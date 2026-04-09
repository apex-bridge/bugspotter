#!/bin/bash
# Get current Redis master from Sentinel
# Usage: eval $(./scripts/get-sentinel-master.sh)

SENTINEL_CONTAINER="${SENTINEL_CONTAINER:-sentinel1}"
SENTINEL_PORT="${SENTINEL_PORT:-26379}"
MASTER_NAME="${REDIS_SENTINEL_MASTER_NAME:-mymaster}"

MASTER_INFO=$(docker exec "$SENTINEL_CONTAINER" redis-cli -p "$SENTINEL_PORT" SENTINEL get-master-addr-by-name "$MASTER_NAME" 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$MASTER_INFO" ]; then
  MASTER_HOST=$(echo "$MASTER_INFO" | head -1)
  MASTER_PORT=$(echo "$MASTER_INFO" | tail -1)
  
  # Output export command for eval
  echo "export REDIS_URL=redis://${MASTER_HOST}:${MASTER_PORT}"
  
  # Log to stderr (won't be eval'd)
  echo "# ✅ Current Redis master: ${MASTER_HOST}:${MASTER_PORT}" >&2
else
  echo "# ❌ Error: Could not query Sentinel at ${SENTINEL_CONTAINER}:${SENTINEL_PORT}" >&2
  echo "# Make sure Sentinel is running: docker ps | grep sentinel" >&2
  exit 1
fi
