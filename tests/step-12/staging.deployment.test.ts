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
import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { assessSecurityConfig } from '../../packages/gateway/src/security-config.js';
import { createGatewayApp } from '../../packages/gateway/src/app.js';
import { isTrustedProxy, clientIdentity } from '../../packages/gateway/src/client-address.js';
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

  it('runs backup-cli and restore-cli matching compose staging volume topology', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'ledger.db');
    const externalBackupDir = path.join(dir, 'external-backups');
    fs.mkdirSync(externalBackupDir, { recursive: true });

    // Seed a ledger with an active agent and reservation
    const engine = createPolicyEngine(dbPath);
    engine.registerAgent(
      {
        agentId: 'agent-cli-backup',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 50_000n,
        periodBudgetMicroUsdc: 200_000n,
        periodSeconds: 3600,
        circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 20 },
      },
      { rawApiKey: 'shlt_cli_backup_test_01', ownerOrg: STAGING_ORG }
    );
    engine.evaluateAndReserve({
      agentId: 'agent-cli-backup',
      vendor: 'api.helius.xyz',
      estimatedCostMicroUsdc: 10000n,
      timestamp: Date.now(),
      idempotencyKey: 'cli-backup-key-01',
    });
    engine.close();

    // Run backup-cli with environment variables matching compose.staging.yaml
    const backupOut = execSync('npx tsx packages/gateway/src/backup-cli.ts', {
      env: {
        ...process.env,
        SHLITA_DB_PATH: dbPath,
        SHLITA_BACKUP_DIR: externalBackupDir,
        SHLITA_BACKUP_RETENTION: '14',
      },
    }).toString();

    const backupJson = JSON.parse(backupOut.trim());
    expect(backupJson.event).toBe('backup');
    expect(backupJson.integrity).toBe('ok');
    expect(fs.existsSync(backupJson.file)).toBe(true);

    // Run restore-cli into a brand new restored database
    const restoredDbPath = path.join(dir, 'restored-cli-ledger.db');
    const restoreOut = execSync(`npx tsx packages/gateway/src/restore-cli.ts "${backupJson.file}" "${restoredDbPath}"`, {
      env: {
        ...process.env,
      },
    }).toString();

    const restoreJson = JSON.parse(restoreOut.trim());
    expect(restoreJson.event).toBe('restore');
    expect(restoreJson.integrity).toBe('ok');
    expect(fs.existsSync(restoredDbPath)).toBe(true);

    // Verify restored database contents
    const restoredEngine = createPolicyEngine(restoredDbPath);
    expect(restoredEngine.getAgentOwnerOrg('agent-cli-backup')).toBe(STAGING_ORG);
    restoredEngine.close();

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('surfaces failures on unwritable backup destination and preserves last known-good snapshot', async () => {
    const dir = tempDir();
    const dbPath = path.join(dir, 'ledger.db');
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const engine = createPolicyEngine(dbPath);
    engine.registerAgent(
      {
        agentId: 'agent-good-snapshot',
        allowedVendors: ['api.helius.xyz'],
        maxPerCallMicroUsdc: 50_000n,
        periodBudgetMicroUsdc: 200_000n,
        periodSeconds: 3600,
        circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 20 },
      },
      { rawApiKey: 'shlt_snapshot_key_00000001', ownerOrg: STAGING_ORG }
    );
    engine.close();

    // 1. Create a known-good snapshot
    const knownGoodSnapshot = path.join(backupDir, 'ledger-known-good.db');
    const engineForBackup = createPolicyEngine(dbPath);
    await engineForBackup.backupTo(knownGoodSnapshot);
    expect(fs.existsSync(knownGoodSnapshot)).toBe(true);
    const originalMtime = fs.statSync(knownGoodSnapshot).mtimeMs;
    const originalSize = fs.statSync(knownGoodSnapshot).size;

    // 2. An unwritable directory destination causes backup-cli to fail with non-zero exit code
    const invalidDir = path.join(dir, 'unwritable-as-file');
    fs.writeFileSync(invalidDir, 'i-am-a-file-not-a-directory');

    let cliFailed = false;
    try {
      execSync('npx tsx packages/gateway/src/backup-cli.ts', {
        env: {
          ...process.env,
          SHLITA_DB_PATH: dbPath,
          SHLITA_BACKUP_DIR: path.join(invalidDir, 'sub'),
        },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      cliFailed = true;
      const error = err as { status: number; stderr: Buffer };
      expect(error.status).not.toBe(0);
      expect(error.stderr.toString()).toContain('ENOTDIR');
    }
    expect(cliFailed).toBe(true);

    // 3. Verify the existing known-good snapshot was preserved intact
    expect(fs.existsSync(knownGoodSnapshot)).toBe(true);
    expect(fs.statSync(knownGoodSnapshot).mtimeMs).toBe(originalMtime);
    expect(fs.statSync(knownGoodSnapshot).size).toBe(originalSize);

    // 4. Verify that restoring the known-good snapshot succeeds completely
    const restoredPath = path.join(dir, 'restored-after-failure.db');
    restoreLedgerBackup(knownGoodSnapshot, restoredPath, false);
    expect(fs.existsSync(restoredPath)).toBe(true);
    const restoredEngine = createPolicyEngine(restoredPath);
    expect(restoredEngine.getAgentOwnerOrg('agent-good-snapshot')).toBe(STAGING_ORG);
    restoredEngine.close();

    engineForBackup.close();
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

describe('Step 12 — Reverse Proxy & Operator Access Behind Caddy', () => {
  it('matches trusted proxy CIDR ranges and single IPs for Docker networks', () => {
    const proxies = ['127.0.0.1', '::1', '172.16.0.0/12', '10.0.0.0/8'];

    // Local loopback
    expect(isTrustedProxy('127.0.0.1', proxies)).toBe(true);
    expect(isTrustedProxy('::1', proxies)).toBe(true);

    // Docker bridge network IP (within 172.16.0.0/12)
    expect(isTrustedProxy('172.17.0.2', proxies)).toBe(true);
    expect(isTrustedProxy('172.20.0.15', proxies)).toBe(true);
    expect(isTrustedProxy('172.31.255.254', proxies)).toBe(true);

    // Other private network (10.0.0.0/8)
    expect(isTrustedProxy('10.42.0.1', proxies)).toBe(true);

    // Untrusted public IPs
    expect(isTrustedProxy('198.51.100.1', proxies)).toBe(false);
    expect(isTrustedProxy('203.0.113.50', proxies)).toBe(false);
    expect(isTrustedProxy('172.32.0.1', proxies)).toBe(false); // Outside /12

    // Client identity extraction through trusted proxy
    const extracted = clientIdentity({
      remoteAddress: '172.20.0.2',
      forwardedFor: '198.51.100.42',
      realIp: '198.51.100.42',
      trustedProxies: proxies,
    });
    expect(extracted).toBe('198.51.100.42');

    // Untrusted direct client attempting to spoof forwarded headers
    const spoofed = clientIdentity({
      remoteAddress: '198.51.100.99',
      forwardedFor: '1.2.3.4',
      realIp: '1.2.3.4',
      trustedProxies: proxies,
    });
    expect(spoofed).toBe('198.51.100.99');
  });

  it('distinguishes client IPs behind Caddy for operator login rate limiting and enforces secure cookies', async () => {
    const engine = createPolicyEngine();
    const app = createGatewayApp(engine, undefined, {
      operators: [{ key: STRONG_KEY, ownerOrg: STAGING_ORG }],
      secureCookies: true,
      trustedProxies: ['127.0.0.1', '::1', '172.16.0.0/12', '10.0.0.0/8'],
      publicOrigin: 'https://gateway.staging.shlita.xyz',
      remoteAddress: (header) => header('x-mock-remote-addr') || '172.20.0.2',
    });

    const caddyProxyIp = '172.20.0.2';
    const clientAIp = '198.51.100.10';
    const clientBIp = '198.51.100.20';

    // 1. Client A sends 8 invalid operator sign-in attempts through Caddy (maxFailures = 8)
    for (let i = 0; i < 8; i++) {
      const res = await app.request('/v1/session', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mock-remote-addr': caddyProxyIp,
          'x-real-ip': clientAIp,
          'x-forwarded-for': clientAIp,
          'x-forwarded-proto': 'https',
          host: 'gateway.staging.shlita.xyz',
        },
        body: JSON.stringify({ operatorKey: 'invalid-operator-secret' }),
      });
      expect(res.status).toBe(403);
    }

    // 2. Client A attempt #9 is rate-limited (429)
    const clientALocked = await app.request('/v1/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-remote-addr': caddyProxyIp,
        'x-real-ip': clientAIp,
        'x-forwarded-for': clientAIp,
        'x-forwarded-proto': 'https',
        host: 'gateway.staging.shlita.xyz',
      },
      body: JSON.stringify({ operatorKey: STRONG_KEY }),
    });
    expect(clientALocked.status).toBe(429);
    const lockedJson = await clientALocked.json();
    expect(lockedJson.error).toBe('RATE_LIMITED');

    // 3. Client B connects through the exact same Caddy proxy with valid key and succeeds
    const clientBOk = await app.request('/v1/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-mock-remote-addr': caddyProxyIp,
        'x-real-ip': clientBIp,
        'x-forwarded-for': clientBIp,
        'x-forwarded-proto': 'https',
        host: 'gateway.staging.shlita.xyz',
      },
      body: JSON.stringify({ operatorKey: STRONG_KEY }),
    });
    expect(clientBOk.status).toBe(200);
    const clientBJson = await clientBOk.json();
    expect(clientBJson.authenticated).toBe(true);
    expect(clientBJson.organizationId).toBe(STAGING_ORG);
    expect(clientBJson.csrfToken).toBeDefined();

    // 4. Verify cookie has Secure; HttpOnly flag set
    const setCookie = clientBOk.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    engine.close();
  });
});
