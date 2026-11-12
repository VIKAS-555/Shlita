# Shlita — Step 10: Documentation Inconsistencies & Conflict Audit

**Phase:** Phase 8 — Investigation of Step 8 Inconsistencies & Blueprint Mismatches  
**Audit Purpose:** Reconcile documented architectural claims with actual source code, route registrations, and deployment reality.

---

## 1. Executive Forensic Summary

During the Step 10 independent audit, nine specific conflicts were identified between the documentation authored during Step 8 (`docs/step-8/`) and the actual implementation in `packages/`, `Dockerfile`, and `.github/workflows/deploy.yml`. 

If an SRE, DevOps engineer, or external partner attempted to deploy and operate Shlita using only the Step 8 documentation, operations would fail due to invalid endpoint routes, impossible TLS configurations, and boot-time configuration rejections.

---

## 2. Itemized Inconsistency Analysis

### Issue A: Misleading Staging Deployment Success
- **Documented Claim in Step 8:** GitHub Actions workflow "Verify & Deploy Staging" successfully deploys Shlita to a live staging environment at `https://xiaoarnav.github.io/Shlita/`.
- **Actual Reality in Code (`.github/workflows/deploy.yml` lines 181–215):**
  1. The environment URL `https://xiaoarnav.github.io/Shlita/` points to the **static client-side Vite application** hosted on GitHub Pages, not an active backend API gateway.
  2. The staging job builds and pushes `ghcr.io/xiaoarnav/shlita-gateway:staging` to GitHub Container Registry, pulls it back down, and runs `docker run --rm ghcr.io/xiaoarnav/shlita-gateway:staging node -v`.
  3. No persistent container process, cloud virtual machine, or live HTTPS gateway is instantiated.
- **Severity:** **HIGH (Operational Misunderstanding)**
- **Minimal Proposed Correction:** Update documentation to state: *"Staging container artifact published and verified on GHCR; public HTTPS API server deployment remains unprovisioned."*

---

### Issue B: Staging Simulation Configuration Conflict
- **Documented Claim in Step 8:** `docs/step-8/DEPLOYMENT_BLUEPRINT.md` specifies staging configuration:
  ```bash
  SHLITA_ENV=staging
  SHLITA_ALLOW_SIMULATION=true
  ```
- **Actual Reality in Code (`packages/gateway/src/security-config.ts` lines 67–74):**
  ```typescript
  const locked = mode === 'production' || mode === 'staging';
  if (locked) {
    if (allowSimulation) errors.push('Simulation cannot be enabled in production.');
  }
  ```
  `security-config.ts` treats both `production` and `staging` as `locked` environments. If `SHLITA_ALLOW_SIMULATION=true` is set when `SHLITA_ENV=staging`, the startup validator fails closed and refuses to boot.
- **Severity:** **CRITICAL (Service Boot Failure)**
- **Minimal Proposed Correction:** For staging sandbox testing where simulation is required, operators must set `SHLITA_ENV=development` with explicit secrets, or `security-config.ts` must be adjusted in a future release to allow simulation in staging only.

---

### Issue C: Incorrect Health Endpoint Route
- **Documented Claim in Step 8:** `docs/step-8/PILOT_OPERATIONS.md`, `INCIDENT_RESPONSE.md`, and `REMAINING_BLOCKERS.md` instruct operators and Caddy to poll:
  ```bash
  curl -s -I https://staging-gateway.shlita.internal/healthz
  ```
- **Actual Reality in Code (`packages/gateway/src/app.ts` lines 431 & 442):**
  The gateway registers only two health-related routes:
  - `GET /health` (process uptime)
  - `GET /ready` (storage check, returns 200 or 503)
  There is no route registered for `/healthz`. A curl to `/healthz` falls through to the SPA catch-all route `GET *`, returning HTTP 200 with HTML instead of JSON status.
- **Severity:** **MEDIUM (Monitoring False Positives)**
- **Minimal Proposed Correction:** Update all runbooks, Docker healthchecks, and reverse proxy configs to poll `GET /ready`.

---

### Issue D: Docker Base Image and Runtime User Mismatch
- **Documented Claim in Step 8:** Blueprint describes an Alpine Linux container (`node:22-alpine`) running under UID `1000`.
- **Actual Reality in Code (`Dockerfile` lines 3–14):**
  - Base Image: `node:22-bookworm-slim` (Debian GNU/Linux 12, Bookworm)
  - Runtime User: `shlita` with UID `10001` and GID `10001` (`/usr/sbin/nologin`)
- **Severity:** **LOW (Documentation Accuracy)**
- **Minimal Proposed Correction:** Align documentation with the actual Debian Bookworm UID 10001 configuration.

---

### Issue E: SDK Package Naming and Registry Availability
- **Documented Claim in Step 8:** Developer onboarding guides instruct partners to run:
  ```bash
  npm install @shlita/sdk
  ```
- **Actual Reality in Code (`packages/sdk/package.json` lines 2–4):**
  ```json
  {
    "name": "shlita-sdk",
    "private": true,
    "description": "Client for the Shlita financial-control gateway. Not published to npm."
  }
  ```
  The package is named `shlita-sdk` (not scoped `@shlita/sdk`), is marked `private: true`, and is not published to the npm registry. Attempting `npm install @shlita/sdk` returns `E404 Not Found`.
- **Severity:** **HIGH (Onboarding Blocker)**
- **Minimal Proposed Correction:** Instruct pilot partners to install from a packaged tarball (`npm install ./shlita-sdk-0.1.0.tgz`) or GitHub Release asset URL.

---

### Issue F: Impossible Public TLS on `.internal` Domain
- **Documented Claim in Step 8:** Multiple Step 8 documents (`DEVELOPER_ONBOARDING.md`, `PILOT_TEST_MATRIX.md`, `INCIDENT_RESPONSE.md`) instruct Caddy to obtain automated Let's Encrypt certificates for:
  `staging-gateway.shlita.internal`
- **Actual Reality:** Public Certificate Authorities (such as Let's Encrypt) cannot issue TLS certificates for internal, non-public top-level domains (`.internal`, `.local`, `.lan`) per CA/Browser Forum Baseline Requirements. Let's Encrypt requires a valid public FQDN (e.g. `gateway.staging.shlita.xyz`).
- **Severity:** **HIGH (Deployment Blocker)**
- **Minimal Proposed Correction:** Replace all references to `.internal` with a valid public domain delegation or self-signed internal CA.

---

### Issue G: Placeholder Incident Contacts
- **Documented Claim in Step 8:** `docs/step-8/INCIDENT_RESPONSE.md` cites:
  - SRE On-Call: `sre-oncall@shlita.internal` (PagerDuty: `shlita-staging-sre`)
  - Security Incident Commander: `security@shlita.internal`
- **Actual Reality:** These are illustrative placeholder emails and nonexistent PagerDuty service IDs. No active alerting integration exists.
- **Severity:** **MEDIUM (SRE Operational Risk)**
- **Minimal Proposed Correction:** Explicitly label contacts as illustrative templates until real monitoring endpoints are provisioned.

---

### Issue H: Release Authority vs. Deployment Blueprint
- **Documented Claim in Step 8:** `docs/step-8/STEP_7_CLOSURE.md` states staging deployment is approved.
- **Actual Reality:** An architectural document stating a blueprint is complete does not constitute repository owner approval to expend cloud computing budget, provision public infrastructure, or move funds.
- **Severity:** **GOVERNANCE**
- **Minimal Proposed Correction:** Maintain strict distinction between technical verification and owner authorization.

---

### Issue I: Nonexistent Operator Route Prefixes in Runbooks
- **Documented Claim in Step 8:** Runbooks cite:
  - `POST /v1/operator/agents/{AGENT_ID}/freeze`
  - `GET /v1/operator/audit-log`
  - `POST /v1/gateway/proxy`
  - `GET /v1/operator/circuit-breaker`
- **Actual Reality in Code (`packages/gateway/src/app.ts`):**
  - Freeze: `POST /v1/agents/:id/freeze`
  - Audit: `GET /v1/audit`
  - Proxy: `POST /v1/proxy`
  - Reset Circuit: `POST /v1/agents/:id/reset-circuit`
- **Severity:** **HIGH (Operator Command Failure)**
- **Minimal Proposed Correction:** Correct all curl command paths in operational runbooks to match `app.ts`.
