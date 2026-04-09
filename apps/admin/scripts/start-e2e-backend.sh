#!/bin/bash
# Start backend API connected to E2E testcontainer database
# This script waits for the testcontainer to be ready, then starts the backend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$ADMIN_DIR/../../packages/backend"
TEST_ENV_FILE="$ADMIN_DIR/src/tests/e2e/.test-env"

echo " Waiting for E2E testcontainer to be ready..."
echo ""
echo "   IMPORTANT: Start tests with --headed or --ui to keep them running:"
echo "   $ pnpm test:e2e --headed"
echo ""
echo "   Or run specific tests that take longer:"
echo "   $ pnpm test:e2e:ui"
echo ""

# Wait for .test-env file to be created by global-setup
MAX_WAIT=120
WAITED=0
while [ ! -f "$TEST_ENV_FILE" ] && [ $WAITED -lt $MAX_WAIT ]; do
  sleep 1
  WAITED=$((WAITED + 1))
  echo -ne "\r   Waiting... ${WAITED}s / ${MAX_WAIT}s"
done

if [ ! -f "$TEST_ENV_FILE" ]; then
  echo ""
  echo " Error: .test-env file not found after ${MAX_WAIT}s"
  echo ""
  echo "   Make sure E2E tests are still running in another terminal."
  echo "   Tests should be started with --headed or --ui to keep container alive."
  echo ""
  echo "   Example: pnpm test:e2e --headed"
  exit 1
fi

echo ""
echo " Testcontainer ready!"
echo ""

# Read DATABASE_URL from .test-env
DATABASE_URL=$(grep "^DATABASE_URL=" "$TEST_ENV_FILE" | cut -d '=' -f 2-)

if [ -z "$DATABASE_URL" ]; then
  echo " Error: DATABASE_URL not found in .test-env"
  exit 1
fi

# Mask password in output
MASKED_URL=$(echo "$DATABASE_URL" | sed 's/:\/\/\([^:]*\):\([^@]*\)@/:\/\/\1:***@/')
echo " Connecting to: $MASKED_URL"
echo ""

# Kill any existing backend on port 4000
echo " Killing existing E2E backend processes on port 4000..."
lsof -ti:4000 | xargs kill -9 2>/dev/null || true
sleep 1

# Start backend on port 4000 with testcontainer DATABASE_URL
echo " Starting E2E backend on port 4000 connected to testcontainer..."
echo ""
cd "$BACKEND_DIR"
PORT=4000 DATABASE_URL="$DATABASE_URL" pnpm dev
