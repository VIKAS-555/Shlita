import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { createPolicyEngine } from '../packages/core/src/index.js';
import { canTransition } from '../packages/core/src/lifecycle.js';
import { parseMicroUsdc, MAX_MICRO_USDC } from '../packages/core/src/money.js';
import type { SpendingPolicy } from '../packages/core/src/types.js';

const AGENT_KEY = 'shlt_test_ledger_agent_01';
const OTHER_KEY = 'shlt_test_ledger_other_key';
const OPERATOR = 'l'.repeat(40);
const OTHER_OPERATOR = 'm'.repeat(40);

const policy: SpendingPolicy = {
  agentId: 'agent-ledger-01',
  allowedVendors: ['api.helius.xyz'],
  maxPerCallMicroUsdc: 50_000n,
  periodBudgetMicroUsdc: 30_000n,
  periodSeconds: 3600,
  circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 20 },
};

function appFor(engine: ReturnType<typeof createPolicyEngine>, upstream?: (exchange: { url: string }) => Promise<{ status: number; body: unknown }>) {
  return createGatewayApp(engine, undefined, {
    operators: [
      { key: OPERATOR, ownerOrg: 'org-ledger' },
      { key: OTHER_OPERATOR, ownerOrg: 'org-other' },
    ],
    allowSimulation: true,
    corsOrigins: ['http://localhost:5173'],
    upstream: upstream as never,
  });
}

function register(engine: ReturnType<typeof createPolicyEngine>, budget = 30_000n) {
  engine.registerAgent(
    { ...policy, periodBudgetMicroUsdc: budget },
    { rawApiKey: AGENT_KEY, ownerOrg: 'org-ledger' }
  );
  engine.registerAgent(
    { ...policy, agentId: 'agent-other-01', periodBudgetMicroUsdc: budget },
    { rawApiKey: OTHER_KEY, ownerOrg: 'org-other' }
  );
}

function proxy(
  app: ReturnType<typeof createGatewayApp>,
  idempotencyKey: string,
  body: Record<string, unknown> = {},
  key = AGENT_KEY
) {
  return app.request('/v1/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-shlita-api-key': key,
    },
    body: JSON.stringify({
      agentId: key === AGENT_KEY ? 'agent-ledger-01' : 'agent-other-01',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      method: 'POST',
      body: { mints: ['USDC'] },
      idempotencyKey,
      ...body,
    }),
  });
}

describe('financial ledger integrity', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
  });

  it('rejects impossible financial transitions', () => {
    expect(canTransition('POLICY_REJECTED', 'SETTLEMENT_CONFIRMED')).toBe(false);
    expect(canTransition('VENDOR_FAILED', 'EXECUTION_IN_PROGRESS')).toBe(false);
    expect(canTransition('ACCOUNTING_COMMITTED', 'SETTLEMENT_CONFIRMED')).toBe(false);
    expect(canTransition('EXECUTION_IN_PROGRESS', 'VENDOR_SUCCEEDED')).toBe(true);
    expect(canTransition('VENDOR_SUCCEEDED', 'ACCOUNTING_COMMITTED')).toBe(true);
    expect(canTransition('SETTLEMENT_PENDING', 'SETTLEMENT_CONFIRMED')).toBe(true);
  });

  it('rejects negative, fractional, and oversized amounts', () => {
    expect(parseMicroUsdc(-1).ok).toBe(false);
    expect(parseMicroUsdc(0).ok).toBe(false);
    expect(parseMicroUsdc('1.5').ok).toBe(false);
    expect(parseMicroUsdc('1e6').ok).toBe(false);
    expect(parseMicroUsdc(MAX_MICRO_USDC + 1n).ok).toBe(false);
    expect(parseMicroUsdc(10_000n)).toEqual({ ok: true, amount: 10_000n });
  });

  it('dispatches one upstream call for two simultaneous requests with the same key', async () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = appFor(engine, async () => {
      calls += 1;
      await gate;
      return { status: 200, body: { ok: true } };
    });

    const first = proxy(app, 'same-key-concurrent');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await proxy(app, 'same-key-concurrent');
    expect(calls).toBe(1);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('OPERATION_IN_PROGRESS');
    release();
    const completed = await first;
    expect(completed.status).toBe(200);
    expect(calls).toBe(1);
    expect(engine.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(10_000n);
  });

  it('rejects the same idempotency key with a different payload', async () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    let calls = 0;
    const app = appFor(engine, async () => {
      calls += 1;
      return { status: 200, body: { ok: true } };
    });
    const first = await proxy(app, 'payload-key', { body: { mints: ['USDC'] } });
    expect(first.status).toBe(200);
    const second = await proxy(app, 'payload-key', { body: { mints: ['OTHER'] } });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('IDEMPOTENCY_CONFLICT');
    expect(calls).toBe(1);
  });

  it('returns the stored result when a successful call is retried', async () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    let calls = 0;
    const app = appFor(engine, async () => {
      calls += 1;
      return { status: 200, body: { ok: true, n: calls } };
    });
    const first = await proxy(app, 'retry-success');
    const firstBody = await first.json();
    const second = await proxy(app, 'retry-success');
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(second.headers.get('x-shlita-idempotent-replay')).toBe('true');
    expect(secondBody.operationId).toBe(firstBody.operationId);
    expect(calls).toBe(1);
    expect(engine.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(10_000n);
    expect(secondBody.settlement.fundsMoved).toBe(false);
    expect(secondBody.cost.costBasis).toBe('ESTIMATED');
    expect(secondBody.cost.actualCostMicroUsdc).toBeNull();
  });

  it('does not execute again after a definite provider failure', async () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    let calls = 0;
    const app = appFor(engine, async () => {
      calls += 1;
      return { status: 400, body: { error: 'bad request' } };
    });
    const first = await proxy(app, 'retry-failed');
    expect(first.status).toBe(502);
    const second = await proxy(app, 'retry-failed');
    expect(second.status).toBe(502);
    expect(second.headers.get('x-shlita-idempotent-replay')).toBe('true');
    expect(calls).toBe(1);
    expect(engine.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(0n);
  });

  it('preserves an unknown provider outcome and does not replay it', async () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    let calls = 0;
    const app = appFor(engine, async () => {
      calls += 1;
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    const first = await proxy(app, 'timeout-key');
    expect(first.status).toBe(504);
    const body = await first.json();
    expect(body.error).toBe('RECONCILIATION_REQUIRED');
    expect(body.fundsMoved).toBe(false);
    const second = await proxy(app, 'timeout-key');
    expect(second.status).toBe(504);
    expect(calls).toBe(1);
    expect(engine.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(0n);
    expect(engine.getAgentState('agent-ledger-01').activePendingReservationsMicroUsdc).toBe(10_000n);
    const visible = engine.listReconciliation('org-ledger');
    expect(visible).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toContain(AGENT_KEY);
  });

  it('does not report success when the ledger commit fails', async () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    const app = appFor(engine, async () => ({ status: 200, body: { ok: true } }));
    engine.failNextCommit();
    const res = await proxy(app, 'commit-fails');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).not.toBe(true);
    expect(body.error).toBe('ACCOUNTING_FAILED');
    expect(engine.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(0n);
  });

  it('does not let concurrent different keys exceed the period budget', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-budget-'));
    const dbPath = path.join(dir, 'ledger.db');
    const setup = createPolicyEngine(dbPath);
    register(setup, 15_000n);
    setup.close();

    const results = await Promise.all(
      ['budget-a', 'budget-b'].map(
        (key) =>
          new Promise<string>((resolve, reject) => {
            const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm')).href;
            const child = spawn(process.execPath, ['--import', loader, path.resolve('tests/workers/claim-once.ts')], {
              cwd: process.cwd(),
              env: {
                ...process.env,
                CLAIM_DB: dbPath,
                CLAIM_KEY: key,
                CLAIM_AGENT: AGENT_KEY,
              },
            });
            let out = '';
            let err = '';
            child.stdout.on('data', (chunk) => {
              out += chunk.toString();
            });
            child.stderr.on('data', (chunk) => {
              err += chunk.toString();
            });
            child.on('error', reject);
            child.on('exit', (code) => {
              if (code !== 0) reject(new Error(err || out || `claim worker exited ${code}`));
              else resolve(out.trim());
            });
          })
      )
    );
    const statuses = results.map((line) => JSON.parse(line).status).sort();
    expect(statuses).toEqual([200, 403]);
    const check = createPolicyEngine(dbPath);
    cleanups.push(() => {
      check.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    expect(check.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(10_000n);
  });

  it('keeps a held reservation when an uncertain operation would otherwise expire', () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    const now = Date.now();
    const claim = engine.claimExecution({
      agentId: 'agent-ledger-01',
      vendor: 'api.helius.xyz',
      method: 'POST',
      path: '/v0/token-metadata',
      fingerprint: 'fingerprint-hold',
      idempotencyKey: 'hold-key',
      estimatedCostMicroUsdc: 10_000n,
      reservedAmountMicroUsdc: 10_000n,
      timestamp: now,
    });
    expect(claim.kind).toBe('execute');
    engine.getLedger().pruneExpiredReservations(now + 60_000);
    expect(engine.getAgentState('agent-ledger-01').activePendingReservationsMicroUsdc).toBe(10_000n);
  });

  it('commits a reservation once and refuses a commit after rollback', () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    const decision = engine.evaluateAndReserve({
      agentId: 'agent-ledger-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 10_000n,
      timestamp: Date.now(),
      idempotencyKey: 'commit-once',
    });
    expect(decision.allowed).toBe(true);
    if (!decision.allowed || !decision.reservationId) return;
    expect(engine.commitReservation(decision.reservationId, 10_000n)).toBe(true);
    expect(engine.commitReservation(decision.reservationId, 10_000n)).toBe(false);
    expect(engine.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(10_000n);

    const second = engine.evaluateAndReserve({
      agentId: 'agent-ledger-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 10_000n,
      timestamp: Date.now(),
      idempotencyKey: 'rollback-then-commit',
    });
    expect(second.allowed).toBe(true);
    if (!second.allowed || !second.reservationId) return;
    expect(engine.rollbackReservation(second.reservationId, 'definite failure')).toBe(true);
    expect(engine.commitReservation(second.reservationId, 10_000n)).toBe(false);
    expect(engine.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(10_000n);
  });

  it('counts a pending reservation against the new budget period', () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 15_000n);
    const start = Date.now();
    const pending = engine.evaluateAndReserve({
      agentId: 'agent-ledger-01',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 10_000n,
      timestamp: start,
      idempotencyKey: 'period-pending',
    });
    expect(pending.allowed).toBe(true);
    const rolled = engine.claimExecution({
      agentId: 'agent-ledger-01',
      vendor: 'api.helius.xyz',
      method: 'POST',
      path: '/v0/token-metadata',
      fingerprint: 'period-fingerprint',
      idempotencyKey: 'period-next',
      estimatedCostMicroUsdc: 10_000n,
      reservedAmountMicroUsdc: 10_000n,
      timestamp: start + 3_600_000,
    });
    expect(rolled.kind).toBe('rejected');
    if (rolled.kind === 'rejected') expect(rolled.body.reason).toBe('PERIOD_BUDGET_EXCEEDED');
  });

  it('recovers an in-flight operation after restart without executing it again', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-recover-'));
    const dbPath = path.join(dir, 'ledger.db');
    const first = createPolicyEngine(dbPath);
    register(first, 100_000n);
    const claim = first.claimExecution({
      agentId: 'agent-ledger-01',
      vendor: 'api.helius.xyz',
      method: 'POST',
      path: '/v0/token-metadata',
      fingerprint: 'restart-fingerprint',
      idempotencyKey: 'restart-key',
      estimatedCostMicroUsdc: 10_000n,
      reservedAmountMicroUsdc: 10_000n,
      timestamp: Date.now(),
    });
    expect(claim.kind).toBe('execute');
    first.close();

    const restarted = createPolicyEngine(dbPath);
    cleanups.push(() => {
      restarted.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    expect(restarted.recoverInFlightOperations()).toBe(1);
    const again = restarted.claimExecution({
      agentId: 'agent-ledger-01',
      vendor: 'api.helius.xyz',
      method: 'POST',
      path: '/v0/token-metadata',
      fingerprint: 'restart-fingerprint',
      idempotencyKey: 'restart-key',
      estimatedCostMicroUsdc: 10_000n,
      reservedAmountMicroUsdc: 10_000n,
      timestamp: Date.now(),
    });
    expect(again.kind).toBe('replay');
    if (again.kind === 'replay') expect(again.body.error).toBe('RECONCILIATION_REQUIRED');
    expect(restarted.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(0n);
    expect(restarted.getAgentState('agent-ledger-01').activePendingReservationsMicroUsdc).toBe(10_000n);
  });

  it('keeps a completed operation across a database restart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-persist-'));
    const dbPath = path.join(dir, 'ledger.db');
    const first = createPolicyEngine(dbPath);
    register(first, 100_000n);
    const app = appFor(first, async () => ({ status: 200, body: { ok: true } }));
    const created = await proxy(app, 'persist-key');
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    first.close();

    const restarted = createPolicyEngine(dbPath);
    cleanups.push(() => {
      restarted.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const app2 = appFor(restarted, async () => {
      throw new Error('upstream must not be called on replay');
    });
    const replay = await proxy(app2, 'persist-key');
    expect(replay.status).toBe(200);
    expect((await replay.json()).operationId).toBe(createdBody.operationId);
    expect(restarted.getAgentState('agent-ledger-01').currentPeriodSpendMicroUsdc).toBe(10_000n);
  });

  it('writes an audit trail without credentials and hides other organizations', async () => {
    const engine = createPolicyEngine();
    cleanups.push(() => engine.close());
    register(engine, 100_000n);
    const app = appFor(engine, async () => ({ status: 200, body: { ok: true } }));
    const res = await proxy(app, 'audit-key');
    expect(res.status).toBe(200);
    const logs = engine.getAuditLogs(20);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(AGENT_KEY);
    expect(serialized).not.toContain(OPERATOR);
    expect(logs.some((entry) => entry.lifecycleState === 'ACCOUNTING_COMMITTED')).toBe(true);
    expect(logs.some((entry) => entry.metadata?.idempotencyRef && entry.metadata.idempotencyRef !== 'audit-key')).toBe(true);

    const own = await app.request('/v1/audit', { headers: { 'x-shlita-operator-key': OPERATOR } });
    const other = await app.request('/v1/audit', { headers: { 'x-shlita-operator-key': OTHER_OPERATOR } });
    expect(own.status).toBe(200);
    expect(other.status).toBe(200);
    const ownLogs = await own.json();
    const otherLogs = await other.json();
    expect(ownLogs.logs.some((entry: { agentId: string }) => entry.agentId === 'agent-ledger-01')).toBe(true);
    expect(otherLogs.logs.some((entry: { agentId: string }) => entry.agentId === 'agent-ledger-01')).toBe(false);

    const otherRecon = await app.request('/v1/reconciliation', {
      headers: { 'x-shlita-operator-key': OTHER_OPERATOR },
    });
    expect(otherRecon.status).toBe(200);
    expect((await otherRecon.json()).operations).toEqual([]);
  });

  it('opens a ledger created before financial_operations existed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-migrate-'));
    const dbPath = path.join(dir, 'ledger.db');
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        owner_org TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        api_key_hash TEXT UNIQUE NOT NULL,
        freeze_reason TEXT,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        period_start_timestamp INTEGER NOT NULL,
        current_period_spend_micro_usdc TEXT NOT NULL DEFAULT '0',
        total_lifetime_spend_micro_usdc TEXT NOT NULL DEFAULT '0',
        created_at INTEGER NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO agents (id, owner_org, status, api_key_hash, period_start_timestamp, current_period_spend_micro_usdc, total_lifetime_spend_micro_usdc, created_at)
       VALUES ('agent-old', 'org-old', 'ACTIVE', 'hash', 1, '2500', '2500', 1)`
    ).run();
    db.close();

    const engine = createPolicyEngine(dbPath);
    cleanups.push(() => {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    expect(engine.getAgentOwnerOrg('agent-old')).toBe('org-old');
    expect(engine.getAgentState('agent-old').currentPeriodSpendMicroUsdc).toBe(2500n);
    expect(engine.listReconciliation('org-old')).toEqual([]);
  });

  it('refuses an in-memory ledger when persistence is required', () => {
    expect(() => createPolicyEngine(':memory:', { requirePersistent: true })).toThrow(/Persistent ledger/);
  });
});
