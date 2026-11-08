# Shlita (שְׁלִיטָה)

> **Autonomous AI Agent Financial Control Plane & Policy Proxy on Solana Rails.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-xiaoarnav.github.io%2FShlita-14F195?style=for-the-badge&logo=googlechrome&logoColor=white)](https://xiaoarnav.github.io/Shlita/)
[![Solana](https://img.shields.io/badge/Solana-Pay%20%26%20Subscriptions-14F195?logo=solana)](https://solana.com)
[![GitHub Repo](https://img.shields.io/badge/GitHub-XiaoArnav%2FShlita-7C3AED?logo=github)](https://github.com/XiaoArnav/Shlita)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**🌐 Live Production App**: [https://xiaoarnav.github.io/Shlita/](https://xiaoarnav.github.io/Shlita/)

---

## 1. The Problem: The AI Agent Financial Paradox

Autonomous AI agents (trading bots, research agents, code reviewers, DevOps responders) require continuous access to paid services:
- **Inference APIs**: OpenAI, Anthropic, DeepSeek
- **Solana RPCs**: Helius, QuickNode, Triton
- **Web Search & Data**: Tavily, Exa, Brave Search

Giving an autonomous AI agent raw wallet private keys or unlimited credit cards is financial suicide:
- **Prompt Injection & Phishing**: Adversaries trick agents into transacting with malicious drainer endpoints.
- **Recursive Hallucination Loops**: Bugs or tool-use loops can trigger thousands of calls per minute, draining thousands of dollars in minutes.
- **Manual Approvals Kill Autonomy**: Requiring human sign-off on every \$0.02 micro-transaction makes autonomous agent workflows impossible.

---

## 2. The Solution: Shlita

**Shlita** (Hebrew for *"Governance & Control"*) is an inline financial policy proxy and operator control plane that enforces deterministic boundaries on AI agent spending before on-chain settlement on Solana:

- 🛡️ **Sub-Millisecond Policy Checks**: Intercepts requests and enforces per-call spending caps (e.g. $0.05 max per call).
- 🔒 **Atomic Budget Reservations**: Concurrency-safe two-phase commit reservation protocol (`evaluateAndReserve` ➔ `commitReservation` / `rollbackReservation`) preventing race condition overspending under high concurrency.
- 🔄 **Periodic Budget Rollovers**: Hard periodic limits (daily/monthly caps in USDC base units) with automatic period rollovers.
- 🌐 **Vendor Whitelisting & SSRF Firewall**: Restricts agents to verified domains (`api.helius.xyz`, `api.tavily.com`) and strictly blocks SSRF attacks (loopback, RFC 1918 private subnets, cloud metadata services).
- ⚡ **Rolling Anomaly Circuit Breaker**: Detects high-frequency call bursts (>6 calls/min) or error cascades and automatically freezes the agent.
- ⛓️ **Real Solana USDC SPL Settlement**: Settles micro-transfers via `@solana/spl-token` (`createTransferCheckedInstruction` with 6-decimal micro-USDC precision) and Solana Subscriptions Authority PDAs without single-delegate collisions.
- 🎨 **Enterprise Command Center**: Beautiful dark/light theme dashboard with real-time budget utilization rings, live gateway daemon status indicator (`Gateway Live (:4000)`), telemetry, and 1-click circuit reset.

---

## 3. Architecture

```
┌─────────────────────┐
│ Autonomous AI Agent │ (Executes LLM workflows & tool calls)
└──────────┬──────────┘
           │ 1. POST /v1/proxy (Vendor, Cost, Payload)
           ▼
┌────────────────────────────────────────────────────────┐
│                 Shlita Policy Gateway                  │
│                                                        │
│  [Deterministic Rules Evaluator in packages/core]:     │
│  ✔ Registered Agent ID?                                │
│  ✔ Operator Freeze Active?                             │
│  ✔ Circuit Breaker Status?                             │
│  ✔ Vendor in Whitelist? (e.g. Helius, Tavily)          │
│  ✔ Within Per-Request Cap? (< $0.05 USDC)              │
│  ✔ Rolling Call Burst Loop Detector (< 6 calls/min)?   │
│  ✔ Within Periodic Budget? (< $150.00 USDC)            │
└──────────┬───────────────────────────┬─────────────────┘
           │ 2. Approved               │ 3. Policy Violation / Tripped
           ▼                           ▼
 ┌───────────────────┐       ┌───────────────────────────────┐
 │ Upstream Vendor   │       │ HTTP 403 Policy Violation     │
 │ + Batch On-Chain  │       │ Circuit Breaker Trips & Alert │
 │ Solana Settlement │       │ Streamed to Operator UI       │
 └───────────────────┘       └───────────────────────────────┘
```

---

## 4. Codebase Structure

```
shlita/
├── packages/
│   ├── core/                  # Deterministic Policy Engine (Pure TypeScript, zero side-effects)
│   ├── gateway/               # Hono HTTP API Gateway (/v1/proxy, /v1/agents, audit logs)
│   └── solana/                # Solana Subscriptions Authority PDA derivation & settlement
├── src/                       # React 18 + Vite + Tailwind v4 + Recharts UI Dashboard
├── demo/
│   └── run-demo.ts            # Terminal attack & circuit breaker simulation
├── tests/                     # 17 Unit & Integration Tests (Vitest)
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
All 17 unit and integration tests will execute against core invariants, atomic budget reservations, gateway SSRF proxies, and Solana USDC settlement seams.

### Run Attack Simulation
```bash
npm run demo
```
Demonstrates authorized micro-transactions, prompt-injection vendor blocking, per-call cap enforcement, and automatic circuit breaker tripping on recursive loops.

### Build and Launch Server + Dashboard
```bash
npm run build:ui
npm start
```
Open [http://localhost:4000](http://localhost:4000) to view the live dashboard.

---

## 6. Integration Example (Agent SDK)

### Node.js / TypeScript
```typescript
import { ShlitaClient } from '@shlita/sdk';

const client = new ShlitaClient({
  apiKey: process.env.SHLITA_API_KEY,
  network: 'mainnet-beta',
});

// Outbound paid tool invocation protected by Shlita perimeter
const response = await client.proxy({
  agentId: 'agent-researcher-01',
  vendor: 'api.helius.xyz',
  estimatedCostMicroUsdc: 20000n, // $0.02 USDC
  method: 'POST',
  path: '/v0/addresses/USDC/balances',
  body: { address: '...' },
});

console.log('Approved & Settled:', response.data);
```

### cURL
```bash
curl -X POST http://localhost:4000/v1/proxy \
  -H "Authorization: Bearer shlt_live_79f939b4e18ac89a42ff9041280bce42" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-researcher-01",
    "vendor": "api.helius.xyz",
    "estimatedCostMicroUsdc": "20000",
    "path": "/v0/addresses/USDC/balances"
  }'
```

---

## 7. License

MIT © [XiaoArnav](https://github.com/XiaoArnav)
