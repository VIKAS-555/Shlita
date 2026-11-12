# Shlita — Step 9: Pilot Runbook

**Purpose:** Step-by-step operational guide for launching and managing a controlled Shlita pilot with external developer partners.

---

## Pre-Pilot Checklist

- [ ] All 98 tests pass on the deployment commit
- [ ] Container image tagged and pushed to GHCR
- [ ] VM provisioned with persistent storage
- [ ] TLS certificate active (Caddy auto-renewal)
- [ ] Environment variables set (see `.env.example`)
- [ ] Backup schedule configured
- [ ] Log forwarding active
- [ ] Alert webhooks verified
- [ ] Pilot partner list finalized (max 3 organizations)
- [ ] Emergency contacts documented

---

## 1. Infrastructure Provisioning

```bash
# 1.1 Provision VM (example: Fly.io or Hetzner)
# Minimum: 2 vCPU, 4GB RAM, 50GB NVMe SSD
# OS: Ubuntu 24.04 LTS with Docker CE installed

# 1.2 Pull the verified container image
docker pull ghcr.io/xiaoarnav/shlita-gateway:staging

# 1.3 Create persistent data directory
sudo mkdir -p /var/lib/shlita/data
sudo mkdir -p /var/lib/shlita/backups
sudo chown -R 1000:1000 /var/lib/shlita
```

---

## 2. Gateway Deployment

```bash
# 2.1 Create environment file
cat > /opt/shlita/.env <<'EOF'
NODE_ENV=production
SHLITA_PORT=4000
SHLITA_DATA_DIR=/var/lib/shlita/data
SHLITA_OPERATOR_KEY=<generated-operator-key>
SHLITA_OPERATOR_ORG=org_pilot_alpha
SHLITA_SIMULATION=false
# Add provider credentials for upstream services:
# HELIUS_API_KEY=<key>
# TAVILY_API_KEY=<key>
EOF

# 2.2 Start with Docker Compose
cd /opt/shlita
docker compose up -d

# 2.3 Verify health
curl -s http://localhost:4000/ready
# Expected: HTTP 200, {"status":"ok"}
```

---

## 3. TLS Termination (Caddy)

```bash
# 3.1 Install Caddy
sudo apt install caddy

# 3.2 Configure reverse proxy
cat > /etc/caddy/Caddyfile <<'EOF'
gateway.pilot.shlita.xyz {
    reverse_proxy localhost:4000
    log {
        output file /var/log/caddy/shlita.log
    }
}
EOF

# 3.3 Start Caddy (auto-provisions TLS via Let's Encrypt)
sudo systemctl restart caddy

# 3.4 Verify HTTPS
curl -s -I https://gateway.pilot.shlita.xyz/ready
# Expected: HTTP/2 200 with valid TLS
```

---

## 4. Partner Onboarding

```bash
# 4.1 Enroll pilot partner organization
# (via operator session or direct API call)
curl -X POST https://gateway.pilot.shlita.xyz/v1/agents \
  -H "x-shlita-operator-key: $OPERATOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "partner-alpha-agent-1",
    "budgetMicroUsdc": 100000,
    "perCallLimitMicroUsdc": 25000,
    "vendors": ["api.openai.com", "api.anthropic.com"]
  }'
# Response includes the agent API key (shown ONCE)

# 4.2 Distribute to partner
# - Agent API key (secure channel only)
# - SDK installation: npm install <tarball-url>
# - Quickstart guide: docs/sdk/quickstart.md
```

---

## 5. Monitoring & Alerting

```bash
# 5.1 Health check (every 60 seconds)
# Configure uptime monitor to poll:
# GET https://gateway.pilot.shlita.xyz/ready

# 5.2 Prometheus metrics
# Scrape endpoint: GET https://gateway.pilot.shlita.xyz/metrics
# Key metrics:
#   shlita_operations_total — total operation count
#   shlita_operations_approved — approved reservations
#   shlita_operations_rejected — policy rejections
#   shlita_circuit_breaker_trips — circuit breaker activations

# 5.3 Log monitoring
# Tail structured JSON logs from Docker:
docker logs -f shlita-gateway --since 1h | jq .
```

---

## 6. Daily Operations

### 6.1 Backup (Run Daily)
```bash
# Online hot backup (does not stop the server)
docker exec shlita-gateway node dist/backup-cli.js
# Output: {"event":"backup","integrity":"ok"}

# Copy backup to off-site storage
cp /var/lib/shlita/backups/latest.db /backup/shlita-$(date +%Y%m%d).db
```

### 6.2 Budget Review
```bash
# Check aggregate spend across all pilot agents
curl -s https://gateway.pilot.shlita.xyz/v1/operations \
  -H "x-shlita-operator-key: $OPERATOR_KEY" | jq '.summary'
```

### 6.3 Freeze Agent (Emergency)
```bash
# Immediately halt all spending for a specific agent
curl -X POST https://gateway.pilot.shlita.xyz/v1/agents/<agent-id>/freeze \
  -H "x-shlita-operator-key: $OPERATOR_KEY" \
  -H "x-shlita-csrf: $CSRF_TOKEN"
```

---

## 7. Incident Response Quick Reference

| Severity | Trigger | Action |
|---|---|---|
| **SEV-1** | Overspend detected | Freeze all agents → backup database → investigate ledger |
| **SEV-1** | Gateway unreachable | Check VM, Docker status, disk space |
| **SEV-2** | Circuit breaker trips | Review agent behavior → reset if false positive |
| **SEV-2** | Database lock timeout | Verify single-instance (no duplicate containers) |
| **SEV-3** | Partner reports SDK error | Check agent enrollment, API key validity, policy config |

**Full incident response playbook:** `docs/step-8/INCIDENT_RESPONSE.md`

---

## 8. Pilot Exit Criteria

The pilot is considered successful when:

- [ ] At least 2 external developers have connected agents via the SDK
- [ ] At least 100 financial operations have been processed without overspend
- [ ] Zero security incidents (unauthorized access, credential leaks)
- [ ] Uptime ≥ 99% over the pilot period
- [ ] Backup/restore cycle tested at least once
- [ ] All circuit breaker trips were genuine (no false positives)
- [ ] Partner feedback collected and documented

---

## 9. Pilot Shutdown Procedure

```bash
# 9.1 Notify all partners of shutdown window
# 9.2 Final backup
docker exec shlita-gateway node dist/backup-cli.js

# 9.3 Freeze all agents (prevent new operations)
# (via operator dashboard or API)

# 9.4 Wait for in-flight operations to complete (30 seconds)
sleep 30

# 9.5 Stop gateway
docker compose down

# 9.6 Archive database and logs
tar czf shlita-pilot-archive-$(date +%Y%m%d).tar.gz /var/lib/shlita/
```

---

## 10. Rollback Procedure

If a critical issue is discovered during the pilot:

1. **Freeze all agents** immediately via operator API
2. **Create emergency backup** of the current database
3. **Stop the gateway** container
4. **Restore from known-good backup** using `restore-cli.ts`
5. **Restart the gateway** and verify `/ready` returns 200
6. **Notify partners** of the incident and expected resolution
