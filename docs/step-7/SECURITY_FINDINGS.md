# Shlita — Security Validation & Threat Assessment

**Commit Inspected:** `4d461c5b1edb63db802674c4cb827a91b211627a`  
**Security Baseline:** OWASP API Security Top 10 + Fintech Custody Baseline  
**Auditor Classification:** Independent Application Security Review

---

## 1. Threat Matrix & Finding Classifications

| ID | Category | Severity | Description & Location | Status / Compensating Control |
|---|---|:---:|---|---|
| **SEC-01** | SSRF & Network Egress | **LOW (Resolved)** | Potential egress to private networks or metadata endpoints via untrusted vendor hostnames in `POST /v1/proxy`. | **RESOLVED in `packages/gateway/src/app.ts`**: Strict DNS/hostname validation blocks loopback (`127.0.0.0/8`, `::1`), RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), cloud metadata (`169.254.169.254`), non-standard ports (strictly port 443 only), and userinfo credentials. |
| **SEC-02** | Header Injection / Privilege Bleed | **LOW (Resolved)** | Caller supplying `x-shlita-api-key` or `x-shlita-operator-key` in `ProxyParams.headers` to hijack authentication. | **RESOLVED in `packages/sdk/src/http.ts`**: `callerHeaders()` strips all protected headers (`authorization`, `cookie`, `proxy-authorization`, `x-shlita-api-key`, `x-shlita-operator-key`, `x-shlita-csrf`, `x-shlita-simulation`) before setting internal credentials. |
| **SEC-03** | Brute Force on Operator Login | **LOW (Resolved)** | Repeated guessing of operator authentication keys on `POST /v1/session`. | **RESOLVED in `packages/gateway/src/app.ts`**: Client IP rate limiting with 5 failed attempts per rolling 60-second window before locking out caller. |
| **SEC-04** | Cross-Organization Tenant Access | **LOW (Resolved)** | Tenant A attempting to view or freeze Tenant B's agents or ledger operations. | **RESOLVED in `packages/core/src/db.ts`**: Multi-tenant database schema enforces `owner_org` filtering on every query. Cross-tenant lookups return `null` or empty arrays. |
| **SEC-05** | Production Startup Without Secrets | **LOW (Resolved)** | Running production gateway with default or placeholder credentials. | **RESOLVED in `packages/gateway/src/security-config.ts`**: Gateway fails closed on startup if `SHLITA_ENV=production` and secrets contain default placeholder tokens. |
| **SEC-06** | Single-Instance File Locking | **MEDIUM (Operational)** | Multiple container replicas mounting the same SQLite ledger simultaneously, potentially leading to database locking or corruption. | **MITIGATION / RUNBOOK**: Architecture strictly mandates active-passive single-writer container deployment (documented in `docs/adr/0001-single-instance-sqlite.md`). Automated Docker restart tests in CI verify clean recovery. |
| **SEC-07** | Public Gateway Ingress Exposure | **MEDIUM (Operational)** | Gateway currently lacks a provisioned TLS termination reverse proxy (Nginx, Caddy, or Cloudflare Tunnel) in the default open-source repo. | **MITIGATION / PILOT REQUIREMENT**: Pilot runbook mandates that operators deploy Shlita behind TLS termination (HTTPS with valid certificates) and never expose raw port 4000 to the public internet unencrypted. |

---

## 2. In-Depth Security Analysis

### A. Authentication & Credential Storage
1. **Agent Tokens (`shlt_live_...`):**
   - Agent tokens are issued once via `POST /v1/agents`.
   - The gateway stores only the **SHA-256 hash** of the token in SQLite.
   - Lookups compute `hash(token)` and query `SELECT ... WHERE token_hash = ?`. Plaintext keys are never persisted.
2. **Operator Credentials:**
   - Operator credentials can be configured via `SHLITA_OPERATOR_KEY` environment variable or provisioned into `.shlita/operator.key` during development.
   - For web dashboard access, `POST /v1/session` verifies the operator key and sets a secure `HttpOnly`, `SameSite=Strict`, short-lived session cookie accompanied by a CSRF token.
   - State-changing mutations (e.g., `freeze`, `unfreeze`, `reset-circuit`) require both the session cookie and valid `x-shlita-csrf` header.

### B. Financial Policy & Replay Defense
1. **Concurrency Safety:**
   - Evaluated under Vitest concurrent stress tests (`tests/ledger.integrity.test.ts`).
   - SQLite `BEGIN IMMEDIATE` transactions ensure mutual exclusion during budget evaluation and reservation creation.
   - Over-allocation is mathematically impossible even under saturated event loop bursts.
2. **Idempotency Collision Guard:**
   - When a request is received with an existing idempotency key, Shlita hashes the request payload (vendor, path, method, body).
   - If the hash matches the initial request, Shlita returns the cached response with `x-shlita-idempotent-replay: true`.
   - If the hash differs, Shlita aborts with `HTTP 409 IDEMPOTENCY_CONFLICT` without modifying budget balances.

### C. Container & Operating System Security
1. **Non-Root Execution:**
   - `Dockerfile` utilizes a non-root system user (`USER node`).
   - Volumes mounted at `/var/lib/shlita` are owned by `node:node`.
2. **Read-Only Code & State Separation:**
   - Application source code and build artifacts reside in `/app`.
   - Persistent ledger files reside separately in `/var/lib/shlita`.
