# Shlita Developer Integration & Pilot Onboarding Guide

**Document Reference:** `docs/step-8/DEVELOPER_ONBOARDING.md`  
**Parent Milestone:** Step 8 — Pilot Deployment Blueprint & Release-Gate Closure  
**Baseline Git Commit:** `4d461c5b1edb63db802674c4cb827a91b211627a`  
**Target Audience:** External AI Agent Developers, Pilot Engineering Partners  

---

## 1. Overview & Pilot Integration Model

Welcome to the Shlita Staging Pilot. Shlita acts as a **Financial Firewall and Autonomous Governance Layer** placed between your AI agent runtime and upstream commercial APIs (such as OpenAI, Anthropic, or specialized web3 endpoints).

During this pilot, your agent interacts with the Shlita Gateway using the standalone TypeScript `shlita-sdk`. The gateway enforces spending caps, reservation atomicity, and ledger immutability before requests reach external LLM endpoints.

---

## 2. The 10-Step Developer Journey

### Step 1: Pilot Agreement & Network Scope
- Confirm your integration operates exclusively on **Solana Devnet** with test budgets.
- Pilot organization identifier: `org_pilot_alpha`.
- Allocated pilot budget: **$50.00 USD equivalent** (5,000 cents).

### Step 2: Credential Provisioning (Operator Issued)
Until automated self-service registration is deployed, credentials are generated and delivered securely by Shlita Platform Operators:
- **Assigned Agent ID:** `agent_prod_reader` (or `agent_prod_writer`)
- **Agent Bearer Token:** `agt_sec_...`
- **Staging Gateway URL:** `https://gateway.staging.shlita.xyz` (or local `http://localhost:4000`)

### Step 3: Install the Standalone SDK
Install the standalone Shlita client package into your agent application repository:
```bash
# Using the pre-built pilot tarball:
npm install https://github.com/XiaoArnav/Shlita/releases/download/v0.1.0-pilot/shlita-sdk-0.1.0.tgz

# Or directly from the packaged artifact in a monorepo checkout:
npm install /path/to/packages/sdk
```

### Step 4: Configure Environment Variables
Add the required connection parameters to your application's `.env`:
```bash
SHLITA_GATEWAY_URL="https://gateway.staging.shlita.xyz"
SHLITA_AGENT_KEY="agt_sec_pilot_alpha_reader_001"
OPENAI_API_KEY="sk-mock-pilot-upstream-key"
```

### Step 5: Initialize the Shlita Client
Instantiate the typed client in your TypeScript or JavaScript application:
```typescript
import { ShlitaClient } from 'shlita-sdk';

const shlita = new ShlitaClient({
  baseUrl: process.env.SHLITA_GATEWAY_URL!,
  apiKey: process.env.SHLITA_AGENT_KEY!,
  timeoutMs: 10000,
  maxRetries: 2
});
```

### Step 6: Verify Connection & Policy Invariants
Perform an initial connectivity test to verify your agent's active limits:
```typescript
async function verifySetup() {
  const status = await shlita.getAgentStatus();
  console.log('Shlita Gateway Status:', status);
  console.log(`Allocated Budget: $${(status.spendingLimitCents / 100).toFixed(2)}`);
  console.log(`Current Spend: $${(status.currentSpendCents / 100).toFixed(2)}`);
}
verifySetup();
```

### Step 7: Execute Your First Governed Proxy Call
Pass your model completion call through the Shlita Gateway:
```typescript
async function runGovernedPrompt() {
  const response = await shlita.executeProxyRequest({
    provider: 'openai',
    model: 'gpt-4o-mini',
    estimatedCostCents: 15,
    payload: {
      messages: [{ role: 'user', content: 'Summarize financial firewall invariants.' }]
    }
  });

  console.log('LLM Output:', response.data);
  console.log('Shlita Reservation ID:', response.reservationId);
  console.log('Settled Cost (cents):', response.settledCostCents);
}
runGovernedPrompt();
```

### Step 8: Verify Real-Time Ledger Confirmation
Inspect the returned response headers. Every valid Shlita proxy call includes cryptographic and ledger traceability:
- `x-shlita-reservation-id`: The unique UUID representing the pre-allocated atomic budget reservation.
- `x-shlita-settled-cost-cents`: The exact financial deduction committed to the persistent SQLite ledger.
- `x-shlita-solana-slot`: The Solana Devnet slot index recording the audit log signature.

### Step 9: Test Guardrail Enforcement (Over-Budget Rejection)
Verify that your application gracefully handles safety policy rejections:
```typescript
try {
  // Intentionally submit a request exceeding the $5.00 single-transaction limit
  await shlita.executeProxyRequest({
    provider: 'openai',
    model: 'gpt-4o',
    estimatedCostCents: 550, // 550 cents = $5.50
    payload: { prompt: 'Large batch prompt' }
  });
} catch (error) {
  if (shlita.isPolicyViolation(error)) {
    console.warn('Safety Guardrail Active: Request blocked before hitting OpenAI.');
    console.warn(`Reason: ${error.code} - ${error.message}`);
  }
}
```

### Step 10: Implement Idempotent Safe Retries
Protect your agent against duplicate spend during network blips by passing explicit idempotency keys:
```typescript
import { randomUUID } from 'crypto';

const actionId = `agent_run_${randomUUID()}`;

// If network drops and you retry with the identical actionId:
const result = await shlita.executeProxyRequest({
  idempotencyKey: actionId,
  provider: 'openai',
  model: 'gpt-4o-mini',
  estimatedCostCents: 20,
  payload: { prompt: 'Idempotency safety verification' }
});
// Shlita guarantees this request is charged exactly once regardless of retries.
```

---

## 3. Current Platform Limitations (Missing Self-Service Features)

To maintain realistic expectations, pilot partners must note the following features are not yet automated in the current architecture:

1. **No Self-Service Web Sign-Up:** Organization registration and API key issuance are conducted manually by Shlita SREs via database seeds or administrative CLI.
2. **No Automated Credit Card Billing:** Pilot funding is allocated virtually via operator policy configurations.
3. **No Dynamic Webhook Callbacks:** Settlement events and balance exhaustion warnings are currently delivered via synchronous HTTP response headers rather than outbound webhooks.
4. **Single-Region Gateway:** The staging gateway is hosted in a single primary datacenter (US-East); latency-sensitive agents outside North America should account for network propagation delays (~80–120ms).
