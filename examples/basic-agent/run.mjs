import { ShlitaAgentClient } from 'shlita-sdk';

const client = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY,
  baseUrl: process.env.SHLITA_GATEWAY_URL,
});

const result = await client.proxy({
  agentId: process.env.SHLITA_AGENT_ID,
  vendor: 'api.helius.xyz',
  path: '/v0/token-metadata',
  method: 'POST',
  body: { mints: ['example-mint'] },
  idempotencyKey: 'example-a-operation-01',
  simulate: true,
});

if (result.outcome !== 'committed' || result.cost.reservedAmountMicroUsdc !== '10000' || result.fundsMoved !== false) {
  console.error(JSON.stringify({ outcome: result.outcome }));
  process.exit(1);
}

console.log(JSON.stringify({
  example: 'basic-agent',
  outcome: result.outcome,
  reservedAmountMicroUsdc: result.cost.reservedAmountMicroUsdc,
  fundsMoved: result.fundsMoved,
}));
