# Shlita (שְׁלִיטָה)

> **Autonomous AI Agent Financial Control Plane & Policy Proxy on Solana Rails.**

![Shlita - Financial Firewall for Autonomous AI Agents on Solana](assets/thumbnail.jpg)

[![Vercel](https://img.shields.io/badge/Vercel-shlita.vercel.app-000000?style=flat-square&logo=vercel&logoColor=white)](https://shlita.vercel.app/)
[![GitHub Pages](https://img.shields.io/badge/Mirror-xiaoarnav.github.io%2FShlita-14F195?style=flat-square&logo=googlechrome&logoColor=white)](https://xiaoarnav.github.io/Shlita/)
[![YouTube Demo](https://img.shields.io/badge/YouTube-Video%20Demo-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/o5vHfcUjDJE)
[![Solana Subscriptions](https://img.shields.io/badge/Solana-Subscriptions%20PDA-7C3AED?style=flat-square&logo=solana)](https://solana.com)
[![Tests](https://img.shields.io/badge/Tests-npm%20test-success?style=flat-square)](https://github.com/XiaoArnav/Shlita/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

- ⚡ **Static demo (Vercel)**: [https://shlita.vercel.app/](https://shlita.vercel.app/) serves the built interface only. It does not host the ledger.
- 🌐 **Static mirror (GitHub Pages)**: [https://xiaoarnav.github.io/Shlita/](https://xiaoarnav.github.io/Shlita/) is the same static build.

The financial control plane is the gateway process plus its SQLite file. `npm start` serves the built interface and `/v1` on the same origin, so the operator session cookie stays on that host. The operator key is not bundled into the frontend. A hosted static site is not a persistent ledger, and this repository does not deploy the gateway.
- 📺 **Full Video Walkthrough**: [Watch on YouTube (https://youtu.be/o5vHfcUjDJE)](https://youtu.be/o5vHfcUjDJE)
- 📖 **DEV.to Deep Dive Writeup**: [Why We Built a Financial Firewall for Autonomous AI Agents on Solana](https://dev.to/polymath_arnav/why-we-built-a-financial-firewall-for-autonomous-ai-agents-on-solana-acid-reservations-zero-key-4mfe)

---

## 1. The Problem: The AI Agent Financial Paradox

Autonomous AI agents (trading bots, research agents, code reviewers, DevOps responders) require continuous access to paid services:
- **Inference APIs**: OpenAI, Anthropic, DeepSeek
- **Solana RPCs**: Helius, QuickNode, Triton
- **Web Search & Data**: Tavily, Exa, Brave Search

Giving an autonomous AI agent raw wallet private keys or unlimited corporate cards is financial suicide:
- **Prompt Injection & Phishing**: Adversaries trick agents into transacting with malicious drainer endpoints.
- **Recursive Hallucination Loops**: Tool-use loops trigger thousands of calls per minute, draining budgets in seconds.
- **Concurrency Race Conditions**: Parallel subagents spend the same balance simultaneously, breaking periodic budgets.
- **Manual Approvals Kill Autonomy**: Requiring human sign-off on every $0.02 micro-transaction renders agents useless.

---

## 2. The Solution: Shlita

**Shlita** (Hebrew for *"Governance & Control"*) is an inline financial policy proxy and operator control plane that enforces deterministic boundaries on AI agent spending before on-chain settlement on Solana:

- 🛡️ **Sub-Millisecond Policy Checks**: Intercepts requests and enforces per-call spending caps (<$0.05 max per call).
- 🔒 **Atomic Budget Reservations**: Concurrency-safe two-phase commit reservation protocol (`evaluateAndReserve` ➔ `commitReservation` / `rollbackReservation`) backed by a durable ACID SQLite ledger to eliminate race-condition overspending under parallel bursts.
- 💳 **Server-Owned Tariffs**: Reconciles authoritative provider tariffs (`helius`, `tavily`) rather than trusting client-reported costs.
- 🔄 **Periodic Budget Rollovers**: Hard periodic limits (daily/monthly caps in USDC base units) with automatic period rollovers.
- 🌐 **Vendor Whitelisting & SSRF Firewall**: Restricts agents to verified domains (`api.helius.xyz`, `api.tavily.com`) and strictly blocks SSRF attacks (loopback, RFC 1918 private subnets, cloud metadata `169.254.169.254`, userinfo URLs, and non-443 ports).
- ⚡ **Rolling Anomaly Circuit Breaker**: Detects high-frequency call bursts (>6 calls/min) or error cascades and automatically freezes the agent.
- ⛓️ **Canonical Solana Subscriptions Protocol**: Directly integrates official Solana Subscriptions program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`) with deterministic `SubscriptionAuthority` PDAs (`['SubscriptionAuthority', user, mint]`), `FixedDelegation` PDAs, and honest pending/confirmed settlement states.
- 🔑 **Agent Credential Boundary**: Dedicated agent API keys with hashed key storage; upstream vendor secrets are injected server-side and never exposed to the agent runtime.
- 🎨 **Enterprise Command Center**: Dark/light theme dashboard with real-time budget utilization rings, live gateway daemon status indicator (`Gateway Live (:4000)`), telemetry, and 1-click circuit reset.

---

## 3. Architecture & Request Lifecycle

```
┌─────────────────────┐
│ Autonomous AI Agent │ (Executes LLM workflows & tool calls)
└──────────┬──────────┘
           │ 1. POST /v1/proxy (Vendor, Path, Body, x-shlita-api-key)
           ▼
┌────────────────────────────────────────────────────────┐
│                 Shlita Policy Gateway                  │
│                                                        │
│  [Durable Ledger & Rules Engine in packages/core]:     │
│  ✔ Validate Shlita Agent API Key (SHA-256 hash)?       │
│  ✔ SSRF & Origin Validation (HTTPS, 443, no metadata)? │
│  ✔ Calculate Authoritative Tariff Quote (Micro-USDC)?  │
│  ✔ Atomic Database Reservation Lock (Two-Phase Commit)?│
│  ✔ Operator Freeze Active?                             │
│  ✔ Circuit Breaker Status?                             │
│  ✔ Within Per-Request Cap? (< $0.05 USDC)              │
│  ✔ Rolling Call Burst Loop Detector (< 6 calls/min)?   │
│  ✔ Within Periodic Budget? (< $150.00 USDC)            │
└──────────┬───────────────────────────┬─────────────────┘
           │ 2. Approved               │ 3. Policy Violation / Tripped
           ▼                           ▼
 ┌───────────────────────────┐       ┌───────────────────────────────┐
 │ Real Upstream Vendor API  │       │ HTTP 403 Policy Violation     │
 │ + Injected Provider Secret│       │ Circuit Breaker Trips & Alert │
 │ + Solana Devnet Settlement│       │ Streamed to Operator UI       │
 │ State: SETTLEMENT_PENDING │       └───────────────────────────────┘
 └───────────────────────────┘
```

### Honest Transaction State Model

Shlita enforces strict truth-in-advertising for all transaction states:

| Lifecycle State | Meaning |
| :--- | :--- |
| `REQUEST_RECEIVED` | Request accepted by gateway; no approval implied. |
| `POLICY_REJECTED` | A rule denied the request; no vendor call or payment occurs. |
| `BUDGET_RESERVED` | Funds/budget held atomically for this idempotency key in SQLite ledger. |
| `VENDOR_SUCCEEDED` / `FAILED` | Provider response and billable usage recorded server-side. |
| `SETTLEMENT_PENDING` | Payment instruction prepared or submitted to Solana RPC; awaiting confirmation. |
| `SETTLEMENT_CONFIRMED` | RPC confirms a real transaction signature on the configured cluster. |
| `SETTLEMENT_FAILED` | Payment failed or needs reconciliation. **Never falsely displays SETTLED.** |

---

## 4. Codebase Structure

```
shlita/
├── packages/
│   ├── core/                  # Policy engine and durable SQLite ledger
│   ├── gateway/               # Hono HTTP API Gateway (/v1/proxy, /v1/agents, audit logs, SSRF guard)
│   ├── sdk/                   # Installable agent and operator clients (shlita-sdk)
│   └── solana/                # Canonical Solana Subscriptions Protocol (Program De1egAF...vR44)
├── src/                       # React 18 + Vite + Tailwind v4 + Recharts UI Dashboard
├── demo/
│   └── run-demo.ts            # Terminal attack & circuit breaker simulation
├── tests/                     # Vitest suite, including the external SDK install
├── examples/                  # Runnable agent, policy, idempotency, and tool examples
├── docs/api/openapi.yaml      # HTTP contract for the routes the gateway implements
├── GLOSSARY.md                # Ubiquitous domain language
└── docs/adr/                  # Architectural Decision Records (ADR 0001)
```

---

## 5. Quickstart

### Prerequisites
- Node.js >= 20.0.0
- npm >= 10.0.0

### Installation
```bash
git clone https://github.com/XiaoArnav/Shlita.git
cd Shlita
npm install
```

### Run Tests
```bash
npm test
```
`npm test` runs the ledger, gateway, session, Solana, and SDK suites. One test packs `shlita-sdk` and installs that archive in a temporary project outside this repository.

### Run Attack Simulation
```bash
npm run demo
```
Demonstrates authorized micro-transactions, prompt-injection vendor blocking, per-call cap enforcement, and automatic circuit breaker tripping on recursive loops.

### Build and Launch Server + Dashboard
```bash
npm run build
npm start
```
Open [http://127.0.0.1:4000](http://127.0.0.1:4000). The default screen asks for the operator key. Add `?demo=1` for the labeled sample dashboard. The sample balances are not ledger records.

A single container with a persistent volume is the supported deployment. It is not a multi-instance service. See `docs/adr/0001-single-instance-sqlite.md`, `Dockerfile`, and `compose.yaml`. Production and staging require `SHLITA_DB_PATH` to be a real file. `npm run backup` writes a SQLite backup, and `npm run restore -- <backup> <destination>` refuses to replace an existing file unless `SHLITA_RESTORE_OVERWRITE=true`. Vercel and GitHub Pages still serve only the static interface.

Development startup without `SHLITA_OPERATOR_KEY` generates a local operator key under `.shlita/` and does not print it. Production (`SHLITA_ENV=production`) refuses to start unless `.env.example` is copied to `.env` and the placeholders are replaced with strong values. Demo agent enrollment runs only when `SHLITA_SEED_DEMO=true` outside production. Simulation runs only when `SHLITA_ALLOW_SIMULATION=true` outside production.

---

## 6. Integration Example (Agent SDK)

The installable package is `packages/sdk`, named `shlita-sdk`. It is not published to npm. Build an archive and install that archive:

```bash
npm run build:sdk
cd packages/sdk && npm pack --pack-destination /tmp/shlita-sdk
npm install /tmp/shlita-sdk/shlita-sdk-0.1.0.tgz
```

The client requires Node.js 22 or newer. Pass the gateway URL explicitly. Keep the agent key in a trusted process, and use `ShlitaOperatorClient` only on a trusted backend. The full setup, including policies, timeouts, and settlement, is in [docs/sdk/quickstart.md](docs/sdk/quickstart.md). The HTTP contract is [docs/api/openapi.yaml](docs/api/openapi.yaml).

```typescript
import { ShlitaAgentClient } from 'shlita-sdk';

const shlita = new ShlitaAgentClient({
  apiKey: process.env.SHLITA_API_KEY!,
  baseUrl: process.env.SHLITA_GATEWAY_URL!,
});

const result = await shlita.proxy({
  agentId: 'research-agent',
  vendor: 'api.helius.xyz',
  method: 'POST',
  path: '/v0/token-metadata',
  body: { mints: ['example-mint'] },
  idempotencyKey: 'operation-unique-id',
});
```

Runnable copies live in `examples/`. They talk to a local gateway and send `simulate: true`, so they do not call a paid provider.

### cURL
```bash
curl -X POST "$SHLITA_GATEWAY_URL/v1/proxy" \
  -H "x-shlita-api-key: $SHLITA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "research-agent",
    "vendor": "api.helius.xyz",
    "path": "/v0/token-metadata",
    "idempotencyKey": "operation-unique-id",
    "simulate": true
  }'
```

---

## 7. Commercial Readiness, Security Audit & Pilot Blueprint (Steps 7–8)

Shlita has undergone independent security auditing, commercial readiness analysis, and operational planning for staging deployment and controlled pilot onboarding:

### Step 7 — Commercial Readiness & Security Validation Audit
- [Readiness Audit (18 Capabilities)](docs/step-7/READINESS_AUDIT.md)
- [Commercial Release Gates Evaluation](docs/step-7/RELEASE_GATES.md)
- [Application Security Review & Threat Classifications](docs/step-7/SECURITY_FINDINGS.md)
- [Controlled Pilot Architecture & Constraints](docs/step-7/PILOT_PLAN.md)
- [Operations & Monitoring Checklist](docs/step-7/OPERATIONS_CHECKLIST.md)
- [Commercial Assumptions vs Verified Realities](docs/step-7/COMMERCIAL_ASSUMPTIONS.md)
- [Remaining Engineering Roadmap (Milestones A–D)](docs/step-7/REMAINING_WORK.md)

### Step 8 — Pilot Deployment Blueprint & Release-Gate Closure
- [Staging Deployment Blueprint & Ingress Topology](docs/step-8/DEPLOYMENT_BLUEPRINT.md)
- [Step 7 Findings Closure & Gate Status](docs/step-8/STEP_7_CLOSURE.md)
- [Pilot End-to-End Test Matrix](docs/step-8/PILOT_TEST_MATRIX.md)
- [Pilot Operations & Guardrail Specifications](docs/step-8/PILOT_OPERATIONS.md)
- [Site Reliability & Incident Response Runbook](docs/step-8/INCIDENT_RESPONSE.md)
- [Developer Integration & Onboarding Guide](docs/step-8/DEVELOPER_ONBOARDING.md)
- [Release Gate Scorecard (10 Passed, 2 Staging Blockers)](docs/step-8/RELEASE_GATES.md)
- [Remaining Pilot Blockers & Acceptance Criteria](docs/step-8/REMAINING_BLOCKERS.md)
- [Staging Implementation & Execution Roadmap](docs/step-8/NEXT_IMPLEMENTATION_PLAN.md)

---

## 8. License

MIT © [XiaoArnav](https://github.com/XiaoArnav)
