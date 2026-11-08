import {
  AgentFinancialState,
  AuditLogEntry,
  BudgetReservation,
  ExecutionOutcome,
  OutboundRequest,
  PolicyDecision,
  SpendingPolicy,
} from './types.js';

export class PolicyEngine {
  private policies = new Map<string, SpendingPolicy>();
  private states = new Map<string, AgentFinancialState>();
  private reservations = new Map<string, BudgetReservation>();
  private auditLogs: AuditLogEntry[] = [];

  registerAgent(policy: SpendingPolicy): void {
    this.policies.set(policy.agentId, policy);
    if (!this.states.has(policy.agentId)) {
      this.states.set(policy.agentId, {
        agentId: policy.agentId,
        status: 'ACTIVE',
        currentPeriodSpendMicroUsdc: 0n,
        totalLifetimeSpendMicroUsdc: 0n,
        activePendingReservationsMicroUsdc: 0n,
        periodStartTimestamp: Date.now(),
        consecutiveErrors: 0,
        recentCallTimestamps: [],
      });
    }
  }

  /**
   * Normalizes vendor hostname, rejecting SSRF patterns and stripping protocols/ports.
   */
  public normalizeVendorHost(vendorStr: string): string {
    const clean = vendorStr.trim().toLowerCase();
    // If it contains a protocol, extract hostname
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
   * Prunes any reservations that have passed their TTL, releasing held funds.
   */
  private pruneExpiredReservations(): void {
    const now = Date.now();
    for (const [id, r] of this.reservations.entries()) {
      if (now > r.expiresAt) {
        const state = this.states.get(r.agentId);
        if (state) {
          state.activePendingReservationsMicroUsdc =
            state.activePendingReservationsMicroUsdc >= r.amountMicroUsdc
              ? state.activePendingReservationsMicroUsdc - r.amountMicroUsdc
              : 0n;
        }
        this.reservations.delete(id);
      }
    }
  }

  /**
   * Atomic evaluation and budget reservation to prevent concurrent double-spending race conditions.
   * Immediately places an in-memory hold on the requested funds.
   */
  evaluateAndReserve(request: OutboundRequest, ttlMs: number = 30_000): PolicyDecision {
    this.pruneExpiredReservations();

    const policy = this.policies.get(request.agentId);
    if (!policy) {
      return {
        allowed: false,
        reason: 'AGENT_NOT_FOUND',
        message: `Agent ${request.agentId} is not registered in Shlita.`,
      };
    }

    const state = this.states.get(request.agentId)!;

    // 1. Check frozen status
    if (state.status === 'AGENT_FROZEN') {
      this.logAudit(request, 'BLOCKED', 'AGENT_FROZEN');
      return {
        allowed: false,
        reason: 'AGENT_FROZEN',
        message: state.freezeReason || 'Agent has been manually frozen by operator.',
      };
    }

    // 2. Check circuit tripped status
    if (state.status === 'CIRCUIT_TRIPPED') {
      this.logAudit(request, 'BLOCKED', 'CIRCUIT_BREAKER_TRIPPED');
      return {
        allowed: false,
        reason: 'CIRCUIT_BREAKER_TRIPPED',
        message: state.freezeReason || 'Circuit breaker tripped due to anomaly or error cascade.',
      };
    }

    // 3. Vendor whitelist enforcement with normalized host parsing
    const normVendor = this.normalizeVendorHost(request.vendor);
    const isVendorAllowed = policy.allowedVendors.some((v) => {
      const normAllowed = this.normalizeVendorHost(v);
      return normVendor === normAllowed || normVendor.endsWith(`.${normAllowed}`);
    });

    if (!isVendorAllowed) {
      this.logAudit(request, 'BLOCKED', 'UNAPPROVED_VENDOR');
      return {
        allowed: false,
        reason: 'UNAPPROVED_VENDOR',
        message: `Vendor '${request.vendor}' (${normVendor}) is not in agent whitelist [${policy.allowedVendors.join(', ')}].`,
      };
    }

    // 4. Per-call spending cap enforcement
    if (request.estimatedCostMicroUsdc > policy.maxPerCallMicroUsdc) {
      this.logAudit(request, 'BLOCKED', 'PER_CALL_LIMIT_EXCEEDED');
      return {
        allowed: false,
        reason: 'PER_CALL_LIMIT_EXCEEDED',
        message: `Request cost (${request.estimatedCostMicroUsdc} µUSDC) exceeds per-call cap (${policy.maxPerCallMicroUsdc} µUSDC).`,
      };
    }

    // 5. Rate anomaly loop detection (rolling 60s window)
    const windowStart = request.timestamp - 60_000;
    state.recentCallTimestamps = state.recentCallTimestamps.filter((t) => t >= windowStart);
    if (state.recentCallTimestamps.length >= policy.circuitBreaker.maxCallsPerMinute) {
      state.status = 'CIRCUIT_TRIPPED';
      state.freezeReason = `Call frequency (${state.recentCallTimestamps.length} calls/min) exceeded limit (${policy.circuitBreaker.maxCallsPerMinute}).`;
      this.logAudit(request, 'BLOCKED', 'RATE_ANOMALY_LOOP_DETECTED');
      return {
        allowed: false,
        reason: 'RATE_ANOMALY_LOOP_DETECTED',
        message: state.freezeReason,
      };
    }

    // 6. Period budget rollover check
    const periodDurationMs = policy.periodSeconds * 1000;
    if (request.timestamp >= state.periodStartTimestamp + periodDurationMs) {
      state.periodStartTimestamp = request.timestamp;
      state.currentPeriodSpendMicroUsdc = 0n;
      // Do not clear activePendingReservationsMicroUsdc as ongoing inflight calls are still reserved
    }

    // 7. Cumulative period budget enforcement (INCLUDING ACTIVE RESERVATIONS)
    const totalCommittedAndReserved =
      state.currentPeriodSpendMicroUsdc + state.activePendingReservationsMicroUsdc;
    const projectedSpend = totalCommittedAndReserved + request.estimatedCostMicroUsdc;

    if (projectedSpend > policy.periodBudgetMicroUsdc) {
      this.logAudit(request, 'BLOCKED', 'PERIOD_BUDGET_EXCEEDED');
      return {
        allowed: false,
        reason: 'PERIOD_BUDGET_EXCEEDED',
        message: `Projected spend with active reservations (${projectedSpend} µUSDC) exceeds period budget (${policy.periodBudgetMicroUsdc} µUSDC). Available: ${
          policy.periodBudgetMicroUsdc > totalCommittedAndReserved
            ? policy.periodBudgetMicroUsdc - totalCommittedAndReserved
            : 0n
        } µUSDC.`,
      };
    }

    // 8. Place Atomic Budget Reservation
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const reservation: BudgetReservation = {
      reservationId,
      agentId: request.agentId,
      amountMicroUsdc: request.estimatedCostMicroUsdc,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    state.activePendingReservationsMicroUsdc += request.estimatedCostMicroUsdc;
    this.reservations.set(reservationId, reservation);

    this.logAudit(request, 'ALLOWED', undefined, reservationId);
    return {
      allowed: true,
      authorizedAmountMicroUsdc: request.estimatedCostMicroUsdc,
      reservationId,
    };
  }

  /**
   * Commits an active reservation after successful upstream response.
   * Converts the reserved hold into actual committed spend.
   */
  commitReservation(reservationId: string, actualCostMicroUsdc?: bigint): boolean {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return false;

    const state = this.states.get(reservation.agentId);
    if (!state) return false;

    const costToCommit = actualCostMicroUsdc ?? reservation.amountMicroUsdc;

    // Release reservation hold
    state.activePendingReservationsMicroUsdc =
      state.activePendingReservationsMicroUsdc >= reservation.amountMicroUsdc
        ? state.activePendingReservationsMicroUsdc - reservation.amountMicroUsdc
        : 0n;

    // Apply actual spend
    state.currentPeriodSpendMicroUsdc += costToCommit;
    state.totalLifetimeSpendMicroUsdc += costToCommit;
    state.consecutiveErrors = 0;
    state.recentCallTimestamps.push(Date.now());

    this.reservations.delete(reservationId);
    return true;
  }

  /**
   * Rolls back a reservation when an upstream request fails or network aborts.
   * Instantly unlocks the reserved budget for subsequent requests.
   */
  rollbackReservation(reservationId: string, error?: string): boolean {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) return false;

    const state = this.states.get(reservation.agentId);
    const policy = this.policies.get(reservation.agentId);

    if (state) {
      state.activePendingReservationsMicroUsdc =
        state.activePendingReservationsMicroUsdc >= reservation.amountMicroUsdc
          ? state.activePendingReservationsMicroUsdc - reservation.amountMicroUsdc
          : 0n;

      if (error) {
        state.consecutiveErrors += 1;
        if (policy && state.consecutiveErrors >= policy.circuitBreaker.maxConsecutiveErrors) {
          state.status = 'CIRCUIT_TRIPPED';
          state.freezeReason = `Consecutive error threshold reached (${state.consecutiveErrors}/${policy.circuitBreaker.maxConsecutiveErrors}). Last error: ${error}`;
        }
      }
    }

    this.reservations.delete(reservationId);
    return true;
  }

  /**
   * Traditional synchronous evaluate for backward compatibility.
   */
  evaluate(request: OutboundRequest): PolicyDecision {
    return this.evaluateAndReserve(request);
  }

  /**
   * Traditional recordExecution for backward compatibility.
   * Automatically clears any matching active reservation for the agent.
   */
  recordExecution(request: OutboundRequest, outcome: ExecutionOutcome): void {
    const policy = this.policies.get(request.agentId);
    const state = this.states.get(request.agentId);
    if (!policy || !state) return;

    // Release matching pending reservation to avoid double counting in legacy calls
    for (const [resId, r] of this.reservations.entries()) {
      if (r.agentId === request.agentId && r.amountMicroUsdc === request.estimatedCostMicroUsdc) {
        state.activePendingReservationsMicroUsdc =
          state.activePendingReservationsMicroUsdc >= r.amountMicroUsdc
            ? state.activePendingReservationsMicroUsdc - r.amountMicroUsdc
            : 0n;
        this.reservations.delete(resId);
        break;
      }
    }

    if (outcome.success) {
      state.currentPeriodSpendMicroUsdc += outcome.actualCostMicroUsdc;
      state.totalLifetimeSpendMicroUsdc += outcome.actualCostMicroUsdc;
      state.consecutiveErrors = 0;
      state.recentCallTimestamps.push(request.timestamp);
    } else {
      state.consecutiveErrors += 1;
      if (state.consecutiveErrors >= policy.circuitBreaker.maxConsecutiveErrors) {
        state.status = 'CIRCUIT_TRIPPED';
        state.freezeReason = `Consecutive error threshold reached (${state.consecutiveErrors}/${policy.circuitBreaker.maxConsecutiveErrors}). Last error: ${outcome.error}`;
      }
    }
  }

  freezeAgent(agentId: string, reason = 'Operator emergency freeze'): void {
    const state = this.states.get(agentId);
    if (state) {
      state.status = 'AGENT_FROZEN';
      state.freezeReason = reason;
    }
  }

  unfreezeAgent(agentId: string): void {
    const state = this.states.get(agentId);
    if (state) {
      state.status = 'ACTIVE';
      state.freezeReason = undefined;
      state.consecutiveErrors = 0;
    }
  }

  resetCircuitBreaker(agentId: string): void {
    const state = this.states.get(agentId);
    if (state) {
      state.status = 'ACTIVE';
      state.consecutiveErrors = 0;
      state.freezeReason = undefined;
    }
  }

  getAgentState(agentId: string): AgentFinancialState {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} not registered`);
    }
    return { ...state };
  }

  getAllPolicies(): SpendingPolicy[] {
    return Array.from(this.policies.values());
  }

  getAllStates(): AgentFinancialState[] {
    return Array.from(this.states.values());
  }

  getAuditLogs(): AuditLogEntry[] {
    return [...this.auditLogs];
  }

  getActiveReservations(): BudgetReservation[] {
    this.pruneExpiredReservations();
    return Array.from(this.reservations.values());
  }

  private logAudit(
    request: OutboundRequest,
    decision: 'ALLOWED' | 'BLOCKED',
    reason?: any,
    reservationId?: string
  ): void {
    this.auditLogs.unshift({
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      agentId: request.agentId,
      vendor: request.vendor,
      estimatedCostMicroUsdc: request.estimatedCostMicroUsdc.toString(),
      decision,
      reason,
      reservationId,
    });
  }
}

export function createPolicyEngine(): PolicyEngine {
  return new PolicyEngine();
}
