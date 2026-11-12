export interface ShlitaClientOptions {
  apiKey: string;
  operatorKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface ProxyRequestParams {
  agentId: string;
  vendor: string;
  path?: string;
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  simulate?: boolean;
  idempotencyKey: string;
}

export interface ProxyResponse<T = any> {
  status: number;
  data: T;
  decision?: 'ALLOWED' | 'BLOCKED';
  headers: Headers;
}

export class ShlitaClient {
  private apiKey: string;
  private operatorKey?: string;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: ShlitaClientOptions) {
    if (!options.apiKey) {
      throw new Error('ShlitaClient requires a valid apiKey.');
    }
    this.apiKey = options.apiKey;
    this.operatorKey = options.operatorKey;
    this.baseUrl = (options.baseUrl || 'http://localhost:4000').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  /**
   * Proxies an outbound paid tool/API request through the Shlita policy perimeter.
   */
  async proxy<T = any>(params: ProxyRequestParams): Promise<ProxyResponse<T>> {
    if (!params.idempotencyKey) {
      throw new Error('ShlitaClient.proxy requires an idempotencyKey.');
    }
    const callerHeaders = { ...(params.headers || {}) };
    for (const name of Object.keys(callerHeaders)) {
      const normalized = name.toLowerCase();
      if (
        normalized === 'authorization' ||
        normalized === 'cookie' ||
        normalized === 'x-shlita-api-key' ||
        normalized === 'x-shlita-operator-key' ||
        normalized === 'x-shlita-csrf'
      ) {
        delete callerHeaders[name];
      }
    }
    const res = await fetch(`${this.baseUrl}/v1/proxy`, {
      method: 'POST',
      headers: {
        ...callerHeaders,
        'Content-Type': 'application/json',
        'x-shlita-api-key': this.apiKey,
      },
      body: JSON.stringify({
        agentId: params.agentId,
        vendor: params.vendor,
        path: params.path ?? '/',
        method: params.method ?? 'POST',
        payload: params.body,
        simulate: params.simulate,
        idempotencyKey: params.idempotencyKey,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const data = await res.json();
    const decision = res.headers.get('x-shlita-decision') as 'ALLOWED' | 'BLOCKED' | undefined;

    return {
      status: res.status,
      data,
      decision,
      headers: res.headers,
    };
  }

  /**
   * Checks the live health of the Shlita policy gateway.
   */
  async getHealth(): Promise<{ status: string; uptimeSeconds: number; version: string }> {
    const res = await fetch(`${this.baseUrl}/health`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return res.json();
  }

  /**
   * Emergency freeze / kill-switch for an agent.
   */
  async freeze(agentId: string, reason = 'Operator Kill-Switch'): Promise<any> {
    const res = await fetch(`${this.baseUrl}/v1/agents/${encodeURIComponent(agentId)}/freeze`, {
      method: 'POST',
      headers: this.operatorHeaders(),
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return res.json();
  }

  /**
   * Resets circuit breaker and unfreezes an agent.
   */
  async unfreeze(agentId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/v1/agents/${encodeURIComponent(agentId)}/unfreeze`, {
      method: 'POST',
      headers: this.operatorHeaders(),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return res.json();
  }

  private operatorHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.operatorKey ? { 'x-shlita-operator-key': this.operatorKey } : {}),
    };
  }
}
