# Shlita Site Reliability & Incident Response Runbook

**Document Reference:** `docs/step-8/INCIDENT_RESPONSE.md`  
**Parent Milestone:** Step 8 — Pilot Deployment Blueprint & Release-Gate Closure  
**Baseline Git Commit:** `4d461c5b1edb63db802674c4cb827a91b211627a`  
**Classification:** Operational Security & Reliability Protocol  

---

## 1. Incident Severity Definitions & Escalation Matrix

| Severity | Definition | MTTA (Acknowledge) | MTTC (Containment) | Target Resolution | Escalation Authority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEV-1 (Critical)** | Financial leakage, unauthorized spend, double-spend invariant violation, database corruption, unhandled container crash loop. | < 5 minutes | < 15 minutes | < 2 hours | Lead Platform Architect & Security Lead |
| **SEV-2 (High)** | Upstream LLM proxy outage, sustained latency > 2,000ms, circuit breaker tripped, Solana Devnet RPC partitioning. | < 15 minutes | < 45 minutes | < 6 hours | On-Call SRE Engineer |
| **SEV-3 (Medium)** | Read-only telemetry lag, non-critical backup warning, admin dashboard UI connectivity glitch. | < 1 hour | < 4 hours | < 24 hours | On-Duty Platform Operator |

---

## 2. Emergency Escalation Roster & Contacts

*(Note: The following contacts are illustrative templates for pilot staging configuration; replace with active partner escalation webhooks upon provisioning.)*

- **Primary SRE On-Call:** `sre-oncall@shlita.internal` (PagerDuty: `shlita-staging-sre`)
- **Security Incident Commander:** `security@shlita.internal`
- **Partner Technical Liaison:** `partner-ops@pilot-partner.example.com`
- **Bridge Channel:** `#incident-shlita-pilot` (Slack / Discord internal)

---

## 3. Incident Containment Runbooks

### Runbook A: Runaway Agent Spending Loop (SEV-1)
*Symptom: Agent transaction velocity surges, approaching or attempting to exceed velocity caps.*

1. **Immediate Egress Freeze (Containment in < 30 seconds):**
   ```bash
   curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/agents/{AGENT_ID}/freeze \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}" \
     -H "Content-Type: application/json" \
     -d '{"reason": "SEV-1 Runaway spending surge detected"}'
   ```
2. **Audit Real-Time Spend & Ledger Records:**
   ```sql
   SELECT id, agent_id, reserved_cents, settled_cents, status, created_at 
   FROM reservations 
   WHERE agent_id = '{AGENT_ID}' 
   ORDER BY created_at DESC LIMIT 50;
   ```
3. **Verify Ledger Balance Protection:**
   Confirm that Shlita's policy engine successfully blocked transactions exceeding the $5.00 / $10.00 boundaries.
4. **Partner Notification Template:**
   > *"Notice: Agent `{AGENT_ID}` has been temporarily frozen on the Shlita Staging Gateway due to abnormal request velocity (exceeded 30 req/min). No financial leakage occurred; policy limits successfully halted unauthorized spend. Please inspect your agent loop logic before unfreezing."*
5. **Post-Mortem Root Cause Analysis:**
   Inspect caller stack trace and request headers to identify agent recursive prompt loop.

---

### Runbook B: Upstream LLM Outage & Timeout Wave (SEV-2)
*Symptom: Upstream LLM provider returns 504 / 502 or response latency exceeds 10 seconds.*

1. **Verify Circuit Breaker Activation:**
   ```bash
   curl -s https://staging-gateway.shlita.internal/v1/operator/circuit-breaker \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
   ```
   If circuit breaker is `OPEN`, verify that incoming agent requests receive fast-fail `503 Service Unavailable` without reserving budget.
2. **Audit In-Flight Pending Reservations:**
   ```sql
   SELECT count(*), sum(reserved_cents) 
   FROM reservations 
   WHERE status = 'pending' AND created_at < datetime('now', '-30 seconds');
   ```
3. **Trigger Stale Reservation Sweep:**
   If uncommitted reservations exist from dropped provider connections, trigger the automated rollback sweep:
   ```bash
   curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/reservations/reconcile-stale \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
   ```
   *Ensures agent budget is immediately restored without waiting for TTL expiration.*

---

### Runbook C: Compromised Agent Token / Unauthorized Access (SEV-1)
*Symptom: Suspicious IP origin or unauthorized API call signature detected.*

1. **Immediate Token Invalidation:**
   ```bash
   curl -s -X POST https://staging-gateway.shlita.internal/v1/operator/agents/{AGENT_ID}/revoke-key \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
   ```
2. **Block Offending IP Address at Caddy Ingress:**
   Edit `/etc/caddy/Caddyfile`:
   ```caddy
   @blocked remote_ip {OFFENDING_IP}
   abort @blocked
   ```
   Reload Caddy proxy:
   ```bash
   caddy reload --config /etc/caddy/Caddyfile
   ```
3. **Forensic Audit:**
   Extract full audit trail for the compromised credential:
   ```bash
   curl -s "https://staging-gateway.shlita.internal/v1/operator/audit-log?agentId={AGENT_ID}&limit=500" \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}" > /tmp/forensic_audit_{AGENT_ID}.json
   ```

---

### Runbook D: Database Corruption or File Lock Failure (SEV-1)
*Symptom: Gateway throws `SQLITE_CORRUPT`, `SQLITE_BUSY`, or container fails to boot.*

1. **Stop Failing Gateway Container:**
   ```bash
   docker stop shlita-gateway
   ```
2. **Execute Database Integrity Inspection:**
   ```bash
   sqlite3 /var/lib/shlita/data/shlita.db "PRAGMA integrity_check;"
   ```
3. **If Database Corrupted — Initiate Disaster Recovery from Latest Backup:**
   ```bash
   LATEST_BACKUP=$(ls -t /var/lib/shlita/backups/*.db.bak | head -n 1)
   echo "Restoring from: ${LATEST_BACKUP}"
   
   # Verify backup integrity first
   sqlite3 "${LATEST_BACKUP}" "PRAGMA integrity_check;"
   
   # Restore with explicit overwrite authorization
   SHLITA_RESTORE_SOURCE="${LATEST_BACKUP}" \
   SHLITA_DB_PATH="/var/lib/shlita/data/shlita.db" \
   SHLITA_RESTORE_OVERWRITE=true \
   node /app/packages/gateway/dist/restore-cli.js
   ```
4. **Restart Container & Validate Recovery:**
   ```bash
   docker start shlita-gateway
   curl -s http://127.0.0.1:4000/ready
   ```

---

### Runbook E: Solana Devnet RPC Partition & Settlement Lag (SEV-2)
*Symptom: Devnet transactions timing out or returning slot skipped errors.*

1. **Inspect Settlement Retry Queue:**
   ```bash
   curl -s https://staging-gateway.shlita.internal/v1/operator/solana/queue \
     -H "x-operator-key: ${SHLITA_OPERATOR_KEY}"
   ```
2. **Verify Local Ledger Decoupling:**
   Ensure gateway continues servicing HTTP agent requests and reservations locally. Shlita's asynchronous settlement queue buffers on-chain commits without blocking real-time agent execution.
3. **Switch Devnet RPC Endpoint (If public cluster is overloaded):**
   Update `SOLANA_RPC_URL` in `.env` from `https://api.devnet.solana.com` to secondary RPC provider (e.g. Helius / QuickNode Devnet) and trigger smooth restart:
   ```bash
   docker restart shlita-gateway
   ```

---

## 4. Post-Incident Review & RCA Standards

Following the resolution of any SEV-1 or SEV-2 incident, an engineering blameless post-mortem must be published within 24 hours containing:
1. Exact Incident Timeline (UTC timestamps for Detection, Escalation, Containment, and Restoration).
2. Root Cause Analysis using the 5-Whys methodology.
3. Financial Impact Statement (Exact amount reserved, settled, or lost).
4. Action Items with assigned engineers and target PR completion dates.
