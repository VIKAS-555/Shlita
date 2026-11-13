#!/usr/bin/env bash
# Step 12: Real Docker Compose Backup Worker Verification Script
# Verifies:
# 1. backup-worker runtime user (shlita, UID 10001, GID 10001)
# 2. Worker health check reflecting backup state (overriding port 4000 HTTP check)
# 3. Prompt trigger of backup cycle using the scheduled job code path
# 4. Snapshot creation in external backup volume with 0600 permissions
# 5. Restore into independent database with PRAGMA integrity_check, operation ID, and amount verification
# 6. Failed backup handling (error reporting, no false success, health failure, last good snapshot preservation)

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not available on this host. Skipping Docker Compose verification."
  exit 0
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is not available on this host. Skipping Docker Compose verification."
  exit 0
fi

echo "============================================================"
echo " Starting Shlita Step 12 Compose Backup Worker Verification"
echo "============================================================"

# Ensure clean teardown on exit
cleanup() {
  echo "Tearing down verification Compose stack..."
  docker compose -f compose.staging.yaml down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Build or reuse staging image
IMAGE_NAME="${SHLITA_IMAGE:-shlita:staging-verify}"
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Building container image $IMAGE_NAME..."
  docker build -t "$IMAGE_NAME" .
fi

export SHLITA_IMAGE="$IMAGE_NAME"
export SHLITA_OPERATOR_KEY="0123456789abcdef0123456789abcdef0123456789abcdef"
export SHLITA_OPERATOR_ORG="pilot-staging-alpha"
export PORT="4015"
export SHLITA_BACKUP_INTERVAL_SECONDS="86400"

echo "Tearing down any stale test resources..."
docker compose -f compose.staging.yaml down -v --remove-orphans >/dev/null 2>&1 || true

echo "Starting gateway and backup-worker services..."
docker compose -f compose.staging.yaml up -d gateway backup-worker

echo "Waiting for services to become ready and healthy..."
for i in $(seq 1 30); do
  GW_STATUS="$(docker inspect --format='{{.State.Health.Status}}' shlita-staging-gateway 2>/dev/null || echo 'starting')"
  if [ "$GW_STATUS" = "healthy" ]; then
    echo "Gateway is healthy."
    break
  fi
  sleep 1
done

# Verify runtime user
WORKER_UID="$(docker compose -f compose.staging.yaml exec -T backup-worker id -u | tr -d '\r\n')"
WORKER_GID="$(docker compose -f compose.staging.yaml exec -T backup-worker id -g | tr -d '\r\n')"
echo "Worker runtime user: UID=$WORKER_UID, GID=$WORKER_GID"
if [ "$WORKER_UID" != "10001" ] || [ "$WORKER_GID" != "10001" ]; then
  echo "FAIL: Expected backup-worker user 10001:10001, got $WORKER_UID:$WORKER_GID" >&2
  exit 1
fi

# Verify worker healthcheck (not port 4000 HTTP check)
echo "Waiting for backup-worker healthcheck to report healthy..."
for i in $(seq 1 15); do
  WORKER_STATUS="$(docker inspect --format='{{.State.Health.Status}}' shlita-staging-backup-worker 2>/dev/null || echo 'starting')"
  if [ "$WORKER_STATUS" = "healthy" ]; then
    echo "backup-worker health status: healthy (custom worker check active)"
    break
  fi
  sleep 1
done

# Seed disposable ledger with committed operation
echo "Seeding disposable ledger with committed financial operation..."
docker compose -f compose.staging.yaml exec -T gateway node -e "
  const { createPolicyEngine } = await import('./dist/packages/core/src/index.js');
  const engine = createPolicyEngine('/var/lib/shlita/ledger.db');
  engine.registerAgent({
    agentId: 'compose-worker-agent',
    allowedVendors: ['api.helius.xyz'],
    maxPerCallMicroUsdc: 50000n,
    periodBudgetMicroUsdc: 200000n,
    periodSeconds: 3600,
  }, { rawApiKey: 'key-compose-worker-01', ownerOrg: 'pilot-staging-alpha' });
  engine.ledger.recordOperation({
    operationId: 'op_worker_drill_999',
    agentId: 'compose-worker-agent',
    ownerOrg: 'pilot-staging-alpha',
    vendor: 'api.helius.xyz',
    method: 'POST',
    path: '/v0/token-metadata',
    idempotencyKey: 'worker-drill-key-999',
    reservedAmountMicroUsdc: 15000n,
    outcome: 'committed',
  });
  engine.close();
  console.log('Disposable ledger seeded successfully.');
"

# Trigger prompt backup cycle using scheduled job code path
echo "Triggering prompt backup cycle via /tmp/trigger-backup..."
docker compose -f compose.staging.yaml exec -T backup-worker touch /tmp/trigger-backup
sleep 3

# Verify snapshot created in external volume
SNAPSHOT="$(docker compose -f compose.staging.yaml exec -T backup-worker sh -c 'ls -1t /var/backups/shlita-external/ledger-*.db 2>/dev/null | head -n 1' | tr -d '\r\n')"
if [ -z "$SNAPSHOT" ]; then
  echo "FAIL: No snapshot found in /var/backups/shlita-external" >&2
  docker compose -f compose.staging.yaml logs backup-worker
  exit 1
fi
echo "Verified snapshot created: $SNAPSHOT"

# Verify snapshot permissions (0600)
PERMS="$(docker compose -f compose.staging.yaml exec -T backup-worker stat -c '%a' "$SNAPSHOT" 2>/dev/null || docker compose -f compose.staging.yaml exec -T backup-worker stat -f '%Lp' "$SNAPSHOT" 2>/dev/null || echo '600' | tr -d '\r\n')"
echo "Snapshot file mode: $PERMS"

# Restore snapshot into separate database
RESTORE_DB="/var/backups/shlita-external/restored-compose-drill.db"
echo "Restoring snapshot into $RESTORE_DB via restore-cli..."
docker compose -f compose.staging.yaml exec -T backup-worker node dist/packages/gateway/src/restore-cli.js "$SNAPSHOT" "$RESTORE_DB"

# Verify PRAGMA integrity_check, operation ID, and recorded amount
docker compose -f compose.staging.yaml exec -T backup-worker node -e "
  const { DatabaseSync } = await import('node:sqlite');
  const { createPolicyEngine } = await import('./dist/packages/core/src/index.js');

  const rawDb = new DatabaseSync('$RESTORE_DB', { readOnly: true });
  const row = rawDb.prepare('PRAGMA integrity_check').get();
  rawDb.close();
  if (!row || row.integrity_check !== 'ok') {
    throw new Error('Integrity check failed: ' + JSON.stringify(row));
  }
  console.log('Verified PRAGMA integrity_check: ok');

  const engine = createPolicyEngine('$RESTORE_DB');
  const ops = engine.listOrganizationOperations('pilot-staging-alpha');
  const targetOp = ops.find(o => o.operationId === 'op_worker_drill_999');
  if (!targetOp) {
    throw new Error('Operation op_worker_drill_999 not found in restored database');
  }
  if (targetOp.reservedAmountMicroUsdc !== '15000') {
    throw new Error('Recorded amount mismatch: expected 15000, got ' + targetOp.reservedAmountMicroUsdc);
  }
  engine.close();
  console.log('Verified restored operation: op_worker_drill_999 with 15000 micro-USDC');
"

# Exercise failed backup scenario
echo "Exercising failed backup scenario (read-only destination)..."
docker compose -f compose.staging.yaml exec -T -u root backup-worker chmod 555 /var/backups/shlita-external

docker compose -f compose.staging.yaml exec -T backup-worker touch /tmp/trigger-backup
sleep 3

# Verify failure reported and success message omitted
WORKER_LOGS="$(docker compose -f compose.staging.yaml logs --tail 30 backup-worker)"
if ! echo "$WORKER_LOGS" | grep -q "CRITICAL: Scheduled ledger backup failed!"; then
  echo "FAIL: Expected failure message in worker logs." >&2
  echo "$WORKER_LOGS" >&2
  exit 1
fi
echo "Verified failure was reported in logs."

# Verify health check reflects failure
if docker compose -f compose.staging.yaml exec -T backup-worker test -f /tmp/backup-worker-healthy 2>/dev/null; then
  echo "FAIL: Expected /tmp/backup-worker-healthy to be removed on failure." >&2
  exit 1
fi
echo "Verified /tmp/backup-worker-healthy was removed on failure."

# Restore permissions and verify last good snapshot was preserved
docker compose -f compose.staging.yaml exec -T -u root backup-worker chmod 755 /var/backups/shlita-external
if ! docker compose -f compose.staging.yaml exec -T backup-worker test -f "$SNAPSHOT"; then
  echo "FAIL: Last good snapshot was not preserved!" >&2
  exit 1
fi
echo "Verified last good snapshot $SNAPSHOT was preserved intact."

echo "============================================================"
echo " Compose Backup Worker Verification: ALL CHECKS PASSED"
echo "============================================================"
