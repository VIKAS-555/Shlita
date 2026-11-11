import { describe, it, expect, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { createPolicyEngine } from '../packages/core/src/index.js';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { SolanaSettlementManager } from '../packages/solana/src/settlement.js';
import type { SpendingPolicy } from '../packages/core/src/types.js';

const AGENT_KEY = 'shlt_test_settle_agent_01';
const OPERATOR = 's'.repeat(40);
const OTHER_OPERATOR = 't'.repeat(40);
const DESTINATION = Keypair.generate().publicKey.toBase58();

const policy: SpendingPolicy = {
  agentId: 'agent-settle-01',
  allowedVendors: ['api.helius.xyz'],
  maxPerCallMicroUsdc: 50_000n,
  periodBudgetMicroUsdc: 100_000n,
  periodSeconds: 3600,
  circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 20 },
};

function committedApp(dir: string) {
  const engine = createPolicyEngine(path.join(dir, 'ledger.db'));
  engine.registerAgent(policy, { rawApiKey: AGENT_KEY, ownerOrg: 'org-settle' });
  const manager = new SolanaSettlementManager('http://127.0.0.1:8899');
  const app = createGatewayApp(engine, manager, {
    operators: [
      { key: OPERATOR, ownerOrg: 'org-settle' },
      { key: OTHER_OPERATOR, ownerOrg: 'org-other' },
    ],
    allowSimulation: true,
    settlementEnabled: true,
    settlementDestination: DESTINATION,
    upstream: async () => ({ status: 200, body: { ok: true } }),
  });
  return { engine, app };
}

async function committedOperation(app: ReturnType<typeof createGatewayApp>) {
  const response = await app.request('/v1/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': AGENT_KEY },
    body: JSON.stringify({
      agentId: 'agent-settle-01',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      method: 'POST',
      body: { mints: ['USDC'] },
      idempotencyKey: 'settle-op-0001',
    }),
  });
  expect(response.status).toBe(200);
  return response.headers.get('x-shlita-operation-id') ?? '';
}

function settle(app: ReturnType<typeof createGatewayApp>, operationId: string, body: Record<string, unknown>, operator = OPERATOR) {
  return app.request(`/v1/operations/${operationId}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-shlita-operator-key': operator },
    body: JSON.stringify(body),
  });
}

describe('settlement ledger identity', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
  });

  it('creates one settlement for an accounting commitment and replays the same row', async () => {
    const dir = path.join(os.tmpdir(), `shlita-settle-${Date.now()}`);
    const { engine, app } = committedApp(dir);
    cleanups.push(() => engine.close());
    const operationId = await committedOperation(app);

    const disabled = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR, ownerOrg: 'org-settle' }],
      settlementEnabled: false,
    });
    expect((await settle(disabled, operationId, { destination: DESTINATION, amountMicroUsdc: '10000' })).status).toBe(403);

    expect((await settle(app, operationId, { destination: Keypair.generate().publicKey.toBase58(), amountMicroUsdc: '10000' })).status).toBe(403);
    expect((await settle(app, operationId, { destination: DESTINATION, amountMicroUsdc: '10001' })).status).toBe(409);
    expect((await settle(app, operationId, { destination: DESTINATION, amountMicroUsdc: '10000' }, OTHER_OPERATOR)).status).toBe(404);

    const first = await settle(app, operationId, { destination: DESTINATION, amountMicroUsdc: '10000' });
    const second = await settle(app, operationId, { destination: DESTINATION, amountMicroUsdc: '10000' });
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status).toBe(200);
    expect(firstBody.status).toBe('SETTLEMENT_PREPARED');
    expect(firstBody.fundsMoved).toBe(false);
    expect(firstBody.signature).toBeNull();
    expect(secondBody.settlementId).toBe(firstBody.settlementId);
    expect(secondBody.replay).toBe(true);
    expect(secondBody.fundsMoved).toBe(false);
  });

  it('rejects a second signature and a jump to confirmed', async () => {
    const dir = path.join(os.tmpdir(), `shlita-settle-note-${Date.now()}`);
    const engine = createPolicyEngine(path.join(dir, 'ledger.db'));
    cleanups.push(() => engine.close());
    engine.registerAgent(policy, { rawApiKey: AGENT_KEY, ownerOrg: 'org-settle' });
    const app = createGatewayApp(engine, new SolanaSettlementManager('http://127.0.0.1:8899'), {
      operators: [{ key: OPERATOR, ownerOrg: 'org-settle' }],
      allowSimulation: true,
      settlementEnabled: true,
      settlementDestination: DESTINATION,
      upstream: async () => ({ status: 200, body: { ok: true } }),
    });
    const operationId = await committedOperation(app);
    const claimed = await (await settle(app, operationId, { destination: DESTINATION, amountMicroUsdc: '10000' })).json();
    const unknown = engine.noteChainSettlement(operationId, { status: 'SETTLEMENT_OUTCOME_UNKNOWN', signature: 'sig-a', error: 'timeout' });
    expect(unknown.ok).toBe(true);
    const conflict = engine.noteChainSettlement(operationId, { status: 'SETTLEMENT_OUTCOME_UNKNOWN', signature: 'sig-b' });
    expect(conflict.ok).toBe(false);
    const skipped = engine.noteChainSettlement(operationId, { status: 'SETTLEMENT_CONFIRMED', signature: 'sig-a' });
    expect(skipped.ok).toBe(false);
    expect(claimed.fundsMoved).toBe(false);
  });
});
