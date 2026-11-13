# Step 11 — SDK & API Contract Verification

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)

---

## 1. SDK Package Identity

| Field | Value |
|---|---|
| Package name | `shlita-sdk` |
| Source | `packages/sdk/` |
| Build command | `npm run build:sdk` → `tsc -p packages/sdk/tsconfig.json` |
| Output | `packages/sdk/dist/` |

> ⚠️ **Important:** The package name is `shlita-sdk`, NOT `@shlita/sdk`. Step 8 documentation used `@shlita/sdk` in some install instructions — this is incorrect and must not be repeated.

---

## 2. SDK Build Result

**Command:** `npm run build:sdk`  
**Result:** ✅ Exit 0 — No type errors.

---

## 3. External Consumer Test

**Test:** `tests/sdk.consumer.test.ts` — `packs the SDK and runs it from a project outside the repository`  
**Result:** ✅ Pass (1/1) — Duration: ~2.6 s

This test:
1. Runs `npm pack` in `packages/sdk`
2. Creates a temporary directory outside the repository
3. Installs the resulting `.tgz` tarball
4. Imports from `shlita-sdk` and runs a basic smoke test

The external consumer install flow is **verified working**.

---

## 4. SDK Public API Surface

Verified exports from `packages/sdk/src/client.ts`:

| Export | Type | Purpose |
|---|---|---|
| `ShlitaAgentClient` | Class | Agent-side proxy requests |
| `ShlitaOperatorClient` | Class | Operator enrollment, freeze, settlement |
| `ShlitaApiError` | Class | Typed error thrown on HTTP failures |
| `ProxyResult` | Type | Return type for proxy calls |
| `ProxyParams` | Type | Parameters for proxy calls |
| `EnrollAgentParams` | Type | Parameters for agent enrollment |

---

## 5. SDK Behavior vs OpenAPI Spec

### Routes in `docs/api/openapi.yaml` vs implemented in `packages/gateway/src/app.ts`

| OpenAPI Path | Gateway Route | Match |
|---|---|---|
| `GET /health` | `app.get('/health')` | ✅ |
| `GET /ready` | `app.get('/ready')` | ✅ |
| `POST /v1/session` | `app.post('/v1/session')` | ✅ |
| `GET /v1/session` | `app.get('/v1/session')` | ✅ |
| `POST /v1/session/logout` | `app.post('/v1/session/logout')` | ✅ |
| `POST /v1/proxy` | `app.post('/v1/proxy')` | ✅ |
| `GET /v1/agents` | `app.get('/v1/agents')` | ✅ |
| `POST /v1/agents` | `app.post('/v1/agents')` | ✅ |
| `POST /v1/agents/{id}/freeze` | `app.post('/v1/agents/:id/freeze')` | ✅ |
| `POST /v1/agents/{id}/unfreeze` | `app.post('/v1/agents/:id/unfreeze')` | ✅ |
| `POST /v1/agents/{id}/reset-circuit` | `app.post('/v1/agents/:id/reset-circuit')` | ✅ |
| `GET /v1/operations` | `app.get('/v1/operations')` | ✅ |
| `POST /v1/operations/{operationId}/settle` | `app.post('/v1/operations/:operationId/settle')` | ✅ |
| `GET /v1/dashboard` | `app.get('/v1/dashboard')` | ✅ |
| `GET /v1/audit` | `app.get('/v1/audit')` | ✅ |
| `GET /v1/reconciliation` | `app.get('/v1/reconciliation')` | ✅ |
| `GET /v1/telemetry` | `app.get('/v1/telemetry')` | ✅ |
| — | `app.get('/metrics')` | In gateway, not in OpenAPI spec |

**Mismatch found:** `/metrics` endpoint exists in the gateway but is not documented in `docs/api/openapi.yaml`.

---

## 6. SDK Behavior Notes

| Behavior | Description |
|---|---|
| `proxy()` on 504 timeout | Returns resolved `ProxyResult` with `outcome: 'uncertain'` and `reconciliationRequired: true` — does NOT reject the promise |
| `proxy()` on 403 policy violation | Returns resolved `ProxyResult` with `outcome: 'rejected'` — does NOT reject the promise |
| Idempotent replay | Server adds `x-shlita-idempotent-replay: true` header; SDK does not expose an `isReplay` boolean on the returned object |
| `ShlitaApiError` thrown | Only on network-level failures (no response), not on HTTP 4xx/5xx with valid JSON body |

These behaviors are consistent with the OpenAPI spec's description of `ProxyResult` outcomes.

---

## 7. Findings

| ID | Severity | Finding |
|---|---|---|
| SDK-01 | Low | `/metrics` endpoint exists in gateway but is not in OpenAPI spec — documentation gap |
| SDK-02 | Low | SDK does not expose `isReplay` on `ProxyResult`; only exposed via response header; consider adding to `ProxyResult` type in a future step |
| SDK-03 | Medium | Step 8 documentation incorrectly referenced `@shlita/sdk` instead of `shlita-sdk`; already noted in `CLAIM_EVIDENCE_REGISTER.md` |
