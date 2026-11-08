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
    expect(data.reason).toBe('UNAPPROVED_VENDOR');

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
});
