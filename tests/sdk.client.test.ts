import { describe, expect, it } from 'vitest';
import { ShlitaAgentClient, ShlitaOperatorClient, ShlitaUncertainError } from '../packages/sdk/src/index.js';

const AGENT_KEY = 'agent-key-0123456789abcdef';
const OPERATOR_KEY = 'operator-key-0123456789abcd';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('Shlita agent client', () => {
  it('requires an explicit gateway URL and does not call localhost by default', () => {
    expect(() => new ShlitaAgentClient({ apiKey: AGENT_KEY, baseUrl: '' })).toThrow(/gateway URL/i);
    expect(() => new ShlitaAgentClient({ apiKey: '', baseUrl: 'http://127.0.0.1:4000' })).toThrow(/api key/i);
  });

  it('keeps the agent key when the caller supplies an authorization header', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      return jsonResponse(200, {
        success: true,
        operationId: 'op-1',
        idempotencyKey: 'operation-unique-id',
        lifecycleState: 'ACCOUNTING_COMMITTED',
        cost: {
          estimatedCostMicroUsdc: '10000',
          reservedAmountMicroUsdc: '10000',
          actualCostMicroUsdc: null,
          settledAmountMicroUsdc: null,
          costBasis: 'ESTIMATED',
          currency: 'USDC',
        },
        settlement: { status: 'NOT_SUBMITTED', fundsMoved: false, currency: 'USDC' },
        upstream: { ok: true },
      }, { 'x-shlita-decision': 'ALLOWED' });
    };
    const client = new ShlitaAgentClient({
      apiKey: AGENT_KEY,
      baseUrl: 'http://127.0.0.1:4010',
      fetch: fetchImpl,
    });
    const result = await client.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      method: 'POST',
      body: { mints: ['example-mint'] },
      idempotencyKey: 'operation-unique-id',
      headers: {
        authorization: 'Bearer stolen',
        'x-shlita-api-key': 'attacker-key-should-not-win',
        'x-shlita-operator-key': OPERATOR_KEY,
      },
    });
    expect(result.outcome).toBe('committed');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.['x-shlita-api-key']).toBe(AGENT_KEY);
    expect(seen[0]?.authorization).toBeUndefined();
    expect(seen[0]?.['x-shlita-operator-key']).toBeUndefined();
    expect(JSON.stringify(seen[0])).not.toContain(OPERATOR_KEY);
  });

  it('reports a timeout as uncertain and does not send a second billable request', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new DOMException('The operation was aborted', 'TimeoutError'));
        });
      });
    };
    const client = new ShlitaAgentClient({
      apiKey: AGENT_KEY,
      baseUrl: 'http://127.0.0.1:4010',
      timeoutMs: 20,
      fetch: fetchImpl,
    });
    const error = await client.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      idempotencyKey: 'timeout-key-01',
    }).then(() => { throw new Error('expected an uncertain timeout'); }, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(ShlitaUncertainError);
    expect((error as ShlitaUncertainError).code).toBe('TIMEOUT');
    expect((error as ShlitaUncertainError).idempotencyKey).toBe('timeout-key-01');
    expect((error as Error).message).not.toContain(AGENT_KEY);
    expect(calls).toBe(1);
  });

  it('represents an idempotency conflict without treating it as a committed charge', async () => {
    const client = new ShlitaAgentClient({
      apiKey: AGENT_KEY,
      baseUrl: 'http://127.0.0.1:4010',
      fetch: async () => jsonResponse(409, {
        allowed: false,
        error: 'IDEMPOTENCY_CONFLICT',
        message: 'This idempotency key was already used for a different request.',
      }),
    });
    const result = await client.proxy({
      agentId: 'research-agent',
      vendor: 'api.helius.xyz',
      path: '/v0/token-metadata',
      body: { mints: ['other'] },
      idempotencyKey: 'operation-unique-id',
    });
    expect(result.outcome).toBe('conflict');
    if (result.outcome === 'conflict') {
      expect(result.error).toBe('IDEMPOTENCY_CONFLICT');
      expect(result.status).toBe(409);
    }
  });
});

describe('Shlita operator client', () => {
  it('does not give an agent client an operator freeze method', () => {
    const agent = new ShlitaAgentClient({ apiKey: AGENT_KEY, baseUrl: 'http://127.0.0.1:4010', fetch: async () => jsonResponse(200, {}) });
    expect('freezeAgent' in agent).toBe(false);
  });

  it('sends only the operator key to an operator route', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      expect(String(input)).toContain('/v1/agents/research-agent/freeze');
      return jsonResponse(200, { success: true, agentId: 'research-agent', status: 'AGENT_FROZEN' });
    };
    const operator = new ShlitaOperatorClient({
      operatorKey: OPERATOR_KEY,
      baseUrl: 'http://127.0.0.1:4010',
      fetch: fetchImpl,
    });
    const frozen = await operator.freezeAgent('research-agent', 'review');
    expect(frozen.status).toBe('AGENT_FROZEN');
    expect(seen[0]?.['x-shlita-operator-key']).toBe(OPERATOR_KEY);
    expect(seen[0]?.['x-shlita-api-key']).toBeUndefined();
    expect(seen[0]?.authorization).toBeUndefined();
  });
});
