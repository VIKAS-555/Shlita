import net from 'node:net';
import { ShlitaAgentClient, ShlitaUncertainError } from 'shlita-sdk';

const client = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY,
  baseUrl: process.env.SHLITA_GATEWAY_URL,
});
const params = {
  agentId: process.env.SHLITA_AGENT_ID,
  vendor: 'api.helius.xyz',
  path: '/v0/token-metadata',
  body: { mints: ['example-mint'] },
  idempotencyKey: 'example-c-replay-01',
  simulate: true,
};

const first = await client.proxy(params);
const second = await client.proxy(params);
const conflict = await client.proxy({ ...params, body: { mints: ['other-mint'] } });

const hung = net.createServer();
await new Promise((resolve) => hung.listen(0, '127.0.0.1', resolve));
const address = hung.address();
const port = typeof address === 'object' && address ? address.port : 0;
let connections = 0;
hung.on('connection', (socket) => {
  connections += 1;
  socket.on('error', () => {});
});
const stalled = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY,
  baseUrl: `http://127.0.0.1:${port}`,
  timeoutMs: 200,
});
const uncertain = await stalled.proxy({
  agentId: process.env.SHLITA_AGENT_ID,
  vendor: 'api.helius.xyz',
  path: '/v0/token-metadata',
  idempotencyKey: 'example-c-timeout-01',
}).then(() => { throw new Error('timeout should stay uncertain'); }, (error) => error);
hung.close();

if (first.outcome !== 'committed' || second.outcome !== 'committed' || second.replay !== true) process.exit(1);
if (conflict.outcome !== 'conflict' || conflict.error !== 'IDEMPOTENCY_CONFLICT') process.exit(1);
if (!(uncertain instanceof ShlitaUncertainError) || uncertain.code !== 'TIMEOUT' || connections !== 1) process.exit(1);

console.log(JSON.stringify({
  example: 'idempotency',
  replay: second.replay,
  conflict: conflict.error,
  timeout: uncertain.code,
  connections,
}));
