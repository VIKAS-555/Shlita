import { serve } from '@hono/node-server';
import { createPolicyEngine } from '../../core/src/index.js';
import { createGatewayApp } from './app.js';

const engine = createPolicyEngine();

// Register Default Autonomous Agents with real policy configurations
engine.registerAgent({
  agentId: 'agent-researcher-01',
  allowedVendors: ['api.helius.xyz', 'api.tavily.com'],
  maxPerCallMicroUsdc: 50_000n, // $0.05 USDC per call cap
  periodBudgetMicroUsdc: 2_000_000n, // $2.00 USDC period budget
  periodSeconds: 86400, // 24 hours
  circuitBreaker: {
    maxConsecutiveErrors: 3,
    maxCallsPerMinute: 8,
  },
});

engine.registerAgent({
  agentId: 'agent-arbitrage-bot',
  allowedVendors: ['api.helius.xyz', 'api.jup.ag'],
  maxPerCallMicroUsdc: 100_000n, // $0.10 USDC
  periodBudgetMicroUsdc: 5_000_000n, // $5.00 USDC
  periodSeconds: 86400,
  circuitBreaker: {
    maxConsecutiveErrors: 2,
    maxCallsPerMinute: 12,
  },
});

const app = createGatewayApp(engine);

const PORT = Number(process.env.PORT) || 4000;

console.log(`\n========================================================`);
console.log(`🛡️  SHLITA (שְׁלִיטָה) GATEWAY RUNNING ON http://localhost:${PORT}`);
console.log(`   Financial & Spending Control Plane for Autonomous Agents`);
console.log(`========================================================\n`);

serve({
  fetch: app.fetch,
  port: PORT,
});

export { app, engine };
