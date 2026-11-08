import { describe, it, expect, beforeEach } from 'vitest';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { createPolicyEngine } from '../packages/core/src/index.js';

describe('Shlita Gateway HTTP Seam', () => {
  let app: ReturnType<typeof createGatewayApp>;
  let engine: ReturnType<typeof createPolicyEngine>;

  beforeEach(() => {
    engine = createPolicyEngine();
    engine.registerAgent({
      agentId: 'agent-sentinel-01',
      allowedVendors: ['api.helius.xyz'],
      maxPerCallMicroUsdc: 30_000n, // $0.03
      periodBudgetMicroUsdc: 100_000n, // $0.10
      periodSeconds: 3600,
      circuitBreaker: {
        maxConsecutiveErrors: 2,
        maxCallsPerMinute: 5,
      },
    });
    app = createGatewayApp(engine);
  });

  it('proxies authorized requests and injects Shlita governance headers', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'api.helius.xyz',
        estimatedCostMicroUsdc: '15000',
        method: 'POST',
        path: '/v0/token-metadata',
        body: { mints: ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'] },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('x-shlita-decision')).toBe('ALLOWED');
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.vendor).toBe('api.helius.xyz');
  });

  it('blocks unapproved vendor with 403 Forbidden and violation details', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'unauthorized-drainer.io',
        estimatedCostMicroUsdc: '5000',
        method: 'GET',
        path: '/drain',
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Operator test freeze' }),
    });
    expect(freezeRes.status).toBe(200);

    const proxyRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'api.helius.xyz',
        estimatedCostMicroUsdc: '10000',
      }),
    });
    expect(proxyRes.status).toBe(403);
    const data = await proxyRes.json();
    expect(data.reason).toBe('AGENT_FROZEN');
  });

  it('strictly blocks SSRF attempts targeting localhost or private IPs', async () => {
    // Attempt SSRF targeting loopback
    const loopbackRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'http://127.0.0.1:8080',
        estimatedCostMicroUsdc: '5000',
        path: '/admin/keys',
      }),
    });
    expect(loopbackRes.status).toBe(403);
    const data = await loopbackRes.json();
    expect(data.reason).toBe('SSRF_SECURITY_VIOLATION');

    // Attempt AWS metadata IP
    const metadataRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'http://169.254.169.254',
        estimatedCostMicroUsdc: '5000',
        path: '/latest/meta-data',
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

    const telemRes = await app.request('/v1/telemetry');
    expect(telemRes.status).toBe(200);
    const telem = await telemRes.json();
    expect(Array.isArray(telem.events)).toBe(true);
  });

  it('authenticates agent via API key header and rejects unauthenticated callers', async () => {
    // Generate agent credentials
    const creds = engine.registerAgent(
      {
        agentId: 'agent-authenticated-01',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 25_000n,
        periodBudgetMicroUsdc: 100_000n,
        periodSeconds: 3600,
        circuitBreaker: { maxConsecutiveErrors: 2, maxCallsPerMinute: 5 },
      },
      { rawApiKey: 'shlt_live_secret_key_123' }
    );

    // Call with valid API key header
    const validRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': 'shlt_live_secret_key_123',
        'x-shlita-simulation': 'true',
      },
      body: JSON.stringify({
        vendor: 'api.helius.xyz',
        path: '/v0/token-metadata',
        body: { query: 'test' },
      }),
    });
    expect(validRes.status).toBe(200);
    const validData = await validRes.json();
    expect(validData.success).toBe(true);
    expect(validData.mode).toBe('simulated');
    expect(validData.settlement.status).toBe('SETTLEMENT_PENDING'); // Honest state, never SETTLED!

    // Call without API key or agentId
    const unauthRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor: 'api.helius.xyz',
        path: '/v0/token-metadata',
      }),
    });
    expect(unauthRes.status).toBe(401);
  });

  it('rejects SSRF payloads containing embedded UserInfo or non-443 ports', async () => {
    // Attempt with embedded credentials: https://user:pass@evil.com
    const userinfoRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'https://admin:secret@api.helius.xyz',
      }),
    });
    expect(userinfoRes.status).toBe(403);
    const uiData = await userinfoRes.json();
    expect(uiData.reason).toBe('SSRF_SECURITY_VIOLATION');

    // Attempt with non-standard port: https://api.helius.xyz:8443
    const portRes = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'https://api.helius.xyz:8443',
      }),
    });
    expect(portRes.status).toBe(403);
    const portData = await portRes.json();
    expect(portData.reason).toBe('SSRF_SECURITY_VIOLATION');
  });
});
