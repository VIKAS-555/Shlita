# Step 11 — Financial Invariants Audit

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)  
**Source files inspected:** `packages/core/src/db.ts`, `packages/core/src/policy-engine.ts`, `packages/core/src/lifecycle.ts`, `packages/core/src/money.ts`, `packages/gateway/src/app.ts`

---

## Invariant A — Budget Enforcement

> A request cannot reserve more than the authorized per-call or period spending limit.

**Implementation:** `packages/core/src/db.ts` — `reserveBudget()` reads the agent's `periodBudgetMicroUsdc` and `maxPerCallMicroUsdc` from the SQLite `policies` table, computes current period spend from `financial_operations`, and rejects with `BUDGET_EXCEEDED` if the reservation would exceed either limit.

**Test coverage:** `tests/ledger.integrity.test.ts` — multiple tests verify this directly including period budget exhaustion and per-call cap enforcement.

**Status:** ✅ IMPLEMENTED AND TESTED

---

## Invariant B — Concurrency

> Concurrent requests must not collectively exceed the available budget.

**Implementation:** SQLite WAL mode with per-operation transactions ensures atomicity. `reserveBudget()` performs a `SELECT SUM(reservedAmountMicroUsdc)` inside the same transaction as the INSERT, enforcing serialized reads. The in-memory engine uses the same synchronous SQLite call path.

**Test coverage:** `tests/ledger.integrity.test.ts` — `dispatches one upstream call for two simultaneous requests with the same key` verifies concurrent idempotency; `does not let concurrent different keys exceed the period budget` verifies concurrent budget enforcement.

**Gap:** The concurrency test uses JavaScript-level concurrency (two async calls, not threads). True parallel writes are constrained by Node.js's single-threaded event loop. Under multi-process deployment (e.g., multiple containers), SQLite WAL locking provides the guard but this is not tested at the multi-process level.

**Status:** ✅ IMPLEMENTED; ⚠️ MULTI-PROCESS CONCURRENCY UNTESTED

---

## Invariant C — Idempotency

> A repeated request must not trigger duplicate billable upstream execution.

**Implementation:** `packages/core/src/db.ts` — `beginOperation()` checks the `financial_operations` table for an existing record with the same `idempotencyReference` (derived from `idempotencyKey + agentId + vendor + path`). If found and in a terminal state, it returns the stored result. If found and in-flight, it returns `OPERATION_IN_PROGRESS` (409).

**Test coverage:** `tests/ledger.integrity.test.ts` — `dispatches one upstream call for two simultaneous requests with the same key`, `rejects the same idempotency key with a different payload`, `returns the stored result when a successful call is retried`, `does not execute again after a definite provider failure`.

**Status:** ✅ IMPLEMENTED AND TESTED

---

## Invariant D — Unknown Outcomes

> If the gateway loses communication after an upstream request might have executed, the operation must not be incorrectly marked as definitively failed or safe to retry.

**Implementation:** `packages/core/src/lifecycle.ts` — the `OUTCOME_UNCERTAIN` state prevents any retry or rollback of a timed-out operation. `packages/core/src/db.ts` — `finishExecution()` with `type: 'unknown'` sets the lifecycle state to `OUTCOME_UNCERTAIN`. The gateway returns HTTP 202 to the caller with `reconciliationRequired: true` rather than 500 or 200.

**Test coverage:** `tests/ledger.integrity.test.ts` — `preserves an unknown provider outcome and does not replay it`, `keeps a held reservation when an uncertain operation would otherwise expire`.

**Status:** ✅ IMPLEMENTED AND TESTED

---

## Invariant E — Estimated vs Actual Cost

> Estimated reservations must not be represented as verified actual provider charges.

**Implementation:** `packages/core/src/db.ts` — the `financial_operations` table stores `reservedAmountMicroUsdc` (the estimate) separately. The lifecycle moves through `EXECUTION_IN_PROGRESS` → `VENDOR_SUCCEEDED` → `ACCOUNTING_COMMITTED`. The final charge is the tariff amount, not an arbitrary caller-supplied number. The dashboard and operations endpoint surface `reservedAmountMicroUsdc` with no inflation to "confirmed charge" unless settlement is confirmed.

**Gap:** The `estimatedCostMicroUsdc` field accepted in the proxy request body is used only as a pre-check hint; the actual ledger charge is based on the provider's registered tariff. This design is correct but could mislead callers who expect their estimate to be the charged amount. The OpenAPI spec documents this, but no test specifically asserts the difference between submitted estimate and actual ledger charge.

**Status:** ✅ IMPLEMENTED; ⚠️ MINOR DOCUMENTATION CLARITY GAP

---

## Invariant F — Database Persistence

> Financial operation history must remain consistent after a restart.

**Implementation:** SQLite WAL mode (`PRAGMA journal_mode = WAL`). Docker volume mount at `/var/lib/shlita`. `packages/core/src/db.ts` — `requirePersistent` option throws at startup if `:memory:` is used in production mode.

**Test coverage:** `tests/ledger.integrity.test.ts` — `keeps a completed operation across a database restart`, `recovers an in-flight operation after restart without executing it again`. `tests/security.startup.test.ts` — `serves an authorized local configuration and keeps enrolled keys across restart`. CI workflow (`deploy.yml`) — full container stop/start cycle with volume persistence verified via SQLite operations endpoint.

**Status:** ✅ IMPLEMENTED AND TESTED

---

## Invariant G — Organization Isolation

> One organization must not access another organization's financial data.

**Implementation:** `packages/gateway/src/app.ts` — `requireOwnedAgent()` enforces that the authenticated operator's `ownerOrg` matches the agent's `ownerOrg`. `/v1/agents` returns only the calling operator's org's agents. `/v1/operations` filters by org. `/v1/audit` filters by org.

**Test coverage:** `tests/security.test.ts` — multiple tests covering cross-org agent access (expects 403), cross-org operation visibility, and audit log isolation. `tests/ledger.integrity.test.ts` — `writes an audit trail without credentials and hides other organizations`.

**Status:** ✅ IMPLEMENTED AND TESTED

---

## Invariant H — Settlement Correctness

> A confirmed payment must correspond to genuine settlement evidence.

**Implementation:** `packages/solana/src/settlement.ts` — `observeBalances()` reads on-chain token account balances before and after the transaction and verifies the delta matches the expected transfer amount before marking the settlement `SETTLEMENT_CONFIRMED`. Replay protection is enforced via the `settlements` table (unique constraint on transaction signature + nonce).

**Test coverage:** `tests/settlement.ledger.test.ts` — 2 tests cover settlement recording. `tests/solana.test.ts` — `verifies observed token balance deltas match transfer amount` unit test. Full funded confirmation: **HISTORICALLY VERIFIED** (PR #5) but **CURRENTLY BLOCKED** (no `.so` binary).

**Status:** ✅ IMPLEMENTED; 📜 FUNDED CONFIRMATION HISTORICALLY VERIFIED ONLY

---

## Discovered Issues (Not Fixed)

| ID | Severity | Description | Location |
|---|---|---|---|
| FIN-01 | Low | No test asserts that caller-supplied `estimatedCostMicroUsdc` does not inflate the actual ledger charge | `tests/step-11/regression.test.ts` (new test added) |
| FIN-02 | Low | Multi-process concurrent budget enforcement under multiple Node processes sharing the same SQLite file is untested | Out of scope for single-container deployment; relevant for future horizontal scaling |
