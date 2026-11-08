# Shlita (שְׁלִיטָה)

> **Financial & Spending Control Plane for Autonomous AI Agents on Solana.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Solana](https://img.shields.io/badge/Solana-Pay%20%26%20Subscriptions-14F195?logo=solana)](https://solana.com)

---

## The Problem
When autonomous AI agents interact with the web, they consume paid resources: inference APIs, RPC nodes, web scrapers, and data feeds. 
Giving an AI agent raw wallet private keys is dangerous—an agent trapped in a recursive error loop can drain an entire treasury in minutes. Conversely, requiring human sign-off for every $0.01 micro-transaction completely destroys autonomy.

## The Solution
**Shlita** is an agent financial control plane that provides **bounded, policy-driven financial autonomy**:
- **Granular Spending Policies**: Cap per-call and periodic (daily/monthly) budgets in USDC.
- **Vendor Whitelisting**: Ensure agents can only transact with verified service providers.
- **Autonomous Circuit Breakers**: Instantly detect and freeze rogue execution loops or error storms.
- **Native Solana Settlement**: Settles via Solana's official Subscriptions & Allowance infrastructure.

---

## Architecture

```
┌─────────────────────┐
│ Autonomous AI Agent │ (Runs tools, executes LLM workflows)
└──────────┬──────────┘
           │ 1. Paid API Request + Agent Key
           ▼
┌────────────────────────────────────────────────────────┐
│                 Shlita Policy Gateway                  │
│                                                        │
│  [Rules Engine]:                                       │
│  ✔ Vendor in Whitelist? (e.g. Helius, Tavily)          │
│  ✔ Within Per-Request Limit? (< $0.05 USDC)            │
│  ✔ Within Daily Cap? (< $10.00 USDC)                   │
│  ✔ Circuit Breaker: Normal request frequency?          │
└──────────┬───────────────────────────┬─────────────────┘
           │ 2. Approved               │ 3. Policy Violation
           ▼                           ▼
 ┌───────────────────┐       ┌───────────────────┐
 │ Upstream API      │       │ 403 Forbidden     │
 │ (Settled onchain) │       │ (Agent Frozen)    │
 └───────────────────┘       └───────────────────┘
```

---

## Core Modules
- `packages/core`: Deterministic policy evaluator and circuit breaker state machine.
- `packages/gateway`: High-performance HTTP/RPC proxy intercepting agent outbound requests.
- `packages/dashboard`: Real-time governance dashboard showing active agents, spending gauges, and kill switches.
- `demo/agent`: Demonstration autonomous agent executing real research workflows against protected endpoints.
