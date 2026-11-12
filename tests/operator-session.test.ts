import { describe, expect, it } from 'vitest';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { createPolicyEngine } from '../packages/core/src/index.js';
import { formatMicroUsdc } from '../packages/core/src/money.js';
import { OperatorSessionStore } from '../packages/gateway/src/session.js';

const OPERATOR_A = 'a'.repeat(40);
const OPERATOR_B = 'b'.repeat(40);
const AGENT_A = 'shlt_test_session_agent_a1';
const AGENT_B = 'shlt_test_session_agent_b1';

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  const pair = raw.split(';')[0];
  if (!pair.startsWith('shlita_session=')) throw new Error(`No session cookie: ${raw}`);
  return pair;
}

describe('operator sessions', () => {
  it('formats micro-USDC from integer text without using a JavaScript number', () => {
    expect(formatMicroUsdc('10000')).toBe('0.010000');
    expect(formatMicroUsdc('0')).toBe('0.000000');
    expect(formatMicroUsdc('1000000000000000001')).toBe('1000000000000.000001');
  });

  it('signs in with a short-lived cookie and does not return the operator key', async () => {
    const engine = createPolicyEngine();
    engine.registerAgent(policy('agent-session-a'), { rawApiKey: AGENT_A, ownerOrg: 'org-a' });
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR_A, ownerOrg: 'org-a' }],
      allowSimulation: true,
    });
    const response = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.20' },
      body: JSON.stringify({ operatorKey: OPERATOR_A }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(OPERATOR_A);
    expect(body.organizationId).toBe('org-a');
    expect(body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    const cookie = cookieFrom(response);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');

    const session = await app.request('/v1/session', { headers: { cookie } });
    expect(session.status).toBe(200);
    const agents = await app.request('/v1/agents', { headers: { cookie } });
    expect(agents.status).toBe(200);
    const listed = await agents.json();
    expect(listed.agents.map((agent: { agentId: string }) => agent.agentId)).toEqual(['agent-session-a']);
    expect(listed.agents[0].credentialStatus).toBe('enrolled');
    expect(JSON.stringify(listed)).not.toContain(AGENT_A);
  });

  it('rejects a wrong key, an expired session, and a logout', async () => {
    let now = 1_000_000;
    const sessions = new OperatorSessionStore({ now: () => now, ttlMs: 1_000 });
    const engine = createPolicyEngine();
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR_A, ownerOrg: 'org-a' }],
      sessions,
    });
    const wrong = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.21' },
      body: JSON.stringify({ operatorKey: 'not-the-operator-key-value-here' }),
    });
    expect(wrong.status).toBe(403);
    expect(JSON.stringify(await wrong.json())).not.toContain('not-the-operator-key-value-here');

    const signed = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.22' },
      body: JSON.stringify({ operatorKey: OPERATOR_A }),
    });
    const cookie = cookieFrom(signed);
    const csrf = (await signed.json()).csrfToken as string;
    now += 1_001;
    const expired = await app.request('/v1/agents', { headers: { cookie } });
    expect(expired.status).toBe(401);

    now = 2_000_000;
    const again = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.22' },
      body: JSON.stringify({ operatorKey: OPERATOR_A }),
    });
    const freshCookie = cookieFrom(again);
    const freshCsrf = (await again.json()).csrfToken as string;
    const logout = await app.request('/v1/session/logout', {
      method: 'POST',
      headers: { cookie: freshCookie, 'x-shlita-csrf': freshCsrf },
    });
    expect(logout.status).toBe(200);
    const after = await app.request('/v1/session', { headers: { cookie: freshCookie } });
    expect(after.status).toBe(401);
    expect(csrf).not.toBe(freshCsrf);
  });

  it('requires a CSRF token for a cookie-authenticated freeze and rate-limits sign-in', async () => {
    const sessions = new OperatorSessionStore({ maxFailures: 3, windowMs: 60_000 });
    const engine = createPolicyEngine();
    engine.registerAgent(policy('agent-session-a'), { rawApiKey: AGENT_A, ownerOrg: 'org-a' });
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR_A, ownerOrg: 'org-a' }],
      sessions,
    });
    const signed = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.30' },
      body: JSON.stringify({ operatorKey: OPERATOR_A }),
    });
    const cookie = cookieFrom(signed);
    const csrf = (await signed.json()).csrfToken as string;
    const missing = await app.request('/v1/agents/agent-session-a/freeze', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'stop' }),
    });
    expect(missing.status).toBe(403);
    expect((await missing.json()).error).toBe('CSRF');

    const frozen = await app.request('/v1/agents/agent-session-a/freeze', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-shlita-csrf': csrf },
      body: JSON.stringify({ reason: 'stop' }),
    });
    expect(frozen.status).toBe(200);
    const agents = await app.request('/v1/agents', { headers: { cookie } });
    expect((await agents.json()).agents[0].status).toBe('AGENT_FROZEN');

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const denied = await app.request('/v1/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.31' },
        body: JSON.stringify({ operatorKey: 'wrong-operator-key-0123456789' }),
      });
      expect(denied.status).toBe(403);
    }
    const limited = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.31' },
      body: JSON.stringify({ operatorKey: OPERATOR_A }),
    });
    expect(limited.status).toBe(429);
  });

  it('does not show another organization its agents, operations, or totals', async () => {
    const engine = createPolicyEngine();
    engine.registerAgent(policy('agent-session-a'), { rawApiKey: AGENT_A, ownerOrg: 'org-a' });
    engine.registerAgent(policy('agent-session-b'), { rawApiKey: AGENT_B, ownerOrg: 'org-b' });
    const app = createGatewayApp(engine, undefined, {
      operators: [
        { key: OPERATOR_A, ownerOrg: 'org-a' },
        { key: OPERATOR_B, ownerOrg: 'org-b' },
      ],
      allowSimulation: true,
    });
    const proxy = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-api-key': AGENT_A, 'x-shlita-simulation': 'true' },
      body: JSON.stringify({
        agentId: 'agent-session-a',
        vendor: 'api.helius.xyz',
        estimatedCostMicroUsdc: '15000',
        method: 'POST',
        path: '/v0/token-metadata',
        body: { mints: ['local'] },
        idempotencyKey: 'session-op-01',
        simulate: true,
      }),
    });
    expect(proxy.status).toBe(200);

    const signed = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.40' },
      body: JSON.stringify({ operatorKey: OPERATOR_B }),
    });
    const cookie = cookieFrom(signed);
    const agents = await app.request('/v1/agents', { headers: { cookie } });
    const operations = await app.request('/v1/operations', { headers: { cookie } });
    const dashboard = await app.request('/v1/dashboard', { headers: { cookie } });
    expect((await agents.json()).agents.map((agent: { agentId: string }) => agent.agentId)).toEqual(['agent-session-b']);
    expect((await operations.json()).operations).toEqual([]);
    const totals = await dashboard.json();
    expect(totals.organizationId).toBe('org-b');
    expect(totals.accountedSpendMicroUsdc).toBe('0');
    expect(totals.agents.total).toBe(1);

    const owner = await app.request('/v1/operations', { headers: { 'x-shlita-operator-key': OPERATOR_A } });
    const rows = await owner.json();
    expect(rows.operations).toHaveLength(1);
    expect(rows.operations[0].reservedAmountMicroUsdc).toBe('10000');
    expect(rows.operations[0].signature).toBeNull();
    expect(rows.operations[0].settlementStatus).toBe('NOT_SUBMITTED');
    expect(rows.operations[0].costBasis).toBe('ESTIMATED');
  });

  it('issues an agent credential once and does not list it again', async () => {
    const engine = createPolicyEngine();
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR_A, ownerOrg: 'org-a' }],
    });
    const signed = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.50' },
      body: JSON.stringify({ operatorKey: OPERATOR_A }),
    });
    const cookie = cookieFrom(signed);
    const csrf = (await signed.json()).csrfToken as string;
    const created = await app.request('/v1/agents', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-shlita-csrf': csrf },
      body: JSON.stringify({
        agentId: 'agent-enrolled',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: '50000',
        periodBudgetMicroUsdc: '1000000',
      }),
    });
    expect(created.status).toBe(201);
    const issued = await created.json();
    expect(issued.apiKey).toMatch(/^shlt_live_/);
    const listed = await app.request('/v1/agents', { headers: { cookie } });
    expect(JSON.stringify(await listed.json())).not.toContain(issued.apiKey);
  });
});

function policy(agentId: string) {
  return {
    agentId,
    allowedVendors: ['api.helius.xyz'],
    maxPerCallMicroUsdc: 50_000n,
    periodBudgetMicroUsdc: 1_000_000n,
    periodSeconds: 3600,
    circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 10 },
  };
}
