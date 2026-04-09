#!/bin/sh
# ============================================================================
# BugSpotter Backend - Docker Entrypoint Script
# ============================================================================
# Responsibilities:
# 1. Wait for PostgreSQL and Redis to be ready (unless SKIP_DB_CHECK=true)
# 2. Run database migrations (API service only)
# 3. Start the appropriate service (api or worker)
#
# Environment Variables:
# - SKIP_DB_CHECK: Set to "true" to skip PostgreSQL and Redis connectivity checks
# - DATABASE_URL: PostgreSQL connection string
# - REDIS_URL: Redis connection string
# - DB_HOST, DB_PORT: Alternative to parsing DATABASE_URL
# - REDIS_HOST, REDIS_PORT: Alternative to parsing REDIS_URL
# ============================================================================

set -e

SERVICE_TYPE="${1:-api}"
MAX_RETRIES=30
RETRY_DELAY=2

echo "==================================="
echo "BugSpotter Backend - $SERVICE_TYPE"
echo "==================================="

# ============================================================================
# Utility Functions
# ============================================================================

# Generic function to wait for a service
wait_for_service() {
  local service_name="$1"
  local host="$2"
  local port="$3"
  
  echo "Checking $service_name at $host:$port..."
  
  local retry_count=0
  while [ $retry_count -lt $MAX_RETRIES ]; do
    if nc -z "$host" "$port" 2>/dev/null; then
      echo "$service_name is ready"
      return 0
    fi
    
    retry_count=$((retry_count + 1))
    echo "$service_name not ready yet (attempt $retry_count/$MAX_RETRIES)..."
    sleep $RETRY_DELAY
  done
  
  echo "Error: $service_name did not become ready in time"
  exit 1
}

# Parse PostgreSQL connection details
parse_postgres_connection() {
  # Use env vars if provided
  if [ -n "$DB_HOST" ] && [ -n "$DB_PORT" ]; then
    echo "Using DB_HOST and DB_PORT from environment"
    return 0
  fi
  
  echo "Parsing DATABASE_URL for connection details..."
  
  if [ -z "$DATABASE_URL" ]; then
    echo "Error: DATABASE_URL not set and DB_HOST/DB_PORT not provided"
    exit 1
  fi
  
  # Extract connection details from DATABASE_URL
  # Format: postgresql://user:pass@host:port/db
  local url_no_proto="${DATABASE_URL#postgresql://}"
  url_no_proto="${url_no_proto#postgres://}"
  
  # Extract host:port/db part (after @)
  local hostport="${url_no_proto#*@}"
  
  # Extract host and port
  DB_HOST="${hostport%%:*}"
  local port_db="${hostport#*:}"
  DB_PORT="${port_db%%/*}"
  
  if [ -z "$DB_HOST" ] || [ -z "$DB_PORT" ]; then
    echo "Error: Could not parse DATABASE_URL"
    echo "Expected format: postgresql://user:pass@host:port/db"
    echo "Got: $DATABASE_URL"
    exit 1
  fi
}

# Parse Redis connection details
parse_redis_connection() {
  # Use env vars if provided
  if [ -n "$REDIS_HOST" ] && [ -n "$REDIS_PORT" ]; then
    echo "Using REDIS_HOST and REDIS_PORT from environment"
    return 0
  fi
  
  echo "Parsing REDIS_URL for connection details..."
  
  if [ -z "$REDIS_URL" ]; then
    echo "REDIS_URL not set, skipping Redis check"
    return 1
  fi
  
  # Validate URL format (accept both redis:// and rediss:// for TLS)
  if [ "${REDIS_URL#redis://}" = "$REDIS_URL" ] && [ "${REDIS_URL#rediss://}" = "$REDIS_URL" ]; then
    echo "Error: REDIS_URL must start with redis:// or rediss://"
    echo "Got: $REDIS_URL"
    exit 1
  fi

  # Extract connection details from REDIS_URL (strip redis:// or rediss://)
  local url_no_proto="${REDIS_URL#rediss://}"
  url_no_proto="${url_no_proto#redis://}"
  
  # Handle optional auth (user:pass@)
  local hostport
  if echo "$url_no_proto" | grep -q '@'; then
    hostport="${url_no_proto#*@}"
  else
    hostport="$url_no_proto"
  fi
  
  # Extract host and port
  REDIS_HOST="${hostport%%:*}"
  REDIS_PORT="${hostport#*:}"
  
  # Validate parsing
  if [ -z "$REDIS_HOST" ] || [ -z "$REDIS_PORT" ] || [ "$REDIS_HOST" = "$REDIS_PORT" ]; then
    echo "Error: Failed to parse REDIS_URL"
    echo "Expected format: redis://host:port or rediss://host:port"
    echo "Got: $REDIS_URL"
    exit 1
  fi
  
  return 0
}

# Wait for PostgreSQL
wait_for_postgres() {
  echo "Waiting for PostgreSQL..."
  parse_postgres_connection
  wait_for_service "PostgreSQL" "$DB_HOST" "$DB_PORT"
}

# Wait for Redis
wait_for_redis() {
  echo "Waiting for Redis..."
  if parse_redis_connection; then
    wait_for_service "Redis" "$REDIS_HOST" "$REDIS_PORT"
  fi
}

# Run database migrations
run_migrations() {
  echo "Running database migrations..."
  
  cd /app/packages/backend
  if node dist/cli/migrate.js; then
    echo "Migrations completed successfully"
  else
    echo "Error: Migrations failed"
    exit 1
  fi
}

# Start the service
start_service() {
  echo "Starting $SERVICE_TYPE service..."
  cd /app/packages/backend

  case "$SERVICE_TYPE" in
    api)
      exec node dist/api/index.js
      ;;
    worker)
      exec node dist/worker.js
      ;;
    *)
      echo "Error: Invalid service type '$SERVICE_TYPE'. Must be 'api' or 'worker'"
      exit 1
      ;;
  esac
}

# ============================================================================
# Main Logic
# ============================================================================

# Check if database checks should be skipped
if [ "$SKIP_DB_CHECK" = "true" ]; then
  echo "Warning: SKIP_DB_CHECK=true - Skipping database and Redis connectivity checks"
else
  wait_for_postgres
  wait_for_redis
fi

# Run migrations for API service only
if [ "$SERVICE_TYPE" = "api" ]; then
  run_migrations
else
  echo "Worker service - skipping migrations"
fi

# Start the service
start_service
