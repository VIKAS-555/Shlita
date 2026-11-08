import { serve } from '@hono/node-server';
import { createPolicyEngine } from '../../core/src/index.js';
import { SolanaSettlementManager } from '../../solana/src/settlement.js';
import { createGatewayApp } from './app.js';
import path from 'node:path';

const dbPath = process.env.SHLITA_DB_PATH || path.resolve(process.cwd(), '.shlita/ledger.db');
const engine = createPolicyEngine(dbPath);

// Initialize Solana Settlement Manager with Devnet cluster configuration
const settlementManager = new SolanaSettlementManager(
  process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  undefined,
  process.env.SOLANA_NETWORK === 'mainnet-beta'
);

// Register Default Autonomous Agents with real policy configurations and hashed keys
const researcherCreds = engine.registerAgent(
  {
    agentId: 'agent-researcher-01',
    allowedVendors: ['api.helius.xyz', 'api.tavily.com'],
    maxPerCallMicroUsdc: 50_000n, // $0.05 USDC per call cap
    periodBudgetMicroUsdc: 2_000_000n, // $2.00 USDC period budget
    periodSeconds: 86400, // 24 hours
    circuitBreaker: {
      maxConsecutiveErrors: 3,
      maxCallsPerMinute: 8,
    },
  },
  { rawApiKey: 'shlt_live_researcher_dev_01' }
);

const arbitrageCreds = engine.registerAgent(
  {
    agentId: 'agent-arbitrage-bot',
    allowedVendors: ['api.helius.xyz', 'api.jup.ag'],
    maxPerCallMicroUsdc: 100_000n, // $0.10 USDC
    periodBudgetMicroUsdc: 5_000_000n, // $5.00 USDC
    periodSeconds: 86400,
    circuitBreaker: {
      maxConsecutiveErrors: 2,
      maxCallsPerMinute: 12,
    },
  },
  { rawApiKey: 'shlt_live_arbitrage_dev_02' }
);

const app = createGatewayApp(engine, settlementManager);

const PORT = Number(process.env.PORT) || 4000;

console.log(`\n========================================================`);
console.log(`🛡️  SHLITA (שְׁלִיטָה) GATEWAY RUNNING ON http://localhost:${PORT}`);
console.log(`   Financial & Spending Control Plane for Autonomous Agents`);
console.log(`   Durable Ledger: ${dbPath}`);
console.log(`   Solana Subscriptions Program: ${settlementManager.getProgramId().toBase58()}`);
console.log(`   Cluster: ${settlementManager.getCluster()} | Mint: ${settlementManager.getUsdcMint().toBase58()}`);
console.log(`--------------------------------------------------------`);
console.log(`   Agent 1: agent-researcher-01`);
console.log(`   API Key: ${researcherCreds.apiKey}`);
console.log(`   Agent 2: agent-arbitrage-bot`);
console.log(`   API Key: ${arbitrageCreds.apiKey}`);
console.log(`========================================================\n`);

serve({
  fetch: app.fetch,
  port: PORT,
});

export { app, engine, settlementManager };
