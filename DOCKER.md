# BugSpotter Docker Setup

Complete Docker setup for running BugSpotter backend with PostgreSQL, Redis, and MinIO.

## Quick Start

### 1. Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 4GB+ available RAM
- 10GB+ available disk space

### 2. Initial Setup

```bash
# Copy environment template
cp .env.example .env

# Generate secure secrets (REQUIRED!)
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env

# Edit .env and set all required credentials
nano .env
```

**IMPORTANT**: The following variables have NO defaults and MUST be set in `.env`:

- `JWT_SECRET` - Generate with `openssl rand -base64 32`
- `ENCRYPTION_KEY` - Generate with `openssl rand -base64 32`
- `MINIO_ROOT_USER` - Already set in `.env.example` (16+ chars, dev only)
- `MINIO_ROOT_PASSWORD` - Already set in `.env.example` (32+ chars, dev only)

**Security Note**: Docker Compose will fail to start if required secrets are missing. This is intentional to prevent running with insecure defaults.

### 3. Start Services

```bash
# Build images (includes git commit hash for version display)
GIT_COMMIT=$(git rev-parse HEAD) pnpm docker:build

# Start all services
pnpm docker:up

# View logs
pnpm docker:logs
```

### 4. Verify Deployment

Services will be available at:

- **API**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **MinIO Console**: http://localhost:9001 (development only - see Security section)
- **PostgreSQL**: localhost:5432 (development only - see Security section)
- **Redis**: localhost:6379 (development only - see Security section)

**Security Note**: Infrastructure ports (PostgreSQL, Redis, MinIO) are only exposed in development via `docker-compose.override.yml` binding to `127.0.0.1`. In production, only the API port is exposed. See [Port Binding Security](#port-binding-security) below.

Test the API:

```bash
# Health check
curl http://localhost:3000/health

# Register a user and get auth token
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "SecurePass123!"
  }'
```

## Services

### API Server (`api`)

- **Image**: Built from `packages/backend/Dockerfile`
- **Port**: 3000 (configurable via `PORT`)
- **Responsibilities**:
  - REST API endpoints
  - Database migrations (runs automatically on startup)
  - Authentication & authorization
  - File uploads to S3-compatible storage
  - Job queue management (adds jobs to Redis queues)

### Background Worker (`worker`)

- **Image**: Same as API server
- **Process**: `node dist/worker.js` (separate from API)
- **Responsibilities**:
  - Screenshot processing (generates thumbnails, stores metadata)
  - Session replay processing (decompresses, validates, generates signed URLs)
  - Integration jobs (Jira ticket creation, webhook delivery)
  - Notification delivery (email, Slack, etc.)
  - Scheduled retention cleanup
- **Concurrency**: Configurable per queue type
  - Screenshots: 5 concurrent jobs (configurable via `WORKER_SCREENSHOT_CONCURRENCY`)
  - Replays: 3 concurrent jobs (configurable via `WORKER_REPLAY_CONCURRENCY`)
  - Integrations: 10 concurrent jobs (configurable via `WORKER_INTEGRATION_CONCURRENCY`)
  - Notifications: 5 concurrent jobs (configurable via `WORKER_NOTIFICATION_CONCURRENCY`)
- **Health Check**: Verifies Redis connectivity (no HTTP endpoint)

**Note**: In the unified Docker deployment (root `Dockerfile`), both API and worker run in the same container via supervisord, eliminating the need for a separate worker service.

### Payment Service (`payment-service`)

- **Image**: Built from `packages/payment-service/Dockerfile`
- **Port**: 3002 (configurable via `PAYMENT_SERVICE_PORT`)
- **Responsibilities**:
  - Processes checkout/cancel requests from `payments` BullMQ queue
  - Handles payment provider webhooks (`POST /webhooks`)
  - Publishes normalized payment events to `payment-events` queue
- **Provider**: One provider per instance, set via `PAYMENT_PROVIDER` env var
  - `kaspi` — Kaspi Pay QR API (Kazakhstan)
  - `yookassa` — YooKassa REST API (Russia)
  - `stripe` — Stripe Checkout Sessions (International)
- **Health Check**: `GET /health` on port 3002
- **Dependencies**: Redis only (communicates with backend via BullMQ queues)

### PostgreSQL 16 (`postgres`)

- **Image**: `postgres:16-alpine`
- **Port**: 5432
- **Volume**: `postgres_data` (persistent)
- **Default Credentials**: bugspotter/bugspotter_dev_password
- **Database**: bugspotter

### Redis 7 (`redis`)

- **Image**: `redis:7-alpine`
- **Port**: 6379
- **Volume**: `redis_data` (persistent)
- **Configuration**:
  - Appendonly persistence enabled
  - 256MB max memory with LRU eviction

### MinIO (`minio`)

- **Image**: `minio/minio:RELEASE.2024-10-13T13-34-11Z`
- **Ports**:
  - 9000: S3 API
  - 9001: Web Console
- **Volume**: `minio_data` (persistent)
- **Default Credentials**: minioadmin123456 / minioadmin12345678901234567890123456
- **Bucket**: `bugspotter` (auto-created, private access)
- **Security Notes**:
  - Credentials must be 16+ chars (user) and 32+ chars (password) for validation
  - Bucket is **private by default** - no public access
  - Assets accessed via authenticated requests from API/worker
  - Never expose bucket publicly - screenshots may contain PII/sensitive data

## Port Binding Security

### Development vs Production

BugSpotter uses a **two-file security model** to prevent accidental exposure of infrastructure services:

#### Base Configuration (`docker-compose.yml`)

Production-safe defaults:

- ✅ **API Port (3000)**: Exposed - public-facing REST API
- 🔒 **PostgreSQL (5432)**: Internal only - no port binding
- 🔒 **Redis (6379)**: Internal only - no port binding
- 🔒 **MinIO (9000/9001)**: Internal only - no port bindings
- 🔒 **Payment Service (3002)**: Internal only - use reverse proxy in production

Services communicate via Docker's internal `bugspotter` network. This prevents direct database/cache access even if the host has a public IP.

#### Development Override (`docker-compose.override.yml`)

Auto-loaded in development with localhost-only bindings:

```yaml
services:
  postgres:
    ports:
      - '127.0.0.1:5432:5432' # Only accessible from localhost

  redis:
    ports:
      - '127.0.0.1:6379:6379' # Only accessible from localhost

  minio:
    ports:
      - '127.0.0.1:9000:9000' # S3 API - localhost only
      - '127.0.0.1:9001:9001' # Console UI - localhost only

  payment-service:
    ports:
      - '127.0.0.1:3002:3002' # Webhook testing - localhost only
```

**Why `127.0.0.1` binding is critical:**

- ❌ `0.0.0.0:5432:5432` - Exposed on ALL network interfaces (public IP, LAN, localhost)
- ✅ `127.0.0.1:5432:5432` - Only accessible from the Docker host itself
- 🔒 No port binding - Only accessible via Docker network (production default)

### Usage

**Development** (local postgres, redis, minio):

```bash
# .env.example sets COMPOSE_PROFILES=dev — copy to .env if you haven't already
cp .env.example .env

docker compose up   # Starts all services including local infrastructure
```

> **Note**: Local infrastructure (postgres, redis, minio) uses the `dev` profile.
> `COMPOSE_PROFILES=dev` in `.env` activates it automatically. Alternatively,
> pass `--profile dev` explicitly: `docker compose --profile dev up -d`

**Production** (managed services, skip override):

```bash
docker compose -f docker-compose.yml up  # No infrastructure ports exposed
```

**Custom Override** (e.g., for staging with VPN):

```bash
# Create docker-compose.staging.yml with appropriate security groups
docker compose -f docker-compose.yml -f docker-compose.staging.yml up
```

### Payment Webhook Configuration

In production, payment providers (Kaspi, Stripe, YooKassa) need to reach the webhook endpoint. Options:

1. **Recommended**: Route webhooks through API server via reverse proxy (nginx/Caddy)
2. **Alternative**: Create production-specific override with proper firewall rules:
   ```yaml
   # docker-compose.production.yml
   services:
     payment-service:
       ports:
         - '3002:3002' # Only if firewall/security group restricts to provider IPs
   ```

See [YANDEX_CLOUD_RESOURCES.md](./YANDEX_CLOUD_RESOURCES.md) for security group configuration.

## Available Commands

```bash
# Build and Start
pnpm docker:build          # Build Docker images
pnpm docker:up             # Start all services
pnpm docker:down           # Stop all services

# Logs and Monitoring
pnpm docker:logs           # Tail logs for all services
pnpm docker:logs:api       # Tail API server logs only
pnpm docker:logs:worker    # Tail worker logs only
pnpm docker:ps             # List running containers

# Maintenance
pnpm docker:restart        # Restart all services
pnpm docker:clean          # Stop and remove volumes (⚠️ deletes data!)
pnpm docker:test           # Run tests inside container
```

## Configuration

### Environment Variables

All configuration is done via `.env` file. Key variables:

#### Database

```bash
POSTGRES_DB=bugspotter
POSTGRES_USER=bugspotter
POSTGRES_PASSWORD=your_secure_password
```

#### Security (REQUIRED!)

```bash
# Generate with: openssl rand -base64 32
# Example below - DO NOT use in production!
JWT_SECRET=EXAMPLE_dev_jwt_key_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6      # 32+ characters required
ENCRYPTION_KEY=EXAMPLE_dev_enc_key_x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4  # 32+ characters required
```

#### Content Security Policy (CSP) Domains (Optional)

Control which external domains are allowed in the admin panel CSP headers:

```bash
# CDN for static assets (screenshots, assets)
CDN_DOMAIN=https://cdn.bugspotter.io  # Default

# Storage backend (R2, S3) for uploaded files
STORAGE_DOMAIN=https://*.r2.cloudflarestorage.com  # Default

# Application domains for cross-origin resources (fonts, images)
APP_DOMAIN=https://*.demo.bugspotter.io  # Default
```

**When to customize:**

- Using a different CDN provider (e.g., BunnyCDN, CloudFront)
- Self-hosting storage (custom S3-compatible endpoint)
- Different application domain structure (e.g., `*.mycompany.com`)

**Security Note:** Wildcard patterns (`*`) are scoped to subdomains only. For example:

- `https://*.demo.bugspotter.io` matches `app.demo.bugspotter.io`, `test.demo.bugspotter.io`
- Does NOT match `demo.bugspotter.io` (no subdomain) or `evilsite.com`

#### Storage

```bash
STORAGE_BACKEND=minio
MINIO_ROOT_USER=minioadmin123456     # 16+ characters required
MINIO_ROOT_PASSWORD=minioadmin12345678901234567890123456  # 32+ characters required
MINIO_BUCKET=bugspotter
```

#### Workers

```bash
WORKER_SCREENSHOT_ENABLED=true
WORKER_REPLAY_ENABLED=true
WORKER_INTEGRATION_ENABLED=true
WORKER_NOTIFICATION_ENABLED=true

# Concurrency
WORKER_SCREENSHOT_CONCURRENCY=5
WORKER_REPLAY_CONCURRENCY=3
```

See `.env.example` for complete list of available options.

### Storage Access Security

**Private by Default**: The MinIO bucket is configured with private access. Assets are NOT publicly accessible.

**Access Patterns**:

- **Internal Services** (API/Worker): Access MinIO directly via authenticated S3 SDK calls over Docker network
- **External Clients**: Must use presigned URLs generated by the API (1-hour expiry by default)

**Important**: Never make the bucket publicly accessible. Screenshots and attachments may contain:

- Personally Identifiable Information (PII)
- Sensitive application data
- User credentials or tokens in console logs
- Private business information

If you need to serve assets to external clients (e.g., web dashboard), implement presigned URL generation:

```typescript
// Generate temporary signed URL (1 hour expiry)
const signedUrl = await storage.getSignedUrl(screenshotKey, { expiresIn: 3600 });
```

## Development Mode

For development with hot reload:

```bash
# Update .env
NODE_ENV=development
LOG_LEVEL=debug

# Mount source code as volume (add to docker-compose.yml)
volumes:
  - ./packages/backend/src:/app/packages/backend/src
  - ./packages/backend/node_modules:/app/packages/backend/node_modules
```

**Note**: Volumes are mounted read-write to allow build tools (TypeScript, nodemon, etc.) to write cache files and intermediate artifacts.

## Production Deployment

### Pre-Deployment Checklist

Before deploying to production:

1. ✅ **Generate secure secrets**:

   ```bash
   JWT_SECRET=$(openssl rand -base64 32)
   ENCRYPTION_KEY=$(openssl rand -base64 32)
   ```

2. ✅ **Update credentials**:
   - Strong PostgreSQL password
   - Secure MinIO credentials
   - Review CORS origins

3. ✅ **Configure storage**:
   - Use AWS S3, Cloudflare R2, or managed MinIO
   - Set up bucket lifecycle policies
   - Configure CDN if needed

4. ✅ **Set up monitoring**:
   - Configure log aggregation
   - Set up health check alerts
   - Monitor worker queue metrics

5. ✅ **Plan backups**:
   - Database backups (pg_dump)
   - S3/MinIO bucket versioning
   - Redis AOF persistence

### Using External Services

Replace container services with managed alternatives:

```bash
# External PostgreSQL (AWS RDS, etc.)
# Option 1: Use connection URL
DATABASE_URL=postgresql://user:pass@db.example.com:5432/bugspotter

# Option 2: Use separate host/port (recommended for complex URLs)
DB_HOST=db.example.com
DB_PORT=5432
DATABASE_URL=postgresql://user:pass@db.example.com:5432/bugspotter

# External Redis (AWS ElastiCache, etc.)
# Option 1: Use connection URL
REDIS_URL=redis://redis.example.com:6379

# Option 2: Use separate host/port (recommended for complex URLs)
REDIS_HOST=redis.example.com
REDIS_PORT=6379
REDIS_URL=redis://redis.example.com:6379

# AWS S3
STORAGE_BACKEND=s3
S3_REGION=us-east-1
S3_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
S3_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
S3_BUCKET=bugspotter-prod
S3_FORCE_PATH_STYLE=false

# Cloudflare R2
STORAGE_BACKEND=r2
S3_ENDPOINT=https://account-id.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY=your-r2-access-key
S3_SECRET_KEY=your-r2-secret-key
S3_BUCKET=bugspotter
```

Then update `docker-compose.yml` to remove unused services.

## Troubleshooting

### Services Not Starting

```bash
# Check service health
pnpm docker:ps

# View logs for specific service
docker compose logs postgres
docker compose logs redis
docker compose logs minio

# Restart specific service
docker compose restart api
```

### Database Connection Issues

```bash
# Check PostgreSQL logs
docker compose logs postgres

# Verify connection inside container
docker compose exec api node -e "require('pg').Pool({connectionString: process.env.DATABASE_URL}).query('SELECT NOW()')"

# Run migrations manually
docker compose exec api node dist/db/migrations/migrate.js
```

### Worker Not Processing Jobs

```bash
# Check worker logs
pnpm docker:logs:worker

# Verify Redis connection
docker compose exec redis redis-cli ping

# Check queue status (from API container)
docker compose exec api node -e "require('bullmq').Queue('screenshots').getJobCounts().then(console.log)"
```

### MinIO Issues

```bash
# Check MinIO logs
docker compose logs minio

# Verify bucket exists
docker compose exec minio mc ls minio/

# Recreate bucket
docker compose exec minio mc mb --ignore-existing minio/bugspotter
```

### Disk Space Issues

```bash
# Check volume sizes
docker system df -v

# Clean up unused resources
docker system prune -a --volumes

# Remove specific volumes (⚠️ deletes data!)
docker volume rm bugspotter_minio_data
```

## Scaling

### Horizontal Scaling

Scale worker instances:

```bash
docker compose up -d --scale worker=3
```

Update `docker-compose.yml`:

```yaml
worker:
  deploy:
    replicas: 3
    resources:
      limits:
        cpus: '1.0'
        memory: 1G
```

### Resource Limits

Set memory and CPU limits:

```yaml
api:
  deploy:
    resources:
      limits:
        cpus: '2.0'
        memory: 2G
      reservations:
        cpus: '0.5'
        memory: 512M
```

## Backups

### Database Backup

```bash
# Backup PostgreSQL
docker compose exec postgres pg_dump -U bugspotter bugspotter > backup.sql

# Restore
docker compose exec -T postgres psql -U bugspotter bugspotter < backup.sql
```

### MinIO Backup

```bash
# Backup bucket
docker compose exec minio mc mirror minio/bugspotter /backup/bugspotter

# Or use MinIO's built-in replication
```

## Monitoring

### Container Status

```bash
# Check all container health
docker ps --format "table {{.Names}}\t{{.Status}}"

# View specific container health details
docker inspect bugspotter-api --format='{{json .State.Health}}'
docker inspect bugspotter-worker --format='{{json .State.Health}}'
```

All containers report health status automatically (see **Health Checks** section above for details).

### Logs

```bash
# Follow all logs
pnpm docker:logs

# Filter logs
docker compose logs --tail=100 api | grep ERROR

# Export logs
docker compose logs --no-color > bugspotter.log
```

## Health Checks

All services include health checks for monitoring and orchestration:

| Service        | Endpoint/Method           | Validates             | Interval | Timeout |
| -------------- | ------------------------- | --------------------- | -------- | ------- |
| **API**        | `GET /ready`              | Database connectivity | 30s      | 10s     |
| **Worker**     | Redis connection (netcat) | Redis connectivity    | 30s      | 10s     |
| **PostgreSQL** | `pg_isready`              | Database ready        | 10s      | 5s      |
| **Redis**      | `redis-cli ping`          | Redis ready           | 10s      | 5s      |
| **MinIO**      | `GET /minio/health/live`  | Storage ready         | 30s      | 10s     |
| **Payment**    | `GET /health`             | Service ready         | 30s      | 10s     |

### API Health Endpoints

```bash
# Liveness - simple server check
curl http://localhost:3000/health
# Response: {"status":"ok","timestamp":"2025-10-15T09:35:22.325Z"}

# Readiness - validates database connectivity
curl http://localhost:3000/ready
# Response: {"status":"ready","timestamp":"2025-10-15T09:35:22.325Z","checks":{"database":"healthy"}}
```

**Note**: Docker health checks use `/ready` to ensure API is fully operational with database connectivity.

## Architecture

### Docker Compose Architecture (Development/Self-Hosted)

```
┌─────────────────────────────────────────────────────────┐
│                      Internet                            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │   Load Balancer │
              └────────┬────────┘
                       │
           ┌───────────┴───────────┐
           ▼                       ▼
    ┌──────────┐           ┌──────────┐
    │   API    │           │   API    │
    │ (Port 3000)│         │ (Replica)│
    └────┬─────┘           └────┬─────┘
         │                      │
         └──────────┬───────────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │Worker 1│ │Worker 2│ │Worker 3│
    └────┬───┘ └────┬───┘ └────┬───┘
         │          │          │
         └──────────┼──────────┘
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    ┌────────┐ ┌────────┐ ┌────────┐
    │Postgres│ │ Redis  │ │ MinIO  │
    │:5432   │ │:6379   │ │:9000   │
    └────────┘ └────────┘ └────────┘
```

### Unified Deployment Architecture (Production)

The root `Dockerfile` creates a unified deployment with all processes in one container:

```
┌─────────────────────────────────────────────────────┐
│        BugSpotter Unified Container                 │
│                                                     │
│  ┌────────────────────────────────────────────┐   │
│  │         supervisord (Process Manager)      │   │
│  └──────┬─────────────┬──────────────┬────────┘   │
│         │             │              │            │
│    ┌────▼────┐   ┌────▼────┐   ┌────▼────┐       │
│    │  nginx  │   │   API   │   │ Worker  │       │
│    │ :3001   │   │  :3000  │   │ (BullMQ)│       │
│    └────┬────┘   └────┬────┘   └────┬────┘       │
│         │             │              │            │
└─────────┼─────────────┼──────────────┼────────────┘
          │             │              │
          │             └──────┬───────┘
          │                    │
          ▼                    ▼
   Admin Panel UI      External Services
   (React + API       (PostgreSQL, Redis, S3)
    proxy at /api)
```

**Benefits of Unified Deployment**:

- Single container to deploy (simpler infrastructure)
- API + Worker share same codebase and dependencies
- Admin panel served from same container (nginx on port 3001)
- supervisord manages all three processes with automatic restarts
- Reduced memory footprint vs separate containers

**Processes**:

- **nginx** (port 3001): Serves admin panel, proxies `/api/*` to port 3000
- **API** (port 3000): Handles HTTP requests, queues jobs to Redis
- **Worker** (no port): Processes jobs from Redis queues, generates signed URLs

**When to Use**:

- **Unified**: Production deployments, PaaS platforms (Railway, Render, Fly.io)
- **Docker Compose**: Development, self-hosted with separate scaling needs

## Performance Tuning

### PostgreSQL

```yaml
postgres:
  command: >
    postgres
    -c max_connections=200
    -c shared_buffers=256MB
    -c effective_cache_size=1GB
    -c maintenance_work_mem=64MB
    -c checkpoint_completion_target=0.9
    -c wal_buffers=16MB
    -c default_statistics_target=100
```

### Redis

```yaml
redis:
  command: >
    redis-server
    --appendonly yes
    --maxmemory 512mb
    --maxmemory-policy allkeys-lru
    --save 60 1000
```

## License

MIT
