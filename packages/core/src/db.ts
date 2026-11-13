import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
let NodeDatabaseSync: any = null;
try {
  NodeDatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  // Graceful fallback when running in runtimes without node:sqlite (< Node 22.5)
}

import {
  AgentFinancialState,
  AgentRecord,
  AuditEventRecord,
  BudgetReservation,
  CostBasis,
  PolicyDecision,
  PolicyRecord,
  RequestRecord,
  ReservationStatus,
  SettlementRecord,
  SpendingPolicy,
  TransactionLifecycleState,
} from './types.js';
import { MAX_MICRO_USDC, parseMicroUsdc, parseStoredMicroUsdc } from './money.js';
import { assertTransition, idempotencyReference, IN_FLIGHT_STATES, RESERVATION_HOLD_STATES } from './lifecycle.js';

export interface SqliteLedgerOptions {
  dbPath?: string; // ':memory:' or file path
  requirePersistent?: boolean;
}

export class SqliteLedger {
  private db?: DatabaseSync;

  // In-memory fallback structures for runtimes without node:sqlite
  private isFallback = false;
  private memAgents = new Map<string, any>();
  private memPolicies = new Map<string, any>();
  private memReservations = new Map<string, any>();
  private memRateCalls: Array<{ agentId: string; timestamp: number }> = [];
  private memSettlements = new Map<string, any>();
  private memAuditEvents: AuditEventRecord[] = [];
  private memOperations = new Map<string, any>();
  private commitShouldFail = false;

  constructor(options: SqliteLedgerOptions = {}) {
    const target = options.dbPath ?? ':memory:';
    const production =
      options.requirePersistent === true ||
      process.env.SHLITA_ENV === 'production' ||
      process.env.NODE_ENV === 'production';
    if (production && (target === ':memory:' || !NodeDatabaseSync)) {
      throw new Error('Persistent ledger is required in production.');
    }
    if (NodeDatabaseSync) {
      if (target !== ':memory:') {
        const dir = path.dirname(path.resolve(target));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new NodeDatabaseSync(target, { timeout: 5000 });
      this.initSchema();
    } else {
      this.isFallback = true;
    }
  }

  private initSchema(): void {
    if (!this.db) return;
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    // 1. Agents Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        owner_org TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        api_key_hash TEXT UNIQUE NOT NULL,
        freeze_reason TEXT,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        period_start_timestamp INTEGER NOT NULL,
        current_period_spend_micro_usdc TEXT NOT NULL DEFAULT '0',
        total_lifetime_spend_micro_usdc TEXT NOT NULL DEFAULT '0',
        created_at INTEGER NOT NULL,
        api_key_revoked INTEGER NOT NULL DEFAULT 0,
        api_key_expires_at INTEGER
      );
    `);
    this.ensureAgentCredentialColumns();

    // 2. Policies Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS policies (
        agent_id TEXT PRIMARY KEY,
        allowed_vendors_json TEXT NOT NULL,
        max_per_call_micro_usdc TEXT NOT NULL,
        period_budget_micro_usdc TEXT NOT NULL,
        period_seconds INTEGER NOT NULL,
        max_consecutive_errors INTEGER NOT NULL DEFAULT 3,
        max_calls_per_minute INTEGER NOT NULL DEFAULT 6,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `);

    // 3. Reservations Table (Atomic 2-Phase Commit Budget Locks)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        idempotency_key TEXT,
        reserved_amount_micro_usdc TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        UNIQUE(agent_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_reservations_agent_status ON reservations(agent_id, status);
    `);

    // 4. Rate Tracking Table (Rolling Anomaly Detector)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rate_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_calls_agent_time ON rate_calls(agent_id, timestamp);
    `);

    // 5. Requests Table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        request_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        route_model TEXT NOT NULL,
        estimate_micro_usdc TEXT NOT NULL,
        usage_units INTEGER,
        actual_cost_micro_usdc TEXT,
        response_status INTEGER,
        latency_ms REAL,
        correlation_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // 6. Settlements Table (Real Solana Subscriptions Settlement Ledger)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settlements (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        reservation_id TEXT NOT NULL,
        network TEXT NOT NULL,
        signature TEXT,
        source_account TEXT NOT NULL,
        destination_account TEXT NOT NULL,
        mint TEXT NOT NULL,
        amount_micro_usdc TEXT NOT NULL,
        confirmation_status TEXT NOT NULL,
        slot INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_settlements_req ON settlements(request_id);
    `);

    // 7. Audit Events Table (Append-Only)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        actor TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT,
        timestamp INTEGER NOT NULL,
        correlation_id TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(timestamp DESC);
    `);

    // 8. Financial operations. Additive: existing agent, policy, and reservation rows stay.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS financial_operations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        idempotency_ref TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        vendor TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        estimated_cost_micro_usdc TEXT NOT NULL,
        reserved_amount_micro_usdc TEXT NOT NULL,
        actual_cost_micro_usdc TEXT,
        cost_basis TEXT NOT NULL,
        state TEXT NOT NULL,
        reservation_id TEXT,
        correlation_id TEXT NOT NULL,
        policy_version INTEGER,
        decision TEXT,
        reason TEXT,
        response_status INTEGER,
        result_json TEXT,
        settlement_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(agent_id, idempotency_key),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_operations_state ON financial_operations(state);
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chain_settlements (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL UNIQUE,
        organization_id TEXT NOT NULL,
        destination TEXT NOT NULL,
        mint TEXT NOT NULL,
        amount_micro_usdc TEXT NOT NULL,
        cluster TEXT NOT NULL,
        status TEXT NOT NULL,
        signature TEXT,
        slot INTEGER,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (operation_id) REFERENCES financial_operations(id)
      );
    `);
    this.applyMigrations();
  }

  private applyMigrations(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    let version = this.schemaVersion();
    if (version < 1) {
      this.markMigration(1);
      version = 1;
    }
    if (version < 2) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          client TEXT NOT NULL,
          attempted_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup
          ON login_attempts(kind, client, attempted_at);
      `);
      this.markMigration(2);
    }
  }

  private markMigration(version: number): void {
    this.db!.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
  }

  schemaVersion(): number {
    if (!this.db) return 0;
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    return row?.version ?? 0;
  }

  storageReady(): boolean {
    if (!this.db) return false;
    try {
      this.db.prepare('SELECT 1 AS ok').get();
      return true;
    } catch {
      return false;
    }
  }

  recordAttempt(kind: string, client: string, at: number): void {
    if (!this.db) return;
    this.db
      .prepare('INSERT INTO login_attempts (kind, client, attempted_at) VALUES (?, ?, ?)')
      .run(kind, client.slice(0, 200), at);
  }

  countAttempts(kind: string, client: string, since: number): number {
    if (!this.db) return 0;
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM login_attempts WHERE kind = ? AND client = ? AND attempted_at >= ?'
      )
      .get(kind, client.slice(0, 200), since) as { n: number };
    return Number(row?.n ?? 0);
  }

  clearAttempts(kind: string, client: string): void {
    if (!this.db) return;
    this.db.prepare('DELETE FROM login_attempts WHERE kind = ? AND client = ?').run(kind, client.slice(0, 200));
  }

  operationalCounts(): { pendingReservations: number; reconciliation: number; settlementPending: number } {
    if (!this.db) return { pendingReservations: 0, reconciliation: 0, settlementPending: 0 };
    const pending = this.db
      .prepare(`SELECT COUNT(*) AS n FROM reservations WHERE status = 'PENDING'`)
      .get() as { n: number };
    const reconciliation = this.db
      .prepare(`SELECT COUNT(*) AS n FROM financial_operations WHERE state = 'RECONCILIATION_REQUIRED'`)
      .get() as { n: number };
    const settlementPending = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM financial_operations WHERE state IN ('SETTLEMENT_SUBMITTED', 'SETTLEMENT_CONFIRMATION_PENDING', 'SETTLEMENT_OUTCOME_UNKNOWN')`
      )
      .get() as { n: number };
    return {
      pendingReservations: Number(pending?.n ?? 0),
      reconciliation: Number(reconciliation?.n ?? 0),
      settlementPending: Number(settlementPending?.n ?? 0),
    };
  }

  async backupTo(dest: string): Promise<void> {
    if (!this.db) throw new Error('Persistent ledger is required for backup.');
    const directory = path.dirname(dest);
    fs.mkdirSync(directory, { recursive: true });
    const tempDest = `${dest}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const escapedTempDest = tempDest.replace(/'/g, "''");
      this.db.exec(`VACUUM INTO '${escapedTempDest}'`);
      fs.chmodSync(tempDest, 0o600);
      const check = new NodeDatabaseSync(tempDest, { readOnly: true });
      try {
        const row = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (row.integrity_check !== 'ok') throw new Error('Backup failed integrity check.');
      } finally {
        check.close();
      }
      fs.renameSync(tempDest, dest);
    } catch (error) {
      if (fs.existsSync(tempDest)) {
        fs.rmSync(tempDest, { force: true });
      }
      throw error;
    }
  }

  private ensureAgentCredentialColumns(): void {
    if (!this.db) return;
    const columns = this.db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('api_key_revoked')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN api_key_revoked INTEGER NOT NULL DEFAULT 0');
    }
    if (!names.has('api_key_expires_at')) {
      this.db.exec('ALTER TABLE agents ADD COLUMN api_key_expires_at INTEGER');
    }
  }

  // --- Agent & Policy Registration ---

  registerAgent(
    policy: SpendingPolicy,
    options: {
      ownerOrg?: string;
      rawApiKey?: string;
      apiKeyHash?: string;
      rotateKey?: boolean;
      expiresAt?: number | null;
    } = {}
  ): { apiKey: string; apiKeyHash: string } {
    const now = Date.now();
    const existing = this.readCredential(policy.agentId);
    if (existing && !options.rotateKey) {
      this.upsertPolicy(policy);
      return { apiKey: '', apiKeyHash: existing.apiKeyHash };
    }

    const rawApiKey =
      options.rotateKey || !options.rawApiKey
        ? `shlt_live_${crypto.randomBytes(16).toString('hex')}`
        : options.rawApiKey;
    const apiKeyHash =
      options.rotateKey || !options.apiKeyHash
        ? crypto.createHash('sha256').update(rawApiKey).digest('hex')
        : options.apiKeyHash;
    const ownerOrg = existing?.ownerOrg || options.ownerOrg || 'org-autonomous-default';
    const expiresAt = options.rotateKey ? null : options.expiresAt ?? null;

    if (this.isFallback) {
      const previous = this.memAgents.get(policy.agentId);
      this.memAgents.set(policy.agentId, {
        id: policy.agentId,
        owner_org: ownerOrg,
        status: previous?.status ?? 'ACTIVE',
        api_key_hash: apiKeyHash,
        api_key_revoked: 0,
        api_key_expires_at: expiresAt,
        consecutive_errors: previous?.consecutive_errors ?? 0,
        period_start_timestamp: previous?.period_start_timestamp ?? now,
        current_period_spend_micro_usdc: previous?.current_period_spend_micro_usdc ?? 0n,
        total_lifetime_spend_micro_usdc: previous?.total_lifetime_spend_micro_usdc ?? 0n,
        created_at: previous?.created_at ?? now,
        freeze_reason: previous?.freeze_reason,
      });
      this.upsertPolicy(policy);
      return { apiKey: rawApiKey, apiKeyHash };
    }

    this.db!.exec('BEGIN IMMEDIATE;');
    try {
      if (existing) {
        this.db!.prepare(
          `UPDATE agents
           SET api_key_hash = ?, api_key_revoked = 0, api_key_expires_at = NULL
           WHERE id = ?`
        ).run(apiKeyHash, policy.agentId);
      } else {
        this.db!.prepare(
          `INSERT INTO agents (
             id, owner_org, status, api_key_hash, period_start_timestamp, created_at,
             api_key_revoked, api_key_expires_at
           )
           VALUES (?, ?, 'ACTIVE', ?, ?, ?, 0, ?)`
        ).run(policy.agentId, ownerOrg, apiKeyHash, now, now, expiresAt);
      }
      this.upsertPolicy(policy);
      this.db!.exec('COMMIT;');
      return { apiKey: rawApiKey, apiKeyHash };
    } catch (err) {
      this.db!.exec('ROLLBACK;');
      throw err;
    }
  }

  private upsertPolicy(policy: SpendingPolicy): void {
    if (this.isFallback) {
      const previous = this.memPolicies.get(policy.agentId);
      this.memPolicies.set(policy.agentId, {
        ...policy,
        version: (previous?.version ?? 0) + 1,
      });
      return;
    }

    this.db!.prepare(
      `INSERT INTO policies (
        agent_id, allowed_vendors_json, max_per_call_micro_usdc,
        period_budget_micro_usdc, period_seconds, max_consecutive_errors,
        max_calls_per_minute, version
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(agent_id) DO UPDATE SET
        allowed_vendors_json = excluded.allowed_vendors_json,
        max_per_call_micro_usdc = excluded.max_per_call_micro_usdc,
        period_budget_micro_usdc = excluded.period_budget_micro_usdc,
        period_seconds = excluded.period_seconds,
        max_consecutive_errors = excluded.max_consecutive_errors,
        max_calls_per_minute = excluded.max_calls_per_minute,
        version = policies.version + 1`
    ).run(
      policy.agentId,
      JSON.stringify(policy.allowedVendors),
      policy.maxPerCallMicroUsdc.toString(),
      policy.periodBudgetMicroUsdc.toString(),
      policy.periodSeconds,
      policy.circuitBreaker.maxConsecutiveErrors,
      policy.circuitBreaker.maxCallsPerMinute
    );
  }

  private readCredential(
    agentId: string
  ): { apiKeyHash: string; ownerOrg: string } | null {
    if (this.isFallback) {
      const agent = this.memAgents.get(agentId);
      if (!agent) return null;
      return { apiKeyHash: agent.api_key_hash, ownerOrg: agent.owner_org };
    }
    const row = this.db!.prepare(
      'SELECT api_key_hash, owner_org FROM agents WHERE id = ?'
    ).get(agentId) as { api_key_hash: string; owner_org: string } | undefined;
    if (!row) return null;
    return { apiKeyHash: row.api_key_hash, ownerOrg: row.owner_org };
  }

  rotateAgentKey(agentId: string): { apiKey: string; apiKeyHash: string } | null {
    const existing = this.readCredential(agentId);
    if (!existing) return null;
    const policy = this.getAllPolicies().find((item) => item.agentId === agentId);
    if (!policy) return null;
    return this.registerAgent(policy, { rotateKey: true });
  }

  revokeAgentKey(agentId: string): boolean {
    if (this.isFallback) {
      const agent = this.memAgents.get(agentId);
      if (!agent) return false;
      agent.api_key_revoked = 1;
      return true;
    }
    const result = this.db!.prepare(
      'UPDATE agents SET api_key_revoked = 1 WHERE id = ?'
    ).run(agentId);
    return Number(result.changes) > 0;
  }

  getAgentOwnerOrg(agentId: string): string | null {
    return this.readCredential(agentId)?.ownerOrg ?? null;
  }

  // --- Authentication ---

  authenticateApiKey(apiKey: string): { agentId: string; ownerOrg: string } | null {
    if (!apiKey) return null;
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const now = Date.now();

    if (this.isFallback) {
      for (const [id, agent] of this.memAgents.entries()) {
        if (agent.api_key_hash !== hash) continue;
        if (agent.api_key_revoked) return null;
        if (agent.api_key_expires_at != null && agent.api_key_expires_at <= now) return null;
        return { agentId: id, ownerOrg: agent.owner_org };
      }
      return null;
    }

    const row = this.db!.prepare(
      `SELECT id, owner_org, api_key_revoked, api_key_expires_at
       FROM agents WHERE api_key_hash = ?`
    ).get(hash) as
      | { id: string; owner_org: string; api_key_revoked: number; api_key_expires_at: number | null }
      | undefined;
    if (!row) return null;
    if (row.api_key_revoked) return null;
    if (row.api_key_expires_at != null && row.api_key_expires_at <= now) return null;
    return { agentId: row.id, ownerOrg: row.owner_org };
  }

  // --- Atomic Two-Phase Budget Reservation ---

  evaluateAndReserve(request: {
    agentId: string;
    vendor: string;
    estimatedCostMicroUsdc: bigint;
    timestamp: number;
    idempotencyKey?: string;
  }): PolicyDecision {
    const now = request.timestamp;
    this.pruneExpiredReservations(now);

    if (this.isFallback) {
      const agent = this.memAgents.get(request.agentId);
      if (!agent) {
        return {
          allowed: false,
          reason: 'AGENT_NOT_FOUND',
          message: `Agent '${request.agentId}' is not registered with Shlita perimeter.`,
        };
      }
      if (agent.status === 'AGENT_FROZEN') {
        return {
          allowed: false,
          reason: 'AGENT_FROZEN',
          message: agent.freeze_reason || 'Agent manually frozen',
        };
      }
      if (agent.status === 'CIRCUIT_TRIPPED') {
        return {
          allowed: false,
          reason: 'CIRCUIT_BREAKER_TRIPPED',
          message: 'Circuit breaker tripped',
        };
      }
      const policy = this.memPolicies.get(request.agentId);
      if (!policy) {
        return { allowed: false, reason: 'AGENT_NOT_FOUND', message: 'No policy' };
      }

      // Check vendor
      const cleanVendor = request.vendor.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      const isAllowed = policy.allowedVendors.some((v: string) => {
        const cv = v.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        return cleanVendor === cv || cleanVendor.endsWith(`.${cv}`);
      });
      if (!isAllowed) {
        return {
          allowed: false,
          reason: 'UNAPPROVED_VENDOR',
          message: `Vendor '${request.vendor}' not allowed`,
        };
      }

      if (request.estimatedCostMicroUsdc > policy.maxPerCallMicroUsdc) {
        return {
          allowed: false,
          reason: 'PER_CALL_LIMIT_EXCEEDED',
          message: 'Exceeds single call cap',
        };
      }

      // Rate limit
      const oneMinuteAgo = now - 60_000;
      this.memRateCalls = this.memRateCalls.filter((c) => c.timestamp >= oneMinuteAgo);
      const agentCalls = this.memRateCalls.filter((c) => c.agentId === request.agentId).length + 1;
      if (agentCalls > policy.circuitBreaker.maxCallsPerMinute) {
        agent.status = 'CIRCUIT_TRIPPED';
        agent.freeze_reason = 'Call burst detected';
        return {
          allowed: false,
          reason: 'RATE_ANOMALY_LOOP_DETECTED',
          message: 'Circuit breaker tripped on loop',
        };
      }

      // Idempotency
      if (request.idempotencyKey) {
        for (const [id, r] of this.memReservations.entries()) {
          if (r.agent_id === request.agentId && r.idempotency_key === request.idempotencyKey) {
            if (r.status === 'PENDING') {
              return {
                allowed: false,
                reason: 'CONCURRENCY_RESERVATION_FAILED',
                message: `Idempotency key '${request.idempotencyKey}' already has an active reservation.`,
              };
            }
            if (r.status === 'COMMITTED') {
              return {
                allowed: false,
                reason: 'CONCURRENCY_RESERVATION_FAILED',
                message: 'Already committed',
              };
            }
          }
        }
      }

      // Active reserves sum
      let activeRes = 0n;
      for (const r of this.memReservations.values()) {
        if (r.agent_id === request.agentId && r.status === 'PENDING') {
          activeRes += r.reserved_amount_micro_usdc;
        }
      }

      if (agent.current_period_spend_micro_usdc + activeRes + request.estimatedCostMicroUsdc > policy.periodBudgetMicroUsdc) {
        return {
          allowed: false,
          reason: 'PERIOD_BUDGET_EXCEEDED',
          message: 'Exceeds period budget',
        };
      }

      const resId = `res_${now}_${Math.random().toString(36).substring(2, 8)}`;
      this.memReservations.set(resId, {
        id: resId,
        agent_id: request.agentId,
        idempotency_key: request.idempotencyKey,
        reserved_amount_micro_usdc: request.estimatedCostMicroUsdc,
        status: 'PENDING',
        created_at: now,
        expires_at: now + 45_000,
      });
      this.memRateCalls.push({ agentId: request.agentId, timestamp: now });

      return {
        allowed: true,
        authorizedAmountMicroUsdc: request.estimatedCostMicroUsdc,
        reservationId: resId,
        idempotencyKey: request.idempotencyKey,
      };
    }

    this.db!.exec('BEGIN IMMEDIATE;');
    try {
      const agentStmt = this.db!.prepare('SELECT * FROM agents WHERE id = ?');
      const agent = agentStmt.get(request.agentId) as any;
      if (!agent) {
        this.db!.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'AGENT_NOT_FOUND',
          message: `Agent '${request.agentId}' is not registered with Shlita perimeter.`,
        };
      }

      if (agent.status === 'AGENT_FROZEN') {
        this.db!.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'AGENT_FROZEN',
          message: `Agent '${request.agentId}' has been administratively frozen by operator. Reason: ${agent.freeze_reason || 'Manual freeze'}`,
        };
      }

      if (agent.status === 'CIRCUIT_TRIPPED') {
        this.db!.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'CIRCUIT_BREAKER_TRIPPED',
          message: `Circuit breaker tripped for agent '${request.agentId}'. Requires operator manual intervention.`,
        };
      }

      const policyStmt = this.db!.prepare('SELECT * FROM policies WHERE agent_id = ?');
      const policyRow = policyStmt.get(request.agentId) as any;
      if (!policyRow) {
        this.db!.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'AGENT_NOT_FOUND',
          message: `No spending policy configured for agent '${request.agentId}'.`,
        };
      }

      const allowedVendors: string[] = JSON.parse(policyRow.allowed_vendors_json);
      const maxPerCallMicroUsdc = BigInt(policyRow.max_per_call_micro_usdc);
      const periodBudgetMicroUsdc = BigInt(policyRow.period_budget_micro_usdc);
      const periodSeconds = policyRow.period_seconds;
      const maxCallsPerMinute = policyRow.max_calls_per_minute;

      const normalizedVendor = request.vendor.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      const isVendorAllowed = allowedVendors.some((v) => {
        const cleanV = v.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        return normalizedVendor === cleanV || normalizedVendor.endsWith(`.${cleanV}`);
      });

      if (!isVendorAllowed) {
        this.db!.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'UNAPPROVED_VENDOR',
          message: `Vendor '${request.vendor}' (${normalizedVendor}) is not in agent whitelist [${allowedVendors.join(', ')}].`,
        };
      }

      if (request.estimatedCostMicroUsdc > maxPerCallMicroUsdc) {
        this.db!.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'PER_CALL_LIMIT_EXCEEDED',
          message: `Estimated cost ${request.estimatedCostMicroUsdc} µUSDC exceeds single-call limit of ${maxPerCallMicroUsdc} µUSDC.`,
        };
      }

      const oneMinuteAgo = now - 60_000;
      this.db!.prepare('DELETE FROM rate_calls WHERE agent_id = ? AND timestamp < ?').run(
        request.agentId,
        oneMinuteAgo
      );
      const callCountRow = this.db!
        .prepare('SELECT COUNT(*) as count FROM rate_calls WHERE agent_id = ? AND timestamp >= ?')
        .get(request.agentId, oneMinuteAgo) as any;
      const recentCalls = (callCountRow?.count ?? 0) + 1;

      if (recentCalls > maxCallsPerMinute) {
        this.db!
          .prepare(
            `UPDATE agents SET status = 'CIRCUIT_TRIPPED', freeze_reason = 'High-frequency burst loop detected' WHERE id = ?`
          )
          .run(request.agentId);
        this.db!.exec('COMMIT;');
        return {
          allowed: false,
          reason: 'RATE_ANOMALY_LOOP_DETECTED',
          message: `Call burst detected (${recentCalls} calls in last 60s, max is ${maxCallsPerMinute}). Circuit breaker tripped.`,
        };
      }

      if (request.idempotencyKey) {
        const existingRes = this.db!
          .prepare('SELECT * FROM reservations WHERE agent_id = ? AND idempotency_key = ?')
          .get(request.agentId, request.idempotencyKey) as any;
        if (existingRes) {
          if (existingRes.status === 'PENDING') {
            this.db!.exec('ROLLBACK;');
            return {
              allowed: false,
              reason: 'CONCURRENCY_RESERVATION_FAILED',
              message: `Idempotency key '${request.idempotencyKey}' already has an active reservation.`,
            };
          }
          if (existingRes.status === 'COMMITTED') {
            this.db!.exec('ROLLBACK;');
            return {
              allowed: false,
              reason: 'CONCURRENCY_RESERVATION_FAILED',
              message: `Idempotency key '${request.idempotencyKey}' was already committed. Duplicate spend prevented.`,
            };
          }
        }
      }

      let currentPeriodSpend = parseStoredMicroUsdc(String(agent.current_period_spend_micro_usdc));
      let periodStart = agent.period_start_timestamp;
      const periodDurationMs = periodSeconds * 1000;

      if (now - periodStart >= periodDurationMs) {
        currentPeriodSpend = 0n;
        periodStart = now;
        this.db!
          .prepare(
            'UPDATE agents SET current_period_spend_micro_usdc = 0, period_start_timestamp = ? WHERE id = ?'
          )
          .run(now, request.agentId);
      }

      const activeReservations = this.sumPendingReservations(request.agentId);

      const totalCommittedAndReserved =
        currentPeriodSpend + activeReservations + request.estimatedCostMicroUsdc;

      if (totalCommittedAndReserved > periodBudgetMicroUsdc) {
        this.db!.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'PERIOD_BUDGET_EXCEEDED',
          message: `Request for ${request.estimatedCostMicroUsdc} µUSDC would exceed period budget (Current: ${currentPeriodSpend} µUSDC, Active Reserves: ${activeReservations} µUSDC, Cap: ${periodBudgetMicroUsdc} µUSDC).`,
        };
      }

      const reservationId = `res_${now}_${Math.random().toString(36).substring(2, 8)}`;
      const expiresAt = now + 45_000;

      this.db!
        .prepare(
          `INSERT INTO reservations (id, agent_id, idempotency_key, reserved_amount_micro_usdc, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`
        )
        .run(
          reservationId,
          request.agentId,
          request.idempotencyKey || null,
          request.estimatedCostMicroUsdc.toString(),
          now,
          expiresAt
        );

      this.db!
        .prepare('INSERT INTO rate_calls (agent_id, timestamp) VALUES (?, ?)')
        .run(request.agentId, now);

      this.db!.exec('COMMIT;');

      return {
        allowed: true,
        authorizedAmountMicroUsdc: request.estimatedCostMicroUsdc,
        reservationId,
        idempotencyKey: request.idempotencyKey,
      };
    } catch (err: any) {
      this.db!.exec('ROLLBACK;');
      return {
        allowed: false,
        reason: 'CONCURRENCY_RESERVATION_FAILED',
        message: `Database reservation failed: ${err?.message || 'Transaction error'}`,
      };
    }
  }

  // --- Commit Reservation ---

  commitReservation(
    reservationId: string,
    actualCostMicroUsdc?: bigint
  ): boolean {
    if (this.isFallback) {
      const res = this.memReservations.get(reservationId);
      if (!res || res.status !== 'PENDING') return false;
      const reservedAmount = res.reserved_amount_micro_usdc;
      const actualCost = actualCostMicroUsdc !== undefined ? actualCostMicroUsdc : reservedAmount;
      if (actualCost > reservedAmount) return false;
      res.status = 'COMMITTED';
      const agent = this.memAgents.get(res.agent_id);
      if (agent) {
        agent.current_period_spend_micro_usdc += actualCost;
        agent.total_lifetime_spend_micro_usdc += actualCost;
        agent.consecutive_errors = 0;
      }
      return true;
    }

    this.db!.exec('BEGIN IMMEDIATE;');
    try {
      const resStmt = this.db!.prepare('SELECT * FROM reservations WHERE id = ?');
      const res = resStmt.get(reservationId) as any;
      if (!res) {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      if (res.status !== 'PENDING') {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      const reservedAmount = parseStoredMicroUsdc(String(res.reserved_amount_micro_usdc));
      const actualCost = actualCostMicroUsdc !== undefined ? actualCostMicroUsdc : reservedAmount;

      if (actualCost > reservedAmount || actualCost < 0n) {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      if (this.commitShouldFail) {
        this.commitShouldFail = false;
        this.db!.exec('ROLLBACK;');
        return false;
      }

      const committed = this.db!
        .prepare("UPDATE reservations SET status = 'COMMITTED' WHERE id = ? AND status = 'PENDING'")
        .run(reservationId);
      if (Number(committed.changes) !== 1) {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      const spend = this.db!
        .prepare(
          'SELECT current_period_spend_micro_usdc, total_lifetime_spend_micro_usdc FROM agents WHERE id = ?'
        )
        .get(res.agent_id) as
        | { current_period_spend_micro_usdc: string; total_lifetime_spend_micro_usdc: string }
        | undefined;
      const nextPeriod = parseStoredMicroUsdc(spend?.current_period_spend_micro_usdc ?? '0') + actualCost;
      const nextLifetime = parseStoredMicroUsdc(spend?.total_lifetime_spend_micro_usdc ?? '0') + actualCost;
      if (nextPeriod > MAX_MICRO_USDC || nextLifetime > MAX_MICRO_USDC) {
        this.db!.exec('ROLLBACK;');
        return false;
      }
      this.db!
        .prepare(
          `UPDATE agents SET
             current_period_spend_micro_usdc = ?,
             total_lifetime_spend_micro_usdc = ?,
             consecutive_errors = 0
           WHERE id = ?`
        )
        .run(nextPeriod.toString(), nextLifetime.toString(), res.agent_id);

      this.db!.exec('COMMIT;');
      return true;
    } catch {
      this.db!.exec('ROLLBACK;');
      return false;
    }
  }

  // --- Rollback Reservation ---

  rollbackReservation(
    reservationId: string,
    reason?: string
  ): boolean {
    if (this.isFallback) {
      const res = this.memReservations.get(reservationId);
      if (!res) return false;
      if (res.status !== 'PENDING') return false;
      res.status = 'ROLLED_BACK';
      const agent = this.memAgents.get(res.agent_id);
      const policy = this.memPolicies.get(res.agent_id);
      if (agent && policy) {
        agent.consecutive_errors = (agent.consecutive_errors || 0) + 1;
        if (agent.consecutive_errors >= policy.circuitBreaker.maxConsecutiveErrors) {
          agent.status = 'CIRCUIT_TRIPPED';
          agent.freeze_reason = reason || 'Consecutive errors breached';
        }
      }
      return true;
    }

    this.db!.exec('BEGIN IMMEDIATE;');
    try {
      const resStmt = this.db!.prepare('SELECT * FROM reservations WHERE id = ?');
      const res = resStmt.get(reservationId) as any;
      if (!res) {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      if (res.status !== 'PENDING') {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      const rolled = this.db!
        .prepare("UPDATE reservations SET status = 'ROLLED_BACK' WHERE id = ? AND status = 'PENDING'")
        .run(reservationId);
      if (Number(rolled.changes) !== 1) {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      const agentStmt = this.db!.prepare('SELECT * FROM agents WHERE id = ?');
      const agent = agentStmt.get(res.agent_id) as any;
      const policyStmt = this.db!.prepare('SELECT * FROM policies WHERE agent_id = ?');
      const policy = policyStmt.get(res.agent_id) as any;

      if (agent && policy) {
        const nextErrors = (agent.consecutive_errors || 0) + 1;
        const maxErrors = policy.max_consecutive_errors || 3;
        if (nextErrors >= maxErrors) {
          this.db!
            .prepare(
              `UPDATE agents SET consecutive_errors = ?, status = 'CIRCUIT_TRIPPED', freeze_reason = ? WHERE id = ?`
            )
            .run(nextErrors, `Consecutive upstream errors (${nextErrors}) exceeded threshold`, res.agent_id);
        } else {
          this.db!
            .prepare('UPDATE agents SET consecutive_errors = ? WHERE id = ?')
            .run(nextErrors, res.agent_id);
        }
      }

      this.db!.exec('COMMIT;');
      return true;
    } catch {
      this.db!.exec('ROLLBACK;');
      return false;
    }
  }

  recordExecutionFailure(agentId: string, error?: string): void {
    if (this.isFallback) {
      const agent = this.memAgents.get(agentId);
      const policy = this.memPolicies.get(agentId);
      if (agent && policy) {
        agent.consecutive_errors = (agent.consecutive_errors || 0) + 1;
        if (agent.consecutive_errors >= policy.circuitBreaker.maxConsecutiveErrors) {
          agent.status = 'CIRCUIT_TRIPPED';
          agent.freeze_reason = error || 'Error threshold breached';
        }
      }
      return;
    }

    const agentStmt = this.db!.prepare('SELECT * FROM agents WHERE id = ?');
    const agent = agentStmt.get(agentId) as any;
    const policyStmt = this.db!.prepare('SELECT * FROM policies WHERE agent_id = ?');
    const policy = policyStmt.get(agentId) as any;

    if (agent && policy) {
      const nextErrors = (agent.consecutive_errors || 0) + 1;
      const maxErrors = policy.max_consecutive_errors || 3;
      if (nextErrors >= maxErrors) {
        this.db!
          .prepare(
            `UPDATE agents SET consecutive_errors = ?, status = 'CIRCUIT_TRIPPED', freeze_reason = ? WHERE id = ?`
          )
          .run(nextErrors, `Consecutive upstream errors (${nextErrors}) exceeded threshold`, agentId);
      } else {
        this.db!
          .prepare('UPDATE agents SET consecutive_errors = ? WHERE id = ?')
          .run(nextErrors, agentId);
      }
    }
  }

  // --- Prune Expired Reservations ---

  pruneExpiredReservations(now = Date.now()): number {
    if (this.isFallback) {
      let count = 0;
      const held = new Set(
        [...this.memOperations.values()]
          .filter((operation) => RESERVATION_HOLD_STATES.includes(operation.state) && operation.reservation_id)
          .map((operation) => operation.reservation_id as string)
      );
      for (const r of this.memReservations.values()) {
        if (r.status === 'PENDING' && r.expires_at < now && !held.has(r.id)) {
          r.status = 'EXPIRED';
          count++;
        }
      }
      return count;
    }

    const protectedStates = RESERVATION_HOLD_STATES.map(() => '?').join(', ');
    const stmt = this.db!.prepare(
      `UPDATE reservations SET status = 'EXPIRED'
       WHERE status = 'PENDING' AND expires_at < ?
       AND id NOT IN (
         SELECT reservation_id FROM financial_operations
         WHERE reservation_id IS NOT NULL AND state IN (${protectedStates})
       )`
    );
    const result = stmt.run(now, ...RESERVATION_HOLD_STATES);
    return Number(result.changes);
  }

  // --- Reset Circuit Breaker ---

  resetCircuitBreaker(agentId: string): boolean {
    if (this.isFallback) {
      const agent = this.memAgents.get(agentId);
      if (agent) {
        agent.status = 'ACTIVE';
        agent.consecutive_errors = 0;
        agent.freeze_reason = undefined;
        return true;
      }
      return false;
    }

    const stmt = this.db!.prepare(
      `UPDATE agents SET status = 'ACTIVE', consecutive_errors = 0, freeze_reason = NULL WHERE id = ?`
    );
    const result = stmt.run(agentId);
    return Number(result.changes) > 0;
  }

  // --- Freeze / Unfreeze Agent ---

  setAgentFreeze(agentId: string, freeze: boolean, reason?: string): boolean {
    const status = freeze ? 'AGENT_FROZEN' : 'ACTIVE';
    if (this.isFallback) {
      const agent = this.memAgents.get(agentId);
      if (agent) {
        agent.status = status;
        agent.freeze_reason = freeze ? reason || 'Manual freeze' : undefined;
        return true;
      }
      return false;
    }

    const stmt = this.db!.prepare(
      `UPDATE agents SET status = ?, freeze_reason = ? WHERE id = ?`
    );
    const result = stmt.run(status, freeze ? reason || 'Manual operator freeze' : null, agentId);
    return Number(result.changes) > 0;
  }

  // --- Settlement Ledger ---

  recordSettlement(record: SettlementRecord): void {
    if (this.isFallback) {
      this.memSettlements.set(record.id, record);
      return;
    }

    const stmt = this.db!.prepare(`
      INSERT INTO settlements (
        id, request_id, reservation_id, network, signature, source_account,
        destination_account, mint, amount_micro_usdc, confirmation_status,
        slot, error, created_at, confirmed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        signature = excluded.signature,
        confirmation_status = excluded.confirmation_status,
        slot = excluded.slot,
        error = excluded.error,
        confirmed_at = excluded.confirmed_at
    `);
    stmt.run(
      record.id,
      record.requestId,
      record.reservationId,
      record.network,
      record.signature || null,
      record.sourceAccount,
      record.destinationAccount,
      record.mint,
      record.amountMicroUsdc.toString(),
      record.confirmationStatus,
      record.slot || null,
      record.error || null,
      record.createdAt,
      record.confirmedAt || null
    );
  }

  getSettlement(id: string): SettlementRecord | null {
    if (this.isFallback) {
      return this.memSettlements.get(id) || null;
    }
    const row = this.db!.prepare('SELECT * FROM settlements WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      requestId: row.request_id,
      reservationId: row.reservation_id,
      network: row.network,
      signature: row.signature,
      sourceAccount: row.source_account,
      destinationAccount: row.destination_account,
      mint: row.mint,
      amountMicroUsdc: BigInt(row.amount_micro_usdc),
      confirmationStatus: row.confirmation_status as TransactionLifecycleState,
      slot: row.slot,
      error: row.error,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
    };
  }

  // --- State Querying ---

  getAgentFinancialState(agentId: string): AgentFinancialState | null {
    if (this.isFallback) {
      const agent = this.memAgents.get(agentId);
      if (!agent) return null;
      let activeRes = 0n;
      for (const r of this.memReservations.values()) {
        if (r.agent_id === agentId && r.status === 'PENDING') {
          activeRes += r.reserved_amount_micro_usdc;
        }
      }
      return {
        agentId: agent.id,
        status: agent.status,
        currentPeriodSpendMicroUsdc: agent.current_period_spend_micro_usdc,
        totalLifetimeSpendMicroUsdc: agent.total_lifetime_spend_micro_usdc,
        activePendingReservationsMicroUsdc: activeRes,
        periodStartTimestamp: agent.period_start_timestamp,
        consecutiveErrors: agent.consecutive_errors,
        recentCallTimestamps: this.memRateCalls
          .filter((c) => c.agentId === agentId)
          .map((c) => c.timestamp),
        freezeReason: agent.freeze_reason,
      };
    }

    const agent = this.db!.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) return null;

    const activeRes = this.sumPendingReservations(agentId);

    const rateCalls = this.db!
      .prepare(
        'SELECT timestamp FROM rate_calls WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 20'
      )
      .all(agentId) as any[];

    return {
      agentId: agent.id,
      status: agent.status,
      currentPeriodSpendMicroUsdc: BigInt(agent.current_period_spend_micro_usdc),
      totalLifetimeSpendMicroUsdc: BigInt(agent.total_lifetime_spend_micro_usdc),
      activePendingReservationsMicroUsdc: activeRes,
      periodStartTimestamp: agent.period_start_timestamp,
      consecutiveErrors: agent.consecutive_errors,
      recentCallTimestamps: rateCalls.map((r) => r.timestamp),
      freezeReason: agent.freeze_reason,
    };
  }

  getAllPolicies(): SpendingPolicy[] {
    if (this.isFallback) {
      return Array.from(this.memPolicies.values());
    }
    const rows = this.db!.prepare('SELECT * FROM policies').all() as any[];
    return rows.map((r) => ({
      agentId: r.agent_id,
      allowedVendors: JSON.parse(r.allowed_vendors_json),
      maxPerCallMicroUsdc: BigInt(r.max_per_call_micro_usdc),
      periodBudgetMicroUsdc: BigInt(r.period_budget_micro_usdc),
      periodSeconds: r.period_seconds,
      circuitBreaker: {
        maxConsecutiveErrors: r.max_consecutive_errors,
        maxCallsPerMinute: r.max_calls_per_minute,
      },
    }));
  }

  // --- Audit Events ---

  recordAuditEventSync(entry: AuditEventRecord): void {
    if (this.isFallback) {
      this.memAuditEvents.unshift(entry);
      return;
    }
    const stmt = this.db!.prepare(`
      INSERT INTO audit_events (
        event_id, actor, agent_id, action, decision, reason, timestamp,
        correlation_id, details_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.eventId,
      entry.actor,
      entry.agentId,
      entry.action,
      entry.decision,
      entry.reason || null,
      entry.timestamp,
      entry.correlationId,
      entry.detailsJson
    );
  }

  getAuditLogs(limit = 100): AuditEventRecord[] {
    if (this.isFallback) {
      return this.memAuditEvents.slice(0, limit);
    }
    const rows = this.db!
      .prepare('SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map((r) => ({
      eventId: r.event_id,
      actor: r.actor,
      agentId: r.agent_id,
      action: r.action,
      decision: r.decision,
      reason: r.reason,
      timestamp: r.timestamp,
      correlationId: r.correlation_id,
      detailsJson: r.details_json,
    }));
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  failNextCommit(): void {
    this.commitShouldFail = true;
  }

  private sumPendingReservations(agentId: string): bigint {
    const rows = this.db!.prepare(
      `SELECT reserved_amount_micro_usdc FROM reservations WHERE agent_id = ? AND status = 'PENDING'`
    ).all(agentId) as Array<{ reserved_amount_micro_usdc: string }>;
    let total = 0n;
    for (const row of rows) total += parseStoredMicroUsdc(row.reserved_amount_micro_usdc);
    return total;
  }

  claimExecution(input: {
    agentId: string;
    vendor: string;
    method: string;
    path: string;
    fingerprint: string;
    idempotencyKey: string;
    estimatedCostMicroUsdc: bigint;
    reservedAmountMicroUsdc: bigint;
    declaredCostMicroUsdc?: bigint;
    timestamp: number;
  }):
    | {
        kind: 'execute';
        operationId: string;
        reservationId: string;
        estimatedMicroUsdc: bigint;
        reservedMicroUsdc: bigint;
        correlationId: string;
        policyVersion: number;
      }
    | { kind: 'replay'; httpStatus: number; body: Record<string, unknown> }
    | { kind: 'in_progress'; operationId: string }
    | { kind: 'conflict' }
    | { kind: 'rejected'; httpStatus: number; body: Record<string, unknown> } {
    if (this.isFallback || !this.db) {
      return {
        kind: 'rejected',
        httpStatus: 503,
        body: { allowed: false, error: 'LEDGER_UNAVAILABLE', message: 'Persistent ledger is required.' },
      };
    }

    const estimated = parseMicroUsdc(input.estimatedCostMicroUsdc);
    const reserved = parseMicroUsdc(input.reservedAmountMicroUsdc);
    if (!estimated.ok || !reserved.ok) {
      const message = !estimated.ok ? estimated.message : !reserved.ok ? reserved.message : 'Amount rejected.';
      return {
        kind: 'rejected',
        httpStatus: 400,
        body: { allowed: false, error: 'AMOUNT_REJECTED', message },
      };
    }
    let declared: bigint | undefined;
    if (input.declaredCostMicroUsdc !== undefined) {
      const parsed = parseMicroUsdc(input.declaredCostMicroUsdc);
      if (!parsed.ok) {
        return {
          kind: 'rejected',
          httpStatus: 400,
          body: { allowed: false, error: 'AMOUNT_REJECTED', message: parsed.message },
        };
      }
      declared = parsed.amount;
    }

    const now = input.timestamp;
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const existing = this.db
        .prepare('SELECT * FROM financial_operations WHERE agent_id = ? AND idempotency_key = ?')
        .get(input.agentId, input.idempotencyKey) as any;
      if (existing) {
        if (existing.request_fingerprint !== input.fingerprint) {
          this.db.exec('ROLLBACK;');
          return { kind: 'conflict' };
        }
        if (
          existing.state === 'EXECUTION_IN_PROGRESS' ||
          existing.state === 'BUDGET_RESERVED' ||
          existing.state === 'VENDOR_SUCCEEDED'
        ) {
          this.db.exec('ROLLBACK;');
          return { kind: 'in_progress', operationId: existing.id };
        }
        const body = existing.result_json
          ? (JSON.parse(existing.result_json) as Record<string, unknown>)
          : {
              error: existing.state,
              operationId: existing.id,
              fundsMoved: false,
            };
        const httpStatus = Number(existing.response_status ?? (existing.state === 'ACCOUNTING_COMMITTED' ? 200 : 409));
        this.db.exec('ROLLBACK;');
        return { kind: 'replay', httpStatus, body };
      }

      const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(input.agentId) as any;
      const policy = this.db.prepare('SELECT * FROM policies WHERE agent_id = ?').get(input.agentId) as any;
      const reject = (reason: string, message: string, status = 403) => {
        const operationId = `op_${crypto.randomUUID()}`;
        const correlationId = crypto.randomUUID();
        const body = { allowed: false, error: 'POLICY_VIOLATION', reason, message, operationId, correlationId };
        this.insertOperation({
          id: operationId,
          agentId: input.agentId,
          idempotencyKey: input.idempotencyKey,
          fingerprint: input.fingerprint,
          vendor: input.vendor,
          method: input.method,
          path: input.path,
          estimated: estimated.amount,
          reserved: 0n,
          state: 'POLICY_REJECTED',
          reservationId: null,
          correlationId,
          policyVersion: policy ? Number(policy.version) : null,
          decision: 'BLOCKED',
          reason,
          responseStatus: status,
          result: body,
          settlementStatus: 'NOT_SUBMITTED',
          costBasis: 'UNAVAILABLE',
          now,
          ownerOrg: agent?.owner_org ?? '',
          previousState: 'REQUEST_RECEIVED',
        });
        this.db!.exec('COMMIT;');
        return { kind: 'rejected' as const, httpStatus: status, body };
      };

      if (!agent || !policy) {
        this.db.exec('ROLLBACK;');
        return {
          kind: 'rejected',
          httpStatus: 403,
          body: { allowed: false, reason: 'AGENT_NOT_FOUND', message: 'Agent is not registered.' },
        };
      }
      if (agent.status === 'AGENT_FROZEN') {
        return reject('AGENT_FROZEN', agent.freeze_reason || 'Agent manually frozen');
      }
      if (agent.status === 'CIRCUIT_TRIPPED') {
        return reject('CIRCUIT_BREAKER_TRIPPED', 'Circuit breaker tripped');
      }

      const allowedVendors: string[] = JSON.parse(policy.allowed_vendors_json);
      const normalizedVendor = input.vendor.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      const vendorAllowed = allowedVendors.some((vendor) => {
        const clean = vendor.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        return normalizedVendor === clean || normalizedVendor.endsWith(`.${clean}`);
      });
      if (!vendorAllowed) {
        return reject('UNAPPROVED_VENDOR', `Vendor '${input.vendor}' is not in the agent whitelist.`);
      }

      const maxPerCall = parseStoredMicroUsdc(String(policy.max_per_call_micro_usdc));
      if (reserved.amount > maxPerCall || (declared !== undefined && declared > maxPerCall)) {
        return reject('PER_CALL_LIMIT_EXCEEDED', 'Request exceeds the single-call limit.');
      }

      const oneMinuteAgo = now - 60_000;
      this.db.prepare('DELETE FROM rate_calls WHERE agent_id = ? AND timestamp < ?').run(input.agentId, oneMinuteAgo);
      const callCount = this.db
        .prepare('SELECT COUNT(*) as count FROM rate_calls WHERE agent_id = ? AND timestamp >= ?')
        .get(input.agentId, oneMinuteAgo) as { count: number };
      const recentCalls = Number(callCount?.count ?? 0) + 1;
      if (recentCalls > Number(policy.max_calls_per_minute)) {
        this.db
          .prepare(`UPDATE agents SET status = 'CIRCUIT_TRIPPED', freeze_reason = ? WHERE id = ?`)
          .run('High-frequency burst loop detected', input.agentId);
        const rejected = reject('RATE_ANOMALY_LOOP_DETECTED', 'Call burst detected. Circuit breaker tripped.');
        return rejected;
      }

      let currentPeriodSpend = parseStoredMicroUsdc(String(agent.current_period_spend_micro_usdc));
      const periodStart = Number(agent.period_start_timestamp);
      const periodDurationMs = Number(policy.period_seconds) * 1000;
      if (now - periodStart >= periodDurationMs) {
        currentPeriodSpend = 0n;
        this.db
          .prepare('UPDATE agents SET current_period_spend_micro_usdc = 0, period_start_timestamp = ? WHERE id = ?')
          .run(now, input.agentId);
      }

      const activeReservations = this.sumPendingReservations(input.agentId);
      const periodBudget = parseStoredMicroUsdc(String(policy.period_budget_micro_usdc));
      if (currentPeriodSpend + activeReservations + reserved.amount > periodBudget) {
        return reject(
          'PERIOD_BUDGET_EXCEEDED',
          `Request for ${reserved.amount} µUSDC would exceed the period budget.`
        );
      }

      const reservationId = `res_${crypto.randomUUID()}`;
      const operationId = `op_${crypto.randomUUID()}`;
      const correlationId = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO reservations (id, agent_id, idempotency_key, reserved_amount_micro_usdc, status, created_at, expires_at)
           VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`
        )
        .run(reservationId, input.agentId, input.idempotencyKey, reserved.amount.toString(), now, now + 45_000);
      this.db.prepare('INSERT INTO rate_calls (agent_id, timestamp) VALUES (?, ?)').run(input.agentId, now);

      this.insertOperation({
        id: operationId,
        agentId: input.agentId,
        idempotencyKey: input.idempotencyKey,
        fingerprint: input.fingerprint,
        vendor: input.vendor,
        method: input.method,
        path: input.path,
        estimated: estimated.amount,
        reserved: reserved.amount,
        state: 'BUDGET_RESERVED',
        reservationId,
        correlationId,
        policyVersion: Number(policy.version),
        decision: 'ALLOWED',
        reason: null,
        responseStatus: null,
        result: null,
        settlementStatus: 'NOT_SUBMITTED',
        costBasis: 'ESTIMATED',
        now,
        ownerOrg: agent.owner_org,
        previousState: 'REQUEST_RECEIVED',
      });
      assertTransition('BUDGET_RESERVED', 'EXECUTION_IN_PROGRESS');
      this.db
        .prepare(`UPDATE financial_operations SET state = 'EXECUTION_IN_PROGRESS', updated_at = ? WHERE id = ?`)
        .run(now, operationId);
      this.auditFinancial({
        agentId: input.agentId,
        idempotencyKey: input.idempotencyKey,
        fingerprint: input.fingerprint,
        vendor: input.vendor,
        state: 'EXECUTION_IN_PROGRESS',
        previousState: 'BUDGET_RESERVED',
        estimated: estimated.amount.toString(),
        reserved: reserved.amount.toString(),
        actual: null,
        costBasis: 'ESTIMATED',
        reservationId,
        settlementStatus: 'NOT_SUBMITTED',
        operationId,
        correlationId,
        ownerOrg: agent.owner_org,
        policyVersion: Number(policy.version),
        decision: 'ALLOWED',
        reason: undefined,
        now,
      });
      this.db.exec('COMMIT;');
      return {
        kind: 'execute',
        operationId,
        reservationId,
        estimatedMicroUsdc: estimated.amount,
        reservedMicroUsdc: reserved.amount,
        correlationId,
        policyVersion: Number(policy.version),
      };
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // The transaction may already have been closed by an earlier rollback.
      }
      return {
        kind: 'rejected',
        httpStatus: 503,
        body: {
          allowed: false,
          error: 'LEDGER_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Reservation failed.',
        },
      };
    }
  }

  private insertOperation(input: {
    id: string;
    agentId: string;
    idempotencyKey: string;
    fingerprint: string;
    vendor: string;
    method: string;
    path: string;
    estimated: bigint;
    reserved: bigint;
    state: TransactionLifecycleState;
    reservationId: string | null;
    correlationId: string;
    policyVersion: number | null;
    decision: 'ALLOWED' | 'BLOCKED';
    reason: string | null;
    responseStatus: number | null;
    result: Record<string, unknown> | null;
    settlementStatus: string;
    costBasis: CostBasis;
    now: number;
    ownerOrg: string;
    previousState: TransactionLifecycleState;
  }): void {
    assertTransition(input.previousState, input.state);
    this.db!.prepare(
      `INSERT INTO financial_operations (
        id, agent_id, idempotency_key, idempotency_ref, request_fingerprint, vendor, method, path,
        estimated_cost_micro_usdc, reserved_amount_micro_usdc, actual_cost_micro_usdc, cost_basis,
        state, reservation_id, correlation_id, policy_version, decision, reason, response_status,
        result_json, settlement_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.agentId,
      input.idempotencyKey,
      idempotencyReference(input.idempotencyKey),
      input.fingerprint,
      input.vendor,
      input.method,
      input.path,
      input.estimated.toString(),
      input.reserved.toString(),
      input.costBasis,
      input.state,
      input.reservationId,
      input.correlationId,
      input.policyVersion,
      input.decision,
      input.reason,
      input.responseStatus,
      input.result ? JSON.stringify(input.result).slice(0, 16_000) : null,
      input.settlementStatus,
      input.now,
      input.now
    );
    this.auditFinancial({
      agentId: input.agentId,
      idempotencyKey: input.idempotencyKey,
      fingerprint: input.fingerprint,
      vendor: input.vendor,
      state: input.state,
      previousState: input.previousState,
      estimated: input.estimated.toString(),
      reserved: input.reserved.toString(),
      actual: null,
      costBasis: input.costBasis,
      reservationId: input.reservationId,
      settlementStatus: input.settlementStatus,
      operationId: input.id,
      correlationId: input.correlationId,
      ownerOrg: input.ownerOrg,
      policyVersion: input.policyVersion,
      decision: input.decision,
      reason: input.reason ?? undefined,
      now: input.now,
    });
  }

  private auditFinancial(input: {
    agentId: string;
    idempotencyKey: string;
    fingerprint: string;
    vendor: string;
    state: TransactionLifecycleState;
    previousState: TransactionLifecycleState;
    estimated: string;
    reserved: string;
    actual: string | null;
    costBasis: CostBasis;
    reservationId: string | null;
    settlementStatus: string;
    operationId: string;
    correlationId: string;
    ownerOrg: string;
    policyVersion: number | null;
    decision: 'ALLOWED' | 'BLOCKED';
    reason?: string;
    now: number;
  }): void {
    this.recordAuditEventSync({
      eventId: crypto.randomUUID(),
      actor: `agent:${input.agentId}`,
      agentId: input.agentId,
      action: 'financial.transition',
      decision: input.decision,
      reason: input.reason,
      timestamp: input.now,
      correlationId: input.correlationId,
      detailsJson: JSON.stringify({
        operationId: input.operationId,
        organizationId: input.ownerOrg,
        idempotencyRef: idempotencyReference(input.idempotencyKey),
        requestFingerprint: input.fingerprint,
        vendor: input.vendor,
        lifecycleState: input.state,
        previousState: input.previousState,
        estimatedCostMicroUsdc: input.estimated,
        reservedAmountMicroUsdc: input.reserved,
        actualCostMicroUsdc: input.actual,
        costBasis: input.costBasis,
        reservationId: input.reservationId,
        settlementStatus: input.settlementStatus,
        policyVersion: input.policyVersion,
        fundsMoved: false,
      }),
    });
  }

  finishExecution(
    operationId: string,
    outcome:
      | { type: 'succeeded'; httpStatus: number; result: Record<string, unknown> }
      | { type: 'failed'; httpStatus: number; result: Record<string, unknown>; reason: string }
      | { type: 'unknown'; reason: string }
  ): { ok: boolean; httpStatus: number; body: Record<string, unknown> } {
    if (!this.db) {
      return { ok: false, httpStatus: 503, body: { error: 'LEDGER_UNAVAILABLE', fundsMoved: false } };
    }
    const current = this.db.prepare('SELECT * FROM financial_operations WHERE id = ?').get(operationId) as any;
    if (!current || current.state !== 'EXECUTION_IN_PROGRESS') {
      return {
        ok: false,
        httpStatus: 409,
        body: { error: 'RECONCILIATION_REQUIRED', operationId, fundsMoved: false },
      };
    }

    if (outcome.type === 'unknown') {
      this.moveOperation(current, 'EXECUTION_OUTCOME_UNKNOWN', {
        reason: outcome.reason,
        responseStatus: 504,
        result: {
          error: 'UPSTREAM_OUTCOME_UNKNOWN',
          message: outcome.reason,
          operationId,
          reconciliationRequired: true,
          fundsMoved: false,
        },
        settlementStatus: 'NOT_SUBMITTED',
        costBasis: 'UNAVAILABLE',
        decision: 'BLOCKED',
      });
      this.moveOperation(
        { ...current, state: 'EXECUTION_OUTCOME_UNKNOWN' },
        'RECONCILIATION_REQUIRED',
        {
          reason: outcome.reason,
          responseStatus: 504,
          result: {
            error: 'RECONCILIATION_REQUIRED',
            message: outcome.reason,
            operationId,
            reconciliationRequired: true,
            fundsMoved: false,
          },
          settlementStatus: 'NOT_SUBMITTED',
          costBasis: 'UNAVAILABLE',
          decision: 'BLOCKED',
        }
      );
      return {
        ok: false,
        httpStatus: 504,
        body: {
          error: 'RECONCILIATION_REQUIRED',
          message: outcome.reason,
          operationId,
          reconciliationRequired: true,
          fundsMoved: false,
        },
      };
    }

    if (outcome.type === 'failed') {
      const released = this.rollbackReservation(current.reservation_id, outcome.reason);
      if (!released) {
        this.moveOperation(current, 'EXECUTION_OUTCOME_UNKNOWN', {
          reason: 'ROLLBACK_FAILED',
          responseStatus: 500,
          result: { error: 'RECONCILIATION_REQUIRED', operationId, fundsMoved: false },
          settlementStatus: 'NOT_SUBMITTED',
          costBasis: 'UNAVAILABLE',
          decision: 'BLOCKED',
        });
        this.moveOperation({ ...current, state: 'EXECUTION_OUTCOME_UNKNOWN' }, 'RECONCILIATION_REQUIRED', {
          reason: 'ROLLBACK_FAILED',
          responseStatus: 500,
          result: { error: 'RECONCILIATION_REQUIRED', operationId, fundsMoved: false },
          settlementStatus: 'NOT_SUBMITTED',
          costBasis: 'UNAVAILABLE',
          decision: 'BLOCKED',
        });
        return { ok: false, httpStatus: 500, body: { error: 'RECONCILIATION_REQUIRED', operationId, fundsMoved: false } };
      }
      const body = { ...outcome.result, operationId, fundsMoved: false, costBasis: 'UNAVAILABLE' };
      this.moveOperation(current, 'VENDOR_FAILED', {
        reason: outcome.reason,
        responseStatus: outcome.httpStatus,
        result: body,
        settlementStatus: 'NOT_SUBMITTED',
        costBasis: 'UNAVAILABLE',
        decision: 'BLOCKED',
      });
      return { ok: true, httpStatus: outcome.httpStatus, body };
    }

    const reserved = parseStoredMicroUsdc(String(current.reserved_amount_micro_usdc));
    const committed = this.commitReservation(current.reservation_id, reserved);
    if (!committed) {
      this.moveOperation(current, 'VENDOR_SUCCEEDED', {
        reason: 'ACCOUNTING_COMMIT_FAILED',
        responseStatus: 500,
        result: { success: false, error: 'ACCOUNTING_FAILED', operationId, fundsMoved: false },
        settlementStatus: 'NOT_SUBMITTED',
        costBasis: 'ESTIMATED',
        decision: 'BLOCKED',
      });
      this.moveOperation({ ...current, state: 'VENDOR_SUCCEEDED' }, 'RECONCILIATION_REQUIRED', {
        reason: 'ACCOUNTING_COMMIT_FAILED',
        responseStatus: 500,
        result: { success: false, error: 'ACCOUNTING_FAILED', operationId, fundsMoved: false, reconciliationRequired: true },
        settlementStatus: 'NOT_SUBMITTED',
        costBasis: 'ESTIMATED',
        decision: 'BLOCKED',
      });
      return {
        ok: false,
        httpStatus: 500,
        body: { success: false, error: 'ACCOUNTING_FAILED', operationId, fundsMoved: false, reconciliationRequired: true },
      };
    }

    const body: Record<string, unknown> = {
      ...outcome.result,
      success: true,
      operationId,
      fundsMoved: false,
      costBasis: 'ESTIMATED',
    };
    this.moveOperation(current, 'VENDOR_SUCCEEDED', {
      reason: null,
      responseStatus: outcome.httpStatus,
      result: body,
      settlementStatus: 'NOT_SUBMITTED',
      costBasis: 'ESTIMATED',
      decision: 'ALLOWED',
    });
    this.moveOperation({ ...current, state: 'VENDOR_SUCCEEDED' }, 'ACCOUNTING_COMMITTED', {
      reason: null,
      responseStatus: outcome.httpStatus,
      result: body,
      settlementStatus: 'NOT_SUBMITTED',
      costBasis: 'ESTIMATED',
      decision: 'ALLOWED',
    });
    return { ok: true, httpStatus: outcome.httpStatus, body };
  }

  private moveOperation(
    current: any,
    next: TransactionLifecycleState,
    patch: {
      reason: string | null;
      responseStatus: number;
      result: Record<string, unknown>;
      settlementStatus: string;
      costBasis: CostBasis;
      decision: 'ALLOWED' | 'BLOCKED';
    }
  ): void {
    assertTransition(current.state as TransactionLifecycleState, next);
    const now = Date.now();
    this.db!.exec('BEGIN IMMEDIATE;');
    try {
      const fresh = this.db!.prepare('SELECT state FROM financial_operations WHERE id = ?').get(current.id) as
        | { state: TransactionLifecycleState }
        | undefined;
      if (!fresh || fresh.state !== current.state) {
        this.db!.exec('ROLLBACK;');
        throw new Error(`Operation ${current.id} changed before ${current.state} -> ${next}`);
      }
      this.db!.prepare(
        `UPDATE financial_operations
         SET state = ?, reason = ?, response_status = ?, result_json = ?, settlement_status = ?,
             cost_basis = ?, decision = ?, updated_at = ?
         WHERE id = ? AND state = ?`
      ).run(
        next,
        patch.reason,
        patch.responseStatus,
        JSON.stringify(patch.result).slice(0, 16_000),
        patch.settlementStatus,
        patch.costBasis,
        patch.decision,
        now,
        current.id,
        current.state
      );
      const owner = this.db!.prepare('SELECT owner_org FROM agents WHERE id = ?').get(current.agent_id) as
        | { owner_org: string }
        | undefined;
      this.auditFinancial({
        agentId: current.agent_id,
        idempotencyKey: current.idempotency_key,
        fingerprint: current.request_fingerprint,
        vendor: current.vendor,
        state: next,
        previousState: current.state,
        estimated: String(current.estimated_cost_micro_usdc),
        reserved: String(current.reserved_amount_micro_usdc),
        actual: null,
        costBasis: patch.costBasis,
        reservationId: current.reservation_id,
        settlementStatus: patch.settlementStatus,
        operationId: current.id,
        correlationId: current.correlation_id,
        ownerOrg: owner?.owner_org ?? '',
        policyVersion: current.policy_version,
        decision: patch.decision,
        reason: patch.reason ?? undefined,
        now,
      });
      this.db!.exec('COMMIT;');
    } catch (error) {
      try {
        this.db!.exec('ROLLBACK;');
      } catch {
        // already closed
      }
      throw error;
    }
  }

  recoverInFlightOperations(now = Date.now()): number {
    if (!this.db) return 0;
    const rows = this.db
      .prepare(
        `SELECT * FROM financial_operations WHERE state IN (${IN_FLIGHT_STATES.map(() => '?').join(', ')})`
      )
      .all(...IN_FLIGHT_STATES) as any[];
    let recovered = 0;
    for (const row of rows) {
      const reason = 'Recovered after process restart. Upstream outcome was not replayed.';
      if (row.state === 'BUDGET_RESERVED') {
        this.moveOperation(row, 'EXECUTION_IN_PROGRESS', {
          reason,
          responseStatus: 409,
          result: { error: 'RECONCILIATION_REQUIRED', operationId: row.id, fundsMoved: false },
          settlementStatus: 'NOT_SUBMITTED',
          costBasis: 'UNAVAILABLE',
          decision: 'BLOCKED',
        });
        row.state = 'EXECUTION_IN_PROGRESS';
      }
      if (row.state === 'EXECUTION_IN_PROGRESS') {
        this.moveOperation(row, 'EXECUTION_OUTCOME_UNKNOWN', {
          reason,
          responseStatus: 409,
          result: { error: 'RECONCILIATION_REQUIRED', operationId: row.id, fundsMoved: false, reconciliationRequired: true },
          settlementStatus: 'NOT_SUBMITTED',
          costBasis: 'UNAVAILABLE',
          decision: 'BLOCKED',
        });
        row.state = 'EXECUTION_OUTCOME_UNKNOWN';
      }
      if (row.state === 'EXECUTION_OUTCOME_UNKNOWN' || row.state === 'VENDOR_SUCCEEDED') {
        this.moveOperation(row, 'RECONCILIATION_REQUIRED', {
          reason,
          responseStatus: 409,
          result: {
            error: 'RECONCILIATION_REQUIRED',
            operationId: row.id,
            message: reason,
            fundsMoved: false,
            reconciliationRequired: true,
            recoveredAt: now,
          },
          settlementStatus: 'NOT_SUBMITTED',
          costBasis: 'UNAVAILABLE',
          decision: 'BLOCKED',
        });
        recovered += 1;
      }
    }
    return recovered;
  }

  listReconciliation(ownerOrg: string): Array<Record<string, unknown>> {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT o.*, a.owner_org FROM financial_operations o
         JOIN agents a ON a.id = o.agent_id
         WHERE a.owner_org = ? AND o.state = 'RECONCILIATION_REQUIRED'
         ORDER BY o.updated_at ASC`
      )
      .all(ownerOrg) as any[];
    return rows.map((row) => ({
      operationId: row.id,
      agentId: row.agent_id,
      organizationId: row.owner_org,
      idempotencyRef: row.idempotency_ref,
      requestFingerprint: row.request_fingerprint,
      vendor: row.vendor,
      state: row.state,
      reservationId: row.reservation_id,
      estimatedCostMicroUsdc: row.estimated_cost_micro_usdc,
      reservedAmountMicroUsdc: row.reserved_amount_micro_usdc,
      actualCostMicroUsdc: row.actual_cost_micro_usdc,
      costBasis: row.cost_basis,
      settlementStatus: row.settlement_status,
      reason: row.reason,
      correlationId: row.correlation_id,
      updatedAt: row.updated_at,
    }));
  }

  claimChainSettlement(input: {
    operationId: string;
    ownerOrg: string;
    destination: string;
    amountMicroUsdc: bigint;
    mint: string;
    cluster: string;
  }):
    | { ok: true; replay: boolean; settlement: Record<string, unknown> }
    | { ok: false; httpStatus: number; error: string; message: string } {
    if (!this.db) return { ok: false, httpStatus: 503, error: 'LEDGER_UNAVAILABLE', message: 'Persistent ledger is required.' };
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const operation = this.db
        .prepare(
          `SELECT o.*, a.owner_org FROM financial_operations o
           JOIN agents a ON a.id = o.agent_id WHERE o.id = ?`
        )
        .get(input.operationId) as any;
      if (!operation || operation.owner_org !== input.ownerOrg) {
        this.db.exec('ROLLBACK;');
        return { ok: false, httpStatus: 404, error: 'NOT_FOUND', message: 'Operation was not found.' };
      }
      const existing = this.db.prepare('SELECT * FROM chain_settlements WHERE operation_id = ?').get(input.operationId) as any;
      if (existing) {
        this.db.exec('COMMIT;');
        return { ok: true, replay: true, settlement: this.presentSettlement(existing) };
      }
      if (operation.state !== 'ACCOUNTING_COMMITTED') {
        this.db.exec('ROLLBACK;');
        return { ok: false, httpStatus: 409, error: 'NOT_SETTLEABLE', message: 'The operation is not an unpaid accounting commitment.' };
      }
      if (input.amountMicroUsdc.toString() !== operation.reserved_amount_micro_usdc) {
        this.db.exec('ROLLBACK;');
        return { ok: false, httpStatus: 409, error: 'AMOUNT_MISMATCH', message: 'Settlement amount must equal the reserved amount.' };
      }
      assertTransition(operation.state, 'SETTLEMENT_PREPARED');
      const now = Date.now();
      const id = `set_${crypto.randomUUID()}`;
      this.db.prepare(
        `INSERT INTO chain_settlements (
          id, operation_id, organization_id, destination, mint, amount_micro_usdc, cluster, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SETTLEMENT_PREPARED', ?, ?)`
      ).run(id, input.operationId, input.ownerOrg, input.destination, input.mint, input.amountMicroUsdc.toString(), input.cluster, now, now);
      this.db.prepare(
        `UPDATE financial_operations SET state = 'SETTLEMENT_PREPARED', settlement_status = 'PREPARED', updated_at = ? WHERE id = ? AND state = 'ACCOUNTING_COMMITTED'`
      ).run(now, input.operationId);
      this.db.exec('COMMIT;');
      const stored = this.db.prepare('SELECT * FROM chain_settlements WHERE id = ?').get(id) as any;
      return { ok: true, replay: false, settlement: this.presentSettlement(stored) };
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* already closed */ }
      const existing = this.db.prepare('SELECT * FROM chain_settlements WHERE operation_id = ?').get(input.operationId) as any;
      if (existing) return { ok: true, replay: true, settlement: this.presentSettlement(existing) };
      return { ok: false, httpStatus: 503, error: 'LEDGER_UNAVAILABLE', message: error instanceof Error ? error.message : 'Settlement claim failed.' };
    }
  }

  noteChainSettlement(
    operationId: string,
    patch: { status: TransactionLifecycleState; signature?: string; slot?: number; error?: string }
  ): { ok: true; settlement: Record<string, unknown> } | { ok: false; httpStatus: number; error: string; message: string } {
    if (!this.db) return { ok: false, httpStatus: 503, error: 'LEDGER_UNAVAILABLE', message: 'Persistent ledger is required.' };
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const operation = this.db.prepare('SELECT state FROM financial_operations WHERE id = ?').get(operationId) as { state: TransactionLifecycleState } | undefined;
      const current = this.db.prepare('SELECT * FROM chain_settlements WHERE operation_id = ?').get(operationId) as any;
      if (!operation || !current) {
        this.db.exec('ROLLBACK;');
        return { ok: false, httpStatus: 404, error: 'NOT_FOUND', message: 'Settlement was not found.' };
      }
      if (current.signature && patch.signature && current.signature !== patch.signature) {
        this.db.exec('ROLLBACK;');
        return { ok: false, httpStatus: 409, error: 'SIGNATURE_CONFLICT', message: 'A different signature is already stored for this settlement.' };
      }
      assertTransition(operation.state, patch.status);
      const now = Date.now();
      this.db.prepare(
        `UPDATE chain_settlements
         SET status = ?, signature = COALESCE(?, signature), slot = COALESCE(?, slot), error = ?, updated_at = ?
         WHERE operation_id = ?`
      ).run(patch.status, patch.signature ?? null, patch.slot ?? null, patch.error ?? null, now, operationId);
      this.db.prepare(
        `UPDATE financial_operations SET state = ?, settlement_status = ?, updated_at = ? WHERE id = ? AND state = ?`
      ).run(patch.status, patch.status, now, operationId, operation.state);
      this.db.exec('COMMIT;');
      const stored = this.db.prepare('SELECT * FROM chain_settlements WHERE operation_id = ?').get(operationId) as any;
      return { ok: true, settlement: this.presentSettlement(stored) };
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* already closed */ }
      return { ok: false, httpStatus: 409, error: 'ILLEGAL_SETTLEMENT_TRANSITION', message: error instanceof Error ? error.message : 'Settlement update rejected.' };
    }
  }

  listOrganizationOperations(ownerOrg: string): Array<Record<string, unknown>> {
    if (!this.db) return [];
    const rows = this.db
      .prepare(
        `SELECT o.id, o.agent_id, o.vendor, o.method, o.path, o.decision, o.estimated_cost_micro_usdc,
                o.reserved_amount_micro_usdc, o.actual_cost_micro_usdc, o.cost_basis, o.state,
                o.settlement_status, o.created_at, o.updated_at,
                c.signature, c.cluster, c.mint, c.destination, c.status AS chain_status
         FROM financial_operations o
         JOIN agents a ON a.id = o.agent_id
         LEFT JOIN chain_settlements c ON c.operation_id = o.id
         WHERE a.owner_org = ?
         ORDER BY o.created_at DESC`
      )
      .all(ownerOrg) as any[];
    return rows.map((row) => ({
      operationId: row.id,
      agentId: row.agent_id,
      vendor: row.vendor,
      method: row.method,
      path: row.path,
      decision: row.decision,
      estimatedCostMicroUsdc: row.estimated_cost_micro_usdc,
      reservedAmountMicroUsdc: row.reserved_amount_micro_usdc,
      actualCostMicroUsdc: row.actual_cost_micro_usdc,
      costBasis: row.cost_basis,
      state: row.state,
      settlementStatus: row.chain_status ?? row.settlement_status ?? 'NOT_SUBMITTED',
      signature: row.signature ?? null,
      cluster: row.cluster ?? null,
      mint: row.mint ?? null,
      destination: row.destination ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private presentSettlement(row: any): Record<string, unknown> {
    return {
      settlementId: row.id,
      operationId: row.operation_id,
      organizationId: row.organization_id,
      destination: row.destination,
      mint: row.mint,
      amountMicroUsdc: row.amount_micro_usdc,
      cluster: row.cluster,
      status: row.status,
      signature: row.signature,
      slot: row.slot,
      error: row.error,
      fundsMoved: row.status === 'SETTLEMENT_CONFIRMED' || row.status === 'SETTLEMENT_FINALIZED',
    };
  }
}
