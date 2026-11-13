# Step 11 — CI and Deployment Evidence

**Date:** 2026-11-13  
**Auditor:** Antigravity (independent re-verification)

---

## 1. GitHub Actions Workflow Structure

**File:** `.github/workflows/deploy.yml`  
**Trigger:** `push` to `main`, pull requests, `workflow_dispatch`

### Jobs

| Job | Runs on | Purpose |
|---|---|---|
| `build` | `ubuntu-latest` | npm ci, test, SDK consumer check, Solana local (BLOCKED acceptable), UI build, upload Pages artifact |
| `image` | `ubuntu-latest` | Docker build, fail-closed production startup check, container persistence test (stop/start with SQLite volume) |
| `deploy` | `ubuntu-latest` | Deploy `dist-ui/` to GitHub Pages (main branch only) |
| `staging` | `ubuntu-latest` | Build and push Docker image to GHCR; pull and verify node version (main branch only) |

### Latest CI Runs — All ✅ Passed

| Run | Branch | Event | Status |
|---|---|---|---|
| Merge PR #11 | main | push | ✅ |
| feature/step-9-10-audit | feature branch | pull_request | ✅ |
| Merge PR #10 | main | push | ✅ |
| feature/step-8-pilot-blueprint | feature branch | pull_request | ✅ |
| Merge PR #9 | main | push | ✅ |

---

## 2. Container Evidence

| Level | Status | Evidence |
|---|---|---|
| Docker image builds | ✅ VERIFIED IN CI | `docker build -t shlita:step5 .` in `image` job |
| Production fails closed | ✅ VERIFIED IN CI | `docker run -e SHLITA_ENV=production shlita:step5` exits non-zero |
| Container restarts with persistent SQLite | ✅ VERIFIED IN CI | Stop/start cycle; `GET /v1/operations` returns persisted data |
| Image pushed to GHCR | ✅ IN WORKFLOW | `ghcr.io/xiaoarnav/shlita-gateway:staging` and `:${{ github.sha }}` pushed via `docker/build-push-action` |
| Container pulled and node version verified | ✅ IN WORKFLOW | `docker pull && docker run ... node -v` |
| Running container accepting external traffic | ⚠️ CI-INTERNAL ONLY | Container runs at `127.0.0.1:4010` within the CI runner; no public port exposed |
| Public HTTPS gateway (persistent, monitored) | ❌ NOT DEPLOYED | See section 3 |

---

## 3. Public HTTPS Gateway Status

**Status: NOT DEPLOYED**

The `staging` job in the CI workflow:
- Builds and pushes the image to GHCR ✅
- Pulls and runs `node -v` to confirm the image is accessible ✅
- Does **NOT** deploy the container to any persistent hosting provider
- The `environment: url` is set to `https://xiaoarnav.github.io/Shlita/` — this is the GitHub Pages URL for the **React UI** (a static SPA), not the Node.js gateway API

**Consequence:** There is no live public HTTPS endpoint for the Shlita gateway API. The GitHub Pages deployment hosts only the static dashboard frontend.

---

## 4. Dockerfile — Base Image

**Verified:** `FROM node:22-bookworm-slim` (both `build` and `runtime` stages)

> Step 8 documentation claimed an Alpine container. This is **incorrect**. The actual base image is **Debian Bookworm Slim**.

---

## 5. Health Endpoints

| Endpoint | Location in code | CI verified |
|---|---|---|
| `GET /health` | `app.ts:431` | ✅ Via container test `curl /ready` (ready implies health) |
| `GET /ready` | `app.ts:442` | ✅ Explicitly via `curl -sf http://127.0.0.1:4010/ready` in CI |
| `GET /metrics` | `app.ts:448` | In code; not in CI or OpenAPI spec |

> Step 8 documentation referenced `/healthz`. This endpoint does **not exist**. The correct path is `/health` and `/ready`.

---

## 6. Monitoring Status

**Status:** ❌ NOT CONFIGURED

No monitoring, alerting, or observability stack (Prometheus, Grafana, Datadog, etc.) is configured. The `/metrics` endpoint exists but is not connected to any external monitoring system. This is a known gap and a prerequisite for Step 12 (persistent HTTPS staging deployment).

---

## 7. Backup and Recovery

| Capability | Status |
|---|---|
| SQLite WAL mode | ✅ Configured in `db.ts` |
| Docker volume persistence | ✅ Verified in CI (stop/start test) |
| Backup directory configured | ✅ `/var/lib/shlita/backups` created in Dockerfile |
| Automated backup job | ❌ Not configured — manual or external cron required |
| Restore verification test | ❌ Not tested in CI |
