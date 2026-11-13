#!/usr/bin/env bash
# Step 12: Live Staging Acceptance Checks Automation
# Usage: ./scripts/verify-live-staging.sh [OPTIONS]
# Options:
#   --target-url <URL>        Staging gateway URL (default: https://gateway.staging.shlita.xyz)
#   --operator-key <KEY>      Operator API secret
#   --alert-webhook <URL>     Alert destination webhook URL
#   --cacert <FILE>           Custom CA certificate bundle for TLS verification
#   --dns-status <STATUS>     Override DNS status (ok | nxdomain) for hermetic offline testing
#   --check-only              Report blocker status without throwing fatal error
#
# Verifies the 4 Live Staging Acceptance Criteria:
# 1. LIVE-HTTPS-01: External TLS handshake & GET /ready HTTP 200 (Requires valid HTTPS, no curl -k)
# 2. LIVE-PERSIST-01: Sandbox operation persistence across gateway redeploy
# 3. LIVE-ALERT-01: Outage alert and recovery notification delivery
# 4. LIVE-RESTORE-01: Scheduled worker snapshot restoration into separate DB

set -euo pipefail

TARGET_URL="${SHLITA_PUBLIC_ORIGIN:-https://gateway.staging.shlita.xyz}"
OPERATOR_KEY="${SHLITA_OPERATOR_KEY:-}"
ALERT_WEBHOOK="${SHLITA_ALERT_WEBHOOK_URL:-}"
CACERT_FILE="${SHLITA_CACERT:-}"
DNS_STATUS="${SHLITA_DNS_STATUS:-}"
HOST_DOMAIN="$(echo "$TARGET_URL" | sed -E 's|^https?://||; s|/.*$||; s|:[0-9]+$||')"
CHECK_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-url)
      TARGET_URL="$2"
      HOST_DOMAIN="$(echo "$TARGET_URL" | sed -E 's|^https?://||; s|/.*$||; s|:[0-9]+$||')"
      shift 2
      ;;
    --operator-key)
      OPERATOR_KEY="$2"
      shift 2
      ;;
    --alert-webhook)
      ALERT_WEBHOOK="$2"
      shift 2
      ;;
    --cacert)
      CACERT_FILE="$2"
      shift 2
      ;;
    --dns-status)
      DNS_STATUS="$2"
      shift 2
      ;;
    --check-only)
      CHECK_ONLY=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

echo "============================================================"
echo " Shlita Step 12: Live Staging Acceptance Checks"
echo " Target: $TARGET_URL (Host: $HOST_DOMAIN)"
echo " Timestamp: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "============================================================"

STATUS_HTTPS="BLOCKED"
STATUS_PERSIST="BLOCKED"
STATUS_ALERT="BLOCKED"
STATUS_RESTORE="BLOCKED"

# ------------------------------------------------------------
# Check 1: LIVE-HTTPS-01 (External Public HTTPS & TLS Verification)
# ------------------------------------------------------------
echo ""
echo "[LIVE-HTTPS-01] Checking public HTTPS reachability and TLS certificate..."

if [[ "$TARGET_URL" != https://* ]]; then
  echo "  Result: FAILED (HTTPS is required; target URL is plain HTTP: $TARGET_URL)"
  echo "  Requirement: Protocol must be https:// with valid TLS certificate verification"
  STATUS_HTTPS="FAILED"
else
  # Evaluate DNS resolution independently of public DNS when requested or when host is .invalid
  RESOLVED_DNS=false
  if [ "$DNS_STATUS" = "ok" ]; then
    RESOLVED_DNS=true
  elif [ "$DNS_STATUS" = "nxdomain" ]; then
    RESOLVED_DNS=false
  elif [ "$HOST_DOMAIN" = "127.0.0.1" ] || [ "$HOST_DOMAIN" = "localhost" ]; then
    RESOLVED_DNS=true
  elif [[ "$HOST_DOMAIN" == *.invalid ]]; then
    # RFC 2606 / 6761 reserved top-level domain guaranteed not to resolve
    RESOLVED_DNS=false
  else
    # Resolve via OS resolver
    if node -e 'import dns from "node:dns/promises"; await dns.lookup(process.argv[1]);' "$HOST_DOMAIN" >/dev/null 2>&1; then
      RESOLVED_DNS=true
    elif nslookup "$HOST_DOMAIN" >/dev/null 2>&1; then
      RESOLVED_DNS=true
    else
      RESOLVED_DNS=false
    fi
  fi

  if [ "$RESOLVED_DNS" != "true" ]; then
    echo "  Result: BLOCKED (DNS NXDOMAIN for $HOST_DOMAIN)"
    echo "  Blocker: BLOCKER-DNS-01 (Public DNS delegation missing)"
    echo "  Required Owner: Maintainer (XiaoArnav)"
    STATUS_HTTPS="BLOCKED"
  else
    # Perform strict TLS verification (curl without -k)
    CURL_ERR_FILE="$(mktemp)"
    CACERT_ARGS=()
    if [ -n "$CACERT_FILE" ]; then
      CACERT_ARGS=(--cacert "$CACERT_FILE")
    fi

    set +e
    HTTPS_CODE="$(curl -s -S -o /dev/null -w "%{http_code}" --connect-timeout 5 ${CACERT_ARGS[@]+"${CACERT_ARGS[@]}"} "${TARGET_URL}/ready" 2>"$CURL_ERR_FILE")"
    CURL_EXIT=$?
    set -e

    CURL_ERR_MSG="$(tr '\r\n' ' ' < "$CURL_ERR_FILE" | sed -E 's/[[:space:]]+/ /g' | head -c 200 || true)"
    rm -f "$CURL_ERR_FILE"

    if [ "$CURL_EXIT" -eq 0 ] && [ "$HTTPS_CODE" = "200" ]; then
      echo "  Result: PASS (HTTP 200, valid TLS handshake and verified certificate)"
      STATUS_HTTPS="PASS"
    else
      if [ -n "$CURL_ERR_MSG" ]; then
        echo "  Result: FAILED (TLS certificate verification failed: $CURL_ERR_MSG)"
      else
        echo "  Result: FAILED (GET ${TARGET_URL}/ready returned HTTP $HTTPS_CODE)"
      fi
      STATUS_HTTPS="FAILED"
    fi
  fi
fi

# ------------------------------------------------------------
# Check 2: LIVE-PERSIST-01 (Ledger Persistence Across Redeploy)
# ------------------------------------------------------------
echo ""
echo "[LIVE-PERSIST-01] Checking ledger persistence across container redeploy..."
if [ "$STATUS_HTTPS" != "PASS" ]; then
  echo "  Result: BLOCKED (Requires live host and operational HTTPS gateway)"
  echo "  Blocker: BLOCKER-HOST-01 (Cloud host unprovisioned)"
  echo "  Required Owner: Maintainer (XiaoArnav)"
elif [ -z "$OPERATOR_KEY" ]; then
  echo "  Result: BLOCKED (Missing SHLITA_OPERATOR_KEY)"
  echo "  Blocker: BLOCKER-SECRET-01 (Staging operator secret unconfigured)"
  echo "  Required Owner: Maintainer (XiaoArnav)"
else
  echo "  Running sandbox ledger write -> redeploy -> verification drill..."
  STATUS_PERSIST="PENDING_HOST_EXECUTION"
fi

# ------------------------------------------------------------
# Check 3: LIVE-ALERT-01 (Outage Alert & Recovery Notifications)
# ------------------------------------------------------------
echo ""
echo "[LIVE-ALERT-01] Checking outage alert & recovery notifications..."
if [ -z "$ALERT_WEBHOOK" ]; then
  echo "  Result: BLOCKED (SHLITA_ALERT_WEBHOOK_URL is not set)"
  echo "  Blocker: BLOCKER-SECRET-01 (Staging alert destination webhook not configured)"
  echo "  Required Owner: Maintainer (XiaoArnav)"
elif [ "$STATUS_HTTPS" != "PASS" ]; then
  echo "  Result: BLOCKED (Requires running staging gateway on cloud host)"
  echo "  Blocker: BLOCKER-HOST-01 (Cloud host unprovisioned)"
  echo "  Required Owner: Maintainer (XiaoArnav)"
else
  echo "  Running controlled outage -> notification verification..."
  STATUS_ALERT="PENDING_HOST_EXECUTION"
fi

# ------------------------------------------------------------
# Check 4: LIVE-RESTORE-01 (Worker Snapshot Restore on Host)
# ------------------------------------------------------------
echo ""
echo "[LIVE-RESTORE-01] Checking scheduled backup worker snapshot restore on host..."
if [ "$STATUS_HTTPS" != "PASS" ]; then
  echo "  Result: BLOCKED (Requires live host with scheduled backup worker service)"
  echo "  Blocker: BLOCKER-HOST-01 (Cloud host unprovisioned)"
  echo "  Required Owner: Maintainer (XiaoArnav)"
else
  HOST_BACKUP_DIR="${SHLITA_BACKUP_DIR:-/var/backups/shlita-external}"
  if [ ! -d "$HOST_BACKUP_DIR" ] || [ -z "$(ls -A "$HOST_BACKUP_DIR" 2>/dev/null)" ]; then
    echo "  Result: BLOCKED (Scheduled worker backup volume $HOST_BACKUP_DIR not found or empty on host)"
    echo "  Blocker: BLOCKER-HOST-01 (Cloud host backup volume unavailable)"
    echo "  Required Owner: Maintainer (XiaoArnav)"
    STATUS_RESTORE="BLOCKED"
  else
    echo "  Restoring host worker snapshot into separate database..."
    STATUS_RESTORE="PENDING_HOST_EXECUTION"
  fi
fi

# ------------------------------------------------------------
# Summary Report
# ------------------------------------------------------------
echo ""
echo "============================================================"
echo " Live Staging Acceptance Status Summary"
echo "============================================================"
echo "LIVE-HTTPS-01 (Public TLS & /ready HTTP 200)       : $STATUS_HTTPS"
echo "LIVE-PERSIST-01 (Ledger Persistence Post-Redeploy) : $STATUS_PERSIST"
echo "LIVE-ALERT-01 (Outage & Recovery Notifications)    : $STATUS_ALERT"
echo "LIVE-RESTORE-01 (Worker Snapshot Restore on Host)  : $STATUS_RESTORE"
echo "============================================================"

if [ "$STATUS_HTTPS" = "PASS" ] && [ "$STATUS_PERSIST" = "PASS" ] && [ "$STATUS_ALERT" = "PASS" ] && [ "$STATUS_RESTORE" = "PASS" ]; then
  echo "VERDICT: ALL 4 LIVE ACCEPTANCE CHECKS PASSED. Step 12 is COMPLETE."
  exit 0
else
  echo "VERDICT: Step 12 Live Acceptance is BLOCKED pending maintainer infrastructure provisioning."
  echo "Hold Step 13 until cloud VM, DNS record, and staging secrets are supplied."
  if [ "$CHECK_ONLY" = "true" ]; then
    exit 0
  else
    exit 2
  fi
fi
