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
  private db?: DatabaseSync;

  // In-memory fallback structures for runtimes without node:sqlite
  private isFallback = false;
  private memAgents = new Map<string, any>();
  private memPolicies = new Map<string, any>();
  private memReservations = new Map<string, any>();
  private memRateCalls: Array<{ agentId: string; timestamp: number }> = [];
  private memSettlements = new Map<string, any>();
  private memAuditEvents: AuditEventRecord[] = [];

  constructor(options: SqliteLedgerOptions = {}) {
    const target = options.dbPath ?? ':memory:';
    if (NodeDatabaseSync) {
      if (target !== ':memory:') {
        const dir = path.dirname(path.resolve(target));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new NodeDatabaseSync(target);
      this.initSchema();
    } else {
      this.isFallback = true;
    }
  }

  private initSchema(): void {
    if (!this.db) return;
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

    if (this.isFallback) {
      this.memAgents.set(policy.agentId, {
        id: policy.agentId,
        owner_org: ownerOrg,
        status: 'ACTIVE',
        api_key_hash: apiKeyHash,
        consecutive_errors: 0,
        period_start_timestamp: now,
        current_period_spend_micro_usdc: 0n,
        total_lifetime_spend_micro_usdc: 0n,
        created_at: now,
      });
      this.memPolicies.set(policy.agentId, {
        ...policy,
        version: 1,
      });
      return { apiKey: rawApiKey, apiKeyHash };
    }

    this.db!.exec('BEGIN IMMEDIATE;');
    try {
      const agentStmt = this.db!.prepare(`
        INSERT INTO agents (id, owner_org, status, api_key_hash, period_start_timestamp, created_at)
        VALUES (?, ?, 'ACTIVE', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner_org = excluded.owner_org,
          api_key_hash = excluded.api_key_hash
      `);
      agentStmt.run(policy.agentId, ownerOrg, apiKeyHash, now, now);

      const policyStmt = this.db!.prepare(`
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

      this.db!.exec('COMMIT;');
      return { apiKey: rawApiKey, apiKeyHash };
    } catch (err) {
      this.db!.exec('ROLLBACK;');
      throw err;
    }
  }

  // --- Authentication ---

  authenticateApiKey(bearerToken: string): { agentId: string; ownerOrg: string } | null {
    if (!bearerToken) return null;
    const cleanKey = bearerToken.replace(/^Bearer\s+/i, '').trim();
    const hash = crypto.createHash('sha256').update(cleanKey).digest('hex');

    if (this.isFallback) {
      for (const [id, a] of this.memAgents.entries()) {
        if (a.api_key_hash === hash) {
          return { agentId: id, ownerOrg: a.owner_org };
        }
      }
      return null;
    }

    const stmt = this.db!.prepare(
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
                allowed: true,
                authorizedAmountMicroUsdc: r.reserved_amount_micro_usdc,
                reservationId: id,
                idempotencyKey: request.idempotencyKey,
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
            this.db!.exec('COMMIT;');
            return {
              allowed: true,
              authorizedAmountMicroUsdc: BigInt(existingRes.reserved_amount_micro_usdc),
              reservationId: existingRes.id,
              idempotencyKey: request.idempotencyKey,
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

      let currentPeriodSpend = BigInt(agent.current_period_spend_micro_usdc);
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

      const activeResRow = this.db!
        .prepare(
          `SELECT COALESCE(SUM(CAST(reserved_amount_micro_usdc AS INTEGER)), 0) as total
           FROM reservations WHERE agent_id = ? AND status = 'PENDING'`
        )
        .get(request.agentId) as any;
      const activeReservations = BigInt(activeResRow?.total ?? 0);

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

      const reservedAmount = BigInt(res.reserved_amount_micro_usdc);
      const actualCost = actualCostMicroUsdc !== undefined ? actualCostMicroUsdc : reservedAmount;

      if (actualCost > reservedAmount) {
        this.db!.exec('ROLLBACK;');
        return false;
      }

      this.db!
        .prepare("UPDATE reservations SET status = 'COMMITTED' WHERE id = ?")
        .run(reservationId);

      this.db!
        .prepare(
          `UPDATE agents SET
             current_period_spend_micro_usdc = CAST((CAST(current_period_spend_micro_usdc AS INTEGER) + ?) AS TEXT),
             total_lifetime_spend_micro_usdc = CAST((CAST(total_lifetime_spend_micro_usdc AS INTEGER) + ?) AS TEXT),
             consecutive_errors = 0
           WHERE id = ?`
        )
        .run(actualCost.toString(), actualCost.toString(), res.agent_id);

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
      if (res.status === 'PENDING') {
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

      if (res.status === 'PENDING') {
        this.db!
          .prepare("UPDATE reservations SET status = 'ROLLED_BACK' WHERE id = ?")
          .run(reservationId);

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
      for (const r of this.memReservations.values()) {
        if (r.status === 'PENDING' && r.expires_at < now) {
          r.status = 'EXPIRED';
          count++;
        }
      }
      return count;
    }

    const stmt = this.db!.prepare(
      "UPDATE reservations SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?"
    );
    const result = stmt.run(now);
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

    const activeRes = this.db!
      .prepare(
        `SELECT COALESCE(SUM(CAST(reserved_amount_micro_usdc AS INTEGER)), 0) as total
         FROM reservations WHERE agent_id = ? AND status = 'PENDING'`
      )
      .get(agentId) as any;

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
      activePendingReservationsMicroUsdc: BigInt(activeRes?.total ?? 0),
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
}
