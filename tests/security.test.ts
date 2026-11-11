import crypto from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { createPolicyEngine } from '../packages/core/src/index.js';
import type { SpendingPolicy } from '../packages/core/src/types.js';

const AGENT_KEY = 'shlt_test_sentinel_key_01';
const OTHER_KEY = 'shlt_test_other_org_key_01';
const OPERATOR_ALPHA = 'a'.repeat(40);
const OPERATOR_BETA = 'b'.repeat(40);

const alphaPolicy: SpendingPolicy = {
  agentId: 'agent-sentinel-01',
  allowedVendors: ['api.helius.xyz'],
  maxPerCallMicroUsdc: 50_000n,
  periodBudgetMicroUsdc: 200_000n,
  periodSeconds: 3600,
  circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 8 },
};

const betaPolicy: SpendingPolicy = {
  ...alphaPolicy,
  agentId: 'agent-beta-01',
};

function proxyBody(agentId?: string) {
  return JSON.stringify({
    ...(agentId ? { agentId } : {}),
    vendor: 'api.helius.xyz',
    path: '/v0/token-metadata',
    method: 'POST',
    body: { mints: ['test'] },
    simulate: true,
    idempotencyKey: `sec-${crypto.randomUUID()}`,
  });
}

describe('Shlita security foundation', () => {
  let engine: ReturnType<typeof createPolicyEngine>;
  let app: ReturnType<typeof createGatewayApp>;

  beforeEach(() => {
    engine = createPolicyEngine();
    engine.registerAgent(alphaPolicy, { rawApiKey: AGENT_KEY, ownerOrg: 'org-alpha' });
    engine.registerAgent(betaPolicy, { rawApiKey: OTHER_KEY, ownerOrg: 'org-beta' });
    app = createGatewayApp(engine, undefined, {
      operators: [
        { key: OPERATOR_ALPHA, ownerOrg: 'org-alpha' },
        { key: OPERATOR_BETA, ownerOrg: 'org-beta' },
      ],
      allowSimulation: true,
      corsOrigins: ['http://localhost:5173'],
      maxJsonBytes: 1024,
    });
  });

  afterEach(() => {
    engine.close();
  });

  it('rejects a proxy call that presents a valid agentId and no credential', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.allowed).not.toBe(true);
    expect(JSON.stringify(body)).not.toContain(AGENT_KEY);
    expect(engine.getAgentState('agent-sentinel-01').currentPeriodSpendMicroUsdc).toBe(0n);
  });

  it('rejects a proxy call with an incorrect API key even when agentId is valid', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': 'shlt_test_wrong_key_0001',
      },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(res.status).toBe(401);
    expect(engine.getAgentState('agent-sentinel-01').currentPeriodSpendMicroUsdc).toBe(0n);
  });

  it('allows a proxy call when the API key matches the authenticated agent', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': AGENT_KEY,
        'x-shlita-simulation': 'true',
      },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-shlita-decision')).toBe('ALLOWED');
    const body = await res.json();
    expect(body.mode).toBe('simulated');
    expect(body.success).toBe(true);
  });

  it('accepts a properly parsed Bearer credential for the same agent', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AGENT_KEY}`,
      },
      body: proxyBody(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-shlita-decision')).toBe('ALLOWED');
  });

  it('rejects a correct key when the body agentId belongs to someone else', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': AGENT_KEY,
      },
      body: proxyBody('agent-beta-01'),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(JSON.stringify(body)).not.toContain(OTHER_KEY);
    expect(engine.getAgentState('agent-beta-01').currentPeriodSpendMicroUsdc).toBe(0n);
    expect(engine.getAgentState('agent-sentinel-01').currentPeriodSpendMicroUsdc).toBe(0n);
  });

  it('rejects unsupported authentication schemes without echoing the header', async () => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic c2VjcmV0OnNlY3JldA==',
      },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('c2VjcmV0');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('rejects revoked and expired agent credentials', async () => {
    engine.revokeAgentKey('agent-sentinel-01');
    const revoked = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': AGENT_KEY },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(revoked.status).toBe(401);

    const fresh = createPolicyEngine();
    fresh.registerAgent(alphaPolicy, {
      rawApiKey: 'shlt_test_expired_key_01',
      ownerOrg: 'org-alpha',
      expiresAt: Date.now() - 1000,
    });
    const expiredApp = createGatewayApp(fresh, undefined, { allowSimulation: true });
    const expired = await expiredApp.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': 'shlt_test_expired_key_01',
      },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(expired.status).toBe(401);
    fresh.close();
  });

  it.each([
    ['freeze', '/v1/agents/agent-sentinel-01/freeze'],
    ['unfreeze', '/v1/agents/agent-sentinel-01/unfreeze'],
    ['reset-circuit', '/v1/agents/agent-sentinel-01/reset-circuit'],
  ])('rejects an anonymous %s request', async (_name, route) => {
    const res = await app.request(route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'nope' }),
    });
    expect(res.status).toBe(401);
    expect(engine.getAgentState('agent-sentinel-01').status).toBe('ACTIVE');
  });

  it('rejects an agent key used against an operator action', async () => {
    const res = await app.request('/v1/agents/agent-sentinel-01/freeze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': AGENT_KEY,
      },
      body: JSON.stringify({ reason: 'agent trying to freeze' }),
    });
    expect(res.status).toBe(401);
    expect(engine.getAgentState('agent-sentinel-01').status).toBe('ACTIVE');
    const denied = engine.getAuditLogs().find((entry) => entry.action === 'freeze');
    expect(denied?.decision).toBe('BLOCKED');
  });

  it('allows an operator to freeze an agent in their own organization and audits it', async () => {
    const res = await app.request('/v1/agents/agent-sentinel-01/freeze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-operator-key': OPERATOR_ALPHA,
      },
      body: JSON.stringify({ reason: 'operator hold' }),
    });
    expect(res.status).toBe(200);
    expect(engine.getAgentState('agent-sentinel-01').status).toBe('AGENT_FROZEN');
    const allowed = engine.getAuditLogs().find((entry) => entry.action === 'freeze');
    expect(allowed?.decision).toBe('ALLOWED');
    expect(JSON.stringify(allowed)).not.toContain(OPERATOR_ALPHA);

    const blocked = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': AGENT_KEY },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).reason).toBe('AGENT_FROZEN');
  });

  it('rejects an operator managing an agent owned by another organization', async () => {
    const res = await app.request('/v1/agents/agent-sentinel-01/unfreeze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-operator-key': OPERATOR_BETA,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('org-alpha');
    expect(JSON.stringify(body)).not.toContain(OPERATOR_BETA);
    const denied = engine.getAuditLogs().find((entry) => entry.action === 'unfreeze');
    expect(denied?.decision).toBe('BLOCKED');
  });

  it('rejects unauthenticated reads of agents, audit, and telemetry', async () => {
    for (const route of ['/v1/agents', '/v1/audit', '/v1/telemetry']) {
      const res = await app.request(route);
      expect(res.status).toBe(401);
    }
  });

  it('lists only the authenticated operator organization and hides credentials', async () => {
    const res = await app.request('/v1/agents', {
      headers: { 'x-shlita-operator-key': OPERATOR_ALPHA },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.agents.map((agent: { agentId: string }) => agent.agentId);
    expect(ids).toEqual(['agent-sentinel-01']);
    const encoded = JSON.stringify(body);
    expect(encoded).not.toContain(AGENT_KEY);
    expect(encoded).not.toContain(OTHER_KEY);
    expect(encoded).not.toContain(OPERATOR_ALPHA);
  });

  it('keeps the public health check free of credentials and financial records', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    const encoded = JSON.stringify(body);
    expect(encoded).not.toContain(AGENT_KEY);
    expect(encoded).not.toContain('currentPeriodSpend');
    expect(encoded).not.toContain(OPERATOR_ALPHA);
  });

  it('does not reflect arbitrary origins and never emits a wildcard CORS header', async () => {
    const denied = await app.request('/v1/agents', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();

    const allowed = await app.request('/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(allowed.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('rejects oversized and malformed proxy payloads', async () => {
    const oversized = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': AGENT_KEY },
      body: JSON.stringify({ vendor: 'api.helius.xyz', blob: 'x'.repeat(2000) }),
    });
    expect(oversized.status).toBe(413);

    const malformed = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': AGENT_KEY },
      body: '{',
    });
    expect(malformed.status).toBe(400);
  });

  it('rejects simulation when the gateway is not in an authorized demo mode', async () => {
    const locked = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR_ALPHA, ownerOrg: 'org-alpha' }],
      allowSimulation: false,
    });
    const res = await locked.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': AGENT_KEY,
        'x-shlita-simulation': 'true',
      },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('SIMULATION_DISABLED');
    expect(engine.getAgentState('agent-sentinel-01').currentPeriodSpendMicroUsdc).toBe(0n);
  });

  it('rejects an empty credential, a short Bearer token, and a provider method or path that is not allowed', async () => {
    const empty = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': '   ' },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(empty.status).toBe(401);

    const shortBearer = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: proxyBody('agent-sentinel-01'),
    });
    expect(shortBearer.status).toBe(401);

    const method = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': AGENT_KEY },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'api.helius.xyz',
        method: 'DELETE',
        path: '/v0/token-metadata',
        simulate: true,
      }),
    });
    expect(method.status).toBe(405);

    const path = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': AGENT_KEY },
      body: JSON.stringify({
        agentId: 'agent-sentinel-01',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/admin/keys',
        simulate: true,
      }),
    });
    expect(path.status).toBe(403);
    expect((await path.json()).error).toBe('PATH_NOT_ALLOWED');
    expect(engine.getAgentState('agent-sentinel-01').currentPeriodSpendMicroUsdc).toBe(0n);
  });

  it('keeps an existing agent key valid across restart until it is rotated', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-ledger-'));
    const dbPath = path.join(dir, 'ledger.db');
    const first = createPolicyEngine(dbPath);
    const created = first.registerAgent(alphaPolicy, {
      rawApiKey: AGENT_KEY,
      ownerOrg: 'org-alpha',
    });
    expect(created.apiKey).toBe(AGENT_KEY);
    first.close();

    const restarted = createPolicyEngine(dbPath);
    expect(restarted.authenticateApiKey(AGENT_KEY)?.agentId).toBe('agent-sentinel-01');
    restarted.registerAgent(alphaPolicy, {
      rawApiKey: 'shlt_test_should_not_replace',
      ownerOrg: 'org-alpha',
    });
    expect(restarted.authenticateApiKey(AGENT_KEY)?.agentId).toBe('agent-sentinel-01');
    expect(restarted.authenticateApiKey('shlt_test_should_not_replace')).toBeNull();

    const rotated = restarted.rotateAgentKey('agent-sentinel-01');
    expect(rotated?.apiKey).toBeTruthy();
    expect(rotated?.apiKey).not.toBe(AGENT_KEY);
    expect(restarted.authenticateApiKey(AGENT_KEY)).toBeNull();
    expect(restarted.authenticateApiKey(rotated!.apiKey)?.agentId).toBe('agent-sentinel-01');
    restarted.close();

    const afterRotation = createPolicyEngine(dbPath);
    expect(afterRotation.authenticateApiKey(rotated!.apiKey)?.agentId).toBe('agent-sentinel-01');
    afterRotation.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
