import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createPolicyEngine, PolicyEngine, SpendingPolicy } from '../../core/src/index.js';
import { SolanaSettlementManager } from '../../solana/src/settlement.js';
import { createGatewayApp } from './app.js';
import { assessSecurityConfig, SecurityConfig } from './security-config.js';

export interface BootSuccess {
  ok: true;
  app: ReturnType<typeof createGatewayApp>;
  engine: PolicyEngine;
  config: SecurityConfig;
}

export interface BootFailure {
  ok: false;
  errors: string[];
}

const DEMO_AGENTS: Array<SpendingPolicy & { keyField: 'demoKeyResearcher' | 'demoKeyArbitrage' }> = [
  {
    keyField: 'demoKeyResearcher',
    agentId: 'agent-researcher-01',
    allowedVendors: ['api.helius.xyz', 'api.tavily.com'],
    maxPerCallMicroUsdc: 50_000n,
    periodBudgetMicroUsdc: 2_000_000n,
    periodSeconds: 86400,
    circuitBreaker: { maxConsecutiveErrors: 3, maxCallsPerMinute: 8 },
  },
  {
    keyField: 'demoKeyArbitrage',
    agentId: 'agent-arbitrage-bot',
    allowedVendors: ['api.helius.xyz', 'api.jup.ag'],
    maxPerCallMicroUsdc: 100_000n,
    periodBudgetMicroUsdc: 5_000_000n,
    periodSeconds: 86400,
    circuitBreaker: { maxConsecutiveErrors: 2, maxCallsPerMinute: 12 },
  },
];

export function bootFromEnv(env: Record<string, string | undefined>): BootSuccess | BootFailure {
  const assessed = assessSecurityConfig(env);
  if (!assessed.ok) return assessed;

  const config = { ...assessed.config };
  if (config.generateOperatorKey) {
    config.operatorKey = loadOrCreateOperatorKey(config.stateDir);
    config.operatorOrg = config.operatorOrg || 'org-local';
  }

  const dbPath = config.dbPath || path.resolve(process.cwd(), config.stateDir, 'ledger.db');
  const engine = createPolicyEngine(dbPath);
  if (config.seedDemo) {
    enrollDemoAgents(engine, config);
  }

  const settlementManager = new SolanaSettlementManager(
    env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    undefined,
    env.SOLANA_NETWORK === 'mainnet-beta'
  );

  const app = createGatewayApp(engine, settlementManager, {
    operators: [{ key: config.operatorKey, ownerOrg: config.operatorOrg }],
    allowSimulation: config.allowSimulation,
    corsOrigins: config.corsOrigins,
  });

  return { ok: true, app, engine, config: { ...config, dbPath } };
}

function enrollDemoAgents(engine: PolicyEngine, config: SecurityConfig): void {
  const created: Record<string, string> = {};
  for (const spec of DEMO_AGENTS) {
    if (engine.getAgentOwnerOrg(spec.agentId)) continue;
    const configured = config[spec.keyField];
    const rawApiKey = configured || `shlt_live_${crypto.randomBytes(16).toString('hex')}`;
    const { agentId, allowedVendors, maxPerCallMicroUsdc, periodBudgetMicroUsdc, periodSeconds, circuitBreaker } =
      spec;
    const creds = engine.registerAgent(
      {
        agentId,
        allowedVendors,
        maxPerCallMicroUsdc,
        periodBudgetMicroUsdc,
        periodSeconds,
        circuitBreaker,
      },
      { ownerOrg: config.operatorOrg, rawApiKey }
    );
    if (!configured && creds.apiKey) created[agentId] = creds.apiKey;
  }

  if (Object.keys(created).length === 0) return;
  fs.mkdirSync(config.stateDir, { recursive: true });
  const file = path.join(config.stateDir, 'enrollment.json');
  fs.writeFileSync(file, `${JSON.stringify(created, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function loadOrCreateOperatorKey(stateDir: string): string {
  const file = path.join(stateDir, 'operator.key');
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
    throw new Error('Stored operator key does not meet strength requirements.');
  }
  const key = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(file, `${key}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return key;
}
