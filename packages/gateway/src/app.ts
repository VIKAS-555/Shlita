import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { PolicyEngine } from '../../core/src/index.js';
import fs from 'node:fs';
import path from 'node:path';

export function createGatewayApp(engine: PolicyEngine) {
  const app = new Hono();

  // Middleware for CORS and logging
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (c.req.method === 'OPTIONS') {
      return c.text('', 204);
    }
    await next();
  });

  // Proxy endpoint for AI Agent outbound requests
  app.post('/v1/proxy', async (c) => {
    const body = await c.req.json();
    const {
      agentId,
      vendor,
      estimatedCostMicroUsdc = '10000',
      method = 'POST',
      path: reqPath = '/',
      payload,
    } = body;

    const costBigInt = BigInt(estimatedCostMicroUsdc);
    const now = Date.now();

    const decision = engine.evaluate({
      agentId,
      vendor,
      estimatedCostMicroUsdc: costBigInt,
      timestamp: now,
    });

    if (!decision.allowed) {
      c.header('x-shlita-decision', 'BLOCKED');
      c.header('x-shlita-violation-reason', decision.reason);
      return c.json(
        {
          allowed: false,
          error: 'POLICY_VIOLATION',
          reason: decision.reason,
          message: decision.message,
          timestamp: now,
        },
        403
      );
    }

    // Mock vendor dispatch with realistic simulated data
    let responseData: any = {
      vendor,
      path: reqPath,
      status: 200,
      timestamp: new Date().toISOString(),
    };

    if (vendor === 'api.helius.xyz') {
      responseData.data = {
        network: 'solana-mainnet-beta',
        slot: 318492048,
        result: {
          account: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          balanceUsdc: 450.25,
          activeSubscriptions: 3,
        },
      };
    } else if (vendor === 'api.tavily.com') {
      responseData.data = {
        query: 'Solana hackathon winners 2026',
        results: [
          { title: 'Top Solana Hackathon Patterns', score: 0.98 },
          { title: 'Solana Foundation Subscriptions Announcement', score: 0.94 },
        ],
      };
    } else {
      responseData.data = { message: 'Upstream vendor request fulfilled successfully' };
    }

    // Record successful execution
    engine.recordExecution(
      {
        agentId,
        vendor,
        estimatedCostMicroUsdc: costBigInt,
        timestamp: now,
      },
      { success: true, actualCostMicroUsdc: costBigInt }
    );

    const state = engine.getAgentState(agentId);

    c.header('x-shlita-decision', 'ALLOWED');
    c.header('x-shlita-spend-micro-usdc', state.currentPeriodSpendMicroUsdc.toString());
    c.header('x-shlita-agent-status', state.status);

    return c.json({
      success: true,
      vendor,
      settlement: {
        costMicroUsdc: costBigInt.toString(),
        currency: 'USDC',
        status: 'SETTLED',
      },
      upstream: responseData,
    });
  });

  // Get all registered agents, policies, and live financial metrics
  app.get('/v1/agents', (c) => {
    const policies = engine.getAllPolicies();
    const states = engine.getAllStates();

    const agents = policies.map((policy) => {
      const state = states.find((s) => s.agentId === policy.agentId);
      const budgetExhausted =
        (state?.currentPeriodSpendMicroUsdc ?? 0n) >= policy.periodBudgetMicroUsdc;

      return {
        agentId: policy.agentId,
        status: state?.status ?? 'ACTIVE',
        freezeReason: state?.freezeReason,
        spending: {
          currentPeriodSpendMicroUsdc: (state?.currentPeriodSpendMicroUsdc ?? 0n).toString(),
          periodBudgetMicroUsdc: policy.periodBudgetMicroUsdc.toString(),
          maxPerCallMicroUsdc: policy.maxPerCallMicroUsdc.toString(),
          totalLifetimeSpendMicroUsdc: (state?.totalLifetimeSpendMicroUsdc ?? 0n).toString(),
          spendPercentage: Number(
            ((state?.currentPeriodSpendMicroUsdc ?? 0n) * 100n) / policy.periodBudgetMicroUsdc
          ),
          budgetExhausted,
        },
        policy: {
          allowedVendors: policy.allowedVendors,
          periodSeconds: policy.periodSeconds,
          circuitBreaker: policy.circuitBreaker,
        },
        consecutiveErrors: state?.consecutiveErrors ?? 0,
      };
    });

    return c.json({ agents });
  });

  // Emergency Freeze
  app.post('/v1/agents/:id/freeze', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    engine.freezeAgent(agentId, body.reason || 'Manual operator freeze');
    return c.json({ success: true, agentId, status: 'AGENT_FROZEN' });
  });

  // Unfreeze
  app.post('/v1/agents/:id/unfreeze', (c) => {
    const agentId = c.req.param('id');
    engine.unfreezeAgent(agentId);
    return c.json({ success: true, agentId, status: 'ACTIVE' });
  });

  // Audit Logs
  app.get('/v1/audit', (c) => {
    const logs = engine.getAuditLogs(50);
    return c.json({ logs });
  });

  // Serve static assets from dist-ui
  app.use('/assets/*', serveStatic({ root: './dist-ui' }));
  app.use('/favicon.ico', serveStatic({ root: './dist-ui' }));

  // Root and SPA Fallback: Serve the React application from dist-ui/index.html
  app.get('*', (c) => {
    const indexPath = path.resolve(process.cwd(), 'dist-ui/index.html');
    if (fs.existsSync(indexPath)) {
      return c.html(fs.readFileSync(indexPath, 'utf-8'));
    }
    return c.text('Shlita UI is building. Please run `npm run build:ui` first.', 503);
  });

  return app;
}
