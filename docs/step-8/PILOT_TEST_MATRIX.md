# Shlita Pilot End-to-End Test Matrix

**Document Reference:** `docs/step-8/PILOT_TEST_MATRIX.md`  
**Parent Milestone:** Step 8 — Pilot Deployment Blueprint & Release-Gate Closure  
**Baseline Git Commit:** `4d461c5b1edb63db802674c4cb827a91b211627a`  
**Execution Environment:** Isolated Staging Gateway (`https://staging-gateway.shlita.internal`)  
**Network Constraints:** Solana Devnet Only; Zero Real Mainnet Funds  

---

## 1. Executive Summary

This test matrix specifies the complete suite of deterministic verification procedures that must be executed against the deployed staging environment before any external pilot partner traffic is permitted. Every test scenario defines explicit inputs, expected HTTP status codes, structured JSON payload invariants, database state assertions, and verifiable failure criteria.

---

## 2. Test Category Index

1. **Authentication & Authorization (`AUTH-xx`)**
2. **Financial Correctness & Policy Enforcement (`FIN-xx`)**
3. **Concurrency & Idempotency Invariants (`RACE-xx`)**
4. **Upstream Resilience & Circuit Breaker (`RESIL-xx`)**
5. **Operational Safety & Disaster Recovery (`OPS-xx`)**
6. **Developer SDK Integration (`SDK-xx`)**
7. **Solana Devnet Settlement Integrity (`SOL-xx`)**

---

## 3. Detailed Test Scenarios

### Category 1: Authentication & Authorization

#### `TEST-AUTH-01`: Agent Valid Bearer Token Authentication
- **Objective:** Verify that an agent presenting a valid Bearer token can successfully authenticate and query status.
- **Preconditions:** Agent `agent_prod_reader` is active in SQLite database with assigned secret token `agt_sec_valid_001`.
- **Action:**
  ```bash
  curl -s -i -X GET https://staging-gateway.shlita.internal/v1/agent/status \
    -H "Authorization: Bearer agt_sec_valid_001"
  ```
- **Expected Status:** `200 OK`
- **Expected Payload:**
  ```json
  {
    "status": "active",
    "agentId": "agent_prod_reader",
    "organizationId": "org_pilot_alpha",
    "spendingLimitCents": 5000,
    "currentSpendCents": 0
  }
  ```
- **Failure Mode:** Any `401 Unauthorized`, `403 Forbidden`, or leaking of unhashed tokens.

#### `TEST-AUTH-02`: Agent Invalid / Malformed Token Rejection
- **Objective:** Verify immediate rejection when invalid or forged credentials are submitted.
- **Preconditions:** Gateway running in staging mode.
- **Action:**
  ```bash
  curl -s -i -X GET https://staging-gateway.shlita.internal/v1/agent/status \
    -H "Authorization: Bearer agt_sec_FORGED_999"
  ```
- **Expected Status:** `401 Unauthorized`
- **Expected Payload:**
  ```json
  {
    "error": "unauthorized",
    "message": "Invalid agent token"
  }
  ```
- **Failure Mode:** Any `200 OK`, `500 Internal Server Error`, or stack trace exposure.

#### `TEST-AUTH-03`: Operator Header Key Authentication
- **Objective:** Verify that administrative endpoints require and validate the operator key.
- **Preconditions:** `SHLITA_OPERATOR_KEY=op_sec_staging_master_777` configured in environment.
- **Action:**
  ```bash
  curl -s -i -X GET https://staging-gateway.shlita.internal/v1/operator/audit-log \
    -H "x-operator-key: op_sec_staging_master_777"
  ```
- **Expected Status:** `200 OK`
- **Failure Mode:** Bypassing operator check with empty or arbitrary header values.

#### `TEST-AUTH-04`: Cross-Organization Budget Isolation
- **Objective:** Verify that an agent in Organization A cannot reserve, spend, or query budgets belonging to Organization B.
- **Preconditions:** 
  - Org A: `org_pilot_alpha` with agent `agent_alpha_1`
  - Org B: `org_pilot_beta` with agent `agent_beta_1`
- **Action:** `agent_alpha_1` attempts to reserve funds explicitly targeting `org_pilot_beta` budget ID.
- **Expected Status:** `403 Forbidden` or `404 Not Found` (Target budget inaccessible to agent organization).
- **Database Assertion:**
  ```sql
  SELECT count(*) FROM ledger_entries WHERE organization_id = 'org_pilot_beta' AND agent_id = 'agent_alpha_1';
  -- Result MUST be 0
  ```
- **Failure Mode:** Any deduction from Org B's balance or visibility into Org B ledger records.

---

### Category 2: Financial Correctness & Policy Enforcement

#### `TEST-FIN-01`: Standard Reservation within Velocity & Spending Limits
- **Objective:** Verify that a standard request under policy limits is approved, reserved, and settled.
- **Preconditions:** Agent daily limit: $10.00 (1000 cents), per-transaction limit: $5.00 (500 cents). Current spend: $0.
- **Action:**
  ```bash
  curl -s -i -X POST https://staging-gateway.shlita.internal/v1/gateway/proxy \
    -H "Authorization: Bearer agt_sec_valid_001" \
    -H "Content-Type: application/json" \
    -d '{
      "provider": "mock-llm",
      "model": "gpt-4o-mini",
      "estimatedCostCents": 150,
      "payload": { "prompt": "Sanity test" }
    }'
  ```
- **Expected Status:** `200 OK`
- **Response Headers:**
  - `x-shlita-reservation-id: res_...`
  - `x-shlita-settled-cost-cents: 150`
- **Database Assertion:**
  ```sql
  SELECT status, reserved_cents, settled_cents 
  FROM reservations 
  WHERE agent_id = 'agent_prod_reader' 
  ORDER BY created_at DESC LIMIT 1;
  -- Expected: status = 'settled', reserved_cents = 150, settled_cents = 150
  ```

#### `TEST-FIN-02`: Rejection of Request Exceeding Per-Transaction Limit
- **Objective:** Verify hard denial when a single request exceeds the transaction ceiling.
- **Preconditions:** Per-transaction limit: 500 cents.
- **Action:** Agent submits request with `estimatedCostCents: 550`.
- **Expected Status:** `403 Forbidden` or `422 Unprocessable Entity`
- **Expected Payload:**
  ```json
  {
    "error": "policy_violation",
    "code": "TRANSACTION_LIMIT_EXCEEDED",
    "limitCents": 500,
    "requestedCents": 550
  }
  ```
- **Database Assertion:** Zero reservations created; zero balance deducted.

#### `TEST-FIN-03`: Rejection on Velocity Window Exhaustion
- **Objective:** Verify cumulative velocity enforcement over a rolling 24-hour window.
- **Preconditions:** Daily limit: 1000 cents. Previous approved spend today: 900 cents.
- **Action:** Agent requests reservation of 150 cents.
- **Expected Status:** `429 Too Many Requests` or `403 Forbidden` (`BUDGET_EXHAUSTED`).
- **Database Assertion:** Total daily settled cents remains exactly 900.

---

### Category 3: Concurrency & Idempotency Invariants

#### `TEST-RACE-01`: Concurrent Balance Depletion Race
- **Objective:** Verify that 10 concurrent requests competing for the last $2.00 of budget cannot overspend.
- **Preconditions:** Remaining available budget: 200 cents. 10 parallel threads each request 100 cents.
- **Action:** Execute 10 simultaneous HTTP requests via `Promise.all()` or ApacheBench/k6.
- **Expected Outcome:** Exactly 2 requests succeed (`200 OK`); exactly 8 requests fail (`403 Forbidden` / `429 Too Many Requests`).
- **Database Invariant:**
  ```sql
  SELECT sum(settled_cents) FROM reservations WHERE agent_id = 'agent_race_test';
  -- Result MUST be <= 200 (Zero overspend)
  ```
- **Failure Mode:** Any balance resulting in < 0 cents or more than 2 approved transactions.

#### `TEST-RACE-02`: Deterministic Idempotency Key Replay
- **Objective:** Verify that replaying an identical request with the same `x-idempotency-key` returns the cached response without duplicate balance deduction.
- **Preconditions:** Initial request with `x-idempotency-key: idem_pilot_uuid_001` completed successfully with cost 100 cents.
- **Action:** Send identical request with header `x-idempotency-key: idem_pilot_uuid_001` 5 times in rapid succession.
- **Expected Status:** `200 OK` for all 5 responses with identical reservation ID.
- **Database Invariant:**
  ```sql
  SELECT count(*), sum(settled_cents) FROM reservations WHERE idempotency_key = 'idem_pilot_uuid_001';
  -- count MUST be 1; sum MUST be 100
  ```
- **Failure Mode:** Count > 1 or balance deducted multiple times.

---

### Category 4: Upstream Resilience & Circuit Breaker

#### `TEST-RESIL-01`: Upstream Provider 504 Gateway Timeout (Reservation Rollback)
- **Objective:** Verify that when the upstream LLM provider times out, the unfulfilled reservation is automatically released.
- **Preconditions:** Mock upstream configured to delay 15 seconds (exceeding 10s gateway timeout). Agent balance: 5000 cents.
- **Action:** Agent submits request with `estimatedCostCents: 200`.
- **Expected Status:** `504 Gateway Timeout` or `502 Bad Gateway`
- **Database Invariant:**
  ```sql
  SELECT status, reserved_cents, settled_cents 
  FROM reservations 
  WHERE id = 'res_timeout_test';
  -- status MUST be 'rolled_back' or 'cancelled'; settled_cents = 0
  ```
- **Available Balance Assertion:** Balance remains exactly 5000 cents (no phantom deductions).

#### `TEST-RESIL-02`: Upstream Error Burst Tripping Circuit Breaker
- **Objective:** Verify circuit breaker trips to `OPEN` state after 5 consecutive upstream 5xx errors.
- **Preconditions:** Circuit breaker threshold: 5 consecutive failures.
- **Action:** Send 5 requests to failing upstream mock. Send 6th request.
- **Expected Outcome:** 6th request fails immediately with `503 Service Unavailable` (`CIRCUIT_BREAKER_OPEN`) without attempting network egress.
- **Failure Mode:** Gateway continuing to flood failing upstream provider.

---

### Category 5: Operational Safety & Disaster Recovery

#### `TEST-OPS-01`: Emergency Operator Freeze Drill
- **Objective:** Verify that operator emergency freeze halts all agent egress within < 50ms.
- **Preconditions:** Normal active gateway processing requests.
- **Action:**
  1. Trigger freeze:
     ```bash
     curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/freeze \
       -H "x-operator-key: op_sec_staging_master_777" \
       -H "Content-Type: application/json" \
       -d '{"reason": "Pilot security drill"}'
     ```
  2. Attempt agent proxy request immediately.
- **Expected Status:** `423 Locked` or `403 Forbidden` (`SYSTEM_FROZEN`).
- **Database Assertion:** `system_status` row indicates `frozen = 1`.
- **Action 2:** Send unfreeze command:
  ```bash
  curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/unfreeze \
    -H "x-operator-key: op_sec_staging_master_777"
  ```
- **Expected Status on next agent call:** `200 OK` (Operations resumed).

#### `TEST-OPS-02`: Hard Process Kill and WAL Recovery Drill
- **Objective:** Verify SQLite database integrity and state recovery following `SIGKILL`.
- **Preconditions:** Active transaction sequence occurring.
- **Action:**
  1. Abruptly kill running gateway: `kill -9 $(pgrep -f "shlita-gateway")` or `docker kill shlita-gateway`.
  2. Inspect database files (`shlita.db`, `shlita.db-wal`, `shlita.db-shm`).
  3. Restart gateway container.
- **Expected Outcome:** Gateway boots successfully, performs WAL checkpoint, runs `PRAGMA integrity_check` returning `ok`.
- **Failure Mode:** Corrupted database, unhandled startup crash, missing historical ledger records.

#### `TEST-OPS-03`: Hot Backup Verification Drill
- **Objective:** Verify that `backup-cli.ts` produces a byte-for-byte consistent, verifiable snapshot while the gateway is active.
- **Action:**
  ```bash
  node packages/gateway/dist/backup-cli.js
  ```
- **Expected Output:**
  ```json
  {"event":"backup","integrity":"ok"}
  ```
- **Verification:** Execute `sqlite3 backup.db "PRAGMA integrity_check;"` returning `ok`.

#### `TEST-OPS-04`: Safe Restore Refuse-Overwrite Drill
- **Objective:** Verify that `restore-cli.ts` strictly refuses to overwrite an existing live database unless `SHLITA_RESTORE_OVERWRITE=true` is explicitly set.
- **Action:** Attempt restore to active database path without overwrite flag.
- **Expected Outcome:** CLI process exits with non-zero error: `Refusing to overwrite an existing ledger.`

---

### Category 6: Developer SDK Integration

#### `TEST-SDK-01`: External Clean Tarball Installation
- **Objective:** Verify that an external developer in an isolated directory can install the SDK without monorepo dependencies.
- **Action:**
  ```bash
  cd /tmp && mkdir test-app && cd test-app && npm init -y
  npm pack /Users/polymath/Antigravity/Shlita/packages/sdk
  npm install ./shlita-sdk-*.tgz
  ```
- **Verification:** `node -e "import('shlita-sdk').then(({ ShlitaClient }) => console.log(typeof ShlitaClient));"` prints `function`.

#### `TEST-SDK-02`: SDK Automated Reservation Header Injection
- **Objective:** Verify SDK wraps outgoing OpenAI API calls and automatically negotiates Shlita headers.
- **Action:** Execute Node.js test script using SDK `wrap()` or direct client method against staging gateway.
- **Verification:** Upstream payload is delivered; response metadata contains parsed `reservationId` and `settledCostCents`.

---

### Category 7: Solana Devnet Settlement Integrity

#### `TEST-SOL-01`: Canonical PDA Derivation Verification
- **Objective:** Verify that escrow and audit log PDAs are deterministically derived using canonical seeds and program ID.
- **Preconditions:** Staging gateway configured with Devnet program ID `Sh11ta11111111111111111111111111111111111111`.
- **Action:** Query settlement endpoint for generated escrow account addresses.
- **Verification:** Address matches `PublicKey.findProgramAddressSync([Buffer.from("escrow"), orgPubkey.toBuffer()], programId)`.

#### `TEST-SOL-02`: Strict Rejection of Mainnet RPC Endpoints
- **Objective:** Verify that the settlement engine throws an immediate fatal configuration error if initialized with a mainnet URL.
- **Action:** Initialize settlement engine with `SOLANA_RPC_URL=https://api.mainnet-beta.solana.com`.
- **Expected Outcome:** Process refuses to start or throws `Error: Mainnet RPC endpoints are strictly prohibited in pilot stage`.

---

## 4. Test Execution Sign-Off Criteria

Before granting **Pilot Green Light**:
1. All 18 test scenarios must achieve 100% PASS rate.
2. Zero flaky or intermittent failures permitted.
3. Database integrity checks (`PRAGMA integrity_check;`) must return `ok` before and after test execution.
4. All test runs must be recorded in structured JSON format and archived in `docs/step-8/evidence/`.
