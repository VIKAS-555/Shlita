import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPolicyEngine } from '../packages/core/src/index.js';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { ShlitaAgentClient, ShlitaApiError, ShlitaOperatorClient } from '../packages/sdk/src/index.js';

const OPERATOR_KEY = 'o'.repeat(40);
const BASE = 'http://127.0.0.1:4010';

function adapter(app: { request: (input: string, init?: RequestInit) => Promise<Response> | Response }): typeof fetch {
  return (input, init) => Promise.resolve(app.request(`${new URL(String(input)).pathname}${new URL(String(input)).search}`, init));
}

describe('SDK against the gateway ledger', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  });

  it('enrolls an agent, commits one simulated spend, replays it, and keeps the row after reopen', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-sdk-'));
    directories.push(directory);
    const dbPath = path.join(directory, 'ledger.db');
    let upstreamCalls = 0;
    const open = () => {
      const engine = createPolicyEngine(dbPath);
      const app = createGatewayApp(engine, undefined, {
        operators: [{ key: OPERATOR_KEY, ownerOrg: 'org-sdk' }],
        allowSimulation: true,
        upstream: async () => {
          upstreamCalls += 1;
          throw new Error('socket hang up');
        },
      });
      return { engine, app };
    };

    let current = open();
    const operator = new ShlitaOperatorClient({ operatorKey: OPERATOR_KEY, baseUrl: BASE, fetch: adapter(current.app) });
    const issued = await operator.enrollAgent({
      agentId: 'research-agent',
      allowedVendors: ['api.helius.xyz'],
      maxPerCallMicroUsdc: '50000',
      periodBudgetMicroUsdc: '1000000',
    });
    expect(issued.credentialStatus).toBe('issued');
    expect(issued.apiKey.startsWith('shlt_live_')).toBe(true);

    const agent = new ShlitaAgentClient({ apiKey: issued.apiKey, baseUrl: BASE, fetch: adapter(current.app) });
    const first = await agent.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      method: 'POST',
      body: { mints: ['example-mint'] },
      idempotencyKey: 'operation-unique-id',
      simulate: true,
    });
    expect(first.outcome).toBe('committed');
    if (first.outcome !== 'committed') return;
    expect(first.cost.reservedAmountMicroUsdc).toBe('10000');
    expect(first.settlement.fundsMoved).toBe(false);
    expect(first.fundsMoved).toBe(false);
    expect(upstreamCalls).toBe(0);

    const replay = await agent.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      method: 'POST',
      body: { mints: ['example-mint'] },
      idempotencyKey: 'operation-unique-id',
      simulate: true,
    });
    expect(replay.outcome).toBe('committed');
    if (replay.outcome === 'committed') expect(replay.replay).toBe(true);

    const conflict = await agent.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      body: { mints: ['different-mint'] },
      idempotencyKey: 'operation-unique-id',
      simulate: true,
    });
    expect(conflict.outcome).toBe('conflict');

    const blocked = await agent.proxy({
      agentId: 'research-agent',
      vendor: 'api.example.com',
      path: '/search',
      idempotencyKey: 'blocked-vendor-01',
      simulate: true,
    });
    expect(blocked.outcome).toBe('rejected');
    if (blocked.outcome === 'rejected') expect(blocked.reason).toBe('UNAPPROVED_VENDOR');

    const tight = await operator.enrollAgent({
      agentId: 'tight-agent',
      allowedVendors: ['api.helius.xyz'],
      maxPerCallMicroUsdc: '1000',
      periodBudgetMicroUsdc: '1000',
    });
    const tightAgent = new ShlitaAgentClient({ apiKey: tight.apiKey, baseUrl: BASE, fetch: adapter(current.app) });
    const overBudget = await tightAgent.proxy({
      agentId: 'tight-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      idempotencyKey: 'over-budget-0001',
      simulate: true,
    });
    expect(overBudget.outcome).toBe('rejected');
    if (overBudget.outcome === 'rejected') expect(overBudget.reason).toBe('PER_CALL_LIMIT_EXCEEDED');

    const uncertain = await agent.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      body: { mints: ['live-attempt'] },
      idempotencyKey: 'uncertain-key-01',
    });
    expect(uncertain.outcome).toBe('uncertain');
    if (uncertain.outcome === 'uncertain') expect(uncertain.reconciliationRequired).toBe(true);
    expect(upstreamCalls).toBe(1);
    const again = await agent.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      body: { mints: ['live-attempt'] },
      idempotencyKey: 'uncertain-key-01',
    });
    expect(again.outcome).toBe('uncertain');
    expect(upstreamCalls).toBe(1);

    await operator.freezeAgent('research-agent', 'review');
    const frozen = await agent.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      idempotencyKey: 'after-freeze-01',
      simulate: true,
    });
    expect(frozen.outcome).toBe('rejected');
    if (frozen.outcome === 'rejected') expect(frozen.reason).toBe('AGENT_FROZEN');

    const beforeClose = await operator.listOperations();
    expect(beforeClose.operations.some((row) => row.operationId === first.operationId && row.reservedAmountMicroUsdc === '10000' && row.signature === null)).toBe(true);
    current.engine.close();

    current = open();
    const reopened = new ShlitaOperatorClient({ operatorKey: OPERATOR_KEY, baseUrl: BASE, fetch: adapter(current.app) });
    const afterRestart = await reopened.listOperations();
    const stored = afterRestart.operations.find((row) => row.operationId === first.operationId);
    expect(stored?.reservedAmountMicroUsdc).toBe('10000');
    expect(stored?.state).toBe('ACCOUNTING_COMMITTED');
    expect(stored?.signature).toBeNull();
    const agents = await reopened.listAgents();
    expect(agents.agents.find((row) => row.agentId === 'research-agent')?.status).toBe('AGENT_FROZEN');

    const impersonated = new ShlitaOperatorClient({ operatorKey: issued.apiKey, baseUrl: BASE, fetch: adapter(current.app) });
    await expect(impersonated.listAgents()).rejects.toBeInstanceOf(ShlitaApiError);
    current.engine.close();
  });
});
