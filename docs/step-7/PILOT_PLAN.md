# Shlita — Controlled Developer Pilot Plan (Alpha)

**Stage:** Private Technical Pilot (Non-Mainnet)  
**Target Window:** Q1 2027 (14-Day Evaluation Cohort)  
**Deployment Model:** Self-Hosted Docker Container or Dedicated Staging Gateway

---

## 1. Target Customer Profile

The initial pilot focuses on a narrow, high-pain developer segment:
- **Profile:** AI developer teams, Web3 research labs, and hackathon teams building autonomous multi-agent workflows (e.g., using Eliza, LangChain, or Autogen).
- **Core Pain Point:** Autonomous agents entering recursive tool-use loops or suffering prompt-injection attacks that burn hundreds of dollars in API credits (Helius RPC, Tavily Web Search) overnight.
- **Prerequisite:** Developers willing to route outbound paid agent tool calls through the lightweight `shlita-sdk` client or local gateway proxy.

---

## 2. Pilot Use Case & Boundaries

### Primary Use Case: "Autonomous Solana Research Agent with Financial Firewall"
1. The developer's agent needs to query Solana blockchain state via Helius (`api.helius.xyz`) and perform web research via Tavily (`api.tavily.com`).
2. Instead of embedding raw `HELIUS_API_KEY` and `TAVILY_API_KEY` into the agent prompt or runtime environment, the agent is issued an internal Shlita API key (`shlt_live_...`).
3. Outbound calls are sent to `ShlitaAgentClient.proxy()`.
4. Shlita verifies the agent's spending limits, reserves the tariff, strips credentials, injects true provider secrets server-side, and forwards the request.
5. If the agent enters an infinite loop, the rolling burst detector (>6 calls/min) automatically trips the circuit breaker and freezes the agent before funds are lost.

---

## 3. Pilot Scope & Guardrails

| Parameter | Pilot Limit | Justification |
| :--- | :--- | :--- |
| **Cohort Size** | 3 to 5 organizations | Allows high-touch developer support and manual log verification. |
| **Fleet Capacity** | Up to 10 agents per organization | Sufficient for multi-agent architectures without overwhelming single-instance SQLite. |
| **Vendor Whitelist** | Strictly `api.helius.xyz` & `api.tavily.com` | Verified upstream schemas; protects against SSRF and unvetted hosts. |
| **Financial Cap** | Max **$50.00 USDC** (50,000,000 micro-USDC) per org | Tightly bounded blast radius. |
| **Per-Call Limit** | Max **$0.05 USDC** (50,000 micro-USDC) per request | Enforces micro-transaction discipline. |
| **Duration** | 14 calendar days | Provides enough runtime to verify budget rollovers and stability. |
| **Settlement Rail** | **Solana Devnet Only** (`SOLANA_NETWORK=devnet`) | Mainnet token transfers are strictly disabled (`SHLITA_ALLOW_MAINNET=false`). |

---

## 4. Emergency Freeze & Escalation Process

1. **Operator 1-Click Kill Switch:**
   - Any authorized team lead can immediately freeze an agent via dashboard or SDK:
     ```typescript
     await operator.freezeAgent('agent-id', 'Suspected prompt injection');
     ```
   - Subsequent calls from that agent return `HTTP 403` with `reason: AGENT_FROZEN` in under 0.2ms.
2. **Global Process Shutdown:**
   - In the event of an infrastructure anomaly, stopping the single container (`docker compose stop`) immediately terminates all outbound gateway proxy routes.
3. **Ledger Integrity Audit:**
   - Operations remain durable in the SQLite WAL ledger and can be inspected via `GET /v1/operations` or `GET /v1/reconciliation`.

---

## 5. Measurable Success Criteria

- [ ] **Zero Over-Budget Leaks:** 100% of calls exceeding per-call caps or period budgets are rejected with zero balance leakage.
- [ ] **Zero Duplicate Provider Executions:** Repeated requests with identical idempotency keys return cached responses with zero duplicate upstream invocations.
- [ ] **Fast Onboarding Time:** Developer successfully installs `shlita-sdk` and executes their first proxy call in **under 15 minutes**.
- [ ] **Circuit Breaker Accuracy:** Recursive loop simulators trip the circuit breaker within 6 calls and prevent further egress.
- [ ] **Clean Process Recovery:** Stopping and restarting the gateway container preserves 100% of ledger operations and agent enrollment states.

---

## 6. Immediate Abort / Failure Criteria

The pilot will be paused immediately if any of the following occur:
- Any transaction exceeds configured budget limits due to a race condition.
- An agent API key is exposed in external gateway logs.
- SQLite database corruption occurs during a container restart.
- An unapproved vendor hostname successfully receives forwarded traffic through the proxy.
