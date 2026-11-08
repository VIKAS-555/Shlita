# Shlita (שְׁלִיטָה)

> **Autonomous AI Agent Financial Control Plane & Policy Proxy on Solana Rails.**

![Shlita - Financial Firewall for Autonomous AI Agents on Solana](assets/thumbnail.jpg)

[![Vercel](https://img.shields.io/badge/Vercel-shlita.vercel.app-000000?style=flat-square&logo=vercel&logoColor=white)](https://shlita.vercel.app/)
[![GitHub Pages](https://img.shields.io/badge/Mirror-xiaoarnav.github.io%2FShlita-14F195?style=flat-square&logo=googlechrome&logoColor=white)](https://xiaoarnav.github.io/Shlita/)
[![YouTube Demo](https://img.shields.io/badge/YouTube-Video%20Demo-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://youtu.be/o5vHfcUjDJE)
[![Solana Subscriptions](https://img.shields.io/badge/Solana-Subscriptions%20PDA-7C3AED?style=flat-square&logo=solana)](https://solana.com)
[![Tests](https://img.shields.io/badge/Tests-25%20Passing-success?style=flat-square)](tests)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

- ⚡ **Primary Live Application (Vercel Edge)**: [https://shlita.vercel.app/](https://shlita.vercel.app/)
- 🌐 **Backup Live Mirror (GitHub Pages)**: [https://xiaoarnav.github.io/Shlita/](https://xiaoarnav.github.io/Shlita/)
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
│   ├── core/                  # Deterministic Policy Engine, ShlitaClient SDK & Durable SQLite Ledger
│   ├── gateway/               # Hono HTTP API Gateway (/v1/proxy, /v1/agents, audit logs, SSRF guard)
│   └── solana/                # Canonical Solana Subscriptions Protocol (Program De1egAF...vR44)
├── src/                       # React 18 + Vite + Tailwind v4 + Recharts UI Dashboard
├── demo/
│   └── run-demo.ts            # Terminal attack & circuit breaker simulation
├── tests/                     # 25 Unit & Integration Tests (Vitest)
│   ├── core.test.ts           # 12 Core ledger, concurrency, and policy invariant tests
│   ├── gateway.test.ts        # 8 Gateway, SSRF firewall, SDK and authentication tests
│   └── solana.test.ts         # 5 Canonical Solana Subscriptions protocol and honest state tests
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
All **25 unit and integration tests** execute against core invariants, atomic budget reservations, gateway SSRF proxies, client SDK, and canonical Solana Subscriptions settlement seams.

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
Open [http://localhost:4000](http://localhost:4000) to view the live dashboard.

---

## 6. Integration Example (Agent SDK)

### Node.js / TypeScript
```typescript
import { ShlitaClient } from 'shlita';

const client = new ShlitaClient({
  apiKey: process.env.SHLITA_API_KEY, // e.g. shlt_live_sentinel_dev_01
  baseUrl: 'http://localhost:4000',
});

// Outbound paid tool invocation protected by Shlita perimeter
const response = await client.proxy({
  agentId: 'agent-sentinel-01',
  vendor: 'api.helius.xyz',
  method: 'POST',
  path: '/v0/addresses/USDC/balances',
  body: { address: '...' },
});

console.log('Policy Approved & Forwarded:', response.data);
```

### cURL
```bash
curl -X POST http://localhost:4000/v1/proxy \
  -H "x-shlita-api-key: shlt_live_sentinel_dev_01" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-sentinel-01",
    "vendor": "api.helius.xyz",
    "path": "/v0/addresses/USDC/balances",
    "body": { "address": "..." }
  }'
```

---

## 7. License

MIT © [XiaoArnav](https://github.com/XiaoArnav)
