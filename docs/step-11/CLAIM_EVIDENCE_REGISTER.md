# Step 11 — Claim-Evidence Register

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)

---

## Classification Key

| Label | Meaning |
|---|---|
| ✅ VERIFIED | Independently confirmed with current code, tests, or CI output |
| 📜 HISTORICALLY VERIFIED | Supported by prior PR evidence; not independently re-reproducible now |
| ⚠️ PARTIAL | True in some conditions or partially evidenced |
| ❌ UNVERIFIED | No supporting evidence found |
| ❌ CONTRADICTED | Current evidence shows the claim is false |
| 🔁 OUTDATED | Was true at a prior step; superseded by current state |

---

## Claims Register

| # | Claim | Source | Status | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | 98 tests passing | Steps 7–10 reports, README | ✅ VERIFIED | `npm test` → 98 passed, 15 files, exit 0 | Reproduced at SHA `3628850` |
| 2 | Solana funded local transfer executed (10,000 tokens, 1,000,000→990,000) | PR #5 description | 📜 HISTORICALLY VERIFIED | PR #5 commit `e478d9a` description; script implements described behavior | Cannot reproduce without `subscriptions_program.so` binary |
| 3 | Funded Solana test passes in CI | PR #5 | ❌ CONTRADICTED | CI explicitly records this as BLOCKED (exit 2); `deploy.yml` treats exit 2 as named condition | PR #5 itself states CI is blocked; not a regression, by design |
| 4 | Public HTTPS gateway deployed and accessible | Step 8 Pilot Blueprint | ❌ UNVERIFIED | No persistent host provisioned; `staging` job only pushes to GHCR and verifies `node -v` | GitHub Pages hosts only the static UI SPA |
| 5 | Dashboard browser-level E2E verified | Step 9 / Step 10 reports | ⚠️ PARTIAL | Backend API flows verified via tests and CI; visual browser rendering not performed in Steps 9, 10, or 11 | Browser automation not available; manual test spec provided |
| 6 | SDK installable as `shlita-sdk` from tarball | Step 6 | ✅ VERIFIED | `tests/sdk.consumer.test.ts` packs and installs from tarball; passes (1/1) | |
| 7 | SDK referenced as `@shlita/sdk` in install instructions | Step 8 docs | ❌ CONTRADICTED | Package name is `shlita-sdk`; `@shlita/sdk` does not exist | Step 8 docs must not be used for install instructions |
| 8 | Gateway uses Alpine base image | Step 8 Pilot Blueprint | ❌ CONTRADICTED | `Dockerfile` uses `node:22-bookworm-slim` (Debian Bookworm Slim) | |
| 9 | Health endpoint at `/healthz` | Step 8 docs | ❌ CONTRADICTED | Actual endpoints: `/health` and `/ready`; `/healthz` is not registered | |
| 10 | Financial budget enforcement | Steps 2–10 | ✅ VERIFIED | `ledger.integrity.test.ts` (17 tests) all pass | |
| 11 | Idempotency — no duplicate execution | Steps 2–10 | ✅ VERIFIED | `ledger.integrity.test.ts` — multiple idempotency tests pass | |
| 12 | ACID persistence across restart | Step 5 | ✅ VERIFIED | CI container stop/start test; `security.startup.test.ts` | |
| 13 | SSRF protection | Step 7 / Step 10 | ✅ VERIFIED | `security.test.ts` and `gateway.test.ts` pass; source code inspection | |
| 14 | CSRF protection for operator sessions | Step 7 / Step 10 | ✅ VERIFIED | `operator-session.test.ts` (6 tests); source code confirms `x-shlita-csrf` required | |
| 15 | Organization isolation | Step 7 / Step 10 | ✅ VERIFIED | `security.test.ts` — cross-org access returns 403 | |
| 16 | Production fails closed on insecure config | Step 5 | ✅ VERIFIED | `security.startup.test.ts` (2 tests); CI Docker production startup test | |
| 17 | Operator sign-in with session cookie | Step 4 | ✅ VERIFIED | `operator-session.test.ts`; CI container test | |
| 18 | Monitoring and alerting operational | Step 10 | ❌ UNVERIFIED | No monitoring stack configured; `/metrics` exists but not connected | |
| 19 | `SHLITA_ALLOW_SIMULATION=true` allowed in staging | Step 8 Blueprint | ❌ CONTRADICTED | `security-config.test.ts` explicitly rejects this config; `security.startup.test.ts` confirms startup failure | Step 8 staging config was inconsistent with security implementation |
| 20 | Automated database backups | Step 8/10 | ❌ UNVERIFIED | Backup directory created in Dockerfile; no automated backup job configured | |
| 21 | TypeScript strict compilation passes | Step 11 | ✅ VERIFIED | `npx tsc --noEmit` → exit 0, no errors | |
| 22 | Docker image pushed to GHCR | Step 8 / CI | ✅ VERIFIED | `staging` job in `deploy.yml` pushes `ghcr.io/xiaoarnav/shlita-gateway:staging` | |
