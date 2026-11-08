export type AgentStatus = 'ACTIVE' | 'PAUSED' | 'SUSPENDED' | 'EXPIRED' | 'CIRCUIT_TRIPPED';

export interface Agent {
  id: string;
  name: string;
  description: string;
  avatar: string;
  environment: 'Production' | 'Staging' | 'Development';
  version: string;
  mode: 'Runner' | 'Caller';
  connection: string;
  status: AgentStatus;
  walletAddress: string;
  dailyBudgetUsdc: number;
  monthlyBudgetUsdc: number;
  spentThisMonthUsdc: number;
  maxPerCallUsdc: number;
  allowedVendors: string[];
  lastActive: string;
  circuitTrippedReason?: string;
}

export type EnforcementType = 'ON_CHAIN' | 'GATEWAY' | 'OFF_CHAIN_ALERT';

export interface SpendingPolicy {
  id: string;
  name: string;
  tier: string;
  enforcementType: EnforcementType;
  maxPerCallUsdc: number;
  dailyBudgetUsdc: number;
  monthlyBudgetUsdc: number;
  autoApproveLimitUsdc: number;
  humanReviewThresholdUsdc: number;
  allowedTokens: string[];
  allowedVendors: string[];
  blockedVendors: string[];
  assignedAgentsCount: number;
  circuitBreaker: {
    maxConsecutiveErrors: number;
    maxCallsPerMinute: number;
  };
}

export interface Provider {
  id: string;
  name: string;
  category: 'RPC & Node' | 'AI Search' | 'Inference' | 'Dev Tools' | 'Financial Rails';
  logo: string;
  endpoint: string;
  supportedTokens: string[];
  status: 'VERIFIED' | 'CONNECTED' | 'PENDING';
  connectedAgentsCount: number;
  totalSpentUsdc: number;
  tags: string[];
}

export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'PAST_DUE' | 'RETRY_PENDING' | 'CANCELLED';

export interface Subscription {
  id: string;
  name: string;
  merchant: string;
  amountUsdc: number;
  billingInterval: 'Monthly' | 'Annual' | 'Weekly';
  nextCollectionDate: string;
  status: SubscriptionStatus;
  logo: string;
  failureReason?: string;
  initialAmountUsdc: number;
  pdaAuthority: string;
}

export type TransactionStatus = 'CONFIRMED' | 'BLOCKED_BY_POLICY' | 'PENDING' | 'FAILED';

export interface Transaction {
  id: string;
  signature: string;
  agentId: string;
  agentName: string;
  providerId: string;
  providerName: string;
  amountUsdc: number;
  token: string;
  timestamp: string;
  status: TransactionStatus;
  networkFeeSol: number;
  failureReason?: string;
  policyUsed: string;
  solanaExplorerUrl: string;
  fromAddress: string;
  toAddress: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  unread: boolean;
  type: 'VIOLATION' | 'FAILED_PAYMENT' | 'THRESHOLD_WARNING' | 'AUTH_UPDATE' | 'SUCCESS';
}

export interface PendingApproval {
  id: string;
  agentId: string;
  agentName: string;
  amountUsdc: number;
  provider: string;
  reason: string;
  requestedBy: string;
  timestamp: string;
  requiredSignatures: number;
  currentSignatures: number;
}

