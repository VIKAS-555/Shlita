# Shlita — Step 9: Remaining Blockers & Unresolved Issues

**Purpose:** Consolidated inventory of all issues discovered during Step 9 verification that require resolution before or during pilot launch.

---

## 1. Critical Blockers (Must Resolve Before External Pilot)

### RB-CRIT-01: No Public HTTPS Gateway Endpoint
- **Source:** Step 7 `BLOCKER-CRIT-01`, Step 8 `DEPLOYMENT_BLUEPRINT.md`, Step 9 Phase 10
- **Current State:** Container image exists at `ghcr.io/xiaoarnav/shlita-gateway:staging`. No cloud VM is provisioned. No public DNS record exists. No TLS certificate is active.
- **Impact:** External developers cannot connect agents or SDK clients.
- **Required Action:** Provision VM → deploy container → configure Caddy TLS → create DNS record
- **Acceptance Test:** `curl -s -I https://gateway.pilot.shlita.xyz/ready` returns HTTP/2 200 with valid certificate

### RB-CRIT-02: No Telemetry or Alerting Infrastructure
- **Source:** Step 7 `BLOCKER-HIGH-01`, Step 8 `REMAINING_BLOCKERS.md`
- **Current State:** Gateway logs to stdout as structured JSON. No log forwarder, Prometheus scraper, or alert webhook configured.
- **Impact:** SRE team cannot detect errors, overspend, or circuit breaker trips in real time.
- **Required Action:** Deploy log forwarder → configure alert thresholds → verify webhook delivery
- **Acceptance Test:** Synthetic 5× consecutive 500 errors triggers alert within 60 seconds

---

## 2. High-Priority Issues (Should Resolve for Safe Pilot)

### RB-HIGH-01: Manual Credential Provisioning
- **Source:** Step 8 `BLOCKER-HIGH-02`
- **Current State:** All agent API keys and organization policies must be created manually via API calls or database operations.
- **Impact:** Slow partner onboarding; risk of operator error when generating hashed tokens.
- **Mitigation:** Acceptable for a 3-partner pilot with dedicated operator support.
- **Future Action:** Automated onboarding script or self-service dashboard.

### RB-HIGH-02: SDK Not Published to npm Registry
- **Source:** Step 8 `BLOCKER-LOW-01`
- **Current State:** SDK is installable via `npm pack` tarball or GitHub Release asset. Not published to public npm.
- **Impact:** Partners must install from URL rather than `npm install @shlita/sdk`.
- **Mitigation:** Tarball installation works correctly (verified in Step 9 Phase 6). Acceptable for pilot.
- **Future Action:** Publish to npm when ready for public launch.

---

## 3. Medium-Priority Issues (Document and Monitor)

### RB-MED-01: Solana Funded Settlement Unverified
- **Source:** Step 9 Phase 8
- **Current State:** Unit tests (9/9) pass covering PDA derivation, replay prevention, and mainnet rejection. Funded execution on a local validator with compiled BPF program has not been run.
- **Impact:** On-chain settlement behavior under real network conditions is unverified.
- **Mitigation:** Settlement is disabled by default (`SHLITA_SIMULATION=true`). The pilot can operate with simulation mode until funded tests are completed.
- **Future Action:** Compile `subscriptions_program.so` from `program-v0.5.0`, run `npm run test:solana-local` on a machine with `solana-test-validator`.

### RB-MED-02: Docker Verification Relies on CI Evidence
- **Source:** Step 9 Phase 9
- **Current State:** Docker is not installed on the verification machine. Container behavior is verified through GitHub Actions CI run `43179431499` (4/4 jobs passed).
- **Impact:** Local container debugging is not possible without Docker installation.
- **Mitigation:** CI evidence is strong — the `image` job builds the container, runs production startup tests, verifies persistent volume across restart, and confirms operator keys are not leaked in logs.

### RB-MED-03: Solana Settlement Reconciliation Daemon
- **Source:** Step 8 `BLOCKER-MED-01`
- **Current State:** Settlement transaction builders are implemented. Background reconciliation runs synchronously during tests, not as a decoupled cron worker.
- **Impact:** Unconfirmed Solana transactions could accumulate without automated retry.
- **Mitigation:** Not a pilot blocker while running in simulation mode.

---

## 4. Low-Priority Issues (Informational)

### RB-LOW-01: Invalid Login Returns HTTP 403 Instead of 401
- **Source:** Step 9 Phase 3 (Finding SEC-01)
- **Description:** `POST /v1/session` with wrong operator key returns 403 `FORBIDDEN` instead of 401 `Unauthorized`.
- **Assessment:** Defensible security choice to avoid endpoint existence confirmation. No code change needed.

### RB-LOW-02: Upstream Latency Variance Under Real LLMs
- **Source:** Step 8 `BLOCKER-MED-02`
- **Description:** Tests use mock servers with 5–15ms latency. Real API calls may be 1,200–8,000ms.
- **Assessment:** Shlita's 2-phase reserve-then-settle pattern does not hold DB locks during proxy egress, but real-world latency validation would increase confidence.

### RB-LOW-03: Dashboard Browser-Level Testing Not Performed
- **Source:** Step 9 Phase 5
- **Description:** Dashboard HTML/JS rendering, SSE streaming, and interactive controls were not tested in a browser during Step 9. Backend API endpoints are all independently tested.

---

## 5. Issue-to-Phase Traceability

| Issue ID | Step 9 Phase | Severity | Status |
|---|:---:|---|---|
| RB-CRIT-01 | 10 | CRITICAL | Open — requires infrastructure provisioning |
| RB-CRIT-02 | 10 | CRITICAL | Open — requires ops tooling |
| RB-HIGH-01 | 10 | HIGH | Open — acceptable for small pilot |
| RB-HIGH-02 | 6 | HIGH | Open — tarball workaround available |
| RB-MED-01 | 8 | MEDIUM | Open — simulation mode mitigates |
| RB-MED-02 | 9 | MEDIUM | Open — CI evidence mitigates |
| RB-MED-03 | 8 | MEDIUM | Open — simulation mode mitigates |
| RB-LOW-01 | 3 | LOW | Documented — no fix needed |
| RB-LOW-02 | 10 | LOW | Documented — requires live API testing |
| RB-LOW-03 | 5 | LOW | Documented — backend APIs tested |
