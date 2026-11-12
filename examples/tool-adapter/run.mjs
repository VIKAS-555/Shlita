import { ShlitaAgentClient } from 'shlita-sdk';

function shlitaProxyTool(client, agentId) {
  return {
    name: 'shlita_proxy',
    description: 'Send one paid provider call through the Shlita gateway.',
    parameters: {
      type: 'object',
      required: ['vendor', 'path', 'idempotencyKey'],
      properties: {
        vendor: { type: 'string' },
        path: { type: 'string' },
        idempotencyKey: { type: 'string' },
      },
    },
    execute(args) {
      return client.proxy({
        agentId,
        vendor: args.vendor,
        path: args.path,
        idempotencyKey: args.idempotencyKey,
        simulate: true,
      });
    },
  };
}

const tool = shlitaProxyTool(
  new ShlitaAgentClient({
    apiKey: process.env.SHLITA_API_KEY,
    baseUrl: process.env.SHLITA_GATEWAY_URL,
  }),
  process.env.SHLITA_AGENT_ID
);
const result = await tool.execute({
  vendor: 'api.helius.xyz',
  path: '/v0/token-metadata',
  idempotencyKey: 'example-d-tool-01',
});

if (tool.name !== 'shlita_proxy' || result.outcome !== 'committed' || result.cost.reservedAmountMicroUsdc !== '10000') {
  process.exit(1);
}

console.log(JSON.stringify({
  example: 'tool-adapter',
  tool: tool.name,
  outcome: result.outcome,
  reservedAmountMicroUsdc: result.cost.reservedAmountMicroUsdc,
}));
