#!/bin/bash
# Local E2E Test Runner
# Workaround for Corepack issues by running migrations directly

set -e

echo " Starting local E2E test environment..."

# Start PostgreSQL
echo "Starting PostgreSQL container..."
docker run -d \
  --name bugspotter-e2e-postgres \
  -e POSTGRES_DB=bugspotter_e2e_test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=testpass \
  -p 5433:5432 \
  postgres:16

# Start Redis container
echo " Starting Redis container..."
docker run -d \
  --name bugspotter-e2e-redis \
  -p 6380:6379 \
  redis:7-alpine

# Wait for PostgreSQL to be ready
echo " Waiting for PostgreSQL..."
sleep 5

# Set environment variables
export DATABASE_URL="postgresql://postgres:testpass@localhost:5433/bugspotter_e2e_test"
export REDIS_URL="redis://localhost:6380"
export JWT_SECRET="test-jwt-secret-for-e2e-tests-min-32-chars-required-here-now"
export ENCRYPTION_KEY="test-encryption-key-for-e2e-tests-32chars+"
export JWT_EXPIRES_IN="1h"
export JWT_REFRESH_EXPIRES_IN="7d"
export NODE_ENV="test"
export LOG_LEVEL="error"
export API_URL="http://localhost:4000"
export BASE_URL="http://localhost:4001"
export VITE_API_URL="http://localhost:4000"
export DB_POOL_MIN="5"
export DB_POOL_MAX="20"
export SETUP_MODE="full"
export STORAGE_BACKEND="local"
export STORAGE_BASE_DIR="../../packages/backend/data/e2e-uploads"
export STORAGE_BASE_URL="http://localhost:4000/uploads"

# Run migrations
echo " Running database migrations..."
cd ../../packages/backend
npx tsx src/db/migrations/migrate.ts
cd ../../apps/admin

# Start backend server in background
echo " Starting backend server..."
cd ../../packages/backend
PORT=4000 CORS_ORIGINS="http://localhost:4001,http://localhost:4000" \
  npx tsx src/api/index.ts &
BACKEND_PID=$!
cd ../../apps/admin

# Wait for backend to be ready
echo " Waiting for backend to be ready..."
for i in {1..30}; do
  if curl -s http://localhost:4000/health > /dev/null; then
    echo " Backend server is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo " Backend failed to start"
    kill $BACKEND_PID
    docker stop bugspotter-e2e-postgres bugspotter-e2e-redis
    docker rm bugspotter-e2e-postgres bugspotter-e2e-redis
    exit 1
  fi
  sleep 1
done

# Start worker in background
echo " Starting worker..."
cd ../../packages/backend
npx tsx src/worker.ts &
WORKER_PID=$!
cd ../../apps/admin

sleep 2

# Run E2E tests
echo " Running E2E tests..."
BASE_URL="http://localhost:4001" \
  API_URL="http://localhost:4000" \
  pnpm exec playwright test "$@"

TEST_EXIT_CODE=$?

# Cleanup
echo " Cleaning up..."
kill $BACKEND_PID $WORKER_PID 2>/dev/null || true
docker stop bugspotter-e2e-postgres bugspotter-e2e-redis
docker rm bugspotter-e2e-postgres bugspotter-e2e-redis

if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo " E2E tests passed!"
else
  echo " E2E tests failed"
fi

exit $TEST_EXIT_CODE
