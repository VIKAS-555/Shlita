import {
  AgentFinancialState,
  AuditLogEntry,
  ExecutionOutcome,
  OutboundRequest,
  PolicyDecision,
  SpendingPolicy,
} from './types.js';

export class PolicyEngine {
  private policies = new Map<string, SpendingPolicy>();
  private states = new Map<string, AgentFinancialState>();
  private auditLogs: AuditLogEntry[] = [];

  registerAgent(policy: SpendingPolicy): void {
    this.policies.set(policy.agentId, policy);
    if (!this.states.has(policy.agentId)) {
      this.states.set(policy.agentId, {
        agentId: policy.agentId,
        status: 'ACTIVE',
        currentPeriodSpendMicroUsdc: 0n,
        totalLifetimeSpendMicroUsdc: 0n,
        periodStartTimestamp: Date.now(),
        consecutiveErrors: 0,
        recentCallTimestamps: [],
      });
    }
  }

  evaluate(request: OutboundRequest): PolicyDecision {
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

    // 3. Vendor whitelist enforcement
    const isVendorAllowed = policy.allowedVendors.some(
      (v) => v === request.vendor || request.vendor.endsWith(`.${v}`)
    );
    if (!isVendorAllowed) {
      this.logAudit(request, 'BLOCKED', 'UNAPPROVED_VENDOR');
      return {
        allowed: false,
        reason: 'UNAPPROVED_VENDOR',
        message: `Vendor ${request.vendor} is not in agent whitelist [${policy.allowedVendors.join(', ')}].`,
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
    }

    // 7. Cumulative period budget enforcement
    const projectedSpend = state.currentPeriodSpendMicroUsdc + request.estimatedCostMicroUsdc;
    if (projectedSpend > policy.periodBudgetMicroUsdc) {
      this.logAudit(request, 'BLOCKED', 'PERIOD_BUDGET_EXCEEDED');
      return {
        allowed: false,
        reason: 'PERIOD_BUDGET_EXCEEDED',
        message: `Projected period spend (${projectedSpend} µUSDC) exceeds budget (${policy.periodBudgetMicroUsdc} µUSDC).`,
      };
    }

    // Allowed!
    this.logAudit(request, 'ALLOWED');
    return {
      allowed: true,
      authorizedAmountMicroUsdc: request.estimatedCostMicroUsdc,
    };
  }

  recordExecution(request: OutboundRequest, outcome: ExecutionOutcome): void {
    const policy = this.policies.get(request.agentId);
    const state = this.states.get(request.agentId);
    if (!policy || !state) return;

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

  getAgentState(agentId: string): AgentFinancialState {
    const state = this.states.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} not registered.`);
    }
    return { ...state };
  }

  getAllPolicies(): SpendingPolicy[] {
    return Array.from(this.policies.values());
  }

  getAllStates(): AgentFinancialState[] {
    return Array.from(this.states.values());
  }

  getAuditLogs(limit = 100): AuditLogEntry[] {
    return this.auditLogs.slice(-limit).reverse();
  }

  private logAudit(
    request: OutboundRequest,
    decision: 'ALLOWED' | 'BLOCKED',
    reason?: any
  ): void {
    this.auditLogs.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: request.timestamp,
      agentId: request.agentId,
      vendor: request.vendor,
      estimatedCostMicroUsdc: request.estimatedCostMicroUsdc.toString(),
      decision,
      reason,
    });
  }
}

export function createPolicyEngine(): PolicyEngine {
  return new PolicyEngine();
}
