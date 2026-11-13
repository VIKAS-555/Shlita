# Step 11 — Step 12 Prerequisites

**Date:** 2026-11-13

---

## Step 12 Goal

**PERSISTENT HTTPS STAGING DEPLOYMENT**  
Deploy the Shlita gateway to a real, persistent, publicly accessible HTTPS endpoint backed by a durable SQLite volume, with automated health monitoring.

---

## Open Prerequisites

### P1 — Hosting Provider (REQUIRED)
No persistent host has been provisioned. The `staging` CI job publishes an image to GHCR but does not deploy it anywhere. A hosting provider must be chosen and configured:

**Options (in order of simplicity):**
- **Railway** — Docker-native, persistent volumes, automatic HTTPS
- **Render** — Docker deploy, free tier available, persistent disk
- **Fly.io** — Docker-native, volumes, global edge, free tier
- **DigitalOcean App Platform** — Managed Docker, persistent storage
- **Hetzner VPS** — Manual, cheapest long-term option

**Action:** Choose a provider, add deploy step to `deploy.yml`, provision volume at `/var/lib/shlita`.

### P2 — TLS Certificate (REQUIRED)
No TLS certificate is managed. GitHub Pages provides HTTPS for the static UI, but the gateway API has no public HTTPS endpoint.

**Action:** Hosting provider typically handles TLS termination automatically (Railway, Render, Fly.io all do).

### P3 — Persistent Operator Key (REQUIRED)
The current CI container test uses a randomly generated operator key. A staging deployment needs a stable operator key stored as a repository secret.

**Action:** Create GitHub Actions secret `SHLITA_STAGING_OPERATOR_KEY` and reference it in the deploy step.

### P4 — Staging Database Persistence (REQUIRED)
The staging host needs a persistent volume mapped to `/var/lib/shlita`. Without this, the ledger resets on every deploy.

**Action:** Configure persistent storage in the chosen hosting provider before first deploy.

### P5 — Health Monitoring (REQUIRED for Step 12 completion)
No monitoring is configured. Step 12 must include at minimum:
- Uptime check on `GET /ready` with alerting
- Basic latency monitoring on `/v1/proxy`

**Options:** UptimeRobot (free), Betterstack, Grafana Cloud free tier.

### P6 — Public HTTPS URL in Documentation
Once deployed, update:
- `docs/step-8/DEPLOYMENT_BLUEPRINT.md` — replace placeholder URL
- `README.md` — add staging gateway URL
- `docs/api/openapi.yaml` — update `servers[0].url`

### P7 — Fix Documentation Errors (SHOULD DO before Step 12)
Three contradictions found in existing docs (see `CLAIM_EVIDENCE_REGISTER.md`):
- SDK package name: `@shlita/sdk` → `shlita-sdk`
- Docker base image: Alpine → `node:22-bookworm-slim`
- Health endpoint: `/healthz` → `/health` and `/ready`

### P8 — Browser E2E Test (COMPLETED IN STEP 11)
Resolved in Step 11 via Playwright and Chromium. Verified in [GitHub Actions run 43374212468](https://github.com/XiaoArnav/Shlita/actions/runs/43374212468) using the command `npm run test:browser`. It records one passing Playwright Chromium test covering:
1. Operator sign-in and session cookie initialization
2. Agent enrollment and single-view API key issuance
3. Live spend and telemetry updates without reloading
4. Freeze persistence after reload
5. Sign-out and return to login screen

### P9 — `/metrics` OpenAPI Documentation (LOW PRIORITY)
The `/metrics` endpoint exists in the gateway but is not in `docs/api/openapi.yaml`.

---

## Items That Are Already Ready

| Item | Status |
|---|---|
| Docker image exists and is published to GHCR | ✅ Ready |
| Container passes production fail-closed test | ✅ Ready |
| Container persistence (SQLite WAL + volume) | ✅ Ready |
| Gateway API: all 17 endpoints implemented | ✅ Ready |
| Security: SSRF, CSRF, auth, org isolation | ✅ Ready |
| Financial invariants: all 8 implemented and tested | ✅ Ready |
| SDK: `shlita-sdk` installable from tarball | ✅ Ready |
| TypeScript builds clean | ✅ Ready |
| 106 automated tests pass + 1 Playwright browser E2E test | ✅ Ready (Step 11) |
| Dashboard browser E2E verification (Chromium) | ✅ Ready (Step 11, Run 43374212468) |

---

## Blocking vs Non-Blocking

| Item | Blocks Step 12? |
|---|---|
| Hosting provider provisioning | 🔴 YES |
| TLS certificate | 🔴 YES |
| Persistent operator key (secret) | 🔴 YES |
| Persistent volume | 🔴 YES |
| Health monitoring | ⚠️ SHOULD HAVE |
| Browser E2E test | ✅ COMPLETED in Step 11 (Run 43374212468) |
| Documentation error fixes | ⚠️ SHOULD HAVE |
| Funded Solana test reproduction | ✅ Not required for Step 12 (staging can use simulation mode) |
