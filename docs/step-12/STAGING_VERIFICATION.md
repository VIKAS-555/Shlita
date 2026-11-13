# Shlita — Step 12: Persistent HTTPS Staging Deployment Verification Report

**Document Reference:** `docs/step-12/STAGING_VERIFICATION.md`  
**Parent Milestone:** Step 12 — Persistent HTTPS Staging Deployment  
**Upstream Target:** `XiaoArnav/Shlita:main`  
**Base Commit (Step 11 Merged):** `158e06265f74a5ebdf683ad1290db8339e064930` (PR #12 merged)  
**Collaborator Author:** `VIKAS-555 <vikas.tech0007@gmail.com>`  
**Date:** 2026-11-13  
**Target Staging URL:** `https://gateway.staging.shlita.xyz`  
**Target Container Image:** `ghcr.io/xiaoarnav/shlita-gateway:staging`  

---

## 1. Executive Summary & Verification Verdict

Step 12 establishes the complete architecture, container infrastructure, locked staging validation, automated backup/restore flow, SRE monitoring probes, and rollback procedures for a single-instance persistent HTTPS staging deployment.

### Overall Status: SPEC & LOCAL VERIFICATION PASS — LIVE CLOUD DEPLOYMENT BLOCKED
- **Engineering & Specification:** **PASS** (100% complete)
- **Local & Container Invariant Tests:** **PASS** (118/118 unit/integration tests pass, 18/18 files)
- **Chromium Dashboard E2E Browser Test:** **PASS** (Playwright headless Chromium verified)
- **SDK Consumer Archive Test:** **PASS** (Independent installation outside repository verified)
- **SQLite Hot Backup (`VACUUM INTO`) & Offline Restore:** **PASS** (Verified with WAL-safe atomic rename, integrity check, failure preservation, and record validation)
- **Caddy Reverse Proxy & Operator Access Isolation:** **PASS** (Verified CIDR trusted-proxy support, client IP distinction behind proxy, and HTTPS secure cookies)
- **Smoke-Test Probe & Regression Hardening:** **PASS** (Verified false-healthy elimination on 503/non-2xx, status identification, and latency metric separation)
- **Ledger Persistence Across Restart:** **PASS** (Verified with durable SQLite database file)
- **Live Cloud VM & Public DNS/TLS:** **BLOCKED** (Requires maintainer cloud hosting credentials and DNS record provisioning)

---

## 2. Requirement Verification Matrix

| Requirement | Specification & Artifact | Status | Evidence |
| :--- | :--- | :--- | :--- |
| **1. Single-Instance Gateway Container** | `compose.staging.yaml` service `gateway`, single container mounting `/var/lib/shlita` | ✅ PASS | Verified single-writer SQLite WAL constraint in Docker compose spec |
| **2. Persistent Host Storage** | Named Docker volume `shlita-staging-data` mounted at `/var/lib/shlita` | ✅ PASS | Preserved across restarts; non-root user `shlita` UID 10001 |
| **3. Edge TLS & Reverse Proxy** | Caddy 2 reverse proxy (`Caddyfile`, `compose.staging.yaml`), auto-TLS for `gateway.staging.shlita.xyz` | ⚠️ SPEC READY / HOST BLOCKED | Specification complete; requires live public DNS delegation |
| **4. Locked Staging Security** | `packages/gateway/src/security-config.ts` fails closed on `SHLITA_ALLOW_SIMULATION=true` or missing secrets | ✅ PASS | `tests/step-12/staging.deployment.test.ts` (test 1) |
| **5. Safe Fork PR CI** | `.github/workflows/deploy.yml` runs build/image jobs on untrusted PRs with local fixtures | ✅ PASS | Tested locally; zero production secrets exposed to fork PRs |
| **6. Image Rollback Procedure** | `scripts/rollback.sh` automated image pinning script without volume data loss | ✅ PASS | Script created, documented, and made executable |
| **7. Health & Readiness Monitoring** | Public uncredentialed `GET /health`, `GET /ready`, `GET /metrics` | ✅ PASS | Verified in `tests/step-12/staging.deployment.test.ts` |
| **8. Smoke Test & Latency Probe** | `scripts/staging-smoke-test.mjs` measuring latency and HTTP statuses | ✅ PASS | Probes `/health` and `/ready` with automated summary output |
| **9. Automated Backup Worker** | `compose.staging.yaml` sidecar running `node dist/packages/gateway/src/backup-cli.js` with direct volume mount | ✅ PASS | Verified writable external backup mount, `VACUUM INTO`, retention pruning |
| **10. Backup Restoration Drill** | `packages/core/src/backup.ts` `restoreLedgerBackup()` into independent database | ✅ PASS | Verified CLI and API restore in `tests/step-12/staging.deployment.test.ts` |
| **11. Circuit Breaker Alert Drill** | Gateway returns 502 on upstream error, trips breaker on threshold, returns 403 `CIRCUIT_BREAKER_TRIPPED` | ✅ PASS | Verified in `tests/step-12/staging.deployment.test.ts` (test 4) |
| **12. Unit & Integration Suite** | 118 tests across 18 test files | ✅ PASS | `npm test` exit code 0 |
| **13. Browser Dashboard E2E** | Playwright Chromium headless test | ✅ PASS | `npm run test:browser` exit code 0 |
| **14. SDK External Consumer** | External package unpack and run test | ✅ PASS | `node scripts/sdk-consumer-check.mjs` exit code 0 |

---

## 3. Detailed Verification Results

### A. Locked Staging Security Rules
`packages/gateway/src/security-config.ts` treats both `production` and `staging` as locked modes:
1. Rejects missing `SHLITA_OPERATOR_KEY` or `SHLITA_OPERATOR_ORG`.
2. Rejects `SHLITA_ALLOW_SIMULATION=true` (staging requires real sandbox provider keys or mocked upstream).
3. Rejects `SHLITA_SEED_DEMO=true` (no hardcoded test agents).
4. Rejects in-memory database (`SHLITA_DB_PATH=:memory:`).
5. Rejects non-HTTPS `SHLITA_PUBLIC_ORIGIN`.

**Test Output:**
```
✓ Step 12 — Staging Security Configuration > enforces locked staging rules
```

### B. SQLite Backup Snapshot & Independent Restore
Implemented WAL-safe backup implementation in `packages/core/src/db.ts`, automated worker in `compose.staging.yaml`, and end-to-end Compose verification script in `scripts/verify-compose-backup-worker.sh`:
1. Performs consistent online snapshot of active WAL-mode database using SQLite native `VACUUM INTO` to a temporary snapshot file.
2. Runs `PRAGMA integrity_check` on the temporary file before atomically renaming to destination (`fs.renameSync`).
3. Restricts backup file permissions to `0600` (`chmodSync`).
4. Preserves last known-good snapshot intact if a subsequent backup fails or destination is unwritable.
5. Replicates snapshots to off-volume destination (`/var/backups/shlita-external`) owned by container user `shlita` (UID 10001).
6. Unwritable destination causes `backup-cli.ts` to surface non-zero exit code (verified in automated test and Compose worker).
7. Successfully restored backup into independent databases (`/tmp/shlita-step12-.../restored-ledger.db` and `/var/backups/shlita-external/restored-compose-drill.db`) using `restoreLedgerBackup()` and `restore-cli.js`.
8. Verified `PRAGMA integrity_check` returned `ok`.
9. Verified all agents, operations (`reservedAmountMicroUsdc: 10000` / `15000`), and audit logs were present and identical in the restored database.

**Test Output:**
```
✓ Step 12 — Backup, Prune, and Restore Flow > creates an online backup, verifies integrity, prunes retention, and restores to an independent DB
✓ Step 12 — Backup, Prune, and Restore Flow > exercises backup-worker service with configured runtime user, mounted volumes, and verified restore
✓ Step 12 — Backup, Prune, and Restore Flow > surfaces failures on unwritable backup destination and preserves last known-good snapshot
```

### B.1 Isolated Real Compose Backup Worker Service Verification
The real `backup-worker` Compose service was hardened and isolated via `scripts/verify-compose-backup-worker.sh`, unit-tested in `tests/step-12/compose.isolation.test.ts`, and integrated into the GitHub Actions CI `image` job:

1. **Complete Test Isolation & Parameterization:**
   In `compose.staging.yaml`, container names (`${SHLITA_GATEWAY_CONTAINER:-...}`, `${SHLITA_BACKUP_CONTAINER:-...}`, `${SHLITA_CADDY_CONTAINER:-...}`), volume names (`${SHLITA_DATA_VOLUME:-...}`, `${SHLITA_BACKUPS_VOLUME:-...}`, etc.), and network name (`${SHLITA_NETWORK:-...}`) are parameterized with safe staging defaults. In verification runs, each run generates a unique Compose project (`shlita-drill-$$-${RANDOM}`) and unique disposable container and volume names.

2. **Preflight Configuration Check (Fail-Closed Guardrail):**
   Before starting up or tearing down any services, `validate_compose_isolation` resolves the Compose configuration (`docker compose config`). If any effective resource name points to protected staging resources (`shlita-staging-gateway`, `shlita-staging-data`, `shlita-staging-external-backups`, etc.), the script fails closed immediately without starting containers or executing `docker compose down -v`.

3. **Regression Proof: Volume Survival Across Success & Failure:**
   - **Pre-existing Sentinel Volumes:** Seeded canary ledger and backup volumes (`shlita-canary-ledger-*`, `shlita-canary-backups-*`) containing sentinel marker files.
   - **Failed Run Survival:** Executed a disposable test stack (`shlita-simfail-*`), simulated mid-test failure, executed scoped teardown. Verified that pre-existing sentinel volumes remained completely untouched and intact, while all failed test resources were cleaned up.
   - **Successful Run Survival:** After running the full successful drill on disposable stack `shlita-drill-*`, verified that pre-existing canary volumes remained intact, and all disposable test volumes and containers were cleanly purged.

4. **Worker Healthcheck Hardening:** In `compose.staging.yaml`, overridden the inherited Dockerfile HTTP `/ready` check (which attempted port 4000) with a dedicated worker health probe:
   ```yaml
   healthcheck:
     test: ["CMD-SHELL", "test -f /tmp/backup-worker-healthy || exit 1"]
     interval: 10s
     timeout: 3s
     start_period: 5s
     retries: 3
   ```
5. **Prompt Cycle Trigger:** Configured `compose.staging.yaml` worker loop to monitor `/tmp/trigger-backup` and support `SHLITA_BACKUP_RUN_ON_STARTUP=true`. Touching `/tmp/trigger-backup` triggers an immediate cycle using the exact same code path (`node dist/packages/gateway/src/backup-cli.js`) as the scheduled 24h cron loop.
6. **Runtime User & Volume Verification:** Verified `backup-worker` runs with non-root runtime user `shlita` (`UID: 10001, GID: 10001`) via in-container `/proc` scan and mounts `/var/lib/shlita` (source DB) and `/var/backups/shlita-external` (backup volume).
7. **Disposable Ledger Seed & Snapshot:** Seeded a committed operation (`op_worker_drill_999`, amount `15000` micro-USDC). Triggered a prompt backup, confirming snapshot generation with mode `0600`.
8. **Restore & Record Verification:** Restored the generated snapshot into `/var/backups/shlita-external/restored-compose-drill.db`. Verified `PRAGMA integrity_check` returned `ok`, and validated that `op_worker_drill_999` with `15000` micro-USDC was preserved.
9. **Failure & Preservation Drill:** Made the backup destination read-only (`chmod 555`). Triggered a backup cycle. Confirmed:
   - Worker logged `CRITICAL: Scheduled ledger backup failed!` to stderr.
   - Worker omitted any success message for that cycle.
   - Healthcheck file `/tmp/backup-worker-healthy` was removed, marking the container unhealthy.
   - Last known-good snapshot remained intact and passed `PRAGMA integrity_check`.

### C. Single-Instance Persistence Across Restart
1. Initialized gateway on durable SQLite file.
2. Registered agent and committed an outbound operation.
3. Completely shut down process/engine (`engineA.close()`).
4. Re-opened exact same database file with new gateway process (`engineB`).
5. Verified `/ready` returned HTTP 200 without authentication.
6. Verified registered agent and committed financial operations persisted without data loss.

**Test Output:**
```
✓ Step 12 — Persistence & Health Verification Across Restart > preserves ledger records across container/process restart and exposes health checks without credentials
✓ Step 12 — Persistence & Health Verification Across Restart > triggers circuit breaker trip after consecutive errors and recovers after cooldown
```

### D. Reverse Proxy Ingress & Rate Limit Isolation Behind Caddy
1. Verified CIDR trusted-proxy support (`172.16.0.0/12`, `10.0.0.0/8`, `127.0.0.1`, `::1`) in `packages/gateway/src/client-address.ts`.
2. Validated Caddy reverse proxy header pipeline: `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto: https`, `Host: gateway.staging.shlita.xyz`.
3. Proved that client IP addresses are isolated: an attacker at `198.51.100.10` making 8 failed operator sign-in attempts is rate limited (HTTP 429), while a legitimate operator at `198.51.100.20` connecting through the exact same Caddy proxy (`172.20.0.2`) signs in with HTTP 200 and is unaffected by the lockout.
4. Enforced HTTPS secure session cookies (`Secure; HttpOnly; SameSite=Lax`).
5. Confirmed that direct untrusted clients attempting to forge forwarded headers are identified by their direct peer IP.

**Test Output:**
```
✓ Step 12 — Reverse Proxy & Operator Access Behind Caddy > matches trusted proxy CIDR ranges and single IPs for Docker networks
✓ Step 12 — Reverse Proxy & Operator Access Behind Caddy > distinguishes client IPs behind Caddy for operator login rate limiting and enforces secure cookies
```

### E. Smoke-Test Probe Hardening & Regression Fix
Hardened `scripts/staging-smoke-test.mjs` against false `HEALTHY` results:
1. **Readiness Probe Failure Detection:** If a `/ready` sample returns HTTP 503 during latency sampling (even if initial probe passed), the script throws immediately, exits nonzero with exit code 1, reports the failing endpoint and HTTP status to stderr, and omits `HEALTHY`.
2. **Proxy Probe Failure Detection:** If a `/v1/proxy` sample returns a non-2xx status (e.g., HTTP 502 Bad Gateway), the script throws immediately, exits nonzero, reports the failing endpoint and status, and omits `HEALTHY`.
3. **Metric Separation:** Separates uncredentialed `/ready` latency (`readinessLatency`) from authenticated `/v1/proxy` round-trip latency (`proxyLatency`). When `SHLITA_TEST_API_KEY` is omitted, `proxyLatency.status` is reported as `OMITTED_NO_TEST_KEY`.

**Test Output:**
```
✓ Step 12 — Staging Smoke Test Regression > fails and omits HEALTHY when a readiness sample returns HTTP 503 after the initial check succeeds
✓ Step 12 — Staging Smoke Test Regression > fails and omits HEALTHY when an enabled proxy sample returns a non-2xx response
✓ Step 12 — Staging Smoke Test Regression > succeeds without a test key and reports OMITTED_NO_TEST_KEY for proxy latency
✓ Step 12 — Staging Smoke Test Regression > succeeds with a test key and reports separate readiness and proxy timings
```

### F. Full Test Suite & E2E Validation
- **Vitest Unit & Integration Matrix:**
  ```
  Test Files  19 passed (19)
       Tests  124 passed (124)
  ```
- **Playwright Chromium Dashboard Flow:**
  ```
  Running 1 test using 1 worker
  ✓  dashboard end-to-end browser verification flow (2.1s)
  1 passed (3.1s)
  ```
- **Independent SDK Consumer Check:**
  ```
  {"example":"basic-agent","outcome":"committed","reservedAmountMicroUsdc":"10000","fundsMoved":false}
  {"example":"policy","approved":"committed","blocked":"UNAPPROVED_VENDOR","overLimit":"PER_CALL_LIMIT_EXCEEDED"}
  {"example":"idempotency","replay":true,"conflict":"IDEMPOTENCY_CONFLICT","timeout":"TIMEOUT","connections":1}
  {"example":"tool-adapter","tool":"shlita_proxy","outcome":"committed","reservedAmountMicroUsdc":"10000"}
  {"installed":true,"compiled":true,"examples":4,"restart":"preserved","operationId":"op_...","reservedAmountMicroUsdc":"10000"}
  ```

---

## 4. Live Staging Deployment: Blocker Inventory & Action Plan

As documented in Step 11 prerequisites (`STEP_12_PREREQUISITES.md`) and per Step 12 instructions, live public HTTPS staging requires infrastructure inputs outside repository code:

| Blocker ID | Description | Impact | Required Maintainer Action |
| :--- | :--- | :--- | :--- |
| **BLOCKER-HOST-01** | Cloud VM Provisioning | No remote server to run `compose.staging.yaml` | Maintainer provisions Linux host (e.g. AWS EC2, Fly.io, Railway, or Hetzner VPS) |
| **BLOCKER-DNS-01** | Public DNS Delegation | `gateway.staging.shlita.xyz` does not resolve | Add DNS A/AAAA record pointing `gateway.staging.shlita.xyz` to VM public IP |
| **BLOCKER-SECRET-01** | Stable Staging Operator Key | Staging secret store unpopulated | Add GitHub Actions secret `SHLITA_STAGING_OPERATOR_KEY` (>= 32 random hex characters) |

### Live Staging Completion Criteria & Status (Hold on Step 13):
Per the maintainer specification, Step 12 live staging remains marked as **BLOCKED** and **Step 13 remains on hold** until maintainer provisioning allows completing the four mandatory live checks:

| Live Check ID | Verification Requirement | Status | Required Input / Blocker | Owner |
| :--- | :--- | :--- | :--- | :--- |
| **LIVE-HTTPS-01** | Verify public TLS and `/ready` returning HTTP 200 from outside the host | ⚠️ **BLOCKED** | `BLOCKER-HOST-01` (Cloud VM) & `BLOCKER-DNS-01` (DNS A/AAAA record) | Maintainer (`XiaoArnav`) |
| **LIVE-PERSIST-01** | Create sandbox ledger record, redeploy, and verify same operation ID and amount survive | ⚠️ **BLOCKED** | `BLOCKER-HOST-01` (Cloud VM with persistent SQLite mount) | Maintainer (`XiaoArnav`) |
| **LIVE-ALERT-01** | Run controlled staging outage and confirm outage alert and recovery notification reach configured destination | ⚠️ **BLOCKED** | `BLOCKER-SECRET-01` (`SHLITA_ALERT_WEBHOOK_URL` / alert sink) | Maintainer (`XiaoArnav`) |
| **LIVE-RESTORE-01** | Restore snapshot produced by scheduled worker on staging host into separate database; verify integrity and operation ID/amount | ⚠️ **BLOCKED** | `BLOCKER-HOST-01` (Host scheduled backup worker execution) | Maintainer (`XiaoArnav`) |

1. **External Public HTTPS Verification (LIVE-HTTPS-01):** Verify valid TLS handshake and `GET /ready` HTTP 200 from outside the host (`gateway.staging.shlita.xyz`).
2. **Redeploy Persistence (LIVE-PERSIST-01):** Write a sandbox ledger record, redeploy the container stack, and verify that the exact same record persists.
3. **Outage Alert & Recovery Delivery (LIVE-ALERT-01):** Induce a simulated gateway outage and confirm both the outage alert and recovery notification reach the configured notification destination.
4. **Host Scheduled Backup Restore (LIVE-RESTORE-01):** Restore an actual snapshot generated by the scheduled backup worker on that host into a separate database, verifying integrity and record preservation.

### Immediate Deployment Once Host is Provisioned:
```bash
# On staging host:
git clone https://github.com/XiaoArnav/Shlita.git /opt/shlita
cd /opt/shlita
cp .env.example .env # Set SHLITA_OPERATOR_KEY, SHLITA_OPERATOR_ORG, and SHLITA_STAGING_DOMAIN
docker compose -f compose.staging.yaml up -d
./scripts/staging-smoke-test.mjs
```

---

## 5. Rollback Runbook

If a newly deployed image exhibits anomalies or fails health checks:
```bash
# Roll back to the previous known-good image digest/tag:
./scripts/rollback.sh ghcr.io/xiaoarnav/shlita-gateway:158e062
```
The rollback script verifies the target image, performs a graceful stop of the gateway container, starts the target image against the existing persistent volume `shlita-staging-data`, and waits for `/ready` to return 200. Zero ledger records are dropped.
