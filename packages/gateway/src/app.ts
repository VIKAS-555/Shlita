import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { PolicyEngine } from '../../core/src/index.js';
import { SolanaSettlementManager } from '../../solana/src/settlement.js';
import { formatMicroUsdc, parseMicroUsdc } from '../../core/src/money.js';
import { requestFingerprint } from '../../core/src/fingerprint.js';
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
import { OperatorSessionStore, sessionCookie } from './session.js';
import { clientIdentity } from './client-address.js';
import { writeLog } from './log.js';
import crypto from 'node:crypto';

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

function simulatedUpstream(vendor: string, requestPayload: unknown) {
  if (vendor.includes('helius')) {
    return {
      network: 'solana-devnet',
      slot: 318492048,
      result: {
        account: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        balanceMicroUsdc: 25000000,
        activeDelegations: 2,
        program: 'De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44',
      },
    };
  }
  if (vendor.includes('tavily')) {
    return {
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
  }
  return { message: 'Simulated upstream response returned under test perimeter.' };
}

async function dispatchUpstream(
  exchange: { url: string; method: string; body?: unknown; timeoutMs: number },
  providerDef?: ProviderDefinition
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Shlita-Financial-Control-Plane/1.0',
  };
  let fetchUrl = exchange.url;
  if (providerDef?.envKeyName && process.env[providerDef.envKeyName]) {
    const secret = process.env[providerDef.envKeyName]!;
    if (providerDef.authParamName) {
      const urlObj = new URL(fetchUrl);
      urlObj.searchParams.set(providerDef.authParamName, secret);
      fetchUrl = urlObj.toString();
    } else if (providerDef.authHeaderName) {
      headers[providerDef.authHeaderName] = `Bearer ${secret}`;
    }
  }
  const upstreamRes = await fetch(fetchUrl, {
    method: exchange.method,
    headers,
    body:
      exchange.method !== 'GET' && exchange.method !== 'HEAD' && exchange.body !== undefined
        ? JSON.stringify(exchange.body)
        : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(exchange.timeoutMs),
  });
  const text = await upstreamRes.text();
  try {
    return { status: upstreamRes.status, body: JSON.parse(text) };
  } catch {
    return { status: upstreamRes.status, body: text };
  }
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
  const sessions = security.sessions ?? new OperatorSessionStore();
  const secureCookies = security.secureCookies === true;
  const trustedProxies = security.trustedProxies ?? [];
  const publicOrigin = security.publicOrigin;
  const lifecycle = security.lifecycle ?? { accepting: true };
  const metrics = {
    requests: 0,
    failed: 0,
    policyBlocks: 0,
    lastDurationMs: 0,
  };

  function peerAddress(source: { header(name: string): string | undefined; env?: unknown }): string | undefined {
    if (security.remoteAddress) return security.remoteAddress(source.header.bind(source));
    const incoming = (source.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
    return incoming?.socket?.remoteAddress;
  }

  function clientAddress(source: { header(name: string): string | undefined; env?: unknown }): string {
    return clientIdentity({
      remoteAddress: peerAddress(source),
      forwardedFor: source.header('x-forwarded-for'),
      realIp: source.header('x-real-ip'),
      trustedProxies,
    });
  }

  function originRejected(source: { header(name: string): string | undefined }): boolean {
    const origin = source.header('origin');
    if (!origin) return false;
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return true;
    }
    const requestHost = source.header('host');
    if (requestHost && originHost === requestHost) return false;
    if (publicOrigin && origin === publicOrigin) return false;
    return !corsOrigins.includes(origin);
  }

  function currentOperator(source: { header(name: string): string | undefined }) {
    if ((source.header('x-shlita-operator-key') ?? '').trim()) {
      const resolved = resolveOperator(source, operators);
      if (!resolved.ok) return resolved;
      return { ok: true as const, ownerOrg: resolved.ownerOrg, via: 'header' as const, sessionId: undefined };
    }
    const session = sessions.readCookie(source.header('cookie'));
    if (!session) return { ok: false as const, status: 401 as const };
    return { ok: true as const, ownerOrg: session.organizationId, via: 'session' as const, sessionId: session.id };
  }

  function csrfRejected(source: { method: string; header(name: string): string | undefined }, operator: ReturnType<typeof currentOperator>): boolean {
    if (!operator.ok || operator.via !== 'session' || !operator.sessionId) return false;
    if (source.method === 'GET' || source.method === 'HEAD') return false;
    return !sessions.csrfOk(operator.sessionId, source.header('x-shlita-csrf'));
  }

  app.use('*', async (c, next) => {
    const started = Date.now();
    const correlationId = c.req.header('x-request-id') || crypto.randomUUID();
    c.header('x-shlita-correlation-id', correlationId);
    applyCors((name, value) => c.header(name, value), c.req.header('origin'), corsOrigins);
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    await next();
    metrics.requests += 1;
    metrics.lastDurationMs = Date.now() - started;
    if (c.res.status >= 500) metrics.failed += 1;
    if (c.res.headers.get('x-shlita-decision') === 'BLOCKED') metrics.policyBlocks += 1;
    if (security.logger) {
      writeLog(security.logger, {
        level: c.res.status >= 500 ? 'error' : 'info',
        event: 'request',
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        durationMs: metrics.lastDurationMs,
        correlationId,
      });
    }
  });

  // Health check endpoint for container and uptime monitoring
  app.post('/v1/session', async (c) => {
    const client = clientAddress({ header: (name) => c.req.header(name), env: c.env });
    if (sessions.limited(client)) {
      return c.json({ error: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' }, 429);
    }
    const parsed = await readJsonObject(c.req.raw, maxJsonBytes);
    if (!parsed.ok) return c.json(parsed.body, parsed.status);
    const presented = typeof parsed.value.operatorKey === 'string' ? parsed.value.operatorKey : '';
    if (!presented) {
      sessions.recordFailure(client);
      return c.json({ error: 'UNAUTHORIZED', message: 'Authentication required.' }, 401);
    }
    const resolved = resolveOperator({ header: (name) => (name === 'x-shlita-operator-key' ? presented : undefined) }, operators);
    if (!resolved.ok) {
      sessions.recordFailure(client);
      return c.json(
        resolved.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        resolved.status
      );
    }
    sessions.clearFailures(client);
    const session = sessions.open(resolved.ownerOrg);
    c.header('Set-Cookie', sessionCookie(session.id, Math.floor((session.expiresAt - Date.now()) / 1000), secureCookies));
    c.header('Cache-Control', 'no-store');
    return c.json({
      authenticated: true,
      organizationId: session.organizationId,
      expiresAt: session.expiresAt,
      csrfToken: session.csrfToken,
    });
  });

  app.get('/v1/session', (c) => {
    const operator = currentOperator(c.req);
    if (!operator.ok) return c.json({ authenticated: false }, 401);
    const session = operator.sessionId ? sessions.readCookie(c.req.header('cookie')) : null;
    if (session) {
      const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
      c.header('Set-Cookie', sessionCookie(session.id, maxAge, secureCookies));
    }
    return c.json({
      authenticated: true,
      organizationId: operator.ownerOrg,
      expiresAt: session?.expiresAt ?? null,
      csrfToken: session?.csrfToken ?? null,
    });
  });

  app.post('/v1/session/logout', (c) => {
    const operator = currentOperator(c.req);
    if (operator.ok && csrfRejected(c.req, operator)) {
      return c.json({ error: 'CSRF', message: 'A matching CSRF token is required.' }, 403);
    }
    if (operator.ok && operator.sessionId) sessions.close(operator.sessionId);
    c.header('Set-Cookie', sessionCookie('', 0, secureCookies));
    c.header('Cache-Control', 'no-store');
    return c.json({ authenticated: false });
  });

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

  app.get('/ready', (c) => {
    if (!lifecycle.accepting) return c.json({ status: 'shutting-down' }, 503);
    if (!engine.storageReady()) return c.json({ status: 'storage-unavailable' }, 503);
    return c.json({ status: 'ready' });
  });

  app.get('/metrics', (c) => {
    const counts = engine.operationalCounts();
    const lines = [
      `shlita_requests_total ${metrics.requests}`,
      `shlita_requests_failed_total ${metrics.failed}`,
      `shlita_policy_blocks_total ${metrics.policyBlocks}`,
      `shlita_last_request_duration_ms ${metrics.lastDurationMs}`,
      `shlita_pending_reservations ${counts.pendingReservations}`,
      `shlita_reconciliation_required ${counts.reconciliation}`,
      `shlita_settlement_pending ${counts.settlementPending}`,
      `shlita_database_ready ${engine.storageReady() ? 1 : 0}`,
    ];
    return c.text(lines.join('\n') + '\n');
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

    if (typeof idempotencyKey !== 'string' || !/^[A-Za-z0-9._~:-]{8,200}$/.test(idempotencyKey)) {
      return c.json(
        {
          allowed: false,
          error: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'A billable request requires an idempotency key.',
        },
        400
      );
    }

    let declaredCost: bigint | undefined;
    if (estimatedCostMicroUsdc !== undefined && estimatedCostMicroUsdc !== null && estimatedCostMicroUsdc !== '') {
      const parsedCost = parseMicroUsdc(estimatedCostMicroUsdc);
      if (!parsedCost.ok) {
        return c.json({ allowed: false, error: 'AMOUNT_REJECTED', message: parsedCost.message }, 400);
      }
      declaredCost = parsedCost.amount;
    }

    const providerDef = PROVIDER_DEFINITIONS[vendor.toLowerCase()];
    const serverTariff = providerDef?.tariffMicroUsdc ?? 10_000n;
    const fingerprint = requestFingerprint({
      agentId: resolvedAgentId,
      vendorHost: destValidation.host!,
      method: upstreamMethod,
      path: reqPath,
      body: requestPayload ?? null,
    });

    const claim = engine.claimExecution({
      agentId: resolvedAgentId,
      vendor: destValidation.host!,
      method: upstreamMethod,
      path: reqPath,
      fingerprint,
      idempotencyKey,
      estimatedCostMicroUsdc: serverTariff,
      reservedAmountMicroUsdc: serverTariff,
      declaredCostMicroUsdc: declaredCost,
      timestamp: now,
    });

    if (claim.kind === 'conflict') {
      return c.json(
        {
          allowed: false,
          error: 'IDEMPOTENCY_CONFLICT',
          message: 'This idempotency key was already used for a different request.',
        },
        409
      );
    }
    if (claim.kind === 'in_progress') {
      return c.json(
        {
          allowed: false,
          error: 'OPERATION_IN_PROGRESS',
          operationId: claim.operationId,
          message: 'This operation is already executing. It was not dispatched again.',
        },
        409
      );
    }
    if (claim.kind === 'replay') {
      c.header('x-shlita-idempotent-replay', 'true');
      if (claim.body.reason) c.header('x-shlita-violation-reason', String(claim.body.reason));
      c.header('x-shlita-decision', claim.httpStatus >= 400 ? 'BLOCKED' : 'ALLOWED');
      return c.json(claim.body, claim.httpStatus as 200);
    }
    if (claim.kind === 'rejected') {
      c.header('x-shlita-decision', 'BLOCKED');
      if (claim.body.reason) c.header('x-shlita-violation-reason', String(claim.body.reason));
      return c.json(claim.body, claim.httpStatus as 400);
    }

    const targetUrl = destValidation.url!;
    const isExplicitSimulation = allowSimulation && simulationRequested(rawBody, c.req.header('x-shlita-simulation'));
    const startMs = performance.now();
    let upstreamStatus = 200;
    let upstreamBody: unknown;

    if (isExplicitSimulation) {
      upstreamStatus = 200;
      upstreamBody = simulatedUpstream(vendor, requestPayload);
    } else {
      try {
        const dispatch = security.upstream ?? ((exchange) => dispatchUpstream(exchange, providerDef));
        const upstream = await dispatch({
          url: targetUrl,
          method: upstreamMethod,
          body: requestPayload,
          timeoutMs: providerDef?.timeoutMs || 15000,
        });
        upstreamStatus = upstream.status;
        upstreamBody = upstream.body;
      } catch (error) {
        const finished = engine.finishExecution(claim.operationId, {
          type: 'unknown',
          reason: error instanceof Error ? error.name || error.message : 'Upstream outcome unknown',
        });
        return c.json(finished.body, 504);
      }
    }

    const latencyMs = Number((performance.now() - startMs).toFixed(2));
    if (!isExplicitSimulation && upstreamStatus >= 400) {
      const finished = engine.finishExecution(claim.operationId, {
        type: 'failed',
        httpStatus: 502,
        reason: `Upstream HTTP ${upstreamStatus}`,
        result: {
          allowed: true,
          error: 'UPSTREAM_GATEWAY_ERROR',
          message: `Upstream vendor responded with status ${upstreamStatus}`,
          upstreamStatus,
          reservationRolledBack: true,
          lifecycleState: 'VENDOR_FAILED',
        },
      });
      return c.json(finished.body, finished.httpStatus as 502);
    }

    const responseBody = {
      mode: isExplicitSimulation ? 'simulated' : 'live',
      vendor: destValidation.host,
      targetUrl,
      status: upstreamStatus,
      latencyMs,
      lifecycleState: 'ACCOUNTING_COMMITTED',
      idempotencyKey,
      cost: {
        estimatedCostMicroUsdc: claim.estimatedMicroUsdc.toString(),
        reservedAmountMicroUsdc: claim.reservedMicroUsdc.toString(),
        actualCostMicroUsdc: null,
        settledAmountMicroUsdc: null,
        costBasis: 'ESTIMATED',
        currency: 'USDC',
      },
      settlement: {
        status: 'NOT_SUBMITTED',
        fundsMoved: false,
        reservationId: claim.reservationId,
        currency: 'USDC',
      },
      upstream: upstreamBody,
    };
    const finished = engine.finishExecution(claim.operationId, {
      type: 'succeeded',
      httpStatus: 200,
      result: responseBody,
    });
    if (!finished.ok) {
      c.header('x-shlita-decision', 'BLOCKED');
      return c.json(finished.body, finished.httpStatus as 500);
    }

    const updatedState = engine.getAgentState(resolvedAgentId);
    c.header('x-shlita-decision', 'ALLOWED');
    c.header('x-shlita-reservation-id', claim.reservationId);
    c.header('x-shlita-operation-id', claim.operationId);
    c.header('x-shlita-correlation-id', claim.correlationId);
    c.header('x-shlita-spend-micro-usdc', updatedState.currentPeriodSpendMicroUsdc.toString());
    c.header('x-shlita-agent-status', updatedState.status);
    c.header('x-shlita-latency-ms', latencyMs.toString());
    return c.json(finished.body, 200);
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

  function requireOwnedAgent(c: { req: { method: string; header(name: string): string | undefined; param(name: string): string }; env?: unknown }, action: string) {
    const agentId = c.req.param('id');
    const operator = currentOperator(c.req);
    const address = clientAddress({ header: (name) => c.req.header(name), env: c.env });
    if (operator.ok && operator.via === 'session' && originRejected(c.req)) {
      auditPrivileged(agentId, action, 'BLOCKED', `operator:${operator.ownerOrg}`, 'ORIGIN');
      return {
        ok: false as const,
        status: 403 as const,
        body: { error: 'ORIGIN', message: 'This origin is not allowed to use the operator session.' },
      };
    }
    if (operator.ok && csrfRejected(c.req, operator)) {
      auditPrivileged(agentId, action, 'BLOCKED', `operator:${operator.ownerOrg}`, 'CSRF');
      return {
        ok: false as const,
        status: 403 as const,
        body: { error: 'CSRF', message: 'A matching CSRF token is required.' },
      };
    }
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
    if (sessions.mutationLimited(address)) {
      return {
        ok: false as const,
        status: 429 as const,
        body: { error: 'RATE_LIMITED', message: 'Too many operator actions. Try again later.' },
      };
    }
    sessions.recordMutation(address);
    return { ok: true as const, agentId, ownerOrg: operator.ownerOrg };
  }

  // Get all registered agents, policies, and live financial metrics
  app.get('/v1/agents', (c) => {
    const operator = currentOperator(c.req);
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
        organizationId: operator.ownerOrg,
        credentialStatus: 'enrolled',
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

  app.post('/v1/agents', async (c) => {
    const operator = currentOperator(c.req);
    if (!operator.ok) {
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    if (operator.ok && operator.via === 'session' && originRejected(c.req)) {
      return c.json({ error: 'ORIGIN', message: 'This origin is not allowed to use the operator session.' }, 403);
    }
    if (csrfRejected(c.req, operator)) {
      return c.json({ error: 'CSRF', message: 'A matching CSRF token is required.' }, 403);
    }
    const address = clientAddress({ header: (name) => c.req.header(name), env: c.env });
    if (sessions.mutationLimited(address)) {
      return c.json({ error: 'RATE_LIMITED', message: 'Too many operator actions. Try again later.' }, 429);
    }
    sessions.recordMutation(address);
    const parsed = await readJsonObject(c.req.raw, maxJsonBytes);
    if (!parsed.ok) return c.json(parsed.body, parsed.status);
    const agentId = typeof parsed.value.agentId === 'string' ? parsed.value.agentId.trim() : '';
    if (!/^[A-Za-z0-9._~-]{3,80}$/.test(agentId)) {
      return c.json({ error: 'AGENT_ID_REJECTED', message: 'Agent id must be 3–80 letters, numbers, or . _ ~ -.' }, 400);
    }
    if (engine.getAgentOwnerOrg(agentId)) {
      return c.json({ error: 'AGENT_EXISTS', message: 'An agent with that id already exists.' }, 409);
    }
    const perCall = parseMicroUsdc(parsed.value.maxPerCallMicroUsdc);
    const budget = parseMicroUsdc(parsed.value.periodBudgetMicroUsdc);
    if (!perCall.ok || !budget.ok) {
      return c.json({ error: 'AMOUNT_REJECTED', message: 'Budgets must be positive integer micro-USDC strings.' }, 400);
    }
    if (perCall.amount > budget.amount) {
      return c.json({ error: 'AMOUNT_REJECTED', message: 'The per-call limit cannot exceed the period budget.' }, 400);
    }
    const vendors = Array.isArray(parsed.value.allowedVendors)
      ? parsed.value.allowedVendors.filter((vendor): vendor is string => typeof vendor === 'string' && vendor.length > 0 && vendor.length <= 200)
      : [];
    if (vendors.length === 0) {
      return c.json({ error: 'VENDOR_REQUIRED', message: 'At least one allowed provider host is required.' }, 400);
    }
    const created = engine.registerAgent(
      {
        agentId,
        allowedVendors: vendors,
        maxPerCallMicroUsdc: perCall.amount,
        periodBudgetMicroUsdc: budget.amount,
        periodSeconds: 86_400,
        circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 10 },
      },
      { ownerOrg: operator.ownerOrg }
    );
    return c.json({ agentId, apiKey: created.apiKey, credentialStatus: 'issued' }, 201);
  });

  app.get('/v1/operations', (c) => {
    const operator = currentOperator(c.req);
    if (!operator.ok) {
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 50));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const operations = engine.listOrganizationOperations(operator.ownerOrg);
    return c.json({ operations: operations.slice(offset, offset + limit), total: operations.length });
  });

  app.get('/v1/dashboard', (c) => {
    const operator = currentOperator(c.req);
    if (!operator.ok) {
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    const policies = engine.getAllPolicies().filter((policy) => engine.getAgentOwnerOrg(policy.agentId) === operator.ownerOrg);
    const states = engine.getAllStates().filter((state) => engine.getAgentOwnerOrg(state.agentId) === operator.ownerOrg);
    const operations = engine.listOrganizationOperations(operator.ownerOrg);
    const accountedStates = new Set([
      'ACCOUNTING_COMMITTED',
      'SETTLEMENT_PREPARED',
      'SETTLEMENT_SUBMITTED',
      'SETTLEMENT_CONFIRMATION_PENDING',
      'SETTLEMENT_CONFIRMED',
      'SETTLEMENT_FINALIZED',
      'SETTLEMENT_PENDING',
    ]);
    let accounted = 0n;
    const settlement: Record<string, number> = {};
    const byVendor: Record<string, bigint> = {};
    let blocked = 0;
    let failed = 0;
    let reconciliation = 0;
    for (const operation of operations) {
      const state = String(operation.state);
      const reserved = String(operation.reservedAmountMicroUsdc ?? '0');
      if (accountedStates.has(state)) accounted += BigInt(reserved);
      if (state === 'POLICY_REJECTED') blocked += 1;
      if (state === 'VENDOR_FAILED' || state === 'SETTLEMENT_FAILED') failed += 1;
      if (state === 'RECONCILIATION_REQUIRED' || state === 'EXECUTION_OUTCOME_UNKNOWN') reconciliation += 1;
      const settlementStatus = String(operation.settlementStatus ?? 'NOT_SUBMITTED');
      settlement[settlementStatus] = (settlement[settlementStatus] ?? 0) + 1;
      if (accountedStates.has(state)) {
        const vendor = String(operation.vendor);
        byVendor[vendor] = (byVendor[vendor] ?? 0n) + BigInt(reserved);
      }
    }
    let pending = 0n;
    for (const state of states) pending += state.activePendingReservationsMicroUsdc;
    return c.json({
      generatedAt: new Date().toISOString(),
      source: 'ledger',
      organizationId: operator.ownerOrg,
      agents: {
        total: policies.length,
        active: states.filter((state) => state.status === 'ACTIVE').length,
        frozen: states.filter((state) => state.status === 'AGENT_FROZEN').length,
        circuitTripped: states.filter((state) => state.status === 'CIRCUIT_TRIPPED').length,
      },
      accountedSpendMicroUsdc: accounted.toString(),
      accountedSpend: formatMicroUsdc(accounted.toString()),
      pendingReservationsMicroUsdc: pending.toString(),
      pendingReservations: formatMicroUsdc(pending.toString()),
      blocked,
      failed,
      reconciliation,
      settlement,
      spendByVendor: Object.fromEntries(Object.entries(byVendor).map(([vendor, amount]) => [vendor, { microUsdc: amount.toString(), formatted: formatMicroUsdc(amount.toString()) }])),
    });
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

  app.post('/v1/operations/:operationId/settle', async (c) => {
    const operator = currentOperator(c.req);
    if (!operator.ok) {
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    if (operator.ok && operator.via === 'session' && originRejected(c.req)) {
      return c.json({ error: 'ORIGIN', message: 'This origin is not allowed to use the operator session.', fundsMoved: false }, 403);
    }
    if (csrfRejected(c.req, operator)) {
      return c.json({ error: 'CSRF', message: 'A matching CSRF token is required.', fundsMoved: false }, 403);
    }
    const address = clientAddress({ header: (name) => c.req.header(name), env: c.env });
    if (sessions.mutationLimited(address)) {
      return c.json({ error: 'RATE_LIMITED', message: 'Too many operator actions. Try again later.', fundsMoved: false }, 429);
    }
    sessions.recordMutation(address);
    if (security.settlementEnabled !== true || !security.settlementDestination) {
      return c.json({ error: 'SETTLEMENT_DISABLED', message: 'Settlement is disabled.', fundsMoved: false }, 403);
    }
    const body = await readJsonObject(c.req.raw, maxJsonBytes);
    if (!body.ok) return c.json(body.body, body.status);
    const destination = typeof body.value.destination === 'string' ? body.value.destination : '';
    if (destination !== security.settlementDestination) {
      return c.json({ error: 'DESTINATION_NOT_AUTHORIZED', message: 'Destination is not an authorized counterparty.', fundsMoved: false }, 403);
    }
    const parsed = parseMicroUsdc(body.value.amountMicroUsdc);
    if (!parsed.ok) return c.json({ error: 'AMOUNT_REJECTED', message: parsed.message, fundsMoved: false }, 400);
    const claim = engine.claimChainSettlement({
      operationId: c.req.param('operationId'),
      ownerOrg: operator.ownerOrg,
      destination,
      amountMicroUsdc: parsed.amount,
      mint: settlementManager?.getUsdcMint().toBase58() ?? 'unconfigured',
      cluster: settlementManager?.getCluster() ?? 'localnet',
    });
    if (!claim.ok) return c.json({ error: claim.error, message: claim.message, fundsMoved: false }, claim.httpStatus as 404 | 409 | 503);
    if (claim.replay || !settlementManager) {
      return c.json({ ...claim.settlement, replay: claim.replay, fundsMoved: claim.settlement.fundsMoved === true });
    }
    return c.json({ ...claim.settlement, replay: false, fundsMoved: false, broadcast: false });
  });

  app.get('/v1/reconciliation', (c) => {
    const operator = currentOperator(c.req);
    if (!operator.ok) {
      auditPrivileged('*', 'read-reconciliation', 'BLOCKED', 'anonymous', operator.status === 401 ? 'OPERATOR_AUTH_REQUIRED' : 'OPERATOR_FORBIDDEN');
      return c.json(
        operator.status === 401
          ? { error: 'UNAUTHORIZED', message: 'Authentication required.' }
          : { error: 'FORBIDDEN', message: 'Forbidden.' },
        operator.status
      );
    }
    return c.json({ operations: engine.listReconciliation(operator.ownerOrg) });
  });

  // Audit Logs & Active Reservations
  app.get('/v1/audit', (c) => {
    const operator = currentOperator(c.req);
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
    const operator = currentOperator(c.req);
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
