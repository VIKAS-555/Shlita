# Shlita Pilot Operations & Guardrail Specifications

**Document Reference:** `docs/step-8/PILOT_OPERATIONS.md`  
**Parent Milestone:** Step 8 — Pilot Deployment Blueprint & Release-Gate Closure  
**Baseline Git Commit:** `4d461c5b1edb63db802674c4cb827a91b211627a`  
**Target Audience:** Site Reliability Engineers, Platform Operators, Security Responders  

---

## 1. Pilot Bounding Box & Scope Restrictions

To minimize operational risk while gathering real-world agent integration telemetry, the Shlita initial pilot is constrained by immutable boundary parameters:

| Parameter | Pilot Boundary Constraint | Rationale |
| :--- | :--- | :--- |
| **Max Participating Organizations** | **Exactly 1 Organization** (`org_pilot_alpha`) | Prevent multi-tenant operational bleed during first live deployment. |
| **Max Active Agents** | **Exactly 2 Agents** (`agent_prod_reader`, `agent_prod_writer`) | Isolate read-heavy telemetry vs write/transactional agent workloads. |
| **Pilot Duration** | **14 Calendar Days** (Fixed Sunset Window) | Enforce bounded evaluation timeframe before architecture hardening. |
| **Total Pilot Organization Budget** | **$50.00 USD Equivalent** (5,000 cents) | Total financial blast radius capped at minimal partner allocation. |
| **Max Per-Transaction Spend** | **$5.00 USD** (500 cents) | Prevent any single runaway agent iteration from consuming budget. |
| **Max Daily Spend Velocity** | **$10.00 USD** (1,000 cents) / rolling 24h | Mitigate looping agent logic from exhausting funds prematurely. |
| **Blockchain Network** | **Solana Devnet Only** | Real Mainnet SOL or SPL token transfers are strictly prohibited. |
| **Database Topology** | **Single Active Instance** with WAL volume | Preserves SQLite single-writer safety invariant without race conditions. |

---

## 2. Daily Operator Health Check Runbook

Every morning at 09:00 UTC, the on-call platform operator must execute the following 5-point health check routine:

### Step 1: Gateway Availability & Version Verification
```bash
curl -s -i https://staging-gateway.shlita.internal/healthz
```
- **Invariant:** HTTP status must be `200 OK`.
- **Expected Payload:**
  ```json
  {
    "status": "healthy",
    "version": "0.1.0",
    "uptimeSeconds": 86420,
    "database": "connected",
    "circuitBreaker": "CLOSED"
  }
  ```

### Step 2: SQLite WAL File Size & Checkpoint Status
Inspect the physical disk directory holding the live SQLite database:
```bash
ls -lh /var/lib/shlita/data/
```
- **Threshold Alert:** If `shlita.db-wal` exceeds **50 MB**, trigger an explicit checkpoint:
  ```bash
  sqlite3 /var/lib/shlita/data/shlita.db "PRAGMA wal_checkpoint(TRUNCATE);"
  ```

### Step 3: Agent Velocity & Spend Audit
Query the operator endpoint to inspect cumulative spend across active agents:
```bash
curl -s https://staging-gateway.shlita.internal/v1/operator/organizations/org_pilot_alpha/agents \
  -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
```
- **Audit Rule:** Ensure `currentDailySpendCents` is strictly <= `1000`. If any agent is within 90% of daily cap, notify the pilot partner engineering team.

### Step 4: Circuit Breaker Error Rate Inspection
Inspect recent upstream proxy error rates and circuit breaker status:
```bash
curl -s https://staging-gateway.shlita.internal/v1/operator/circuit-breaker \
  -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
```
- **State Check:** Status must be `CLOSED`. If `HALF_OPEN` or `OPEN`, examine upstream provider error logs immediately.

### Step 5: Automated Daily Backup Verification
Confirm that the scheduled 03:00 UTC backup was created and passed integrity checks:
```bash
ls -lt /var/lib/shlita/backups/ | head -n 3
```
- Run verification command:
  ```bash
  sqlite3 /var/lib/shlita/backups/$(ls -t /var/lib/shlita/backups/ | head -n 1) "PRAGMA integrity_check;"
  ```
- **Assertion:** Must return `ok`.

---

## 3. Operator Governance Workflows

### 3.1 Policy Configuration Workflow
To adjust spending limits, daily caps, or provider whitelists for a participating agent:

1. Draft the policy payload (example: adjusting per-transaction cap from $2.00 to $4.00):
   ```json
   {
     "agentId": "agent_prod_writer",
     "spendingLimits": {
       "maxPerTransactionCents": 400,
       "maxDailyVelocityCents": 1000,
       "rollingWindowSeconds": 86400
     },
     "allowedProviders": ["mock-llm", "openai"],
     "allowedModels": ["gpt-4o-mini", "text-embedding-3-small"]
   }
   ```
2. Apply the policy update via operator API:
   ```bash
   curl -s -X PUT https://staging-gateway.shlita.internal/v1/operator/policies/agent_prod_writer \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}" \
     -H "Content-Type: application/json" \
     -d @policy_update.json
   ```
3. Audit log verification:
   ```bash
   curl -s https://staging-gateway.shlita.internal/v1/operator/audit-log?limit=1 \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
   ```
   Confirm event `POLICY_UPDATED` is immutably recorded with operator timestamp.

---

### 3.2 Agent Credential Rotation Procedure

If an agent API key is suspected of leakage or requires standard rotation:

1. **Issue New Token:**
   ```bash
   curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/agents/agent_prod_writer/rotate-key \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"gracePeriodSeconds": 300}'
   ```
   *Note: Grace period of 300 seconds allows existing agent in-flight requests to drain while new key is configured.*
2. **Deliver New Key to Pilot Partner:**
   Send new bearer token through end-to-end encrypted channel (e.g. 1Password secure share).
3. **Revoke Old Token:**
   Following the grace period, verify old token is rejected with `401 Unauthorized`.

---

### 3.3 Emergency Killswitch Procedure

If an agent enters an infinite loop, exhibits abnormal transaction frequency, or security flags are raised:

#### Global Emergency Freeze (All Egress Stopped)
```bash
curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/freeze \
  -H "x-operator-key: ${SHLITA_OPERATOR_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Emergency operator killswitch engaged by SRE"}'
```
- **SLA:** Egress blocked within < 50ms across all agent endpoints.
- **Agent Experience:** All proxy and reservation calls return `423 Locked`.

#### Targeted Single-Agent Freeze
```bash
curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/agents/agent_prod_writer/freeze \
  -H "x-operator-key: ${SHLITA_OPERATOR_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Excessive velocity detected on writer agent"}'
```
- Halts `agent_prod_writer` while leaving `agent_prod_reader` operational.

#### Resuming Operations (Unfreeze)
```bash
curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/unfreeze \
  -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
```

---

## 4. End-of-Day Financial Reconciliation

At 23:55 UTC each day, the automated reconciliation script executes to ensure perfect parity between Shlita's SQLite ledger, upstream provider billing counters, and Solana Devnet audit signatures:

```text
[Shlita Ledger Total Cents] == [Sum of Settled Reservations] == [Upstream Provider Usage Report]
```

### Discrepancy Investigation Thresholds:
- **Zero Tolerance ($0.00 discrepancy):** Any discrepancy between reservations and settled ledger records halts operations.
- **Upstream Rounding Delta (< $0.05):** Permitted if caused by fractional token estimation rounding by provider. Documented in daily reconciliation report.
- **Discrepancy > $0.05:** Trigger SEV-2 Incident (Investigate uncommitted reservations or provider calculation drift).

---

## 5. Pilot Exit & Graduation Criteria

At the conclusion of the 14-day evaluation, the pilot is evaluated for commercial graduation against 5 mandatory criteria:

1. **Zero Financial Leakage:** Exactly $0.00 unbudgeted or over-limit spending recorded.
2. **Zero Invariant Violations:** Concurrency and idempotency stress tests maintained 100% data integrity with zero double-spends.
3. **Zero Data Loss or Corruption:** All SQLite WAL checkpoints, automated backups, and mock crash recovery drills succeeded with `PRAGMA integrity_check = ok`.
4. **Availability SLA:** Staging gateway achieved >= 99.5% uptime during pilot operating hours.
5. **Partner Sign-Off:** Pilot partner engineering team confirms developer experience and SDK stability with no unhandled client exceptions.
