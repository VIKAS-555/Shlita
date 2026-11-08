# Glossary

### Shlita
(שְׁלִיטָה - Hebrew for "Control / Governance"). The financial control plane and policy proxy for autonomous AI agents operating on Solana.

### Agent
An autonomous software actor executing tasks using automated tool calls that consume paid APIs, compute resources, or on-chain transactions.

### Policy Engine
The deterministic rule evaluator that inspects each outbound agent request against spending caps, allowed vendors, rate limits, and loop-detection thresholds before authorization.

### Spending Cap
The maximum token amount (denominated in USDC base units) an agent is permitted to spend within a rolling period (per-call limit, daily limit, or billing-cycle limit).

### Circuit Breaker
An automated safety trip that halts an agent's spending permissions when anomalous behavior (e.g. rapid error cascades, budget exhaustion, or repetitive loop patterns) is detected.

### Vendor
An external paid service or API provider (e.g., RPC providers like Helius, inference APIs, or web retrieval endpoints) authorized to receive micro-payments.

### Settlement Seam
The public interface boundary interfacing with Solana's native `@solana/subscriptions` and token allowances for on-chain settlement and balance verification.
