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
  idempotencyKey?: string;
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
  | 'SSRF_SECURITY_VIOLATION'
  | 'UNAUTHORIZED_AGENT_KEY'
  | 'EXPIRED_RESERVATION'
  | 'ACTUAL_COST_EXCEEDED_RESERVE';

export type ReservationStatus = 'PENDING' | 'COMMITTED' | 'ROLLED_BACK' | 'EXPIRED';

export interface BudgetReservation {
  reservationId: string;
  agentId: string;
  idempotencyKey?: string;
  amountMicroUsdc: bigint;
  status: ReservationStatus;
  createdAt: number;
  expiresAt: number;
}

export type PolicyDecision =
  | { allowed: true; authorizedAmountMicroUsdc: bigint; reservationId?: string; idempotencyKey?: string }
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

export type TransactionLifecycleState =
  | 'REQUEST_RECEIVED'
  | 'POLICY_REJECTED'
  | 'BUDGET_RESERVED'
  | 'EXECUTION_IN_PROGRESS'
  | 'VENDOR_SUCCEEDED'
  | 'VENDOR_FAILED'
  | 'EXECUTION_OUTCOME_UNKNOWN'
  | 'ACCOUNTING_COMMITTED'
  | 'RECONCILIATION_REQUIRED'
  | 'SETTLEMENT_PENDING'
  | 'SETTLEMENT_CONFIRMED'
  | 'SETTLEMENT_FAILED';

export type CostBasis = 'ESTIMATED' | 'VERIFIED' | 'UNAVAILABLE';

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  actor?: string;
  agentId: string;
  action?: string;
  vendor: string;
  estimatedCostMicroUsdc: string;
  actualCostMicroUsdc?: string;
  decision: 'ALLOWED' | 'BLOCKED';
  reason?: PolicyViolationReason;
  reservationId?: string;
  correlationId?: string;
  lifecycleState?: TransactionLifecycleState;
  metadata?: Record<string, any>;
}

// Durable Database Ledger Entities
export interface AgentRecord {
  id: string;
  ownerOrg: string;
  status: AgentStatus;
  apiKeyHash: string;
  createdAt: number;
}

export interface PolicyRecord {
  agentId: string;
  allowedVendorsJson: string;
  maxPerCallMicroUsdc: bigint;
  periodBudgetMicroUsdc: bigint;
  periodSeconds: number;
  periodStart: number;
  maxConsecutiveErrors: number;
  maxCallsPerMinute: number;
  version: number;
}

export interface ReservationRecord {
  id: string;
  agentId: string;
  idempotencyKey: string;
  reservedAmountMicroUsdc: bigint;
  status: ReservationStatus;
  createdAt: number;
  expiresAt: number;
}

export interface RequestRecord {
  requestId: string;
  agentId: string;
  provider: string;
  routeModel: string;
  estimateMicroUsdc: bigint;
  usageUnits?: number;
  actualCostMicroUsdc?: bigint;
  responseStatus?: number;
  latencyMs?: number;
  correlationId: string;
  createdAt: number;
}

export interface SettlementRecord {
  id: string;
  requestId: string;
  reservationId: string;
  network: string;
  signature?: string;
  sourceAccount: string;
  destinationAccount: string;
  mint: string;
  amountMicroUsdc: bigint;
  confirmationStatus: TransactionLifecycleState;
  slot?: number;
  error?: string;
  createdAt: number;
  confirmedAt?: number;
}

export interface AuditEventRecord {
  eventId: string;
  actor: string;
  agentId: string;
  action: string;
  decision: string;
  reason?: string;
  timestamp: number;
  correlationId: string;
  detailsJson: string;
}
