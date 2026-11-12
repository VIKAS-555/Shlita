export type MicroUsdc = string;

export interface CostSnapshot {
  estimatedCostMicroUsdc: MicroUsdc;
  reservedAmountMicroUsdc: MicroUsdc;
  actualCostMicroUsdc: MicroUsdc | null;
  settledAmountMicroUsdc: MicroUsdc | null;
  costBasis: 'ESTIMATED' | 'VERIFIED' | 'UNAVAILABLE';
  currency: 'USDC';
}

export interface SettlementSnapshot {
  status: string;
  fundsMoved: boolean;
  reservationId?: string;
  currency: 'USDC';
}

export interface ProxyParams {
  agentId: string;
  vendor: string;
  path?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey: string;
  estimatedCostMicroUsdc?: MicroUsdc;
  simulate?: boolean;
  requestId?: string;
  /** Extra headers for the gateway request. Authentication headers in this bag are ignored. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export type ProxyResult =
  | {
      outcome: 'committed';
      status: number;
      operationId: string;
      idempotencyKey: string;
      decision: 'ALLOWED';
      replay: boolean;
      lifecycleState: string;
      cost: CostSnapshot;
      settlement: SettlementSnapshot;
      upstream: unknown;
      fundsMoved: false;
    }
  | {
      outcome: 'rejected';
      status: number;
      error: string;
      message: string;
      reason?: string;
      decision: 'BLOCKED';
      operationId?: string;
    }
  | {
      outcome: 'conflict';
      status: 409;
      error: 'IDEMPOTENCY_CONFLICT' | 'OPERATION_IN_PROGRESS';
      message: string;
      operationId?: string;
    }
  | {
      outcome: 'uncertain';
      status: number;
      error: string;
      message: string;
      operationId?: string;
      idempotencyKey: string;
      reconciliationRequired: true;
      fundsMoved: false;
    };

export interface EnrollAgentParams {
  agentId: string;
  allowedVendors: string[];
  maxPerCallMicroUsdc: MicroUsdc;
  periodBudgetMicroUsdc: MicroUsdc;
}

export interface IssuedCredential {
  agentId: string;
  apiKey: string;
  credentialStatus: 'issued';
}

export interface AgentSummary {
  agentId: string;
  organizationId: string;
  credentialStatus: 'enrolled';
  status: string;
  spending: {
    currentPeriodSpendMicroUsdc: MicroUsdc;
    periodBudgetMicroUsdc: MicroUsdc;
    maxPerCallMicroUsdc: MicroUsdc;
  };
  policy: { allowedVendors: string[] };
}

export interface LedgerOperation {
  operationId: string;
  agentId: string;
  vendor: string;
  decision: string;
  reservedAmountMicroUsdc: MicroUsdc;
  actualCostMicroUsdc: MicroUsdc | null;
  costBasis: string;
  state: string;
  settlementStatus: string;
  signature: string | null;
}

export interface DashboardSummary {
  source: 'ledger';
  organizationId: string;
  accountedSpendMicroUsdc: MicroUsdc;
  reconciliation: number;
}

export interface GatewayHealth {
  status: string;
  version: string;
  uptimeSeconds: number;
}
