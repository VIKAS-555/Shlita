import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createPolicyEngine } from '../packages/core/src/index.js';
import { bootFromEnv } from '../packages/gateway/src/bootstrap.js';
import { createGatewayApp } from '../packages/gateway/src/app.js';
import { OperatorSessionStore } from '../packages/gateway/src/session.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    close(): void;
  };
};

const OPERATOR = 'r'.repeat(40);

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-ops-'));
}

describe('production operations', () => {
  it('keeps an older ledger row when the schema migration runs', () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'ledger.db');
    const created = new DatabaseSync(dbPath);
    created.exec(`
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
      INSERT INTO agents (
        id, owner_org, status, api_key_hash, consecutive_errors,
        period_start_timestamp, current_period_spend_micro_usdc,
        total_lifetime_spend_micro_usdc, created_at
      ) VALUES (
        'agent-old', 'org-old', 'ACTIVE', 'hash-old', 0, 1, '0', '0', 1
      );
    `);
    created.close();

    const engine = createPolicyEngine(dbPath);
    expect(engine.schemaVersion()).toBe(2);
    expect(engine.getAgentOwnerOrg('agent-old')).toBe('org-old');
    engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('restores a consistent backup with the agent, operation, and audit event', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'ledger.db');
    const engine = createPolicyEngine(dbPath);
    const created = engine.registerAgent(
      {
        agentId: 'agent-backup',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 50_000n,
        periodBudgetMicroUsdc: 1_000_000n,
        periodSeconds: 86400,
        circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 10 },
      },
      { ownerOrg: 'org-backup' }
    );
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR, ownerOrg: 'org-backup' }],
      allowSimulation: true,
      upstream: async () => ({ status: 200, body: { ok: true } }),
    });
    const proxied = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-api-key': created.apiKey },
      body: JSON.stringify({
        agentId: 'agent-backup',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/v0/token-metadata',
        body: { mints: ['local'] },
        idempotencyKey: 'backup-op-01',
        simulate: true,
      }),
    });
    expect(proxied.status).toBe(200);
    const backupPath = path.join(dir, 'backups', 'ledger.db');
    await engine.backupTo(backupPath);
    engine.close();

    const restoredPath = path.join(dir, 'restored.db');
    const { restoreLedgerBackup } = await import('../packages/core/src/backup.js');
    restoreLedgerBackup(backupPath, restoredPath, false);
    const restored = createPolicyEngine(restoredPath);
    expect(restored.getAgentOwnerOrg('agent-backup')).toBe('org-backup');
    const operations = restored.listOrganizationOperations('org-backup');
    expect(operations).toHaveLength(1);
    expect(operations[0].reservedAmountMicroUsdc).toBe('10000');
    expect(restored.getAuditLogs(20).length).toBeGreaterThan(0);
    expect(fs.statSync(restoredPath).mode & 0o777).toBe(0o600);
    restored.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does not let a spoofed forwarding header reset the login limit across a restart', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'ledger.db');
    const env = {
      SHLITA_ENV: 'development',
      SHLITA_OPERATOR_KEY: OPERATOR,
      SHLITA_OPERATOR_ORG: 'org-limit',
      SHLITA_DB_PATH: dbPath,
      SHLITA_STATE_DIR: dir,
    };
    const first = bootFromEnv(env);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const denied = await first.app.request('/v1/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${attempt}` },
        body: JSON.stringify({ operatorKey: 'wrong-operator-key-0123456789abc' }),
      });
      expect(denied.status).toBe(403);
    }
    first.engine.close();

    const second = bootFromEnv(env);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const limited = await second.app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.99', 'x-forwarded-for': '203.0.113.99' },
      body: JSON.stringify({ operatorKey: OPERATOR }),
    });
    expect(limited.status).toBe(429);
    expect(JSON.stringify(await limited.json())).not.toContain(OPERATOR);
    second.engine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports readiness without credentials and stops accepting work when drained', async () => {
    const engine = createPolicyEngine();
    const logs: string[] = [];
    const lifecycle = { accepting: true };
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR, ownerOrg: 'org-ready' }],
      lifecycle,
      logger: (line) => logs.push(line),
    });
    const ready = await app.request('/ready');
    expect(ready.status).toBe(200);
    expect(JSON.stringify(await ready.json())).not.toContain(OPERATOR);
    lifecycle.accepting = false;
    const draining = await app.request('/ready');
    expect(draining.status).toBe(503);

    const signed = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operatorKey: OPERATOR }),
    });
    expect(signed.status).toBe(200);
    expect(logs.join('\n')).not.toContain(OPERATOR);
    engine.close();
  });

  it('rejects a cross-site origin on a cookie session and leaves settlement state unchanged after recovery', async () => {
    const dir = tempDir();
    const engine = createPolicyEngine(path.join(dir, 'ledger.db'));
    const sessions = new OperatorSessionStore();
    const created = engine.registerAgent(
      {
        agentId: 'agent-origin',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 50_000n,
        periodBudgetMicroUsdc: 1_000_000n,
        periodSeconds: 86400,
        circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 10 },
      },
      { ownerOrg: 'org-origin' }
    );
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: OPERATOR, ownerOrg: 'org-origin' }],
      allowSimulation: true,
      sessions,
      upstream: async () => ({ status: 200, body: { ok: true } }),
    });
    const signed = await app.request('/v1/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operatorKey: OPERATOR }),
    });
    const body = await signed.json();
    const cookie = signed.headers.get('set-cookie')?.split(';')[0] ?? '';
    const blocked = await app.request('/v1/agents/agent-origin/freeze', {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-shlita-csrf': body.csrfToken,
        origin: 'https://evil.example',
        host: '127.0.0.1:4000',
      },
      body: JSON.stringify({ reason: 'nope' }),
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toBe('ORIGIN');

    const proxied = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-api-key': created.apiKey },
      body: JSON.stringify({
        agentId: 'agent-origin',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/v0/token-metadata',
        idempotencyKey: 'origin-op-01',
        simulate: true,
      }),
    });
    expect(proxied.status).toBe(200);
    engine.close();
    const restarted = createPolicyEngine(path.join(dir, 'ledger.db'));
    expect(restarted.recoverInFlightOperations()).toBe(0);
    const [operation] = restarted.listOrganizationOperations('org-origin');
    expect(operation.state).toBe('ACCOUNTING_COMMITTED');
    expect(operation.settlementStatus).toBe('NOT_SUBMITTED');
    expect(operation.signature).toBeNull();
    restarted.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses production startup when the ledger directory is not writable', () => {
    const dir = tempDir();
    fs.chmodSync(dir, 0o555);
    try {
      const result = bootFromEnv({
        SHLITA_ENV: 'production',
        SHLITA_OPERATOR_KEY: OPERATOR,
        SHLITA_OPERATOR_ORG: 'org-readonly',
        SHLITA_DB_PATH: path.join(dir, 'nested', 'ledger.db'),
        SHLITA_CORS_ORIGINS: 'https://shlita.example',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(' ')).toContain('not writable');
    } finally {
      fs.chmodSync(dir, 0o700);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
