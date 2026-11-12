# Shlita — Prioritized Engineering Roadmap & Milestone Plan

**Baseline State:** Steps 1–6 Complete (Commit `4d461c5`)  
**Scope:** Clear engineering gates from internal demonstration to production mainnet.

---

## Milestone A: Internal Technical Demonstration (Status: COMPLETED)
- [x] Two-phase commit SQLite ledger with zero double-spend race conditions (`tests/ledger.integrity.test.ts`).
- [x] SSRF firewall and credential injection reverse proxy (`tests/gateway.test.ts`).
- [x] Canonical Solana Subscriptions PDA derivation (`tests/solana.test.ts`).
- [x] Standalone `shlita-sdk` client with separate agent and operator classes (`tests/sdk.client.test.ts`).
- [x] Interactive web command center and visual PDA flow graph.

---

## Milestone B: Controlled Developer Pilot (Priority: HIGH)

| Task | Priority | Technical Risk | Task Description & Acceptance Criteria | Dependencies |
| :--- | :---: | :---: | :--- | :--- |
| **B1. Provision Staging TLS Gateway** | **CRITICAL** | High | Deploy single-instance Docker container behind Caddy/Nginx with automated Let's Encrypt certificates on a dedicated subdomain (e.g. `gateway.pilot.shlita.xyz`). **Acceptance:** External developers can execute `npm run example` against public HTTPS endpoint without SSL warnings. | Cloud VM / VPS with static public IP and DNS. |
| **B2. Litestream SQLite Backup Replication** | **MEDIUM** | Medium | Integrate Litestream to stream SQLite WAL changes continuously to an S3-compatible bucket (e.g. Cloudflare R2 or AWS S3). **Acceptance:** Gateway point-in-time recovery with <1s RPO in the event of host failure. | S3 storage bucket. |
| **B3. Automated Health Ping & PagerDuty Alerting** | **MEDIUM** | Low | Configure external uptime monitor (e.g. BetterStack) pinging `/health` and `/ready` every 60 seconds. **Acceptance:** Operator receives alert within 2 minutes of gateway unresponsiveness. | External monitoring service. |

---

## Milestone C: Paid Customer Pilot (Priority: MEDIUM)

| Task | Priority | Technical Risk | Task Description & Acceptance Criteria | Dependencies |
| :--- | :---: | :---: | :--- | :--- |
| **C1. Automated Usage Invoicing** | **HIGH** | Medium | Implement operator batch export for monthly accounted spend by organization (`GET /v1/operations?format=csv`). **Acceptance:** Reconciles micro-USDC reservations with billed vendor invoices within 0.01% variance. | Milestone B. |
| **C2. Legal Review & Terms of Service** | **CRITICAL** | High | Complete formal fintech legal review of proxy architecture and terms of service. **Acceptance:** Approved Terms of Service and Privacy Policy published on website. | Legal counsel. |
| **C3. Dynamic Vendor Tariff Configuration** | **MEDIUM** | Low | Enable operators to update upstream vendor pricing tables via authenticated API without redeploying gateway container. **Acceptance:** `PUT /v1/tariffs` updates per-call costs dynamically. | Milestone B. |

---

## Milestone D: Production Mainnet Service (Priority: FUTURE)

| Task | Priority | Technical Risk | Task Description & Acceptance Criteria | Dependencies |
| :--- | :---: | :---: | :--- | :--- |
| **D1. Live Solana Settlement Execution** | **CRITICAL** | Critical | Enable automated transaction signing and RPC broadcasting under canonical Solana Subscriptions PDA rail (`SOLANA_NETWORK=mainnet-beta`). **Acceptance:** Real micro-USDC transfers confirmed on Solana explorer with verified signature and zero double-spend vulnerability. | Smart contract security audit. |
| **D2. Multi-Region Active-Passive Failover** | **HIGH** | High | Multi-region container deployment with automated DNS failover and replicated persistent storage. **Acceptance:** Gateway fails over with <30s downtime during primary host termination. | Milestone C. |
