# Shlita — Step 10: Production Readiness & Four-Tier Go/No-Go Decision

**Phase:** Phase 14 — Final Launch Decision  
**Scope:** Evaluation of Four Progressive Operational Deployment Tiers  
**Authority:** Independent Application Security Auditor, Financial Systems Reviewer & SRE  

---

## 1. The Four Operational Tiers

```mermaid
flowchart LR
    TierA["Tier A: Internal Testing"] -->|Verified| TierB["Tier B: Controlled Developer Pilot"]
    TierB -.->|Blocked on Hosting & Alerts| TierC["Tier C: Paid Commercial Pilot"]
    TierC -.->|Blocked on Legal & Solana BPF| TierD["Tier D: Mainnet Production Settlement"]

    classDef go fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#ecfdf5;
    classDef conditional fill:#78350f,stroke:#f59e0b,stroke-width:2px,color:#fef3c7;
    classDef nogo fill:#450a0a,stroke:#ef4444,stroke-width:2px,color:#fee2e2;

    class TierA go;
    class TierB conditional;
    class TierC,TierD nogo;
```

---

## 2. Tier A — Internal Testing & Local Sandbox

> **Can Shlita continue to be tested safely in an isolated local environment?**

### **DECISION: GO**

#### Supporting Evidence:
1. **100% Automated Test Pass:** 15 test files and 98 unit/integration tests execute cleanly without regressions.
2. **ACID Ledger Invariants:** SQLite in WAL mode with `BEGIN IMMEDIATE` guarantees complete protection against double-spends under local concurrency.
3. **SDK Packaging:** Standalone `shlita-sdk` tarball builds, compiles, and installs into external projects.
4. **Zero Mainnet Risk:** `SHLITA_ALLOW_MAINNET` default is false, preventing accidental on-chain transactions.

#### Operating Rules:
- Development mode must be maintained with ephemeral or local-only databases.
- Real credentials must never be committed to repository scratch directories.

---

## 3. Tier B — Controlled External Developer Pilot

> **Can a limited number of external developers use the gateway with sandbox credentials and bounded, non-billable workloads?**

### **DECISION: CONDITIONAL GO**

#### Specific Conditions to Satisfy Before Launch:
1. **Provision Single Staging VM:** Deploy the published container `ghcr.io/xiaoarnav/shlita-gateway:staging` onto a dedicated cloud virtual machine (e.g. AWS EC2, Fly.io, or Hetzner).
2. **Configure Public TLS Domain:** Point a valid public DNS FQDN (e.g. `gateway.staging.shlita.xyz`) through a Caddy reverse proxy to obtain genuine Let's Encrypt TLS (do **not** use `.internal`).
3. **Enforce Single-Instance Constraint:** Ensure orchestrator configuration enforces `replicas: 1` to prevent SQLite lock contention.
4. **Deploy Telemetry Forwarder:** Configure Promtail, Vector, or Docker syslog to stream container logs to an off-host monitoring sink with alerts on error rate spikes.
5. **Issue Sandboxed Partner Credentials:** Distribute SDK tarball (`shlita-sdk-0.1.0.tgz`) and scoped agent keys with bounded budgets (e.g. 100,000 µUSDC).

---

## 4. Tier C — Paid Commercial Pilot

> **Can customers safely depend on Shlita for genuine billable operations?**

### **DECISION: NO-GO**

#### Reasons for NO-GO:
1. **No Live Infrastructure:** The backend gateway has never run on a publicly accessible 24/7 server.
2. **Absence of Real-Time Alerting:** No SRE team or automated PagerDuty integration is active to respond to overnight gateway stalls or upstream provider outages.
3. **Single Point of Failure (SPOF):** The single-writer SQLite architecture lacks automated multi-region failover. If the host VM crashes, all agent proxy traffic halts until manual reboot.
4. **Legal & Compliance Void:** No Terms of Service, Privacy Policy, or SLA commitments have been formalized.

---

## 5. Tier D — Production Mainnet Financial Operations

> **Can Shlita safely process actual on-chain payments in an authorized production environment?**

### **DECISION: NO-GO**

#### Reasons for NO-GO:
1. **Unverified On-Chain BPF Execution:** Headless local validator settlement testing remains blocked (`exit code 2`) due to the absence of compiled BPF program artifacts.
2. **Delegation Custody Risk:** Holding Solana delegatee private keys on a cloud host presents hot-wallet exposure that requires external cryptographic audit and HSM/KMS integration.
3. **Regulatory Review Required:** Routing third-party payments or managing spending allowances may trigger money transmission regulations (FinCEN, MSB licensing) depending on jurisdiction. Qualified legal counsel has not reviewed the architecture.

---

## 6. Summary Matrix

| Deployment Tier | Decision | Immediate Requirements |
|---|:---:|---|
| **A. Internal Testing** | **GO** | None. Maintain existing clean workspace. |
| **B. Controlled Pilot** | **CONDITIONAL GO** | Provision cloud VM, configure public Caddy TLS, enable log forwarder. |
| **C. Paid Pilot** | **NO-GO** | High-availability architecture, 24/7 SRE alerts, legal terms. |
| **D. Mainnet Production** | **NO-GO** | BPF validator verification, HSM key management, legal regulatory clearance. |
