export interface CircuitBreakerConfig {
  maxConsecutiveErrors: number;
  maxCallsPerMinute: number;
}

export interface SpendingPolicy {
  agentId: string;
  allowedVendors: string[];
  maxPerCallMicroUsdc: bigint;
  periodBudgetMicroUsdc: bigint;
  periodSeconds: number;
  circuitBreaker: CircuitBreakerConfig;
}

export interface OutboundRequest {
  agentId: string;
  vendor: string;
  estimatedCostMicroUsdc: bigint;
  timestamp: number;
}

export type PolicyViolationReason =
  | 'UNAPPROVED_VENDOR'
  | 'PER_CALL_LIMIT_EXCEEDED'
  | 'PERIOD_BUDGET_EXCEEDED'
  | 'CIRCUIT_BREAKER_TRIPPED'
  | 'RATE_ANOMALY_LOOP_DETECTED'
  | 'AGENT_FROZEN'
  | 'AGENT_NOT_FOUND'
  | 'CONCURRENCY_RESERVATION_FAILED'
  | 'SSRF_SECURITY_VIOLATION';

export interface BudgetReservation {
  reservationId: string;
  agentId: string;
  amountMicroUsdc: bigint;
  createdAt: number;
  expiresAt: number;
}

export type PolicyDecision =
  | { allowed: true; authorizedAmountMicroUsdc: bigint; reservationId?: string }
  | { allowed: false; reason: PolicyViolationReason; message: string };

export type ExecutionOutcome =
  | { success: true; actualCostMicroUsdc: bigint }
  | { success: false; error: string };

export type AgentStatus = 'ACTIVE' | 'CIRCUIT_TRIPPED' | 'AGENT_FROZEN';

export interface AgentFinancialState {
  agentId: string;
  status: AgentStatus;
  currentPeriodSpendMicroUsdc: bigint;
  totalLifetimeSpendMicroUsdc: bigint;
  activePendingReservationsMicroUsdc: bigint;
  periodStartTimestamp: number;
  consecutiveErrors: number;
  recentCallTimestamps: number[];
  freezeReason?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  agentId: string;
  vendor: string;
  estimatedCostMicroUsdc: string;
  actualCostMicroUsdc?: string;
  decision: 'ALLOWED' | 'BLOCKED';
  reason?: PolicyViolationReason;
  reservationId?: string;
}
