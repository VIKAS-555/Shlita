# Shlita — Step 10: Commercial Production Blockers & Non-Technical Requirements

**Phase:** Phase 10 — Commercial Production Assessment  
**Auditor Focus:** Technical, Operational, Legal, Regulatory & Financial Custody Preconditions  

---

## 1. Overview

Before Shlita can be marketed as a commercial software-as-a-service (SaaS) or financial infrastructure provider serving paying customers, specific technical, operational, and legal blockers must be systematically resolved.

Software tests passing in a CI environment does not equal authorization to operate a commercial payment gateway.

---

## 2. Technical & Architectural Blockers

### `COMM-TECH-01`: Single-Instance SQLite Scalability & High Availability Bound
- **Impact:** Shlita is designed as an active-passive single-writer architecture using local disk WAL mode. A hardware failure of the host VM results in an unrecoverable outage until the instance is restored.
- **Commercial Requirement:**
  - Implement automated real-time replication via Litestream or LiteFS streaming WAL frames to S3/Cloudflare R2.
  - Define Recovery Point Objective (RPO $\le$ 1s) and Recovery Time Objective (RTO $\le$ 60s).
  - Benchmark performance beyond 1,500 req/sec under slow upstream network conditions.

### `COMM-TECH-02`: Hot-Wallet Key Custody & HSM Integration
- **Impact:** The gateway currently loads delegatee Solana private keys from environment variables into Node.js process memory.
- **Commercial Requirement:**
  - Delegatee private keys must be stored in a cloud Hardware Security Module (AWS KMS, GCP Cloud KMS, or Vault HSM).
  - Signing requests must be policy-checked inside the enclave before generating transaction signatures.

### `COMM-TECH-03`: Third-Party Security Penetration Testing
- **Impact:** All security testing has been conducted internally. No external AppSec firm has performed black-box/gray-box penetration testing against the gateway perimeter.
- **Commercial Requirement:** Engage an accredited third-party security firm to audit the SSRF egress filter, Hono router, session handling, and SQLite transaction boundaries.

---

## 3. Operational & SRE Blockers

### `COMM-OPS-01`: 24/7 Incident Response & PagerDuty Integration
- **Impact:** If an agent encounters an infinite spending loop or upstream API crash during non-business hours, no automated alerting triggers human intervention.
- **Commercial Requirement:**
  - Replace placeholder contacts with live PagerDuty / Opsgenie escalation rotations.
  - Configure automated dead-man snitch pings on `GET /ready`.
  - Formalize customer-facing Status Page (e.g. Instatus / Atlassian Statuspage).

### `COMM-OPS-02`: Log Retention & Audit Compliance
- **Impact:** Container logs currently stream to stdout and are dropped when containers recycle.
- **Commercial Requirement:**
  - Stream structured audit logs to cold append-only storage (AWS S3 Glacier or CloudWatch Logs) with a 7-year retention policy for financial transaction records.
  - Implement log tampering detection via cryptographic hashing chains.

---

## 4. Legal, Regulatory & Financial Compliance Blockers

### `COMM-LEGAL-01`: Money Transmission & Custody Classification
- **Analysis Required:** Does Shlita constitute a "Money Services Business" (MSB) under U.S. FinCEN regulations or state money transmitter laws?
  - *Non-Custodial Argument:* Shlita executes transactions via user-delegated on-chain allowances without ever holding user funds in pooled escrow accounts.
  - *Regulatory Risk:* If the gateway controls the execution timing, destination, and amount of fund transfers, regulators may treat the operator as a money transmitter or payment facilitator.
- **Requirement:** Qualified FinTech / Crypto legal counsel must provide a written legal opinion letter before accepting customer funds.

### `COMM-LEGAL-02`: Customer Terms of Service & SLA Agreements
- **Impact:** In the event of an upstream provider outage, Solana blockchain re-org, or financial loss caused by agent misconfiguration, Shlita has no legal liability protections.
- **Requirement:**
  - Draft commercial Terms of Service with explicit liability caps and disclaimers regarding autonomous AI agent actions.
  - Establish Service Level Agreements (SLAs) for gateway uptime (e.g. 99.9% availability).

### `COMM-LEGAL-03`: Data Privacy & Security (GDPR / CCPA / SOC 2)
- **Impact:** Upstream AI tool calls forwarded through Shlita may contain Personally Identifiable Information (PII) from end-users.
- **Requirement:**
  - Execute Data Processing Agreements (DPAs) with customers.
  - Formalize data redaction policies to guarantee PII is scrubbed before writing to `audit_log`.
  - Undertake a SOC 2 Type I readiness assessment.
