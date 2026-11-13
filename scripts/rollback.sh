#!/bin/sh
# Shlita Staging Rollback Script
# Usage: ./scripts/rollback.sh <PREVIOUS_IMAGE_TAG_OR_DIGEST>
# Example: ./scripts/rollback.sh ghcr.io/xiaoarnav/shlita-gateway:158e062

set -eu

if [ $# -lt 1 ]; then
  echo "Error: Target image or digest is required for rollback."
  echo "Usage: $0 <IMAGE_TAG_OR_DIGEST>"
  exit 1
fi

TARGET_IMAGE="$1"
COMPOSE_FILE="compose.staging.yaml"

echo "=== Shlita Staging Rollback Initiated ==="
echo "Target Image: ${TARGET_IMAGE}"
echo "Persistent Volume: shlita-staging-data (PRESERVED)"

# 1. Pull target image to verify availability before stopping active instance
echo "[1/4] Pulling target image..."
docker pull "${TARGET_IMAGE}"

# 2. Stop running gateway container
echo "[2/4] Stopping gateway service..."
SHLITA_IMAGE="${TARGET_IMAGE}" docker compose -f "${COMPOSE_FILE}" stop gateway

# 3. Restart gateway with target image pinned
echo "[3/4] Starting gateway service with rolled back image..."
SHLITA_IMAGE="${TARGET_IMAGE}" docker compose -f "${COMPOSE_FILE}" up -d --no-deps gateway

# 4. Verify health and readiness
echo "[4/4] Verifying readiness on rolled back instance..."
for i in $(seq 1 15); do
  if docker compose -f "${COMPOSE_FILE}" exec -T gateway node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "=== Rollback Successful: Gateway is READY ==="
    exit 0
  fi
  sleep 2
done

echo "Error: Gateway failed readiness check after rollback."
docker compose -f "${COMPOSE_FILE}" logs --tail 50 gateway
exit 1
