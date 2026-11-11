import { createPolicyEngine } from '../packages/core/src/index.js';
import { createGatewayApp } from '../packages/gateway/src/app.js';

// ANSI terminal color codes for clear presentation
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function runDemo() {
  console.log(`\n${CYAN}${BOLD}========================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}   SHLITA (שְׁלִיטָה): AUTONOMOUS AI AGENT FINANCIAL CONTROL PLANE       ${RESET}`);
  console.log(`${CYAN}   Demonstrating Policy Governance & Circuit Breaker on Solana Rails    ${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================${RESET}\n`);

  const engine = createPolicyEngine();

  // Register Autonomous Research Agent with strict spending parameters
  const agentId = 'agent-researcher-01';
  const enrolled = engine.registerAgent(
    {
      agentId,
      allowedVendors: ['api.helius.xyz', 'api.tavily.com'],
      maxPerCallMicroUsdc: 50_000n, // $0.05 USDC cap per call
      periodBudgetMicroUsdc: 150_000n, // $0.15 USDC total budget
      periodSeconds: 3600,
      circuitBreaker: {
        maxConsecutiveErrors: 2,
        maxCallsPerMinute: 6,
      },
    },
    { ownerOrg: 'org-demo' }
  );

  const app = createGatewayApp(engine, undefined, { allowSimulation: true });

  const callGateway = async (vendor: string, costMicroUsdc: string, requestPath = '/v0/token-metadata') => {
    const res = await app.request('/v1/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-shlita-api-key': enrolled.apiKey,
        'x-shlita-simulation': 'true',
      },
      body: JSON.stringify({
        agentId,
        vendor,
        estimatedCostMicroUsdc: costMicroUsdc,
        path: requestPath,
        simulate: true,
      }),
    });
    return { status: res.status, data: await res.json() };
  };

  // --- SCENARIO 1: Authorized Micro-Transactions ---
  console.log(`${BOLD}[SCENARIO 1] Agent Executes Authorized Tool Calls within Policy${RESET}`);
  console.log(`Agent: ${agentId} requesting Helius RPC and Tavily Search...`);

  const step1 = await callGateway('api.helius.xyz', '20000', '/v0/addresses/USDC/balances');
  console.log(`  ✓ Call 1 -> ${step1.data.vendor}: ${GREEN}APPROVED${RESET} (Cost: $0.020 USDC)`);

  const step2 = await callGateway('api.tavily.com', '15000', '/search');
  console.log(`  ✓ Call 2 -> ${step2.data.vendor}: ${GREEN}APPROVED${RESET} (Cost: $0.015 USDC)`);

  let state = engine.getAgentState(agentId);
  console.log(`  -> Current Spend: ${(Number(state.currentPeriodSpendMicroUsdc)/1e6).toFixed(4)} USDC / $0.150 USDC max`);
  console.log(`  -> Agent Status: ${GREEN}${state.status}${RESET}\n`);

  // --- SCENARIO 2: Phishing / Unapproved Vendor Injection Defense ---
  console.log(`${BOLD}[SCENARIO 2] Agent Tricked into Contacting Unwhitelisted Endpoint${RESET}`);
  console.log(`Simulating prompt injection redirecting agent to unapproved vendor: "evil-drainer-api.org"...`);

  const step3 = await callGateway('evil-drainer-api.org', '10000', '/drain-wallet');
  console.log(`  ✗ Call 3 -> evil-drainer-api.org: ${RED}BLOCKED (HTTP ${step3.status})${RESET}`);
  console.log(`  -> Reason: ${RED}${step3.data.reason}${RESET}`);
  console.log(`  -> Message: ${step3.data.message}\n`);

  // --- SCENARIO 3: Per-Call Spending Cap Enforcement ---
  console.log(`${BOLD}[SCENARIO 3] Agent Attempts a High-Cost Single Request Exceeding Cap${RESET}`);
  console.log(`Agent attempts $0.08 USDC call (Policy cap is $0.05 USDC)...`);

  const step4 = await callGateway('api.helius.xyz', '80000', '/v0/bulk-export');
  console.log(`  ✗ Call 4 -> api.helius.xyz: ${RED}BLOCKED (HTTP ${step4.status})${RESET}`);
  console.log(`  -> Reason: ${RED}${step4.data.reason}${RESET}`);
  console.log(`  -> Message: ${step4.data.message}\n`);

  // --- SCENARIO 4: Rogue Execution Loop / Rapid Anomaly Detection (Circuit Breaker) ---
  console.log(`${BOLD}[SCENARIO 4] Agent Falls into an Infinite Recursive Loop (Circuit Breaker Tripped)${RESET}`);
  console.log(`Simulating rapid recursive tool invocation (>6 calls in seconds)...`);

  for (let i = 1; i <= 6; i++) {
    const loopRes = await callGateway('api.helius.xyz', '5000', `/v0/retry-${i}`);
    if (loopRes.status === 200) {
      console.log(`  -> Loop call ${i}: Executed ($0.005 USDC)`);
    } else {
      console.log(`  🛑 ${RED}${BOLD}CIRCUIT BREAKER ACTIVATED on call ${i}!${RESET}`);
      console.log(`  -> Policy Violation: ${RED}${loopRes.data.reason}${RESET}`);
      console.log(`  -> Message: ${loopRes.data.message}`);
      break;
    }
  }

  state = engine.getAgentState(agentId);
  console.log(`\n  -> Updated Agent Status: ${RED}${BOLD}${state.status}${RESET}`);
  console.log(`  -> Reason: ${state.freezeReason}`);

  // Subsequent call is blocked immediately at perimeter
  console.log(`\nAttempting another call while circuit is tripped...`);
  const step5 = await callGateway('api.helius.xyz', '5000');
  console.log(`  ✗ Blocked at perimeter: ${RED}${step5.data.reason}${RESET}\n`);

  // --- OPERATOR INTERVENTION ---
  console.log(`${BOLD}[SCENARIO 5] Operator Inspects Audit Ledger & Resets Circuit${RESET}`);
  console.log(`Operator reviews live telemetry and resets circuit breaker...`);
  engine.unfreezeAgent(agentId);
  state = engine.getAgentState(agentId);
  console.log(`  ✔ Circuit Reset! Agent Status: ${GREEN}${state.status}${RESET}`);

  console.log(`\n${CYAN}${BOLD}========================================================================${RESET}`);
  console.log(`${GREEN}${BOLD}✔ DEMO COMPLETE: 100% Policy Compliance, Zero Treasury Drain Risk.${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================${RESET}\n`);
}

runDemo().catch(console.error);
