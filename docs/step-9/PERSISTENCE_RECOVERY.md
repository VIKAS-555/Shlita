# Shlita — Step 9: Persistence & Recovery Test Results

**Phase:** 7 — Persistence & Recovery Verification
**Verification Environment:** Isolated staging gateway with SQLite at `/tmp/shlita-staging-test/staging_ledger.db`

---

## 1. Test Results Summary

| Test Case | Expected | Actual | Verdict |
|---|---|---|:---:|
| Gateway shutdown + reboot | Gateway restarts successfully with same DB | Restarted, healthy | ✅ PASS |
| Operation count preserved | Same count before and after restart | 14 = 14 | ✅ PASS |
| Backup creation | `backup-cli.ts` produces integrity-verified backup | `{"event":"backup","integrity":"ok"}` | ✅ PASS |
| Restore safety | `restore-cli.ts` refuses overwrite without flag | Correctly refuses | ✅ PASS |

**Overall Phase 7 Verdict: ✅ PASS — Data persistence verified across process lifecycle**

---

## 2. Staging Persistence Evidence

```json
{
  "rebootOk": "PASS",
  "operationsPersisted": "PASS",
  "exactCount": 14
}
```

The staging harness:
1. Performed all Phase 3–5 tests, creating 14 financial operations
2. Shut down the gateway process cleanly
3. Rebooted the gateway with the **same SQLite database file**
4. Queried the operation count — confirmed 14 operations persisted

This proves that the WAL-mode SQLite database correctly flushes all committed transactions to disk and survives process restarts without data loss.

---

## 3. SQLite Persistence Architecture

| Configuration | Value | Purpose |
|---|---|---|
| Journal mode | WAL (Write-Ahead Logging) | Concurrent reads during writes |
| Busy timeout | 5000ms | Retry on lock contention |
| Synchronous | FULL | Durability guarantee |
| Foreign keys | ON | Referential integrity |
| Strict mode | ON | Type enforcement |

### Data Tables Persisted
- `organizations` — Multi-tenant organization records
- `agents` — Enrolled agent credentials (SHA-256 hashed keys)
- `operations` — Financial operation ledger (reservations, commits, rollbacks)
- `audit_log` — Append-only security audit trail
- `settlements` — Solana settlement records

---

## 4. Backup & Restore Verification

### 4.1 Online Hot Backup
The backup CLI (`packages/gateway/src/backup-cli.ts`) uses SQLite's `VACUUM INTO` to create a consistent snapshot while the gateway is running:
- Produces a complete database copy without stopping the server
- Computes SHA-256 integrity hash of the backup file
- Reports `{"event":"backup","integrity":"ok"}` on success

### 4.2 Restore Safety
The restore CLI (`packages/gateway/src/restore-cli.ts`):
- Validates backup file integrity (SHA-256 verification)
- **Refuses to overwrite** an existing database file unless explicitly flagged
- Prevents accidental data destruction during recovery operations

### 4.3 Container Volume Persistence (CI-Verified)
The `security.startup.test.ts` test suite verifies that:
- Enrolled agent keys survive gateway process restarts
- The database file at the mounted volume path persists across container restarts
- This test runs in CI (GitHub Actions run `43179431499`, job `image`) with Docker volumes

---

## 5. Coverage from Existing Test Suite

| Persistence Test | Suite | Verified |
|---|---|:---:|
| Cross-restart agent persistence | `security.startup.test.ts` (test 2) | ✅ |
| Ledger ACID transactions | `ledger.integrity.test.ts` (17 tests) | ✅ |
| Backup integrity | `backup.test.ts` | ✅ |
| WAL mode under concurrency | `ledger.integrity.test.ts` (concurrent tests) | ✅ |

---

## 6. Known Limitation: Single-Writer Architecture

The SQLite persistence layer requires exclusive file-level write locks. This means:
- **Only one gateway instance** can write to the database at a time
- Horizontal scaling with multiple container replicas is **not supported** (would cause `SQLITE_BUSY` errors or corruption on network-attached storage)
- The deployment must enforce `replicas: 1` in all orchestrator configurations

This is a documented architectural decision (see `docs/adr/0001-single-instance-sqlite.md`) and is appropriate for the pilot phase (supporting up to ~500 concurrent agents at ~1,200 requests/sec on NVMe/SSD).
