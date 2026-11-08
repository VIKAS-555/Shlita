# 0001. Agent Financial Control Plane Architecture

Date: 2026-11-08  
Status: Accepted  

## Context
Autonomous AI agents increasingly execute multi-step workflows requiring paid APIs, compute resources, and on-chain interactions. Without controls, giving an AI agent unrestricted wallet access risks catastrophic fund loss through prompt injections, infinite retry loops, or misconfigurations.

Initial recurring payment proposals in Web3 suggested custom smart contracts managing per-merchant PDA token delegates. However:
1. **Solana SPL Token Constraint**: Solana's SPL Token program supports only one active delegate per token account. Creating separate delegates across multiple merchant PDAs causes subsequent authorizations to overwrite preceding ones.
2. **Native Solana Subscriptions**: The Solana Foundation's official `@solana/subscriptions` architecture already standardizes on-chain subscription authorities and multi-allowances.
3. **The Unsolved Problem**: The critical missing layer is operational governance: real-time policy checks, per-agent budget caps, vendor whitelisting, and automated circuit breakers that prevent agents from draining funds before on-chain settlement occurs.

## Decision
We build **Shlita** as a deep-module Policy & Financial Control Plane:
1. **Shlita Policy Gateway**: An inline proxy that intercepts agent tool/API calls, validates requests against deterministic spending policies (per-call limits, period budgets, allowed vendor lists), and trips circuit breakers on anomalous loop detection.
2. **Settlement Seam**: Bridges to Solana on-chain token allowances and `@solana/subscriptions` primitives for verifiable, non-custodial settlement.
3. **Control Dashboard**: Provides human operators with real-time visibility, live budget gauges, audit logging, and instantaneous one-click revocation.

## Consequences
- **Positive**: Complete multi-vendor support without SPL delegate collision; sub-millisecond policy evaluation; immune to rogue agent drain loops.
- **Trade-off**: Requires agents or tool-runners to route external paid API requests through the Shlita Gateway adapter seam.
