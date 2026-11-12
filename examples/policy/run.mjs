import { ShlitaAgentClient, ShlitaOperatorClient } from 'shlita-sdk';

const operator = new ShlitaOperatorClient({
  operatorKey: process.env.SHLITA_OPERATOR_KEY,
  baseUrl: process.env.SHLITA_GATEWAY_URL,
});
const approvedClient = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY,
  baseUrl: process.env.SHLITA_GATEWAY_URL,
});

const approved = await approvedClient.proxy({
  agentId: process.env.SHLITA_AGENT_ID,
  vendor: 'api.helius.xyz',
  path: '/v0/token-metadata',
  idempotencyKey: 'example-b-approved-01',
  simulate: true,
});
const blocked = await approvedClient.proxy({
  agentId: process.env.SHLITA_AGENT_ID,
  vendor: 'api.example.com',
  path: '/search',
  idempotencyKey: 'example-b-blocked-01',
  simulate: true,
});
const tight = await operator.enrollAgent({
  agentId: 'tight-agent',
  allowedVendors: ['api.helius.xyz'],
  maxPerCallMicroUsdc: '1000',
  periodBudgetMicroUsdc: '1000',
});
const tightClient = new ShlitaAgentClient({
  apiKey: tight.apiKey,
  baseUrl: process.env.SHLITA_GATEWAY_URL,
});
const overLimit = await tightClient.proxy({
  agentId: 'tight-agent',
  vendor: 'api.helius.xyz',
  path: '/v0/token-metadata',
  idempotencyKey: 'example-b-budget-01',
  simulate: true,
});

if (approved.outcome !== 'committed' || blocked.outcome !== 'rejected' || blocked.reason !== 'UNAPPROVED_VENDOR') {
  process.exit(1);
}
if (overLimit.outcome !== 'rejected' || overLimit.reason !== 'PER_CALL_LIMIT_EXCEEDED') {
  process.exit(1);
}

console.log(JSON.stringify({
  example: 'policy',
  approved: approved.outcome,
  blocked: blocked.reason,
  overLimit: overLimit.reason,
}));
