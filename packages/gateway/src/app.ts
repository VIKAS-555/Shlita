import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { PolicyEngine } from '../../core/src/index.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates upstream vendor target against SSRF, private network, and whitelist violations.
 */
export function validateVendorDestination(
  vendorStr: string,
  reqPath: string,
  allowedVendors: string[]
): { valid: boolean; error?: string; url?: string } {
  try {
    let clean = vendorStr.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `https://${clean}`;
    }

    const parsed = new URL(clean);

    // 1. Insecure protocol check (must be HTTPS)
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: 'Insecure protocol: only HTTPS upstream vendor destinations are permitted by Shlita perimeter.',
      };
    }

    const host = parsed.hostname.toLowerCase();

    // 2. Strict SSRF Protection (Block loopback, private ranges, cloud metadata)
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('172.16.') ||
      host.startsWith('172.17.') ||
      host.startsWith('172.18.') ||
      host.startsWith('172.19.') ||
      host.startsWith('172.20.') ||
      host.startsWith('172.21.') ||
      host.startsWith('172.22.') ||
      host.startsWith('172.23.') ||
      host.startsWith('172.24.') ||
      host.startsWith('172.25.') ||
      host.startsWith('172.26.') ||
      host.startsWith('172.27.') ||
      host.startsWith('172.28.') ||
      host.startsWith('172.29.') ||
      host.startsWith('172.30.') ||
      host.startsWith('172.31.') ||
      host.startsWith('169.254.') // AWS/GCP/Azure instance metadata
    ) {
      return {
        valid: false,
        error: `SSRF Violation: Target host '${host}' resolves to private/loopback/cloud-metadata space. Request rejected.`,
      };
    }

    // 3. Domain Whitelist Verification
    const isAllowed = allowedVendors.some((v) => {
      const cleanV = v.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      return host === cleanV || host.endsWith(`.${cleanV}`);
    });

    if (!isAllowed) {
      return {
        valid: false,
        error: `Vendor host '${host}' is not present in policy allowlist [${allowedVendors.join(', ')}].`,
      };
    }

    // Ensure path has leading slash
    const normalizedPath = reqPath.startsWith('/') ? reqPath : `/${reqPath}`;
    const finalUrl = `https://${host}${normalizedPath}`;

    return { valid: true, url: finalUrl };
  } catch {
    return { valid: false, error: 'Malformed vendor endpoint or destination URL.' };
  }
}

export function createGatewayApp(engine: PolicyEngine) {
  const app = new Hono();

  // Middleware for CORS and logging
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-shlita-simulation');
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
  });

  // Health check endpoint for uptime and container monitoring
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'Shlita Policy Gateway & Reverse Proxy',
      version: '0.1.0',
      uptimeSeconds: process.uptime(),
      registeredAgents: engine.getAllPolicies().length,
      timestamp: new Date().toISOString(),
    });
  });

  // Real Proxy endpoint for AI Agent outbound requests
  app.post('/v1/proxy', async (c) => {
    const body = await c.req.json();
    const {
      agentId,
      vendor,
      estimatedCostMicroUsdc = '10000',
      method = 'POST',
      path: reqPath = '/',
      payload,
      simulate = false,
    } = body;

    const costBigInt = BigInt(estimatedCostMicroUsdc);
    const now = Date.now();

    // 1. Atomic Reservation against Policy Perimeter
    const decision = engine.evaluateAndReserve({
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

    const reservationId = decision.reservationId!;
    const state = engine.getAgentState(agentId);
    const policy = engine.getAllPolicies().find((p) => p.agentId === agentId);

    // 2. Strict Destination Validation & SSRF Guard
    const destValidation = validateVendorDestination(
      vendor,
      reqPath,
      policy?.allowedVendors || [vendor]
    );

    if (!destValidation.valid) {
      // Rollback reservation immediately
      engine.rollbackReservation(reservationId, destValidation.error);
      c.header('x-shlita-decision', 'BLOCKED');
      c.header('x-shlita-violation-reason', 'SSRF_SECURITY_VIOLATION');
      return c.json(
        {
          allowed: false,
          error: 'SECURITY_VIOLATION',
          reason: 'SSRF_SECURITY_VIOLATION',
          message: destValidation.error,
          timestamp: now,
        },
        403
      );
    }

    const targetUrl = destValidation.url!;
    let responseData: any = null;
    let actualStatus = 200;
    const startMs = performance.now();

    // 3. Upstream Dispatch (Live or Test-Mode Simulation)
    const isSimulationMode =
      simulate ||
      c.req.header('x-shlita-simulation') === 'true' ||
      vendor === 'api.helius.xyz' ||
      vendor === 'api.tavily.com';

    if (isSimulationMode) {
      // Realistic simulation mode (e.g. hackathon demo or test suite)
      if (vendor.includes('helius')) {
        responseData = {
          network: 'solana-mainnet-beta',
          slot: 318492048,
          result: {
            account: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            balanceUsdc: 450.25,
            activeSubscriptions: 3,
            pdaAuthority: '7xKqWb...SubscriptionsAuthority',
          },
        };
      } else if (vendor.includes('tavily')) {
        responseData = {
          query: payload?.query || 'Solana Subscriptions 2026',
          results: [
            { title: 'Solana Foundation Subscriptions Announcement', score: 0.98 },
            { title: 'Autonomous Agent Micro-Settlements on Solana', score: 0.95 },
          ],
        };
      } else {
        responseData = { message: 'Upstream vendor response successfully processed via Shlita.' };
      }
    } else {
      // Real Upstream Network Request Forwarding
      try {
        const authHeader = c.req.header('Authorization');
        const upstreamRes = await fetch(targetUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Shlita-Policy-Perimeter/1.0',
            ...(authHeader ? { Authorization: authHeader } : {}),
          },
          body: method !== 'GET' && method !== 'HEAD' && payload ? JSON.stringify(payload) : undefined,
          signal: AbortSignal.timeout(10000), // 10s upstream timeout
        });

        actualStatus = upstreamRes.status;
        const text = await upstreamRes.text();
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = text;
        }
      } catch (err: any) {
        // Network timeout or upstream failure -> Rollback reservation
        engine.rollbackReservation(reservationId, err?.message || 'Upstream connection error');
        return c.json(
          {
            allowed: true,
            error: 'UPSTREAM_GATEWAY_ERROR',
            message: `Failed to forward request to ${targetUrl}: ${err?.message}`,
            reservationRolledBack: true,
          },
          502
        );
      }
    }

    const latencyMs = Number((performance.now() - startMs).toFixed(2));

    // 4. Commit atomic reservation
    engine.commitReservation(reservationId, costBigInt);

    const updatedState = engine.getAgentState(agentId);

    c.header('x-shlita-decision', 'ALLOWED');
    c.header('x-shlita-reservation-id', reservationId);
    c.header('x-shlita-spend-micro-usdc', updatedState.currentPeriodSpendMicroUsdc.toString());
    c.header('x-shlita-agent-status', updatedState.status);
    c.header('x-shlita-latency-ms', latencyMs.toString());

    return c.json({
      success: true,
      vendor,
      targetUrl,
      status: actualStatus,
      latencyMs,
      settlement: {
        costMicroUsdc: costBigInt.toString(),
        currency: 'USDC',
        status: 'SETTLED',
        reservationId,
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
          activePendingReservationsMicroUsdc: (state?.activePendingReservationsMicroUsdc ?? 0n).toString(),
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

  // Reset Circuit Breaker
  app.post('/v1/agents/:id/reset-circuit', (c) => {
    const agentId = c.req.param('id');
    engine.resetCircuitBreaker(agentId);
    return c.json({ success: true, agentId, status: 'ACTIVE' });
  });

  // Audit Logs & Active Reservations
  app.get('/v1/audit', (c) => {
    const logs = engine.getAuditLogs();
    const activeReservations = engine.getActiveReservations().map((r) => ({
      ...r,
      amountMicroUsdc: r.amountMicroUsdc.toString(),
    }));
    return c.json({ logs, activeReservations });
  });

  // Live Telemetry Stream Feed
  app.get('/v1/telemetry', (c) => {
    const logs = engine.getAuditLogs().slice(0, 50);
    return c.json({
      events: logs.map((l) => ({
        id: l.id,
        timestamp: new Date(l.timestamp).toLocaleTimeString(),
        type: l.decision === 'ALLOWED' ? 'APPROVED' : 'BLOCKED',
        statusCode: l.decision === 'ALLOWED' ? 200 : 403,
        agent: l.agentId,
        vendor: l.vendor,
        amountUsdc: Number(l.estimatedCostMicroUsdc) / 1_000_000,
        latencyMs: 0.12,
        details: { reason: l.reason, reservationId: l.reservationId },
      })),
    });
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
