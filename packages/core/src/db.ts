import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { DatabaseSync: NodeDatabaseSync } = require('node:sqlite');
import {
  AgentFinancialState,
  AgentRecord,
  AuditEventRecord,
  BudgetReservation,
  PolicyDecision,
  PolicyRecord,
  RequestRecord,
  ReservationStatus,
  SettlementRecord,
  SpendingPolicy,
  TransactionLifecycleState,
} from './types.js';

export interface SqliteLedgerOptions {
  dbPath?: string; // ':memory:' or file path
}

export class SqliteLedger {
  private db: DatabaseSync;

  constructor(options: SqliteLedgerOptions = {}) {
    const target = options.dbPath ?? ':memory:';
    if (target !== ':memory:') {
      const dir = path.dirname(path.resolve(target));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new NodeDatabaseSync(target);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec('PRAGMA journal_mode = WAL;');
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
        created_at INTEGER NOT NULL
      );
    `);

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
  }

  // --- Agent & Policy Registration ---

  registerAgent(
    policy: SpendingPolicy,
    options: { ownerOrg?: string; rawApiKey?: string; apiKeyHash?: string } = {}
  ): { apiKey: string; apiKeyHash: string } {
    const rawApiKey = options.rawApiKey || `shlt_live_${crypto.randomBytes(16).toString('hex')}`;
    const apiKeyHash =
      options.apiKeyHash || crypto.createHash('sha256').update(rawApiKey).digest('hex');
    const ownerOrg = options.ownerOrg || 'org-autonomous-default';
    const now = Date.now();

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // Upsert agent
      const agentStmt = this.db.prepare(`
        INSERT INTO agents (id, owner_org, status, api_key_hash, period_start_timestamp, created_at)
        VALUES (?, ?, 'ACTIVE', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner_org = excluded.owner_org,
          api_key_hash = excluded.api_key_hash
      `);
      agentStmt.run(policy.agentId, ownerOrg, apiKeyHash, now, now);

      // Upsert policy
      const policyStmt = this.db.prepare(`
        INSERT INTO policies (
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
          version = policies.version + 1
      `);
      policyStmt.run(
        policy.agentId,
        JSON.stringify(policy.allowedVendors),
        policy.maxPerCallMicroUsdc.toString(),
        policy.periodBudgetMicroUsdc.toString(),
        policy.periodSeconds,
        policy.circuitBreaker.maxConsecutiveErrors,
        policy.circuitBreaker.maxCallsPerMinute
      );

      this.db.exec('COMMIT;');
      return { apiKey: rawApiKey, apiKeyHash };
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  // --- Authentication ---

  authenticateApiKey(bearerToken: string): { agentId: string; ownerOrg: string } | null {
    if (!bearerToken) return null;
    const cleanKey = bearerToken.replace(/^Bearer\s+/i, '').trim();
    const hash = crypto.createHash('sha256').update(cleanKey).digest('hex');

    const stmt = this.db.prepare(
      'SELECT id, owner_org, status FROM agents WHERE api_key_hash = ?'
    );
    const row = stmt.get(hash) as any;
    if (!row) return null;

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

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      // 1. Fetch Agent and Policy
      const agentStmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
      const agent = agentStmt.get(request.agentId) as any;
      if (!agent) {
        this.db.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'AGENT_NOT_FOUND',
          message: `Agent '${request.agentId}' is not registered with Shlita perimeter.`,
        };
      }

      // Check Freeze or Circuit Status
      if (agent.status === 'AGENT_FROZEN') {
        this.db.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'AGENT_FROZEN',
          message: `Agent '${request.agentId}' has been administratively frozen by operator. Reason: ${agent.freeze_reason || 'Manual freeze'}`,
        };
      }

      if (agent.status === 'CIRCUIT_TRIPPED') {
        this.db.exec('ROLLBACK;');
        return {
          allowed: false,
          reason: 'CIRCUIT_BREAKER_TRIPPED',
          message: `Circuit breaker tripped for agent '${request.agentId}'. Requires operator manual intervention.`,
        };
      }

      const policyStmt = this.db.prepare('SELECT * FROM policies WHERE agent_id = ?');
      const policyRow = policyStmt.get(request.agentId) as any;
      if (!policyRow) {
        this.db.exec('ROLLBACK;');
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

      // 2. Vendor Allowlist Check
      const normalizedVendor = request.vendor.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      const isVendorAllowed = allowedVendors.some((v) => {
        const cleanV = v.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        return normalizedVendor === cleanV || normalizedVendor.endsWith(`.${cleanV}`);
      });

      if (!isVendorAllowed) {
        this.db.exec('ROLLBACK;');
        this.recordAuditEventSync({
          eventId: `audit_${now}_${Math.random().toString(36).substring(2, 7)}`,
          actor: request.agentId,
          agentId: request.agentId,
          action: 'POLICY_EVALUATION',
          decision: 'BLOCKED',
          reason: 'UNAPPROVED_VENDOR',
          timestamp: now,
          correlationId: request.idempotencyKey || `corr_${now}`,
          detailsJson: JSON.stringify({ vendor: request.vendor, allowedVendors }),
        });
        return {
          allowed: false,
          reason: 'UNAPPROVED_VENDOR',
          message: `Vendor '${request.vendor}' (${normalizedVendor}) is not in agent whitelist [${allowedVendors.join(', ')}].`,
        };
      }

      // 3. Per-Call Limit Check
      if (request.estimatedCostMicroUsdc > maxPerCallMicroUsdc) {
        this.db.exec('ROLLBACK;');
        this.recordAuditEventSync({
          eventId: `audit_${now}_${Math.random().toString(36).substring(2, 7)}`,
          actor: request.agentId,
          agentId: request.agentId,
          action: 'POLICY_EVALUATION',
          decision: 'BLOCKED',
          reason: 'PER_CALL_LIMIT_EXCEEDED',
          timestamp: now,
          correlationId: request.idempotencyKey || `corr_${now}`,
          detailsJson: JSON.stringify({
            estimatedCost: request.estimatedCostMicroUsdc.toString(),
            maxPerCall: maxPerCallMicroUsdc.toString(),
          }),
        });
        return {
          allowed: false,
          reason: 'PER_CALL_LIMIT_EXCEEDED',
          message: `Estimated cost ${request.estimatedCostMicroUsdc} µUSDC exceeds single-call limit of ${maxPerCallMicroUsdc} µUSDC.`,
        };
      }

      // 4. Rate Anomaly / Burst Loop Detector (Call Frequency in last 60 seconds)
      const oneMinuteAgo = now - 60_000;
      this.db.prepare('DELETE FROM rate_calls WHERE agent_id = ? AND timestamp < ?').run(
        request.agentId,
        oneMinuteAgo
      );
      const callCountRow = this.db
        .prepare('SELECT COUNT(*) as count FROM rate_calls WHERE agent_id = ? AND timestamp >= ?')
        .get(request.agentId, oneMinuteAgo) as any;
      const recentCalls = (callCountRow?.count ?? 0) + 1;

      if (recentCalls > maxCallsPerMinute) {
        this.db
          .prepare(
            `UPDATE agents SET status = 'CIRCUIT_TRIPPED', freeze_reason = 'High-frequency burst loop detected' WHERE id = ?`
          )
          .run(request.agentId);
        this.db.exec('COMMIT;');
        return {
          allowed: false,
          reason: 'RATE_ANOMALY_LOOP_DETECTED',
          message: `Call burst detected (${recentCalls} calls in last 60s, max is ${maxCallsPerMinute}). Circuit breaker tripped.`,
        };
      }

      // 5. Check Idempotency Key
      if (request.idempotencyKey) {
        const existingRes = this.db
          .prepare('SELECT * FROM reservations WHERE agent_id = ? AND idempotency_key = ?')
          .get(request.agentId, request.idempotencyKey) as any;
        if (existingRes) {
          if (existingRes.status === 'PENDING') {
            this.db.exec('COMMIT;');
            return {
              allowed: true,
              authorizedAmountMicroUsdc: BigInt(existingRes.reserved_amount_micro_usdc),
              reservationId: existingRes.id,
              idempotencyKey: request.idempotencyKey,
            };
          }
          if (existingRes.status === 'COMMITTED') {
            this.db.exec('ROLLBACK;');
            return {
              allowed: false,
              reason: 'CONCURRENCY_RESERVATION_FAILED',
              message: `Idempotency key '${request.idempotencyKey}' was already committed. Duplicate spend prevented.`,
            };
          }
        }
      }

      // 6. Period Rollover Check
      let currentPeriodSpend = BigInt(agent.current_period_spend_micro_usdc);
      let periodStart = agent.period_start_timestamp;
      const periodDurationMs = periodSeconds * 1000;

      if (now - periodStart >= periodDurationMs) {
        // Roll over period
        currentPeriodSpend = 0n;
        periodStart = now;
        this.db
          .prepare(
            'UPDATE agents SET current_period_spend_micro_usdc = 0, period_start_timestamp = ? WHERE id = ?'
          )
          .run(now, request.agentId);
      }

      // 7. Active Pending Reservations Sum
      const activeResRow = this.db
        .prepare(
          `SELECT COALESCE(SUM(CAST(reserved_amount_micro_usdc AS INTEGER)), 0) as total
           FROM reservations WHERE agent_id = ? AND status = 'PENDING'`
        )
        .get(request.agentId) as any;
      const activeReservations = BigInt(activeResRow?.total ?? 0);

      // Invariant: committed spend + active reservations + new reservation <= period budget
      const totalCommittedAndReserved =
        currentPeriodSpend + activeReservations + request.estimatedCostMicroUsdc;

      if (totalCommittedAndReserved > periodBudgetMicroUsdc) {
        this.db.exec('ROLLBACK;');
        this.recordAuditEventSync({
          eventId: `audit_${now}_${Math.random().toString(36).substring(2, 7)}`,
          actor: request.agentId,
          agentId: request.agentId,
          action: 'POLICY_EVALUATION',
          decision: 'BLOCKED',
          reason: 'PERIOD_BUDGET_EXCEEDED',
          timestamp: now,
          correlationId: request.idempotencyKey || `corr_${now}`,
          detailsJson: JSON.stringify({
            currentSpend: currentPeriodSpend.toString(),
            activeReservations: activeReservations.toString(),
            requested: request.estimatedCostMicroUsdc.toString(),
            periodBudget: periodBudgetMicroUsdc.toString(),
          }),
        });
        return {
          allowed: false,
          reason: 'PERIOD_BUDGET_EXCEEDED',
          message: `Request for ${request.estimatedCostMicroUsdc} µUSDC would exceed period budget (Current: ${currentPeriodSpend} µUSDC, Active Reserves: ${activeReservations} µUSDC, Cap: ${periodBudgetMicroUsdc} µUSDC).`,
        };
      }

      // 8. Create Reservation & Record Rate Call
      const reservationId = `res_${now}_${Math.random().toString(36).substring(2, 8)}`;
      const expiresAt = now + 45_000; // 45s TTL

      this.db
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

      this.db
        .prepare('INSERT INTO rate_calls (agent_id, timestamp) VALUES (?, ?)')
        .run(request.agentId, now);

      this.db.exec('COMMIT;');

      this.recordAuditEventSync({
        eventId: `audit_${now}_${Math.random().toString(36).substring(2, 7)}`,
        actor: request.agentId,
        agentId: request.agentId,
        action: 'BUDGET_RESERVED',
        decision: 'ALLOWED',
        timestamp: now,
        correlationId: request.idempotencyKey || `corr_${now}`,
        detailsJson: JSON.stringify({
          reservationId,
          reservedAmountMicroUsdc: request.estimatedCostMicroUsdc.toString(),
          expiresAt,
        }),
      });

      return {
        allowed: true,
        authorizedAmountMicroUsdc: request.estimatedCostMicroUsdc,
        reservationId,
        idempotencyKey: request.idempotencyKey,
      };
    } catch (err: any) {
      this.db.exec('ROLLBACK;');
      return {
        allowed: false,
        reason: 'CONCURRENCY_RESERVATION_FAILED',
        message: `Database reservation failed: ${err?.message || 'Transaction error'}`,
      };
    }
  }

  // --- Commit Reservation (Two-Phase Commit Success) ---

  commitReservation(
    reservationId: string,
    actualCostMicroUsdc?: bigint
  ): boolean {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const resStmt = this.db.prepare('SELECT * FROM reservations WHERE id = ?');
      const res = resStmt.get(reservationId) as any;
      if (!res) {
        this.db.exec('ROLLBACK;');
        return false;
      }

      if (res.status !== 'PENDING') {
        this.db.exec('ROLLBACK;');
        return false;
      }

      const reservedAmount = BigInt(res.reserved_amount_micro_usdc);
      const actualCost = actualCostMicroUsdc !== undefined ? actualCostMicroUsdc : reservedAmount;

      // Actual cost must not exceed the reservation quote
      if (actualCost > reservedAmount) {
        this.db.exec('ROLLBACK;');
        return false;
      }

      // Mark reservation committed
      this.db
        .prepare("UPDATE reservations SET status = 'COMMITTED' WHERE id = ?")
        .run(reservationId);

      // Increment agent period and lifetime spend
      this.db
        .prepare(
          `UPDATE agents SET
             current_period_spend_micro_usdc = CAST((CAST(current_period_spend_micro_usdc AS INTEGER) + ?) AS TEXT),
             total_lifetime_spend_micro_usdc = CAST((CAST(total_lifetime_spend_micro_usdc AS INTEGER) + ?) AS TEXT),
             consecutive_errors = 0
           WHERE id = ?`
        )
        .run(actualCost.toString(), actualCost.toString(), res.agent_id);

      this.db.exec('COMMIT;');
      return true;
    } catch {
      this.db.exec('ROLLBACK;');
      return false;
    }
  }

  // --- Rollback Reservation (On Upstream Error or Timeout) ---

  rollbackReservation(
    reservationId: string,
    reason?: string
  ): boolean {
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const resStmt = this.db.prepare('SELECT * FROM reservations WHERE id = ?');
      const res = resStmt.get(reservationId) as any;
      if (!res) {
        this.db.exec('ROLLBACK;');
        return false;
      }

      if (res.status === 'PENDING') {
        this.db
          .prepare("UPDATE reservations SET status = 'ROLLED_BACK' WHERE id = ?")
          .run(reservationId);

        // Record error and check circuit breaker
        const agentStmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
        const agent = agentStmt.get(res.agent_id) as any;
        const policyStmt = this.db.prepare('SELECT * FROM policies WHERE agent_id = ?');
        const policy = policyStmt.get(res.agent_id) as any;

        if (agent && policy) {
          const nextErrors = (agent.consecutive_errors || 0) + 1;
          const maxErrors = policy.max_consecutive_errors || 3;
          if (nextErrors >= maxErrors) {
            this.db
              .prepare(
                `UPDATE agents SET consecutive_errors = ?, status = 'CIRCUIT_TRIPPED', freeze_reason = ? WHERE id = ?`
              )
              .run(nextErrors, `Consecutive upstream errors (${nextErrors}) exceeded threshold`, res.agent_id);
          } else {
            this.db
              .prepare('UPDATE agents SET consecutive_errors = ? WHERE id = ?')
              .run(nextErrors, res.agent_id);
          }
        }
      }

      this.db.exec('COMMIT;');
      return true;
    } catch {
      this.db.exec('ROLLBACK;');
      return false;
    }
  }

  recordExecutionFailure(agentId: string, error?: string): void {
    const agentStmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
    const agent = agentStmt.get(agentId) as any;
    const policyStmt = this.db.prepare('SELECT * FROM policies WHERE agent_id = ?');
    const policy = policyStmt.get(agentId) as any;

    if (agent && policy) {
      const nextErrors = (agent.consecutive_errors || 0) + 1;
      const maxErrors = policy.max_consecutive_errors || 3;
      if (nextErrors >= maxErrors) {
        this.db
          .prepare(
            `UPDATE agents SET consecutive_errors = ?, status = 'CIRCUIT_TRIPPED', freeze_reason = ? WHERE id = ?`
          )
          .run(nextErrors, `Consecutive upstream errors (${nextErrors}) exceeded threshold`, agentId);
      } else {
        this.db
          .prepare('UPDATE agents SET consecutive_errors = ? WHERE id = ?')
          .run(nextErrors, agentId);
      }
    }
  }

  // --- Prune Expired Reservations ---

  pruneExpiredReservations(now = Date.now()): number {
    const stmt = this.db.prepare(
      "UPDATE reservations SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?"
    );
    const result = stmt.run(now);
    return Number(result.changes);
  }

  // --- Reset Circuit Breaker ---

  resetCircuitBreaker(agentId: string): boolean {
    const stmt = this.db.prepare(
      `UPDATE agents SET status = 'ACTIVE', consecutive_errors = 0, freeze_reason = NULL WHERE id = ?`
    );
    const result = stmt.run(agentId);
    return Number(result.changes) > 0;
  }

  // --- Freeze / Unfreeze Agent ---

  setAgentFreeze(agentId: string, freeze: boolean, reason?: string): boolean {
    const status = freeze ? 'AGENT_FROZEN' : 'ACTIVE';
    const stmt = this.db.prepare(
      `UPDATE agents SET status = ?, freeze_reason = ? WHERE id = ?`
    );
    const result = stmt.run(status, freeze ? reason || 'Manual operator freeze' : null, agentId);
    return Number(result.changes) > 0;
  }

  // --- Settlement Ledger ---

  recordSettlement(record: SettlementRecord): void {
    const stmt = this.db.prepare(`
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
    const row = this.db.prepare('SELECT * FROM settlements WHERE id = ?').get(id) as any;
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
    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) return null;

    const activeRes = this.db
      .prepare(
        `SELECT COALESCE(SUM(CAST(reserved_amount_micro_usdc AS INTEGER)), 0) as total
         FROM reservations WHERE agent_id = ? AND status = 'PENDING'`
      )
      .get(agentId) as any;

    const rateCalls = this.db
      .prepare(
        'SELECT timestamp FROM rate_calls WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 20'
      )
      .all(agentId) as any[];

    return {
      agentId: agent.id,
      status: agent.status,
      currentPeriodSpendMicroUsdc: BigInt(agent.current_period_spend_micro_usdc),
      totalLifetimeSpendMicroUsdc: BigInt(agent.total_lifetime_spend_micro_usdc),
      activePendingReservationsMicroUsdc: BigInt(activeRes?.total ?? 0),
      periodStartTimestamp: agent.period_start_timestamp,
      consecutiveErrors: agent.consecutive_errors,
      recentCallTimestamps: rateCalls.map((r) => r.timestamp),
      freezeReason: agent.freeze_reason,
    };
  }

  getAllPolicies(): SpendingPolicy[] {
    const rows = this.db.prepare('SELECT * FROM policies').all() as any[];
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
    const stmt = this.db.prepare(`
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
    const rows = this.db
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
    this.db.close();
  }
}
