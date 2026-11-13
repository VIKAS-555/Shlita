# Step 11 — Claim-Evidence Register

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)

---

## Classification Key

| Label | Meaning |
|---|---|
| ✅ VERIFIED | Independently confirmed with current code, tests, CI output, or browser automation |
| 📜 HISTORICALLY REPORTED | Reported in prior PR description; not independently re-reproducible in current repository |
| 🔴 CURRENTLY BLOCKED | Implementation exists but execution blocked by external missing prerequisite/tooling |
| ⚠️ PARTIAL | True in some conditions or partially evidenced |
| ❌ UNVERIFIED | No supporting evidence found |
| ❌ CONTRADICTED | Current evidence shows the claim is false |
| 🔁 OUTDATED | Was true at a prior step; superseded by current state |

---

## Claims Register

| # | Claim | Source | Status | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | 98 tests passing on main baseline | Step 10 reports | ✅ VERIFIED | `npm test` on commit `3628850` → 98 passed, 15 files, exit 0 | Main baseline at start of Step 11 |
| 2 | 106 tests passing on Step 11 PR | PR #12 | ✅ VERIFIED | `npm test` on PR #12 → 106 passed, 16 files, exit 0 | Verified in local run & GitHub Actions Run 43369351083 |
| 3 | Solana funded local transfer executed (10,000 tokens, 1,000,000→990,000) | PR #5 description | 📜 HISTORICALLY REPORTED | PR #5 commit `e478d9a` description; script implements described behavior | Cannot reproduce without `subscriptions_program.so` binary |
| 4 | Current funded Solana test execution | Step 11 test | 🔴 CURRENTLY BLOCKED | `npm run test:solana-local` returns exit code 2 (BLOCKED) | Blocked by missing compiled BPF binary in git |
| 5 | Funded Solana test passes in CI | PR #5 / Step 9 | ❌ CONTRADICTED | CI explicitly records this as BLOCKED (exit 2); `deploy.yml` treats exit 2 as named condition | PR #5 itself states CI is blocked; not a regression, by design |
| 6 | Public HTTPS gateway deployed and accessible | Step 8 Pilot Blueprint | ❌ UNVERIFIED | No persistent host provisioned; `staging` job only pushes to GHCR and verifies `node -v` | Tracked under Step 12 prerequisites |
| 7 | Dashboard browser-level E2E verified | Step 11 PR #12 | ✅ VERIFIED | `npm run test:browser` (Playwright v1.65.0, Chromium Headless Shell) | All 5 operator flows verified: sign-in, enroll, live update without reload, freeze persistence, sign-out |
| 8 | SDK installable as `shlita-sdk` from tarball | Step 6 | ✅ VERIFIED | `tests/sdk.consumer.test.ts` packs and installs from tarball; passes (1/1) | Clean external consumer installation |
| 9 | SDK referenced as `@shlita/sdk` in install instructions | Step 8 docs | ❌ CONTRADICTED | Package name is `shlita-sdk`; `@shlita/sdk` does not exist | Step 8 docs must not be used for install instructions |
| 10 | Gateway uses Alpine base image | Step 8 Pilot Blueprint | ❌ CONTRADICTED | `Dockerfile` uses `node:22-bookworm-slim` (Debian Bookworm Slim) | Verified in Dockerfile |
| 11 | Health endpoint at `/healthz` | Step 8 docs | ❌ CONTRADICTED | Actual endpoints: `/health` and `/ready`; `/healthz` is not registered | Verified in `app.ts` |
| 12 | Financial budget enforcement | Steps 2–11 | ✅ VERIFIED | `ledger.integrity.test.ts` (17 tests) all pass | Enforced atomically in SQLite WAL |
| 13 | Idempotency — no duplicate execution | Steps 2–11 | ✅ VERIFIED | `ledger.integrity.test.ts` + `regression.test.ts` pass | Idempotency reference derived from key + agent + vendor + path |
| 14 | ACID persistence across restart | Step 5 | ✅ VERIFIED | CI container stop/start test; `security.startup.test.ts` | Complete state survives container reload |
| 15 | SSRF protection | Steps 7, 10, 11 | ✅ VERIFIED | `security.test.ts` and `gateway.test.ts` pass; source code inspection | Loopback, RFC 1918, metadata IP blocked |
| 16 | CSRF protection for operator sessions | Steps 7, 10, 11 | ✅ VERIFIED | `operator-session.test.ts` (6 tests); `x-shlita-csrf` header verified | Constant-time CSRF validation |
| 17 | Organization isolation | Steps 7, 10, 11 | ✅ VERIFIED | `security.test.ts` + `regression.test.ts` (cross-org access returns 403) | Multi-tenant boundaries intact |
| 18 | Production fails closed on insecure config | Step 5 | ✅ VERIFIED | `security.startup.test.ts` (2 tests); CI Docker production startup test | Rejects insecure secrets or modes |
| 19 | Operator sign-in with session cookie | Step 4, 11 | ✅ VERIFIED | `operator-session.test.ts`; CI container test; Playwright browser test | Sets `HttpOnly; SameSite=Strict` cookie |
| 20 | Monitoring and alerting operational | Step 10 | ❌ UNVERIFIED | No monitoring stack configured; `/metrics` exists but not connected | Tracked under Step 12 prerequisites |
| 21 | `SHLITA_ALLOW_SIMULATION=true` allowed in staging | Step 8 Blueprint | ❌ CONTRADICTED | `security-config.test.ts` explicitly rejects this config; `security.startup.test.ts` confirms startup failure | Step 8 staging config was inconsistent with security implementation |
| 22 | Automated database backups | Step 8/10 | ❌ UNVERIFIED | Backup directory created in Dockerfile; no automated backup job configured | Tracked under Step 12 prerequisites |
