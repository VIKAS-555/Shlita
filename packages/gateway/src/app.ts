import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { PolicyEngine } from '../../core/src/index.js';
import { SolanaSettlementManager } from '../../solana/src/settlement.js';
import { TransactionLifecycleState } from '../../core/src/types.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyCors,
  assertMatchingAgent,
  GatewaySecurityOptions,
  readJsonObject,
  resolveAgentPrincipal,
  resolveOperator,
  simulationRequested,
} from './access.js';

export interface ProviderDefinition {
  id: string;
  canonicalOrigin: string;
  defaultHost: string;
  allowedMethods: string[];
  allowedPathPrefixes: string[];
  tariffMicroUsdc: bigint;
  authHeaderName?: string;
  authParamName?: string;
  envKeyName: string;
  timeoutMs: number;
}

export const PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  helius: {
    id: 'helius',
    canonicalOrigin: 'https://api.helius.xyz',
    defaultHost: 'api.helius.xyz',
    allowedMethods: ['POST', 'GET'],
    allowedPathPrefixes: ['/v0', '/rpc'],
    tariffMicroUsdc: 10_000n, // $0.01 USDC
    authParamName: 'api-key',
    envKeyName: 'HELIUS_API_KEY',
    timeoutMs: 12000,
  },
  'api.helius.xyz': {
    id: 'helius',
    canonicalOrigin: 'https://api.helius.xyz',
    defaultHost: 'api.helius.xyz',
    allowedMethods: ['POST', 'GET'],
    allowedPathPrefixes: ['/v0', '/rpc'],
    tariffMicroUsdc: 10_000n,
    authParamName: 'api-key',
    envKeyName: 'HELIUS_API_KEY',
    timeoutMs: 12000,
  },
  tavily: {
    id: 'tavily',
    canonicalOrigin: 'https://api.tavily.com',
    defaultHost: 'api.tavily.com',
    allowedMethods: ['POST'],
    allowedPathPrefixes: ['/search', '/extract'],
    tariffMicroUsdc: 20_000n, // $0.02 USDC
    authHeaderName: 'Authorization',
    envKeyName: 'TAVILY_API_KEY',
    timeoutMs: 15000,
  },
  'api.tavily.com': {
    id: 'tavily',
    canonicalOrigin: 'https://api.tavily.com',
    defaultHost: 'api.tavily.com',
    allowedMethods: ['POST'],
    allowedPathPrefixes: ['/search', '/extract'],
    tariffMicroUsdc: 20_000n,
    authHeaderName: 'Authorization',
    envKeyName: 'TAVILY_API_KEY',
    timeoutMs: 15000,
  },
};

/**
 * Validates upstream vendor target against SSRF, private network, and whitelist violations.
 */
export function validateVendorDestination(
  vendorStr: string,
  reqPath: string,
  allowedVendors: string[]
): { valid: boolean; error?: string; url?: string; host?: string } {
  try {
    let clean = vendorStr.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `https://${clean}`;
    }

    const parsed = new URL(clean);

    // 1. Strict Protocol Check (Must be HTTPS)
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: 'Insecure protocol: only HTTPS upstream vendor destinations are permitted by Shlita perimeter.',
      };
    }

    // 2. Reject UserInfo (e.g. https://user:pass@host)
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        error: 'SSRF Violation: UserInfo/credentials embedded in vendor URL are prohibited.',
      };
    }

    // 3. Reject non-standard ports
    if (parsed.port && parsed.port !== '443' && parsed.port !== '') {
      return {
        valid: false,
        error: `SSRF Violation: Non-443 port (${parsed.port}) is not permitted.`,
      };
    }

    const host = parsed.hostname.toLowerCase();

    // 4. Strict SSRF Protection (Block loopback, private ranges, link-local, cloud metadata, IPv6 mapped)
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.startsWith('169.254.') || // AWS/GCP/Azure instance metadata
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.')
    ) {
      return {
        valid: false,
        error: `SSRF Violation: Target host '${host}' resolves to private/loopback/cloud-metadata space. Request rejected.`,
      };
    }

    // 5. Domain Whitelist Verification
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

    return { valid: true, url: finalUrl, host };
  } catch {
    return { valid: false, error: 'Malformed vendor endpoint or destination URL.' };
  }
}

function enforceProviderRoute(
  host: string,
  method: string,
  reqPath: string
):
  | { ok: true; method: string }
  | { ok: false; status: 403 | 405; error: string; message: string } {
  const normalized = method.trim().toUpperCase();
  if (!/^[A-Z]{1,16}$/.test(normalized)) {
    return { ok: false, status: 405, error: 'METHOD_NOT_ALLOWED', message: 'Unsupported request method.' };
  }

  const provider = PROVIDER_DEFINITIONS[host];
  if (provider) {
    if (!provider.allowedMethods.includes(normalized)) {
      return { ok: false, status: 405, error: 'METHOD_NOT_ALLOWED', message: 'Unsupported request method.' };
    }
    const pathAllowed = provider.allowedPathPrefixes.some(
      (prefix) => reqPath === prefix || reqPath.startsWith(`${prefix}/`)
    );
    if (!pathAllowed) {
      return {
        ok: false,
        status: 403,
        error: 'PATH_NOT_ALLOWED',
        message: 'Destination path is not permitted for this provider.',
      };
    }
  } else if (!['GET', 'HEAD', 'POST'].includes(normalized)) {
    return { ok: false, status: 405, error: 'METHOD_NOT_ALLOWED', message: 'Unsupported request method.' };
  }

  return { ok: true, method: normalized };
}

export function createGatewayApp(
  engine: PolicyEngine,
  settlementManager?: SolanaSettlementManager,
  security: GatewaySecurityOptions = {}
) {
  const app = new Hono();
  const operators = security.operators ?? [];
  const allowSimulation = security.allowSimulation === true;
  const corsOrigins = security.corsOrigins ?? [];
  const maxJsonBytes = security.maxJsonBytes ?? 65_536;

  app.use('*', async (c, next) => {
    applyCors((name, value) => c.header(name, value), c.req.header('origin'), corsOrigins);
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
  });

  // Health check endpoint for container and uptime monitoring
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
    const parsed = await readJsonObject(c.req.raw, maxJsonBytes);
    if (!parsed.ok) return c.json(parsed.body, parsed.status);
    const rawBody = parsed.value;
    const {
      agentId: rawAgentId,
      vendor,
      estimatedCostMicroUsdc,
      method = 'POST',
      path: reqPath = '/',
      body: clientBody,
      payload: legacyPayload,
      idempotencyKey,
    } = rawBody as {
      agentId?: unknown;
      vendor?: string;
      estimatedCostMicroUsdc?: string | number;
      method?: string;
      path?: string;
      body?: unknown;
      payload?: unknown;
      idempotencyKey?: string;
    };

    const requestPayload = clientBody ?? legacyPayload;
    const now = Date.now();

    const principal = resolveAgentPrincipal(c.req, (token) => engine.authenticateApiKey(token));
    if (!principal.ok) return c.json(principal.body, principal.status);

    const identity = assertMatchingAgent(rawAgentId, principal.principal.agentId);
    if (!identity.ok) return c.json(identity.body, identity.status);
    const resolvedAgentId = identity.agentId;

    if (simulationRequested(rawBody, c.req.header('x-shlita-simulation')) && !allowSimulation) {
      return c.json(
        {
          allowed: false,
          error: 'SIMULATION_DISABLED',
          message: 'Simulation is disabled.',
        },
        403
      );
    }

    if (typeof vendor !== 'string' || !vendor.trim() || typeof reqPath !== 'string') {
      return c.json({ allowed: false, error: 'BAD_REQUEST', message: 'Invalid request.' }, 400);
    }

    const policy = engine.getAllPolicies().find((p) => p.agentId === resolvedAgentId);

    // 2. Strict Destination Validation & SSRF Guard
    const destValidation = validateVendorDestination(
      vendor,
      reqPath,
      policy?.allowedVendors || [vendor]
    );

    if (!destValidation.valid) {
      const isSSRF = destValidation.error?.startsWith('SSRF Violation') || destValidation.error?.startsWith('Insecure protocol');
      const reason = isSSRF ? 'SSRF_SECURITY_VIOLATION' : 'UNAPPROVED_VENDOR';
      c.header('x-shlita-decision', 'BLOCKED');
      c.header('x-shlita-violation-reason', reason);
      return c.json(
        {
          allowed: false,
          error: isSSRF ? 'SECURITY_VIOLATION' : 'POLICY_VIOLATION',
          reason,
          message: destValidation.error,
          timestamp: now,
        },
      403
    );
    }

    const routeCheck = enforceProviderRoute(destValidation.host!, String(method), reqPath);
    if (!routeCheck.ok) {
      return c.json(
        { allowed: false, error: routeCheck.error, message: routeCheck.message },
        routeCheck.status
      );
    }
    const upstreamMethod = routeCheck.method;

    // 3. Server-Side Pricing & Tariffs
    const providerDef = PROVIDER_DEFINITIONS[vendor.toLowerCase()];
    const serverTariff = providerDef?.tariffMicroUsdc ?? 10_000n; // Default $0.01 USDC
    const callerCost = estimatedCostMicroUsdc ? BigInt(estimatedCostMicroUsdc) : 0n;
    // Server calculates authoritative upper-bound reservation quote
    const authoritativeQuoteMicroUsdc = callerCost > serverTariff ? callerCost : serverTariff;

    // 4. Atomic Budget Reservation against Policy Perimeter
    const decision = engine.evaluateAndReserve({
      agentId: resolvedAgentId,
      vendor,
      estimatedCostMicroUsdc: authoritativeQuoteMicroUsdc,
      timestamp: now,
      idempotencyKey,
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

    const targetUrl = destValidation.url!;
    let responseData: any = null;
    let actualStatus = 200;
    const startMs = performance.now();

    // 5. Explicit Simulation Flag (NEVER auto-simulate based on vendor name!)
    const isExplicitSimulation = allowSimulation && simulationRequested(rawBody, c.req.header('x-shlita-simulation'));

    let actualCostMicroUsdc = serverTariff;

    if (isExplicitSimulation) {
      // Explicit Simulation Mode
      if (vendor.includes('helius')) {
        responseData = {
          network: 'solana-devnet',
          slot: 318492048,
          result: {
            account: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
            balanceMicroUsdc: 25000000,
            activeDelegations: 2,
            program: 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44',
          },
        };
      } else if (vendor.includes('tavily')) {
        responseData = {
          query:
            requestPayload &&
            typeof requestPayload === 'object' &&
            'query' in requestPayload &&
            typeof requestPayload.query === 'string'
              ? requestPayload.query
              : 'Solana Subscriptions Protocol',
          results: [
            { title: 'Official Solana Subscriptions & Allowances Program', score: 0.99 },
            { title: 'Autonomous AI Agent Micro-Settlements on Solana', score: 0.96 },
          ],
        };
      } else {
        responseData = { message: 'Simulated upstream response returned under test perimeter.' };
      }
    } else {
      // Real Upstream Network Request Forwarding
      try {
        const upstreamHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'Shlita-Financial-Control-Plane/1.0',
        };

        // Attach server-held provider credentials (NEVER forward agent's Shlita token!)
        let fetchUrl = targetUrl;
        if (providerDef?.envKeyName && process.env[providerDef.envKeyName]) {
          const secret = process.env[providerDef.envKeyName]!;
          if (providerDef.authParamName) {
            const urlObj = new URL(fetchUrl);
            urlObj.searchParams.set(providerDef.authParamName, secret);
            fetchUrl = urlObj.toString();
          } else if (providerDef.authHeaderName) {
            upstreamHeaders[providerDef.authHeaderName] = `Bearer ${secret}`;
          }
        }

        const upstreamRes = await fetch(fetchUrl, {
          method: upstreamMethod,
          headers: upstreamHeaders,
          body:
            upstreamMethod !== 'GET' && upstreamMethod !== 'HEAD' && requestPayload
              ? JSON.stringify(requestPayload)
              : undefined,
          redirect: 'manual', // Prevent redirect-based SSRF hops
          signal: AbortSignal.timeout(providerDef?.timeoutMs || 15000),
        });

        actualStatus = upstreamRes.status;
        const text = await upstreamRes.text();
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = text;
        }

        // Billable status check
        if (actualStatus >= 500) {
          // Upstream 5xx: Rollback reservation
          engine.rollbackReservation(reservationId, `Upstream HTTP ${actualStatus}`);
          return c.json(
            {
              allowed: true,
              error: 'UPSTREAM_GATEWAY_ERROR',
              message: `Upstream vendor ${vendor} responded with status ${actualStatus}`,
              reservationRolledBack: true,
              upstreamStatus: actualStatus,
            },
            502
          );
        }
      } catch (err: any) {
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

    // 6. Commit atomic reservation into ledger
    engine.commitReservation(reservationId, actualCostMicroUsdc);

    const updatedState = engine.getAgentState(resolvedAgentId);

    // 7. Settlement Ledger Orchestration (Honest States)
    // State is SETTLEMENT_PENDING until on-chain submission & confirmation
    const settlementState: TransactionLifecycleState = 'SETTLEMENT_PENDING';

    c.header('x-shlita-decision', 'ALLOWED');
    c.header('x-shlita-reservation-id', reservationId);
    c.header('x-shlita-spend-micro-usdc', updatedState.currentPeriodSpendMicroUsdc.toString());
    c.header('x-shlita-agent-status', updatedState.status);
    c.header('x-shlita-latency-ms', latencyMs.toString());

    return c.json({
      success: true,
      mode: isExplicitSimulation ? 'simulated' : 'live',
      vendor,
      targetUrl,
      status: actualStatus,
      latencyMs,
      lifecycleState: 'VENDOR_SUCCEEDED',
      cost: {
        authorizedQuoteMicroUsdc: authoritativeQuoteMicroUsdc.toString(),
        actualCostMicroUsdc: actualCostMicroUsdc.toString(),
        currency: 'USDC',
      },
      settlement: {
        costMicroUsdc: actualCostMicroUsdc.toString(),
        currency: 'USDC',
        status: settlementState, // NEVER SETTLED!
        reservationId,
      },
      upstream: responseData,
    });
  });

  function auditPrivileged(
    agentId: string,
    action: string,
    decision: 'ALLOWED' | 'BLOCKED',
    actor: string,
    reason?: string
  ) {
    engine.recordPrivilegedAudit({ actor, agentId, action, decision, reason });
  }

  function requireOwnedAgent(c: { req: { header(name: string): string | undefined; param(name: string): string } }, action: string) {
    const agentId = c.req.param('id');
    const operator = resolveOperator(c.req, operators);
    if (!operator.ok) {
      auditPrivileged(agentId, action, 'BLOCKED', 'anonymous', operator.status === 401 ? 'OPERATOR_AUTH_REQUIRED' : 'OPERATOR_FORBIDDEN');
      return {
        ok: false as const,
        status: operator.status,
        body:
          operator.status === 401
            ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
            : { error: 'FORBIDDEN', message: 'Forbidden.' },
      };
    }
    const ownerOrg = engine.getAgentOwnerOrg(agentId);
    if (!ownerOrg || ownerOrg !== operator.ownerOrg) {
      auditPrivileged(agentId, action, 'BLOCKED', `operator:${operator.ownerOrg}`, 'OPERATOR_FORBIDDEN');
      return {
        ok: false as const,
        status: 403 as const,
        body: { error: 'FORBIDDEN', message: 'Forbidden.' },
      };
    }
    return { ok: true as const, agentId, ownerOrg: operator.ownerOrg };
  }

  // Get all registered agents, policies, and live financial metrics
  app.get('/v1/agents', (c) => {
    const operator = resolveOperator(c.req, operators);
    if (!operator.ok) {
      auditPrivileged('*', 'list-agents', 'BLOCKED', 'anonymous', 'OPERATOR_AUTH_REQUIRED');
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    const policies = engine.getAllPolicies().filter((policy) => engine.getAgentOwnerOrg(policy.agentId) === operator.ownerOrg);
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

  // Emergency Freeze (operator, organization scoped)
  app.post('/v1/agents/:id/freeze', async (c) => {
    const parsed = await readJsonObject(c.req.raw, maxJsonBytes);
    if (!parsed.ok) return c.json(parsed.body, parsed.status);
    const gate = requireOwnedAgent(c, 'freeze');
    if (!gate.ok) return c.json(gate.body, gate.status);
    const reason = typeof parsed.value.reason === 'string' ? parsed.value.reason.slice(0, 200) : 'Manual operator freeze';
    engine.freezeAgent(gate.agentId, reason);
    auditPrivileged(gate.agentId, 'freeze', 'ALLOWED', `operator:${gate.ownerOrg}`);
    return c.json({ success: true, agentId: gate.agentId, status: 'AGENT_FROZEN' });
  });

  // Unfreeze (operator, organization scoped)
  app.post('/v1/agents/:id/unfreeze', async (c) => {
    const parsed = await readJsonObject(c.req.raw, maxJsonBytes);
    if (!parsed.ok) return c.json(parsed.body, parsed.status);
    const gate = requireOwnedAgent(c, 'unfreeze');
    if (!gate.ok) return c.json(gate.body, gate.status);
    engine.unfreezeAgent(gate.agentId);
    auditPrivileged(gate.agentId, 'unfreeze', 'ALLOWED', `operator:${gate.ownerOrg}`);
    return c.json({ success: true, agentId: gate.agentId, status: 'ACTIVE' });
  });

  // Reset Circuit Breaker (operator, organization scoped)
  app.post('/v1/agents/:id/reset-circuit', async (c) => {
    const parsed = await readJsonObject(c.req.raw, maxJsonBytes);
    if (!parsed.ok) return c.json(parsed.body, parsed.status);
    const gate = requireOwnedAgent(c, 'reset-circuit');
    if (!gate.ok) return c.json(gate.body, gate.status);
    engine.resetCircuitBreaker(gate.agentId);
    auditPrivileged(gate.agentId, 'reset-circuit', 'ALLOWED', `operator:${gate.ownerOrg}`);
    return c.json({ success: true, agentId: gate.agentId, status: 'ACTIVE' });
  });

  // Audit Logs & Active Reservations
  app.get('/v1/audit', (c) => {
    const operator = resolveOperator(c.req, operators);
    if (!operator.ok) {
      auditPrivileged('*', 'read-audit', 'BLOCKED', 'anonymous', operator.status === 401 ? 'OPERATOR_AUTH_REQUIRED' : 'OPERATOR_FORBIDDEN');
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    const logs = engine.getAuditLogs().filter((entry) => engine.getAgentOwnerOrg(entry.agentId) === operator.ownerOrg);
    return c.json({ logs });
  });

  // Live Telemetry Stream Feed
  app.get('/v1/telemetry', (c) => {
    const operator = resolveOperator(c.req, operators);
    if (!operator.ok) {
      auditPrivileged('*', 'read-telemetry', 'BLOCKED', 'anonymous', operator.status === 401 ? 'OPERATOR_AUTH_REQUIRED' : 'OPERATOR_FORBIDDEN');
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    const logs = engine
      .getAuditLogs()
      .filter((entry) => engine.getAgentOwnerOrg(entry.agentId) === operator.ownerOrg)
      .slice(0, 50);
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
