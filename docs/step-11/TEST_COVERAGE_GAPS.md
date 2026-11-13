# Step 11 — Test Coverage Gaps

**Date:** 2026-11-13

---

## Existing Coverage (98 tests)

| Test File | Tests | Covered Invariants |
|---|---|---|
| `ledger.integrity.test.ts` | 17 | Budget enforcement, concurrency, idempotency, unknown outcome, persistence, restart recovery |
| `security.test.ts` | 21 | SSRF, auth, org isolation, CSRF, session, credential leakage |
| `core.test.ts` | 12 | Policy engine unit tests |
| `gateway.test.ts` | 8 | Proxy, freeze, vendor block, SSRF, telemetry, auth |
| `security.startup.test.ts` | 2 | Production fail-closed, key persistence across restart |
| `security-config.test.ts` | 3 | Insecure config rejection |
| `operator-session.test.ts` | 6 | Session lifecycle, CSRF, expiry |
| `solana.test.ts` | 9 | PDA derivation, instruction building, mainnet gate |
| `sdk.client.test.ts` | 6 | SDK proxy, auth, error classification |
| `sdk.gateway.test.ts` | 1 | SDK end-to-end via real gateway instance |
| `sdk.consumer.test.ts` | 1 | External tarball installation |
| `openapi.contract.test.ts` | 2 | OpenAPI schema validation |
| `operations.reliability.test.ts` | 6 | Circuit breaker, login rate limiting, rate-limit persistence |
| `settlement.ledger.test.ts` | 2 | Settlement recording |
| `client-address.test.ts` | 2 | Client IP resolution, trusted proxy headers |

---

## Gaps Addressed by Step 11 New Tests (8 tests)

| Test | Invariant | Result |
|---|---|---|
| `freeze returns 200 with AGENT_FROZEN status field` | Documents actual freeze API contract (200 + body, not error code) | ✅ PASS |
| `freeze blocks subsequent proxy requests` | Freeze→proxy flow end-to-end | ✅ PASS |
| `cross-tenant freeze returns 403` | Org-beta operator cannot freeze org-alpha agent (403, not 404) | ✅ PASS |
| `agent cannot act on behalf of another org's agentId` | Agent key/agentId mismatch is rejected | ✅ PASS |
| `GET /v1/agents shows only own org's agents` | Org isolation for agent list | ✅ PASS |
| `within-limit estimate accepted; spend header reflects tariff` | estimate ≠ charge; tariff governs actual ledger entry | ✅ PASS |
| `unauthenticated GET /v1/agents returns 401` | Operator-only endpoint rejects unauthenticated access | ✅ PASS |
| `idempotency key reuse with different payload is rejected` | Fingerprint check prevents silent payload mutation | ✅ PASS |

---

## Remaining Gaps (not addressed in Step 11)

| Gap | Reason Not Addressed | Recommended Action |
|---|---|---|
| Browser-level dashboard E2E | Playwright not available on host | Add `@playwright/test` to devDependencies in Step 12; write 5-step smoke test |
| Funded Solana settlement reproduction | Missing `subscriptions_program.so` binary | Provide binary or build from source (program-v0.5.0) |
| Multi-process concurrent budget enforcement | Requires running two Node processes simultaneously | Integration test using `spawn`; add in Step 12+ |
| Automated database backup + restore | No restore test exists | Add `scripts/backup-restore-verify.ts` in Step 12 |
| SDK `isReplay` on `ProxyResult` | SDK does not expose this field | Add to `ProxyResult` type in Step 12 (SDK-02) |
| `/metrics` in OpenAPI spec | Documentation gap only | Update `docs/api/openapi.yaml` |
| Mobile viewport accessibility | No a11y tooling configured | Add `axe-playwright` to E2E suite in Step 12 |
