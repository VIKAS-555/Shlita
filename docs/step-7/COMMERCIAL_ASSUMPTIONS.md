# Shlita — Commercial Assumptions & Regulatory Boundary Assessment

**Objective:** Honest alignment between technical architecture and commercial business strategy.  
**Auditor Classification:** Technical Product Strategy & Fintech Legal Risk Evaluation

---

## 1. Commercial Delivery Models Evaluated

| Model | Feasibility with Current Architecture (`4d461c5`) | Required Architectural Upgrades | Commercial Viability |
| :--- | :---: | :--- | :--- |
| **Model A: Self-Hosted Enterprise Gateway** | **HIGH (Ready for Pilot)** | None. Current single-instance Docker deployment with local SQLite volume maps cleanly to enterprise on-premise or VPC sidecar topologies. | **Recommended Pilot Model**. Enterprise teams operate their own gateway inside their VPC, eliminating third-party custody or privacy concerns. |
| **Model B: Managed Cloud Proxy (Hosted Multi-Tenant SaaS)** | **MEDIUM (Requires Infrastructure)** | Requires transitioning from single-node SQLite to a horizontally scalable distributed database (e.g. SQLite Litestream replication, Turso, or CockroachDB), provisioning cloud Kubernetes pods, and deploying TLS infrastructure. | Viable for Q2/Q3 2027 following pilot validation. |
| **Model C: Embedded Open-Source SDK with Paid Cloud Telemetry** | **HIGH** | The `shlita-sdk` is already decoupled from internal server modules. An optional cloud telemetry sink can be added without altering local policy enforcement. | Highly attractive for developer ecosystem growth. |

---

## 2. Custodial vs Non-Custodial Boundaries

Shlita's cryptographic architecture is **strictly non-custodial**:
1. **Zero Private Key Storage:** The gateway never holds or asks for an agent's root Solana wallet private key.
2. **Canonical Solana Subscriptions PDA:** Spending authorities are established on-chain using the official Solana Subscriptions program (`De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`).
3. **Off-Chain Budget Ledger vs Escrow:** The SQLite reservation ledger holds an **accounting reservation**, not token escrow. Tokens only move when a confirmed on-chain settlement instruction executes.
4. **Honest State Disclosure:** The SDK and gateway explicitly disclose `fundsMoved: false` on all proxy calls. An HTTP 200 response from an upstream API does not imply that an on-chain token transfer has executed or finalized.

---

## 3. Matters Requiring Professional Legal & Regulatory Review

Before Shlita accepts real customer capital or facilitates mainnet cryptocurrency micro-settlements, the following areas must be reviewed by qualified legal counsel:

1. **Money Transmitter Regulations (FinCEN & State MSB Licensing):**
   - *Technical Baseline:* Shlita acts as an inline policy proxy that authorizes third-party API tool calls. In its self-hosted model, Shlita never takes possession or control of fiat or cryptocurrency funds.
   - *Legal Question:* Does the future facilitation of automated on-chain settlement between an agent wallet and a vendor ATA constitute money transmission under US or international frameworks?
2. **Terms of Service & Liability Disclaimers:**
   - What is the liability boundary if an upstream vendor API (e.g. Helius) suffers an outage during an in-flight request, resulting in an uncertain financial state (`ShlitaUncertainError`)?
   - Shlita's contracts must clearly stipulate that off-chain estimated tariff reservations are operational safety caps, not audited vendor invoices.
3. **Data Privacy & AI Prompt Governance:**
   - Shlita proxies outbound HTTP request bodies. If an agent passes sensitive user PII in tool-call payloads, does the proxy's ephemeral memory or audit log trigger GDPR/CCPA data retention requirements? (Current codebase strips credentials, but payload data must have clear retention policies).
