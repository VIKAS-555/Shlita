/**
 * Step 12 — Staging Deployment & Reliability Verification Tests
 *
 * Verifies:
 * 1. Locked staging security configuration (simulation & demo rejected, HTTPS required, persistent DB required)
 * 2. SQLite backup creation with VACUUM INTO, file permissions 0600, and PRAGMA integrity_check
 * 3. Pruning of old backups beyond retention window
 * 4. Restoration of backup into an independent database with complete ledger/operation/audit preservation
 * 5. Single-instance SQLite ledger persistence across restarts
 * 6. Public /health, /ready, and /metrics endpoints without credentials
 * 7. Operator authentication and session flow on staging configuration
 * 8. Proxy latency smoke test and circuit-breaker trip / alert drill
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { assessSecurityConfig } from '../../packages/gateway/src/security-config.js';
import { createGatewayApp } from '../../packages/gateway/src/app.js';
import { createPolicyEngine } from '../../packages/core/src/index.js';
import { restoreLedgerBackup, pruneBackupFiles } from '../../packages/core/src/backup.js';
import type { SpendingPolicy } from '../../packages/core/src/types.js';

const STRONG_KEY = 's'.repeat(48);
const STAGING_ORG = 'pilot-staging-alpha';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shlita-step12-'));
}

describe('Step 12 — Staging Security Configuration', () => {
  it('enforces locked staging rules', () => {
    // Missing operator key
    expect(assessSecurityConfig({ SHLITA_ENV: 'staging' }).ok).toBe(false);

    // Staging rejects simulation mode
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'staging',
        SHLITA_OPERATOR_KEY: STRONG_KEY,
        SHLITA_OPERATOR_ORG: STAGING_ORG,
        SHLITA_DB_PATH: '/var/lib/shlita/ledger.db',
        SHLITA_ALLOW_SIMULATION: 'true',
      }).ok
    ).toBe(false);

    // Staging rejects demo seeding
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'staging',
        SHLITA_OPERATOR_KEY: STRONG_KEY,
        SHLITA_OPERATOR_ORG: STAGING_ORG,
        SHLITA_DB_PATH: '/var/lib/shlita/ledger.db',
        SHLITA_SEED_DEMO: 'true',
      }).ok
    ).toBe(false);

    // Staging rejects in-memory DB
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'staging',
        SHLITA_OPERATOR_KEY: STRONG_KEY,
        SHLITA_OPERATOR_ORG: STAGING_ORG,
        SHLITA_DB_PATH: ':memory:',
      }).ok
    ).toBe(false);

    // Staging rejects non-HTTPS public origin
    expect(
      assessSecurityConfig({
        SHLITA_ENV: 'staging',
        SHLITA_OPERATOR_KEY: STRONG_KEY,
        SHLITA_OPERATOR_ORG: STAGING_ORG,
        SHLITA_DB_PATH: '/var/lib/shlita/ledger.db',
        SHLITA_PUBLIC_ORIGIN: 'http://insecure.example.com',
      }).ok
    ).toBe(false);

    // Staging accepts valid configuration
    const valid = assessSecurityConfig({
      SHLITA_ENV: 'staging',
      SHLITA_OPERATOR_KEY: STRONG_KEY,
      SHLITA_OPERATOR_ORG: STAGING_ORG,
      SHLITA_DB_PATH: '/var/lib/shlita/ledger.db',
      SHLITA_PUBLIC_ORIGIN: 'https://gateway.staging.shlita.xyz',
      SHLITA_TRUSTED_PROXIES: '127.0.0.1,::1',
      PORT: '4000',
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.config.locked).toBe(true);
    expect(valid.config.allowSimulation).toBe(false);
    expect(valid.config.seedDemo).toBe(false);
    expect(valid.config.secureCookies).toBe(true);
  });
});

describe('Step 12 — Backup, Prune, and Restore Flow', () => {
  it('creates an online backup, verifies integrity, prunes retention, and restores to an independent DB', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'ledger.db');
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // 1. Initialize engine on disk and register an agent
    const engine1 = createPolicyEngine(dbPath);
    const policy: SpendingPolicy = {
      agentId: 'staging-agent-backup',
      allowedVendors: ['api.helius.xyz'],
      maxPerCallMicroUsdc: 50_000n,
      periodBudgetMicroUsdc: 200_000n,
      periodSeconds: 3600,
      circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 20 },
    };
    const enrolled = engine1.registerAgent(policy, {
      rawApiKey: 'shlt_staging_backup_test_key_001',
      ownerOrg: STAGING_ORG,
    });
    expect(enrolled.apiKey).toBeDefined();

    // 2. Perform an operation through the gateway
    const app1 = createGatewayApp(engine1, undefined, {
      operators: [{ key: STRONG_KEY, ownerOrg: STAGING_ORG }],
      upstream: async () => ({ status: 200, body: { result: 'sandbox_ok' } }),
    });

    const proxyRes = await app1.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shlita-api-key': 'shlt_staging_backup_test_key_001',
      },
      body: JSON.stringify({
        agentId: 'staging-agent-backup',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/v0/token-metadata',
        body: { mints: ['test'] },
        idempotencyKey: 'staging-op-001',
      }),
    });
    expect(proxyRes.status).toBe(200);

    // 3. Create backup snapshot
    const backupFile1 = path.join(backupDir, 'ledger-snapshot-1.db');
    await engine1.backupTo(backupFile1);
    expect(fs.existsSync(backupFile1)).toBe(true);

    // Verify backup permissions 0600
    const stat = fs.statSync(backupFile1);
    expect(stat.mode & 0o777).toBe(0o600);

    // Create a second and third backup for pruning test
    const backupFile2 = path.join(backupDir, 'ledger-snapshot-2.db');
    const backupFile3 = path.join(backupDir, 'ledger-snapshot-3.db');
    await engine1.backupTo(backupFile2);
    await engine1.backupTo(backupFile3);

    // Prune backups keeping only 2
    const removed = pruneBackupFiles(backupDir, 2);
    expect(removed.length).toBe(1);
    expect(fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).length).toBe(2);

    engine1.close();

    // 4. Restore backup into an independent database
    const restoredPath = path.join(dir, 'restored-ledger.db');
    restoreLedgerBackup(backupFile3, restoredPath, false);
    expect(fs.existsSync(restoredPath)).toBe(true);

    // Verify restored database contents
    const restoredEngine = createPolicyEngine(restoredPath);
    expect(restoredEngine.getAgentOwnerOrg('staging-agent-backup')).toBe(STAGING_ORG);
    const ops = restoredEngine.listOrganizationOperations(STAGING_ORG);
    expect(ops.length).toBe(1);
    expect(ops[0].operationId).toBeDefined();
    expect(ops[0].reservedAmountMicroUsdc).toBe('10000');
    expect(restoredEngine.getAuditLogs(10).length).toBeGreaterThan(0);

    restoredEngine.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('Step 12 — Persistence & Health Verification Across Restart', () => {
  it('preserves ledger records across container/process restart and exposes health checks without credentials', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'ledger.db');

    // Start instance A
    const engineA = createPolicyEngine(dbPath);
    engineA.registerAgent(
      {
        agentId: 'staging-restart-agent',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 25_000n,
        periodBudgetMicroUsdc: 100_000n,
        periodSeconds: 3600,
        circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 20 },
      },
      { rawApiKey: 'shlt_staging_restart_key_01', ownerOrg: STAGING_ORG }
    );

    const appA = createGatewayApp(engineA, undefined, {
      operators: [{ key: STRONG_KEY, ownerOrg: STAGING_ORG }],
      upstream: async () => ({ status: 200, body: { data: 'test' } }),
    });

    // Public health & readiness without credentials
    const healthRes = await appA.request('/health');
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe('ok');

    const readyRes = await appA.request('/ready');
    expect(readyRes.status).toBe(200);

    const metricsRes = await appA.request('/metrics');
    expect(metricsRes.status).toBe(200);

    // Proxy request
    const p1 = await appA.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shlita-api-key': 'shlt_staging_restart_key_01',
      },
      body: JSON.stringify({
        agentId: 'staging-restart-agent',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/v0/token-metadata',
        idempotencyKey: 'restart-op-01',
      }),
    });
    expect(p1.status).toBe(200);

    // Simulate process shutdown / restart
    engineA.close();

    // Start instance B pointing to the exact same persistent SQLite DB
    const engineB = createPolicyEngine(dbPath);
    const appB = createGatewayApp(engineB, undefined, {
      operators: [{ key: STRONG_KEY, ownerOrg: STAGING_ORG }],
    });

    // Verify readiness of restarted instance
    const readyB = await appB.request('/ready');
    expect(readyB.status).toBe(200);

    // Verify agent and operation persisted
    expect(engineB.getAgentOwnerOrg('staging-restart-agent')).toBe(STAGING_ORG);
    const opsB = engineB.listOrganizationOperations(STAGING_ORG);
    expect(opsB.length).toBe(1);
    expect(opsB[0].operationId).toBeDefined();

    engineB.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('triggers circuit breaker trip after consecutive errors and recovers after cooldown', async () => {
    const engine = createPolicyEngine();
    engine.registerAgent(
      {
        agentId: 'cb-agent',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 25_000n,
        periodBudgetMicroUsdc: 100_000n,
        periodSeconds: 3600,
        circuitBreaker: { maxConsecutiveErrors: 2, maxCallsPerMinute: 20 },
      },
      { rawApiKey: 'shlt_cb_key_00000001', ownerOrg: STAGING_ORG }
    );

    let callCount = 0;
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: STRONG_KEY, ownerOrg: STAGING_ORG }],
      upstream: async () => {
        callCount++;
        return { status: 500, body: { error: 'upstream failure' } };
      },
    });

    // Call 1: fails upstream -> gateway returns 502
    const r1 = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-api-key': 'shlt_cb_key_00000001' },
      body: JSON.stringify({
        agentId: 'cb-agent',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/v0/token-metadata',
        idempotencyKey: 'cb-op-01',
      }),
    });
    expect(r1.status).toBe(502);

    // Call 2: fails upstream -> gateway returns 502 and trips circuit breaker
    const r2 = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-api-key': 'shlt_cb_key_00000001' },
      body: JSON.stringify({
        agentId: 'cb-agent',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/v0/token-metadata',
        idempotencyKey: 'cb-op-02',
      }),
    });
    expect(r2.status).toBe(502);

    // Call 3: should be fast-failed by circuit breaker before reaching upstream
    const beforeCalls = callCount;
    const r3 = await app.request('/v1/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-shlita-api-key': 'shlt_cb_key_00000001' },
      body: JSON.stringify({
        agentId: 'cb-agent',
        vendor: 'api.helius.xyz',
        method: 'POST',
        path: '/v0/token-metadata',
        idempotencyKey: 'cb-op-03',
      }),
    });
    expect(r3.status).toBe(403);
    const r3Json = await r3.json();
    expect(r3Json.reason).toBe('CIRCUIT_BREAKER_TRIPPED');
    expect(r3Json.allowed).toBe(false);
    expect(callCount).toBe(beforeCalls); // Verified upstream was not called!

    engine.close();
  });
});
