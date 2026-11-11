import { describe, it, expect, beforeEach } from 'vitest';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { createPolicyEngine } from '../packages/core/src/index.js';

const AGENT_KEY = 'shlt_test_gateway_agent_01';
const OPERATOR_KEY = 'o'.repeat(40);

describe('Shlita Gateway HTTP Seam', () => {
  let app: ReturnType<typeof createGatewayApp>;
  let engine: ReturnType<typeof createPolicyEngine>;

  beforeEach(() => {
    engine = createPolicyEngine();
    engine.registerAgent(
      {
        agentId: 'agent-sentinel-01',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 30_000n, // $0.03
        periodBudgetMicroUsdc: 100_000n, // $0.10
        periodSeconds: 3600,
        circuitBreaker: {
          maxConsecutiveErrors: 2,
          maxCallsPerMinute: 5,
        },
      },
      { rawApiKey: AGENT_KEY, ownerOrg: 'org-sentinel' }
    );
    app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR_KEY, ownerOrg: 'org-sentinel' }],
      allowSimulation: true,
      corsOrigins: ['http://localhost:5173'],
    });
  });

  function agentHeaders(extra: Record<string, string> = {}) {
    return {
      'Content-Type': 'application/json',
      'x-shlita-api-key': AGENT_KEY,
      'x-shlita-simulation': 'true',
      ...extra,
    };
  }

  it('proxies authorized requests and injects Shlita governance headers', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'api.helius.xyz',
        estimatedCostMicroUsdc: '15000',
        method: 'POST',
        path: '/v0/token-metadata',
        body: { mints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'] },
        idempotencyKey: 'gateway-proxy-allow-01',
        simulate: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-shlita-decision')).toBe('ALLOWED');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.vendor).toBe('api.helius.xyz');
    expect(data.mode).toBe('simulated');
  });

  it('blocks unapproved vendor with 403 Forbidden and violation details', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'unauthorized-drainer.io',
        estimatedCostMicroUsdc: '5000',
        method: 'GET',
        path: '/drain',
        simulate: true,
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.allowed).toBe(false);
    expect(data.reason).toBe('UNAPPROVED_VENDOR');
  });

  it('allows manual freeze and blocks subsequent requests', async () => {
    const freezeRes = await app.request('/v1/agents/agent-sentinel-01/freeze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-operator-key': OPERATOR_KEY,
      },
      body: JSON.stringify({ reason: 'Operator test freeze' }),
    });
    expect(freezeRes.status).toBe(200);

    const proxyRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'api.helius.xyz',
        path: '/v0/token-metadata',
        estimatedCostMicroUsdc: '10000',
        idempotencyKey: 'gateway-frozen-followup-01',
        simulate: true,
      }),
    });
    expect(proxyRes.status).toBe(403);
    const data = await proxyRes.json();
    expect(data.reason).toBe('AGENT_FROZEN');
  });

  it('strictly blocks SSRF attempts targeting localhost or private IPs', async () => {
    const loopbackRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'http://127.0.0.1:8080',
        estimatedCostMicroUsdc: '5000',
        path: '/admin/keys',
        simulate: true,
      }),
    });
    expect(loopbackRes.status).toBe(403);
    const data = await loopbackRes.json();
    expect(data.reason).toBe('SSRF_SECURITY_VIOLATION');

    const metadataRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'http://169.254.169.254',
        estimatedCostMicroUsdc: '5000',
        path: '/latest/meta-data',
        simulate: true,
      }),
    });
    expect(metadataRes.status).toBe(403);
    const metaData = await metadataRes.json();
    expect(metaData.reason).toBe('SSRF_SECURITY_VIOLATION');
  });

  it('serves gateway health status and live telemetry stream', async () => {
    const healthRes = await app.request('/health');
    expect(healthRes.status).toBe(200);
    const health = await healthRes.json();
    expect(health.status).toBe('ok');
    expect(health.registeredAgents).toBe(1);
    expect(JSON.stringify(health)).not.toContain(AGENT_KEY);

    const anonymous = await app.request('/v1/telemetry');
    expect(anonymous.status).toBe(401);

    const telemRes = await app.request('/v1/telemetry', {
      headers: { 'x-shlita-operator-key': OPERATOR_KEY },
    });
    expect(telemRes.status).toBe(200);
    const telem = await telemRes.json();
    expect(Array.isArray(telem.events)).toBe(true);
  });

  it('authenticates agent via API key header and rejects unauthenticated callers', async () => {
    const creds = engine.registerAgent(
      {
        agentId: 'agent-authenticated-01',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 25_000n,
        periodBudgetMicroUsdc: 100_000n,
        periodSeconds: 3600,
        circuitBreaker: { maxConsecutiveErrors: 2, maxCallsPerMinute: 5 },
      },
      { rawApiKey: 'shlt_test_authenticated_key', ownerOrg: 'org-sentinel' }
    );
    expect(creds.apiKey).toBe('shlt_test_authenticated_key');

    const validRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': 'shlt_test_authenticated_key',
        'x-shlita-simulation': 'true',
      },
      body: JSON.stringify({
        vendor: 'api.helius.xyz',
        path: '/v0/token-metadata',
        body: { query: 'test' },
        idempotencyKey: 'gateway-auth-allow-01',
        simulate: true,
      }),
    });
    expect(validRes.status).toBe(200);
    const validData = await validRes.json();
    expect(validData.success).toBe(true);
    expect(validData.mode).toBe('simulated');
    expect(validData.settlement.status).toBe('NOT_SUBMITTED');
    expect(validData.settlement.fundsMoved).toBe(false);
    expect(validData.cost.costBasis).toBe('ESTIMATED');
    expect(validData.cost.actualCostMicroUsdc).toBeNull();

    const unauthRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-authenticated-01',
        vendor: 'api.helius.xyz',
        path: '/v0/token-metadata',
      }),
    });
    expect(unauthRes.status).toBe(401);
  });

  it('rejects SSRF payloads containing embedded UserInfo or non-443 ports', async () => {
    const userinfoRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'https://admin:secret@api.helius.xyz',
        simulate: true,
      }),
    });
    expect(userinfoRes.status).toBe(403);
    const uiData = await userinfoRes.json();
    expect(uiData.reason).toBe('SSRF_SECURITY_VIOLATION');

    const portRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: agentHeaders(),
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'https://api.helius.xyz:8443',
        simulate: true,
      }),
    });
    expect(portRes.status).toBe(403);
    const portData = await portRes.json();
    expect(portData.reason).toBe('SSRF_SECURITY_VIOLATION');
  });

  it('ShlitaClient SDK connects, sets auth headers, and proxies requests', async () => {
    const { ShlitaClient } = await import('../packages/core/src/client.js');
    const { serve } = await import('@hono/node-server');
    const server = serve({ fetch: app.fetch, port: 4099 });

    try {
      const client = new ShlitaClient({
        apiKey: AGENT_KEY,
        operatorKey: OPERATOR_KEY,
        baseUrl: 'http://localhost:4099',
      });

      const health = await client.getHealth();
      expect(health.status).toBe('ok');

      const response = await client.proxy({
        agentId: 'agent-sentinel-01',
        vendor: 'api.helius.xyz',
        path: '/v0/token-metadata',
        body: { mints: ['test'] },
        idempotencyKey: 'gateway-sdk-allow-01',
        simulate: true,
      });

      expect(response.status).toBe(200);
      expect(response.decision).toBe('ALLOWED');
      expect(response.data.success).toBe(true);
    } finally {
      server.close();
    }
  });
});
