# Step 11 — Verification Baseline

**Date:** 2026-11-13  
**SHA:** `3628850f63ae403c28cfa91c8dd3f08644a980c0`  
**Auditor:** Antigravity  
**Verdict:** PARTIAL — BASELINE ESTABLISHED WITH GAPS

---

## Capability Baseline Table

| # | Capability | Status | Tested Commit | Environment | Evidence | Gap |
|---|---|---|---|---|---|---|
| 1 | **Automated test suite (98 → 106 tests)** | ✅ PASS | `3628850` | Node 24.22.1, macOS | `npm test` → 106 passed, 16 files, exit 0 | — |
| 2 | **TypeScript compilation** | ✅ PASS | `3628850` | Node 24.22.1 | `npx tsc --noEmit` exit 0 | — |
| 3 | **UI + gateway build** | ✅ PASS | `3628850` | Vite + tsc | `npm run build` exit 0; `dist-ui/` populated | — |
| 4 | **SDK build** | ✅ PASS | `3628850` | tsc | `npm run build:sdk` exit 0 | — |
| 5 | **SDK external consumer install** | ✅ PASS | `3628850` | Tarball install | `sdk.consumer.test.ts` 1/1 pass (2s) | — |
| 6 | **Budget enforcement** | ✅ PASS | `3628850` | In-process | `ledger.integrity.test.ts` (17 tests) | — |
| 7 | **Idempotency / no duplicate execution** | ✅ PASS | `3628850` | In-process | `ledger.integrity.test.ts` + new `regression.test.ts` | — |
| 8 | **Unknown outcome preservation** | ✅ PASS | `3628850` | In-process | `ledger.integrity.test.ts` | — |
| 9 | **Database persistence across restart** | ✅ PASS | `3628850` | Docker + CI | `security.startup.test.ts`; CI container stop/start | — |
| 10 | **Organization isolation** | ✅ PASS | `3628850` | In-process | `security.test.ts` (21 tests) + new `regression.test.ts` | — |
| 11 | **SSRF protection** | ✅ PASS | `3628850` | In-process | `security.test.ts`, `gateway.test.ts` | — |
| 12 | **CSRF protection** | ✅ PASS | `3628850` | In-process | `operator-session.test.ts`, `security.test.ts` | — |
| 13 | **Operator session authentication** | ✅ PASS | `3628850` | In-process | `operator-session.test.ts` (6 tests) | — |
| 14 | **Production fail-closed startup** | ✅ PASS | `3628850` | Docker + process | `security.startup.test.ts`; CI Docker test | — |
| 15 | **Login rate limiting** | ✅ PASS | `3628850` | In-process | `operations.reliability.test.ts` | — |
| 16 | **Credential never logged** | ✅ PASS | `3628850` | Docker CI | CI `docker logs \| grep KEY && exit 1` | — |
| 17 | **OpenAPI contract** | ✅ PASS | `3628850` | In-process | `openapi.contract.test.ts` (2 tests) | — |
| 18 | **Solana PDA derivation + instruction building** | ✅ PASS | `3628850` | In-process | `solana.test.ts` (9/9) | — |
| 19 | **Solana mainnet fail-closed gate** | ✅ PASS | `3628850` | In-process | `solana.test.ts` | — |
| 20 | **Funded Solana local settlement** | 🔴 BLOCKED | `e478d9a` (PR #5) | Author's local machine | PR #5 description — HISTORICALLY VERIFIED | Missing `subscriptions_program.so` binary |
| 21 | **Docker image build** | ✅ PASS | `3628850` (CI) | Ubuntu CI | CI `image` job passes | — |
| 22 | **Container persistence (stop/start)** | ✅ PASS | `3628850` (CI) | Docker + CI | CI `image` job persistent volume test | — |
| 23 | **Image published to GHCR** | ✅ PASS | `3628850` (CI) | GitHub Actions | CI `staging` job pushes `ghcr.io/xiaoarnav/shlita-gateway:staging` | — |
| 24 | **Public HTTPS gateway** | ❌ NOT DEPLOYED | — | — | No persistent hosting provisioned | Requires Step 12 |
| 25 | **Dashboard browser E2E** | 🔴 BLOCKED | — | — | Backend API flows all tested; visual rendering not verified | Playwright not available |
| 26 | **Monitoring / alerting** | ❌ NOT CONFIGURED | — | — | `/metrics` endpoint exists but not connected | Requires Step 12 |
| 27 | **Automated backup + restore** | ❌ NOT TESTED | — | — | Backup dir exists; no restore test | Requires Step 12 |
| 28 | **New regression tests (Step 11)** | ✅ PASS | `3628850` | Node 24.22.1 | `tests/step-11/regression.test.ts` 8/8 pass | — |

---

## Contradictions Found in Prior Reports (Corrections)

| Prior Claim | Source | Correction |
|---|---|---|
| Docker base image: Alpine | Step 8 Pilot Blueprint | Actual: `node:22-bookworm-slim` (Debian Bookworm Slim) |
| Health endpoint: `/healthz` | Step 8 docs | Actual: `/health` and `/ready` |
| SDK install: `@shlita/sdk` | Step 8 install instructions | Actual: `shlita-sdk` |
| `SHLITA_ALLOW_SIMULATION=true` allowed in staging | Step 8 Blueprint | Actual: `security-config.test.ts` explicitly rejects this |
| Funded Solana settlement passes in CI | Implied by Step 9/10 partial pass | Actual: CI has always recorded this as BLOCKED (exit 2) — by design |

The original dates and test scopes of Steps 7–10 are preserved. These corrections appear only here in Step 11 documentation.

---

## Verdict

| Domain | Verdict |
|---|---|
| **Verification baseline** | ✅ ESTABLISHED — 106 tests pass, all major capabilities have executable evidence or explicit gap documentation |
| **Production readiness** | ⚠️ NOT READY — Public HTTPS gateway, monitoring, backup/restore, and browser E2E remain unverified |
| **Financial correctness** | ✅ VERIFIED — All 8 invariants implemented and tested |
| **Security** | ✅ VERIFIED — No critical or high findings; 3 low findings documented |
| **Solana settlement** | ⚠️ PARTIAL — Unit logic verified; funded execution historically verified, currently blocked |
