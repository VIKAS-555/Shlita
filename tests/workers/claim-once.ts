import { createPolicyEngine } from '../../packages/core/src/index.js';
import { createGatewayApp } from '../../packages/gateway/src/app.js';

const dbPath = process.env.CLAIM_DB;
const idempotencyKey = process.env.CLAIM_KEY;
const apiKey = process.env.CLAIM_AGENT;
if (!dbPath || !idempotencyKey || !apiKey) {
  throw new Error('claim worker is missing its arguments');
}

const engine = createPolicyEngine(dbPath);
const app = createGatewayApp(engine, undefined, {
  allowSimulation: false,
  upstream: async () => ({ status: 200, body: { ok: true } }),
});

const response = await app.request('/v1/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-shlita-api-key': apiKey },
  body: JSON.stringify({
    agentId: 'agent-ledger-01',
    vendor: 'api.helius.xyz',
    path: '/v0/token-metadata',
    method: 'POST',
    body: { mints: ['USDC'] },
    idempotencyKey,
  }),
});
const body = await response.json();
process.stdout.write(JSON.stringify({ status: response.status, reason: body.reason ?? body.error ?? null }));
engine.close();
