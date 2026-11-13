# Step 11 — Verification Baseline

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)  
**Old Main Baseline SHA:** `3628850f63ae403c28cfa91c8dd3f08644a980c0` (98 tests passed)  
**Step 11 PR Head:** `audit/step-11-evidence-baseline` (PR #12)  
**CI Test Count:** 106 unit/integration tests + 1 Playwright browser E2E test  
**CI Run Evidence:** GitHub Actions Run 43369351083 (Commit `a1c807a`) & Subsequent PR #12 runs  
**Verdict:** **PASS — VERIFIED BASELINE ESTABLISHED** (Pre-Pilot / Step 12 Prerequisites Tracked Separately)

---

## 1. Baseline Evolution (Main vs. PR #12)

| Dimension | Previous Main Baseline (`3628850`) | Step 11 PR Baseline (PR #12) |
|---|---|---|
| **Test Suites** | 15 test files (98 tests) | 16 test files (106 tests) + 1 Playwright E2E test |
| **Unit/Integration Pass Count** | 98 passed, 0 failed | 106 passed, 0 failed |
| **Dashboard Browser Testing** | 🔴 Unverified (no browser automation) | ✅ **PASS** in real Chromium (Playwright E2E) |
| **Freeze Contract Tests** | Generic policy error expected | Specific HTTP 200 + `AGENT_FROZEN` verified |
| **Cross-Tenant Isolation Tests** | Incomplete edge cases | HTTP 403 cross-tenant freeze verified |
| **Estimate vs. Tariff Tests** | Unverified | Within-limit estimate vs. tariff verified |
| **Solana Settlement Math** | 9 unit tests passed | 9 unit tests passed |
| **Solana Funded Local Test** | 🔴 BLOCKED (exit 2) | 🔴 **BLOCKED** (exit 2, missing `.so` binary) |
| **CI Execution Status** | Passed (Pages deploy) | **Passed** (Deploy Shlita to GitHub Pages) |

---

## 2. Capability Baseline Table

| # | Capability | Status | Tested Commit / Ref | Environment | Evidence / Command | Remaining Gap |
|---|---|---|---|---|---|---|
| 1 | **Automated test suite (106 tests)** | ✅ PASS | PR #12 (`a1c807a`+) | Node 24.22.1, macOS & Ubuntu | `npm test` → 106 passed, 16 files, exit 0 | None for Step 11 |
| 2 | **TypeScript compilation** | ✅ PASS | PR #12 | Node 24.22.1 | `npx tsc --noEmit` exit 0 | None |
| 3 | **UI + gateway build** | ✅ PASS | PR #12 | Vite + tsc | `npm run build` exit 0; `dist-ui/` populated | None |
| 4 | **SDK build** | ✅ PASS | PR #12 | tsc | `npm run build:sdk` exit 0 | None |
| 5 | **SDK external consumer install** | ✅ PASS | PR #12 | Tarball install | `sdk.consumer.test.ts` 1/1 pass (2.0s) | None |
| 6 | **Budget enforcement** | ✅ PASS | PR #12 | In-process SQLite | `ledger.integrity.test.ts` (17 tests) | None |
| 7 | **Idempotency / no duplicate execution** | ✅ PASS | PR #12 | In-process SQLite | `ledger.integrity.test.ts` + `regression.test.ts` | None |
| 8 | **Unknown outcome preservation** | ✅ PASS | PR #12 | In-process SQLite | `ledger.integrity.test.ts` | None |
| 9 | **Database persistence across restart** | ✅ PASS | PR #12 | Docker + CI | `security.startup.test.ts`; CI container stop/start | None |
| 10 | **Organization isolation** | ✅ PASS | PR #12 | In-process SQLite | `security.test.ts` (21 tests) + `regression.test.ts` | None |
| 11 | **SSRF protection** | ✅ PASS | PR #12 | In-process gateway | `security.test.ts`, `gateway.test.ts` | None |
| 12 | **CSRF protection** | ✅ PASS | PR #12 | In-process gateway | `operator-session.test.ts`, `security.test.ts` | None |
| 13 | **Operator session authentication** | ✅ PASS | PR #12 | In-process gateway | `operator-session.test.ts` (6 tests) | None |
| 14 | **Production fail-closed startup** | ✅ PASS | PR #12 | Docker + process | `security.startup.test.ts`; CI Docker test | None |
| 15 | **Login rate limiting** | ✅ PASS | PR #12 | In-process gateway | `operations.reliability.test.ts` | None |
| 16 | **Credential never logged** | ✅ PASS | PR #12 | Docker CI | CI `docker logs \| grep KEY && exit 1` | None |
| 17 | **OpenAPI contract** | ✅ PASS | PR #12 | In-process gateway | `openapi.contract.test.ts` (2 tests) | None |
| 18 | **Solana PDA derivation + instruction building** | ✅ PASS | PR #12 | In-process Solana | `solana.test.ts` (9/9 pass) | None |
| 19 | **Solana mainnet fail-closed gate** | ✅ PASS | PR #12 | In-process Solana | `solana.test.ts` | None |
| 20 | **Funded Solana local settlement** | 📜 HISTORICALLY REPORTED / 🔴 BLOCKED | `e478d9a` (PR #5) | Author's local machine | PR #5 description; current execution exits 2 | Missing `subscriptions_program.so` binary |
| 21 | **Dashboard browser E2E** | ✅ **PASS** | PR #12 | Playwright / Chromium | `npm run test:browser` (all 5 flows verified) | None |
| 22 | **Docker image build** | ✅ PASS | CI | Ubuntu CI | CI `image` job passes | None |
| 23 | **Container persistence (stop/start)** | ✅ PASS | CI | Docker + CI | CI `image` job persistent volume test | None |
| 24 | **Image published to GHCR** | ✅ PASS | CI | GitHub Actions | CI `staging` job pushes `ghcr.io/xiaoarnav/shlita-gateway:staging` | None |
| 25 | **Public HTTPS gateway** | ❌ NOT DEPLOYED | — | — | No persistent hosting provisioned | Tracked under Step 12 |
| 26 | **Monitoring / alerting** | ❌ NOT CONFIGURED | — | — | `/metrics` endpoint exists but not connected | Tracked under Step 12 |
| 27 | **Automated backup + restore** | ❌ NOT TESTED | — | — | Backup dir exists; no restore test | Tracked under Step 12 |
| 28 | **New regression tests (Step 11)** | ✅ PASS | PR #12 | Node 24.22.1 | `tests/step-11/regression.test.ts` 8/8 pass | None |

---

## 3. Reconciled Solana Settlement Evidence

1. **Unit-Level Protocol Logic:** Fully reproduced and passing (9 of 9 tests in `tests/solana.test.ts`).
2. **Funded Local-Validator Settlement:**
   - **Historical PR #5 Evidence:** In PR #5, commit `e478d9a` reported a funded transfer of 10,000 micro-units, balance update from 1,000,000 to 990,000, and confirmed transaction signature. Because PR #5's description is the only record, this is classified as **HISTORICALLY REPORTED**.
   - **Current Reproduction Attempt:** Running `npm run test:solana-local` returns exit code 2:
     ```
     BLOCKED: SHLITA_SUBSCRIPTIONS_SO is not a subscriptions_program.so built from program-v0.5.0
     ```
     This is classified as **CURRENTLY BLOCKED** due to the absence of the compiled BPF binary in git.
   - **CI History:** In both PR #5 and subsequent CI runs, CI has intentionally treated exit code 2 as an expected BLOCKED condition and continued.

---

## 4. Contradictions Corrected in Historical Documentation

| Historical Document Claim | Location | Corrected Factual Finding |
|---|---|---|
| Gateway container uses Alpine | Step 8 Blueprint | **Debian Bookworm Slim** (`node:22-bookworm-slim`) |
| Gateway health endpoint is `/healthz` | Step 8 Blueprint | Registered endpoints are `/health` and `/ready` |
| SDK package install is `@shlita/sdk` | Step 8 Blueprint | Actual package name is `shlita-sdk` |
| `SHLITA_ALLOW_SIMULATION=true` valid for staging | Step 8 Blueprint | Explicitly rejected by `security-config.ts` in production mode |
| Funded Solana execution passed in CI | Step 9 report | CI runner recorded exit 2 as BLOCKED, not passed |

---

## 5. Separate Verdicts

### Engineering Verification Baseline: **PASS — FULLY ESTABLISHED**
All 106 automated tests pass, the full dashboard flow is verified in a real Chromium browser with zero page reloads for live events and spend, and conflicting historical claims are cleanly reconciled.

### Production Readiness: **NO-GO (Pre-Pilot Only — Tracked Under Step 12)**
Public HTTPS hosting, uptime monitoring, and automated backup/restore verification remain prerequisites for Step 12.
