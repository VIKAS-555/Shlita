# Shlita — Operator Deployment & SRE Runbook

**Architecture:** Single-Instance Stateful Gateway with Persistent SQLite Volume  
**Target Environments:** Staging / Private Pilot Host

---

## 1. Pre-Deployment Configuration Checklist

Before launching the Shlita gateway container, verify all environment variables in `.env`:

```bash
# 1. Environment & Mode
SHLITA_ENV=staging
PORT=4000
SHLITA_ALLOW_SIMULATION=false        # Disable simulated responses for genuine pilot
SHLITA_SEED_DEMO=false               # Disable mock demo agent seeding

# 2. Storage & Backups
SHLITA_DB_PATH=/var/lib/shlita/ledger.db
SHLITA_STATE_DIR=/var/lib/shlita
SHLITA_BACKUP_DIR=/var/lib/shlita/backups

# 3. Authentication Secrets (Must be 32+ char random hex strings)
SHLITA_OPERATOR_KEY=<generate-with-openssl-rand-hex-32>
SHLITA_SESSION_SECRET=<generate-with-openssl-rand-hex-32>
SHLITA_OPERATOR_ORG=pilot-org-alpha

# 4. Upstream Vendor Credentials (Server-Held)
HELIUS_API_KEY=<pilot-helius-key>
TAVILY_API_KEY=<pilot-tavily-key>

# 5. Solana Network Controls (Devnet Only for Pilot)
SOLANA_NETWORK=devnet
SHLITA_ALLOW_MAINNET=false
```

---

## 2. Container Launch & Volume Verification

1. **Build Container Image:**
   ```bash
   docker build -t shlita:pilot .
   ```
2. **Launch with Persistent Storage:**
   ```bash
   docker compose up -d
   ```
3. **Verify Health Endpoints:**
   ```bash
   curl -f http://127.0.0.1:4010/health
   curl -f http://127.0.0.1:4010/ready
   ```
   Both endpoints must return `HTTP 200 OK`.

---

## 3. Reverse Proxy & TLS Termination (MANDATORY FOR EXTERNAL ACCESS)

> [!CRITICAL]
> The Shlita Node.js process does not terminate TLS natively. Never expose port 4000/4010 directly to the public internet. Place Shlita behind a TLS reverse proxy (Caddy, Nginx, or Cloudflare Tunnel).

### Example Caddyfile (Automatic Let's Encrypt HTTPS):
```caddy
gateway.pilot.shlita.internal {
    reverse_proxy 127.0.0.1:4010 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

---

## 4. Daily Hot Backups & Integrity Monitoring

1. **Schedule Automated Daily Snapshot via Cron:**
   ```bash
   # Daily backup at 02:00 UTC
   0 2 * * * docker exec shlita npm run backup >> /var/log/shlita-backups.log 2>&1
   ```
2. **Verify Backup Integrity:**
   ```bash
   docker exec shlita node --import tsx packages/gateway/src/backup-cli.ts
   # Returns: {"event":"backup","file":"...","integrity":"ok"}
   ```
3. **Restore Drill (Off-Host Validation):**
   ```bash
   docker exec shlita node --import tsx packages/gateway/src/restore-cli.ts /var/lib/shlita/backups/latest.db /tmp/test-restore.db
   ```

---

## 5. Metrics & SRE Monitoring

Shlita exposes standard operational counters at `GET /metrics`:
- **`shlita_requests_total`**: Total incoming HTTP requests by route and status.
- **`shlita_policy_evaluations_total`**: Count of requests approved vs blocked by policy engine.
- **`shlita_reservations_active`**: In-flight two-phase commit reservation locks.
- **`shlita_circuit_breaker_trips_total`**: Rolling burst loops intercepted.

**Alerting Thresholds:**
- **Trigger Level 1 Alert:** Gateway `GET /ready` returns non-200 for >30 seconds.
- **Trigger Level 1 Alert:** Rate of `HTTP 409 IDEMPOTENCY_CONFLICT` spikes (>10/min), indicating client integration defect.
- **Trigger Level 2 Alert:** Circuit breaker trips on any production agent.
