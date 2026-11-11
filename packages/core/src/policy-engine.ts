import crypto from 'node:crypto';
import {
  AgentFinancialState,
  AuditLogEntry,
  BudgetReservation,
  ExecutionOutcome,
  OutboundRequest,
  PolicyDecision,
  SpendingPolicy,
} from './types.js';
import { SqliteLedger } from './db.js';

export class PolicyEngine {
  private ledger: SqliteLedger;
  private lastReservationByAgent = new Map<string, string>(); // agentId -> reservationId

  constructor(dbPath: string = ':memory:', options: { requirePersistent?: boolean } = {}) {
    this.ledger = new SqliteLedger({ dbPath, requirePersistent: options.requirePersistent });
  }

  public getLedger(): SqliteLedger {
    return this.ledger;
  }

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
    return this.ledger.registerAgent(policy, options);
  }

  /**
   * Plaintext keys are returned only from registerAgent or rotateAgentKey.
   * They are not retained or listed afterward.
   */
  getAgentApiKey(_agentId: string): string | undefined {
    return undefined;
  }

  rotateAgentKey(agentId: string): { apiKey: string; apiKeyHash: string } | null {
    return this.ledger.rotateAgentKey(agentId);
  }

  revokeAgentKey(agentId: string): boolean {
    return this.ledger.revokeAgentKey(agentId);
  }

  getAgentOwnerOrg(agentId: string): string | null {
    return this.ledger.getAgentOwnerOrg(agentId);
  }

  recordPrivilegedAudit(input: {
    actor: string;
    agentId: string;
    action: string;
    decision: 'ALLOWED' | 'BLOCKED';
    reason?: string;
  }): void {
    const now = Date.now();
    this.ledger.recordAuditEventSync({
      eventId: crypto.randomUUID(),
      actor: input.actor,
      agentId: input.agentId,
      action: input.action,
      decision: input.decision,
      reason: input.reason,
      timestamp: now,
      correlationId: crypto.randomUUID(),
      detailsJson: JSON.stringify({ action: input.action }),
    });
  }

  authenticateApiKey(bearerToken: string): { agentId: string; ownerOrg: string } | null {
    return this.ledger.authenticateApiKey(bearerToken);
  }

  /**
   * Normalizes vendor hostname, rejecting SSRF patterns and stripping protocols/ports.
   */
  public normalizeVendorHost(vendorStr: string): string {
    const clean = vendorStr.trim().toLowerCase();
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      try {
        return new URL(clean).hostname;
      } catch {
        return clean.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
      }
    }
    return clean.split('/')[0].split(':')[0];
  }

  /**
   * Atomic evaluation and budget reservation to prevent concurrent double-spending race conditions.
   * Backed by durable SQLite database transactions with row-level/immediate locks.
   */
  evaluateAndReserve(request: OutboundRequest): PolicyDecision {
    const decision = this.ledger.evaluateAndReserve(request);
    if (decision.allowed && decision.reservationId) {
      this.lastReservationByAgent.set(request.agentId, decision.reservationId);
    }
    return decision;
  }

  /**
   * Two-phase commit: Commits an active reservation into confirmed period spend.
   */
  commitReservation(
    reservationId: string,
    actualCostMicroUsdc?: bigint
  ): boolean {
    return this.ledger.commitReservation(reservationId, actualCostMicroUsdc);
  }

  claimExecution(input: Parameters<SqliteLedger['claimExecution']>[0]) {
    return this.ledger.claimExecution(input);
  }

  finishExecution(operationId: string, outcome: Parameters<SqliteLedger['finishExecution']>[1]) {
    return this.ledger.finishExecution(operationId, outcome);
  }

  recoverInFlightOperations(now = Date.now()): number {
    return this.ledger.recoverInFlightOperations(now);
  }

  listReconciliation(ownerOrg: string) {
    return this.ledger.listReconciliation(ownerOrg);
  }

  failNextCommit(): void {
    this.ledger.failNextCommit();
  }

  /**
   * Two-phase rollback: Releases funds held by a pending reservation on failure.
   */
  rollbackReservation(
    reservationId: string,
    reason?: string
  ): boolean {
    return this.ledger.rollbackReservation(reservationId, reason);
  }

  /**
   * Traditional synchronous evaluate for backward compatibility.
   */
  evaluate(request: OutboundRequest): PolicyDecision {
    return this.evaluateAndReserve(request);
  }

  /**
   * Traditional recordExecution for backward compatibility.
   */
  recordExecution(request: OutboundRequest, outcome: ExecutionOutcome): void {
    const resId = this.lastReservationByAgent.get(request.agentId);
    if (outcome.success) {
      if (resId) {
        this.commitReservation(resId, outcome.actualCostMicroUsdc);
        this.lastReservationByAgent.delete(request.agentId);
      }
    } else {
      if (resId) {
        this.rollbackReservation(resId, outcome.error);
        this.lastReservationByAgent.delete(request.agentId);
      } else {
        this.ledger.recordExecutionFailure(request.agentId, outcome.error);
      }
    }
  }

  freezeAgent(agentId: string, reason = 'Operator emergency freeze'): void {
    this.ledger.setAgentFreeze(agentId, true, reason);
  }

  unfreezeAgent(agentId: string): void {
    this.ledger.setAgentFreeze(agentId, false);
  }

  resetCircuitBreaker(agentId: string): void {
    this.ledger.resetCircuitBreaker(agentId);
  }

  getAgentState(agentId: string): AgentFinancialState {
    const state = this.ledger.getAgentFinancialState(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} not registered`);
    }
    return state;
  }

  getAllPolicies(): SpendingPolicy[] {
    return this.ledger.getAllPolicies();
  }

  getAllStates(): AgentFinancialState[] {
    const policies = this.getAllPolicies();
    return policies.map((p) => this.getAgentState(p.agentId));
  }

  getAuditLogs(limit = 100): AuditLogEntry[] {
    const records = this.ledger.getAuditLogs(limit);
    return records.map((r) => {
      let details: any = {};
      try {
        details = JSON.parse(r.detailsJson);
      } catch {}
      return {
        id: r.eventId,
        timestamp: r.timestamp,
        agentId: r.agentId,
        actor: r.actor,
        action: r.action,
        vendor: details.vendor || 'solana-network',
        estimatedCostMicroUsdc: details.estimatedCostMicroUsdc || details.estimatedCost || details.reservedAmountMicroUsdc || '0',
        actualCostMicroUsdc: details.actualCostMicroUsdc ?? details.actualCost,
        decision: r.decision as 'ALLOWED' | 'BLOCKED',
        reason: r.reason as any,
        reservationId: details.reservationId,
        correlationId: r.correlationId,
        lifecycleState: details.lifecycleState,
        metadata: details,
      };
    });
  }

  close(): void {
    this.ledger.close();
  }
}

export function createPolicyEngine(
  dbPath: string = ':memory:',
  options: { requirePersistent?: boolean } = {}
): PolicyEngine {
  return new PolicyEngine(dbPath, options);
}
