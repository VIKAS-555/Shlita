import { ShlitaApiError } from './errors.js';
import {
  callerHeaders,
  optionalRequestId,
  readString,
  requireCredential,
  requireGatewayUrl,
  requireIdempotencyKey,
  requireMicroUsdc,
  sendJson,
} from './http.js';
import type {
  AgentSummary,
  CostSnapshot,
  DashboardSummary,
  EnrollAgentParams,
  GatewayHealth,
  IssuedCredential,
  LedgerOperation,
  ProxyParams,
  ProxyResult,
  SettlementSnapshot,
} from './types.js';

export interface AgentClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface OperatorClientOptions {
  operatorKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class ShlitaAgentClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AgentClientOptions) {
    this.apiKey = requireCredential(options.apiKey, 'An API key');
    this.baseUrl = requireGatewayUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async proxy(params: ProxyParams): Promise<ProxyResult> {
    const idempotencyKey = requireIdempotencyKey(params.idempotencyKey);
    if (params.estimatedCostMicroUsdc !== undefined) {
      requireMicroUsdc(params.estimatedCostMicroUsdc, 'The estimated amount');
    }
    const requestId = optionalRequestId(params.requestId);
    const headers: Record<string, string> = {
      ...callerHeaders(params.headers),
      'content-type': 'application/json',
      'x-shlita-api-key': this.apiKey,
    };
    if (requestId) headers['x-request-id'] = requestId;
    if (params.simulate === true) headers['x-shlita-simulation'] = 'true';

    const response = await sendJson({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/v1/proxy`,
      method: 'POST',
      headers,
      timeoutMs: this.timeoutMs,
      signal: params.signal,
      idempotencyKey,
      secret: this.apiKey,
      body: {
        agentId: params.agentId,
        vendor: params.vendor,
        path: params.path ?? '/',
        method: params.method ?? 'POST',
        body: params.body ?? null,
        idempotencyKey,
        ...(params.estimatedCostMicroUsdc ? { estimatedCostMicroUsdc: params.estimatedCostMicroUsdc } : {}),
        ...(params.simulate === true ? { simulate: true } : {}),
      },
    });
    return classifyProxy(response.status, response.body, response.headers, idempotencyKey);
  }

  async health(): Promise<GatewayHealth> {
    const response = await sendJson({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/health`,
      method: 'GET',
      headers: {},
      timeoutMs: this.timeoutMs,
      secret: this.apiKey,
    });
    if (response.status !== 200) {
      throw new ShlitaApiError(response.status, 'HEALTH', 'The gateway health check failed.');
    }
    return {
      status: readString(response.body, 'status') ?? 'unknown',
      version: readString(response.body, 'version') ?? '',
      uptimeSeconds: typeof response.body.uptimeSeconds === 'number' ? response.body.uptimeSeconds : 0,
    };
  }
}

export class ShlitaOperatorClient {
  private readonly operatorKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OperatorClientOptions) {
    this.operatorKey = requireCredential(options.operatorKey, 'An operator key');
    this.baseUrl = requireGatewayUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  enrollAgent(params: EnrollAgentParams): Promise<IssuedCredential> {
    requireMicroUsdc(params.maxPerCallMicroUsdc, 'The per-call limit');
    requireMicroUsdc(params.periodBudgetMicroUsdc, 'The period budget');
    return this.mutate('/v1/agents', {
      agentId: params.agentId,
      allowedVendors: params.allowedVendors,
      maxPerCallMicroUsdc: params.maxPerCallMicroUsdc,
      periodBudgetMicroUsdc: params.periodBudgetMicroUsdc,
    }, 201) as Promise<IssuedCredential>;
  }

  listAgents(): Promise<{ agents: AgentSummary[] }> {
    return this.read('/v1/agents');
  }

  freezeAgent(agentId: string, reason: string): Promise<{ success: true; agentId: string; status: 'AGENT_FROZEN' }> {
    return this.mutate(`/v1/agents/${encodeURIComponent(agentId)}/freeze`, { reason });
  }

  unfreezeAgent(agentId: string): Promise<{ success: true; agentId: string; status: 'ACTIVE' }> {
    return this.mutate(`/v1/agents/${encodeURIComponent(agentId)}/unfreeze`, {});
  }

  resetCircuit(agentId: string): Promise<{ success: true; agentId: string; status: 'ACTIVE' }> {
    return this.mutate(`/v1/agents/${encodeURIComponent(agentId)}/reset-circuit`, {});
  }

  listOperations(query?: { limit?: number; offset?: number }): Promise<{ operations: LedgerOperation[]; total: number }> {
    const params = new URLSearchParams();
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    if (query?.offset !== undefined) params.set('offset', String(query.offset));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.read(`/v1/operations${suffix}`);
  }

  dashboard(): Promise<DashboardSummary> {
    return this.read('/v1/dashboard');
  }

  audit(): Promise<{ logs: Array<Record<string, unknown>> }> {
    return this.read('/v1/audit');
  }

  reconciliation(): Promise<{ operations: Array<Record<string, unknown>> }> {
    return this.read('/v1/reconciliation');
  }

  private async read<T>(path: string): Promise<T> {
    const response = await sendJson({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}${path}`,
      method: 'GET',
      headers: { 'x-shlita-operator-key': this.operatorKey },
      timeoutMs: this.timeoutMs,
      secret: this.operatorKey,
    });
    if (response.status >= 400) throw apiError(response.status, response.body);
    return response.body as T;
  }

  private async mutate<T>(path: string, body: unknown, expected = 200): Promise<T> {
    const response = await sendJson({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}${path}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shlita-operator-key': this.operatorKey,
      },
      body,
      timeoutMs: this.timeoutMs,
      secret: this.operatorKey,
    });
    if (response.status !== expected) throw apiError(response.status, response.body);
    return response.body as T;
  }
}

function classifyProxy(status: number, body: Record<string, unknown>, headers: Headers, idempotencyKey: string): ProxyResult {
  const error = readString(body, 'error') ?? 'GATEWAY_ERROR';
  const message = readString(body, 'message') ?? 'The gateway rejected the request.';
  if (status === 409 && (error === 'IDEMPOTENCY_CONFLICT' || error === 'OPERATION_IN_PROGRESS')) {
    return {
      outcome: 'conflict',
      status: 409,
      error,
      message,
      operationId: readString(body, 'operationId'),
    };
  }
  if (status === 504 || body.reconciliationRequired === true || error === 'RECONCILIATION_REQUIRED' || error === 'UPSTREAM_OUTCOME_UNKNOWN') {
    return {
      outcome: 'uncertain',
      status,
      error,
      message,
      operationId: readString(body, 'operationId'),
      idempotencyKey,
      reconciliationRequired: true,
      fundsMoved: false,
    };
  }
  if (status >= 400 || body.allowed === false || headers.get('x-shlita-decision') === 'BLOCKED') {
    return {
      outcome: 'rejected',
      status,
      error,
      message,
      reason: readString(body, 'reason'),
      decision: 'BLOCKED',
      operationId: readString(body, 'operationId'),
    };
  }
  if (status >= 200 && status < 300 && body.success === true && body.fundsMoved !== true) {
    const cost = asCost(body.cost);
    const settlement = asSettlement(body.settlement);
    if (!cost || !settlement) {
      throw new ShlitaApiError(status, 'MALFORMED_RESPONSE', 'The gateway committed a response without a cost snapshot.');
    }
    return {
      outcome: 'committed',
      status,
      operationId: readString(body, 'operationId') ?? '',
      idempotencyKey,
      decision: 'ALLOWED',
      replay: headers.get('x-shlita-idempotent-replay') === 'true',
      lifecycleState: readString(body, 'lifecycleState') ?? 'ACCOUNTING_COMMITTED',
      cost,
      settlement,
      upstream: body.upstream,
      fundsMoved: false,
    };
  }
  throw new ShlitaApiError(status, error, message);
}

function asCost(value: unknown): CostSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cost = value as Record<string, unknown>;
  if (typeof cost.reservedAmountMicroUsdc !== 'string' || typeof cost.estimatedCostMicroUsdc !== 'string') return undefined;
  return {
    estimatedCostMicroUsdc: cost.estimatedCostMicroUsdc,
    reservedAmountMicroUsdc: cost.reservedAmountMicroUsdc,
    actualCostMicroUsdc: typeof cost.actualCostMicroUsdc === 'string' ? cost.actualCostMicroUsdc : null,
    settledAmountMicroUsdc: typeof cost.settledAmountMicroUsdc === 'string' ? cost.settledAmountMicroUsdc : null,
    costBasis: cost.costBasis === 'VERIFIED' || cost.costBasis === 'UNAVAILABLE' ? cost.costBasis : 'ESTIMATED',
    currency: 'USDC',
  };
}

function asSettlement(value: unknown): SettlementSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const settlement = value as Record<string, unknown>;
  return {
    status: typeof settlement.status === 'string' ? settlement.status : 'NOT_SUBMITTED',
    fundsMoved: settlement.fundsMoved === true,
    reservationId: typeof settlement.reservationId === 'string' ? settlement.reservationId : undefined,
    currency: 'USDC',
  };
}

function apiError(status: number, body: Record<string, unknown>): ShlitaApiError {
  return new ShlitaApiError(status, readString(body, 'error') ?? 'GATEWAY_ERROR', readString(body, 'message') ?? 'The gateway request failed.');
}
