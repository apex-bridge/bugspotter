# @bugspotter/backend

Production-ready backend for BugSpotter with PostgreSQL database, REST API, and S3-compatible storage.

## Features

- 🗄️ **PostgreSQL Database** - Schema with migrations, connection pooling, ACID transactions
- 🔐 **Dual Authentication** - API keys (SDK) + JWT tokens (users)
- 💾 **S3 Storage** - Screenshots, attachments, replay chunks (S3/MinIO/LocalStack/Local)
- 🛡️ **Security** - CORS, Helmet, rate limiting, input validation, SQL injection protection
- 🔍 **Query & Filter** - Pagination, sorting, role-based access control
- 🕐 **Data Retention** - Automated lifecycle management with compliance support (GDPR, CCPA, Kazakhstan)
- 🏥 **Health Checks** - Liveness and readiness endpoints
- 🧪 **Testing** - 2136 tests with Testcontainers (no manual setup required)
- 🔗 **Type Safety** - Uses `@bugspotter/types` for shared type definitions with admin panel

## Quick Start

### 1. Install Dependencies

**Important**: The backend requires `isolated-vm`, a native Node.js module for secure plugin execution. Ensure you have build tools installed:

**Linux/macOS**:

```bash
# Ubuntu/Debian
sudo apt-get install python3 make g++

# macOS
xcode-select --install
```

**Windows**:

```bash
# Install Visual Studio Build Tools or
npm install --global windows-build-tools
```

Then install all dependencies:

```bash
pnpm install
```

**Troubleshooting**: If `isolated-vm` fails to build, try:

```bash
pnpm install isolated-vm --force
# Or rebuild native modules
pnpm rebuild isolated-vm
```

### 2. Configure Environment

Create a `.env` file in the backend package directory:

````bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/bugspotter
JWT_SECRET=your-secret-key-min-32-characters-long  # Generate: openssl rand -base64 32

# Storage Backend (choose one)
STORAGE_BACKEND=local  # Options: local, s3

# For local storage:
STORAGE_BASE_DIR=./data/uploads
STORAGE_BASE_URL=http://localhost:3000/uploads

# For S3 storage (AWS S3):
# S3_BUCKET=bugspotter
# S3_REGION=us-east-1
# AWS_ACCESS_KEY_ID=your-key
# AWS_SECRET_ACCESS_KEY=your-secret

# For Cloudflare R2:
# STORAGE_BACKEND=r2
# S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
# S3_REGION=auto
# S3_ACCESS_KEY_ID=your-r2-access-key
# S3_SECRET_ACCESS_KEY=your-r2-secret-key
# S3_BUCKET=bugspotter
# Note: R2 uses virtual-hosted style URLs automatically

# For other S3-compatible storage (MinIO, Backblaze B2):
# S3_ENDPOINT=https://your-endpoint.com
# S3_DISABLE_CHECKSUMS=false  # Optional: auto-detected for B2/R2, set true to override

# Optional - Server
PORT=3000
NODE_ENV=development
# CORS Origins - comma-separated list, supports wildcard patterns:
#   Exact: https://app.example.com
#   Subdomain wildcard: https://*.demo.bugspotter.io (matches app.demo.*, staging.demo.*, etc.)
#   Port wildcard: http://localhost:* (any numeric port)
#   IPv6: http://[::1]:* (IPv6 localhost with numeric port)
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Optional - Database Pool
DB_POOL_MIN=2
DB_POOL_MAX=10

# Optional - JWT
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

### 3. Set Up Database

```bash
createdb bugspotter
pnpm migrate
````

### 4. Start Server

```bash
# Development
pnpm dev

# Production
pnpm build && pnpm start
```

Server runs at `http://localhost:3000`

### 5. Test the API

```bash
# Health check
curl http://localhost:3000/health

# Register user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password123"}'

# Create project
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"name":"My App"}'
```

## API Reference

### Authentication

#### Register User

```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

Returns JWT tokens (access + refresh)

#### Login

```http
POST /api/v1/auth/login
```

#### Refresh Token

```http
POST /api/v1/auth/refresh
```

### Projects

#### Create Project

```http
POST /api/v1/projects
Authorization: Bearer YOUR_JWT_TOKEN

{"name": "My App"}
```

#### Get Project

```http
GET /api/v1/projects/:id
```

### Bug Reports

#### Create Report (SDK)

```http
POST /api/v1/reports
X-API-Key: bgs_your_api_key
Content-Type: application/json

{
  "title": "Button not working",
  "description": "Submit button doesn't respond",
  "report": {
    "console": [...],
    "network": [...],
    "metadata": {...},
    "sessionReplay": {...}
  }
}
```

#### List Reports

```http
GET /api/v1/reports?status=open&priority=high&page=1&limit=20
```

Query params:

- **Filters**: `status`, `priority`, `project_id`, `created_after`, `created_before`
- **Pagination**: `page`, `limit`
- **Sorting**: `sort_by`, `order`

**Date Filter Examples**:

```http
# Reports created after a specific date
GET /api/v1/reports?created_after=2025-01-01

# Reports created before a specific date
GET /api/v1/reports?created_before=2025-12-31

# Reports in a date range
GET /api/v1/reports?created_after=2025-01-01&created_before=2025-12-31
```

Dates should be in ISO 8601 format (`YYYY-MM-DD` or full ISO string)

#### Get/Update Report

```http
GET /api/v1/reports/:id
PATCH /api/v1/reports/:id
```

### Presigned URL Uploads

For direct client-to-storage uploads (bypasses API for file data, reduces memory usage by 97%).

#### Optimized Flow (Recommended)

The optimized flow returns presigned URLs directly in the bug report creation response, reducing HTTP requests by 40%:

**Step 1: Create bug report with file flags**

```http
POST /api/v1/reports
x-api-key: bgs_YOUR_API_KEY
Content-Type: application/json

{
  "title": "Bug title",
  "description": "Bug description",
  "report": { ... },
  "hasScreenshot": true,
  "hasReplay": true
}
```

**Response includes presigned URLs:**

```json
{
  "success": true,
  "data": {
    "id": "bug-uuid",
    "presignedUrls": {
      "screenshot": {
        "uploadUrl": "https://s3.amazonaws.com/...",
        "storageKey": "screenshots/project/bug/screenshot.png"
      },
      "replay": {
        "uploadUrl": "https://s3.amazonaws.com/...",
        "storageKey": "replays/project/bug/replay.gz"
      }
    }
  }
}
```

**Step 2: Upload files directly to S3:**

```bash
curl -X PUT "{uploadUrl}" \
  --data-binary @screenshot.png \
  -H "Content-Type: image/png"
```

**Step 3: Confirm upload (triggers processing):**

```http
POST /api/v1/reports/{id}/confirm-upload
x-api-key: bgs_YOUR_API_KEY

{
  "fileType": "screenshot"
}
```

#### Legacy Flow (Still Supported)

For backwards compatibility, you can request presigned URLs separately:

```http
POST /api/v1/uploads/presigned-url
x-api-key: bgs_YOUR_API_KEY
Content-Type: application/json

{
  "projectId": "uuid",
  "bugId": "uuid",
  "fileType": "screenshot" | "replay" | "attachment",
  "filename": "screenshot.png"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://s3.amazonaws.com/...",
    "storageKey": "screenshots/project-id/bug-id/filename.png",
    "expiresIn": 3600
  }
}
```

#### Confirm Upload

After uploading to storage, confirm the upload to trigger processing:

```http
POST /api/v1/reports/:id/confirm-upload
x-api-key: bgs_YOUR_API_KEY
Content-Type: application/json

{
  "fileType": "screenshot" | "replay"
}
```

**Note:** The storage key is retrieved from the database (set when the presigned URL was generated). This ensures the client cannot manipulate which file is being confirmed.

#### Get Download URL

Get temporary presigned URL for viewing uploaded files:

```http
GET /api/v1/reports/:id/screenshot-url
GET /api/v1/reports/:id/replay-url
Authorization: Bearer YOUR_JWT_TOKEN or x-api-key: bgs_...
```

**Response:**

```json
{
  "success": true,
  "url": "https://s3.amazonaws.com/...",
  "expiresIn": 900
}
```

**Benefits:**

- 97% memory reduction (3.33MB → 100KB per upload)
- 3x faster uploads (direct to storage)
- Supports large files (up to 10MB+)
- Works with S3, MinIO, local storage

See SDK documentation for `DirectUploader` usage examples.

### Data Retention

#### Get Project Retention Settings

```http
GET /api/v1/projects/:id/retention
Authorization: Bearer YOUR_JWT_TOKEN
```

Returns retention policy for a project (requires project access)

#### Update Project Retention Settings

```http
PUT /api/v1/projects/:id/retention
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json

{
  "bugReportRetentionDays": 90,
  "screenshotRetentionDays": 60,
  "replayRetentionDays": 30,
  "dataClassification": "general",
  "complianceRegion": "none"
}
```

Requires project owner or admin role. Admins can bypass tier limits.

**Tier Limits:**

- Free: 90 days max
- Professional: 365 days max
- Enterprise: 3650 days max

**Compliance Regions:**

- `none` - No regulatory requirements
- `eu` - GDPR (Europe)
- `us` - CCPA (California)
- `kz` - Kazakhstan data laws (5 years for financial)
- `uk` - UK GDPR
- `ca` - PIPEDA (Canada)

#### Admin - Get Global Retention Config

```http
GET /api/v1/admin/retention
Authorization: Bearer ADMIN_JWT_TOKEN
```

Returns global default retention configuration (admin only)

#### Admin - Update Global Retention Config

```http
PUT /api/v1/admin/retention
Authorization: Bearer ADMIN_JWT_TOKEN
Content-Type: application/json

{
  "bugReportRetentionDays": 90
}
```

**Status**: ⚠️ NOT IMPLEMENTED - Returns HTTP 501  
Global retention policies are managed via environment variables. Use project-specific retention settings instead. Requires database persistence layer (system_config table) for full implementation.

#### Admin - Preview Retention Policy

```http
POST /api/v1/admin/retention/preview?projectId=PROJECT_UUID
Authorization: Bearer ADMIN_JWT_TOKEN
```

Dry-run to see what would be deleted. Returns report counts and storage estimates.

#### Admin - Apply Retention Policies

```http
POST /api/v1/admin/retention/apply
Authorization: Bearer ADMIN_JWT_TOKEN
Content-Type: application/json

{
  "dryRun": false,
  "confirm": true,
  "batchSize": 100,
  "maxErrorRate": 5
}
```

Executes retention policy deletion. Requires `confirm: true` for production deletions.

#### Admin - Get Scheduler Status

```http
GET /api/v1/admin/retention/status
Authorization: Bearer ADMIN_JWT_TOKEN
```

Returns retention scheduler status (enabled, next run time)

#### Admin - Legal Hold (Apply/Remove)

```http
POST /api/v1/admin/retention/legal-hold
Authorization: Bearer ADMIN_JWT_TOKEN
Content-Type: application/json

{
  "reportIds": ["uuid-1", "uuid-2"],
  "hold": true  // true to apply, false to remove
}
```

Apply or remove legal hold protection on bug reports. Reports with legal hold cannot be deleted by retention policies (admin only).

#### Admin - Restore Soft-Deleted Reports

```http
POST /api/v1/admin/retention/restore
Authorization: Bearer ADMIN_JWT_TOKEN
Content-Type: application/json

{
  "reportIds": ["uuid-1", "uuid-2"]
}
```

Restore soft-deleted reports (admin only).  
**Note**: Only restores reports still in `bug_reports` table. Archived reports (moved to `archived_bug_reports`) cannot be restored.

### Health Checks

```http
GET /health   # Liveness
GET /ready    # Readiness (includes DB)
```

## Database Usage

### Basic Operations

```typescript
import { createDatabaseClient } from '@bugspotter/backend';

const db = createDatabaseClient();

// Create bug report
const bug = await db.bugReports.create({
  project_id: 'project-uuid',
  title: 'Critical issue',
  priority: 'high',
});

// Query with filters
const result = await db.bugReports.list(
  { status: 'open', priority: 'high' },
  { sort_by: 'created_at', order: 'desc' },
  { page: 1, limit: 20 }
);

// Transactions
await db.transaction(async (tx) => {
  const bug = await tx.bugReports.create({...});
  const session = await tx.sessions.createSession(bug.id, {...});
  return { bug, session };
});
```

### Repository Pattern

> **⚠️ BREAKING CHANGE (Jan 2026)**: The `BaseRepository` constructor signature has changed to support multi-tenancy schemas. All custom repositories must be updated.

```typescript
import { ProjectRepository } from '@bugspotter/backend';

const projectRepo = new ProjectRepository(pool);
const project = await projectRepo.findByApiKey('bgs_...');
```

Available repositories: `ProjectRepository`, `BugReportRepository`, `UserRepository`, `SessionRepository`, `TicketRepository`, `ProjectMemberRepository`, `RetentionRepository`

#### Creating Custom Repositories

If you've created custom repository classes, update the constructor:

```typescript
// ❌ OLD (will break):
class MyRepository extends BaseRepository<MyType> {
  constructor(pool: Pool) {
    super(pool, 'my_table', ['json_column']);
  }
}

// ✅ NEW (required):
class MyRepository extends BaseRepository<MyType> {
  constructor(pool: Pool) {
    super(pool, 'application', 'my_table', ['json_column']);
  }
}
```

**Constructor signature**: `super(pool, schema, tableName, jsonFields)`

- `schema`: Database schema name (type: `DatabaseSchemas`, e.g., `'application'`, `'system'`)
- Default schema: `'application'`

## Storage Layer

### Configuration

```typescript
import { createStorage } from '@bugspotter/backend';

// Local filesystem
const storage = createStorage({
  backend: 'local',
  local: {
    baseDirectory: './data/uploads',
    baseUrl: 'http://localhost:3000/uploads',
  },
});

// S3-compatible (AWS S3, Cloudflare R2)
const storage = createStorage({
  backend: 's3', // or 'r2' for Cloudflare R2
  s3: {
    endpoint: 'https://<account-id>.r2.cloudflarestorage.com', // Optional, omit for AWS S3
    region: 'auto', // 'auto' for R2, 'us-east-1' for AWS
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: 'bugspotter',
    // forcePathStyle is automatically set to false for virtual-hosted URLs
    // (required for R2, recommended for AWS S3)
  },
});

// Or use environment variables
const storage = createStorageFromEnv();
```

### Operations

```typescript
// Upload screenshot
const result = await storage.uploadScreenshot(projectId, bugId, buffer);

// Upload thumbnail
const result = await storage.uploadThumbnail(projectId, bugId, buffer);

// Upload attachment
const result = await storage.uploadAttachment(projectId, bugId, 'filename.pdf', buffer);

// Note: Replay uploads use presigned URLs (client uploads directly to storage)
```

## Architecture

### Authentication Flow

- **API Keys** (`X-API-Key`) - SDK requests, project-scoped, never expire
- **JWT Tokens** (`Authorization: Bearer`) - User requests, 1h access + 7d refresh

Mark routes as public:

```typescript
fastify.get('/public', { config: { public: true } }, handler);
```

### Error Handling

Uses **Strategy Pattern** for error types:

```typescript
const errorHandlers = [
  { matcher: isValidationError, processor: processValidationError },
  { matcher: isDatabaseError, processor: processDatabaseError },
  // Add new handlers without modifying existing code
];
```

### Repository Pattern

```
DatabaseClient (Facade)
    ├── ProjectRepository
    ├── BugReportRepository
    ├── RetentionRepository
    └── ... (7 repositories total)
         └── BaseRepository (shared logic)
```

Benefits: Testability, dependency injection, single responsibility

### Retry Logic

Automatic retry for read operations only:

```typescript
// ✅ Auto-retried on connection failure
await db.bugReports.findById(id);

// ❌ Not retried (prevents duplicates)
await db.bugReports.create(data);
```

### Data Retention Services

Automated data lifecycle management with compliance support:

```typescript
import { RetentionService, RetentionScheduler } from '@bugspotter/backend';

// Initialize services
const retentionService = new RetentionService(db, storage);
const scheduler = new RetentionScheduler(retentionService, notificationService);

// Preview what would be deleted
const preview = await retentionService.previewRetentionPolicy();
// { totalReports: 150, affectedProjects: [...], totalStorageBytes: 52428800 }

// Apply retention policies
const result = await retentionService.applyRetentionPolicies({
  dryRun: false,
  batchSize: 100,
  maxErrorRate: 5,
});
// { totalDeleted: 150, storageFreed: 52428800, projectsProcessed: 5 }

// Start automated daily cleanup (runs at 2 AM)
await scheduler.start();
```

**Features:**

- Tier-based retention limits (Free: 90d, Pro: 365d, Enterprise: 3650d)
- Compliance region support (GDPR, CCPA, Kazakhstan, UK, Canada)
- Data classification (general, financial, healthcare, PII, sensitive, government)
- Archive-before-delete option
- Legal hold protection
- Batch processing with error handling
- Notification on completion (logger/email/Slack)

## Testing

```bash
# Run all tests (Docker required)
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage

# Specific test suites
pnpm test:unit              # Unit tests only
pnpm test:integration       # Integration tests
pnpm test:queue             # Queue integration tests
pnpm test:load              # Load/performance tests

# Notification integration tests (real services)
RUN_INTEGRATION_TESTS=true pnpm test tests/integration/notification-delivery.test.ts
```

**1,202 tests** across 6 comprehensive test suites:

- Unit tests (database, API, storage, queue, retention, utilities)
- Queue tests (267 tests - BullMQ workers, managers, job definitions)
- Integration tests (API + DB + storage + queue - 22 tests with real Redis)
- Load tests (performance, concurrency, memory)
- E2E scenarios (complete workflows)
- **Notification tests** (30+ unit tests per handler, optional integration tests)

Uses [Testcontainers](https://testcontainers.com/) - **no manual database setup required!**

**Documentation:**

- [TESTING.md](./TESTING.md) - Testing guide and best practices
- [E2E_TEST_SCENARIOS.md](./E2E_TEST_SCENARIOS.md) - Complete test scenario documentation
- [NOTIFICATION_TESTING.md](./docs/NOTIFICATION_TESTING.md) - Notification testing guide (email, Slack, webhooks, etc.)

### Notification Integration Testing

Test notification delivery with real services (email, Slack, Discord, Teams):

1. **Copy example file**: `cp .env.integration.example .env.integration`
2. **Add test credentials**: Fill in SMTP, webhook URLs for services you want to test
3. **Run tests**: `RUN_INTEGRATION_TESTS=true pnpm test tests/integration/notification-delivery.test.ts`

See [NOTIFICATION_TESTING.md](./docs/NOTIFICATION_TESTING.md) for detailed setup instructions.

## Security

### CORS Protection

- ✅ Wildcard pattern support for flexible subdomain/port configuration
- ✅ Subdomain wildcards: `https://*.demo.bugspotter.io`
  - Uses `[^.]+` to block nested subdomains (security: prevents `evil.nested.app.example.com`)
- ✅ Port wildcards: `http://localhost:*`
  - Uses `\d+` to match numeric ports only (security: rejects `localhost:foo`)
  - Note: Does not validate port range (0-65535), only ensures numeric
- ✅ IPv6 address support: `http://[::1]:*`
- ✅ Combined wildcards: `https://*.example.com:*`
- ✅ Wildcard-only patterns (`*`) explicitly rejected
- ✅ RegExp conversion for @fastify/cors native matching
- ✅ Credentials enabled for authenticated requests

### SQL Injection Protection

- ✅ Parameterized queries (`$1`, `$2` placeholders)
- ✅ Identifier validation (`^[a-zA-Z0-9_]+$`)
- ✅ Pagination limits (1-1000)
- ✅ Batch size limits (max 1000)

### Content Security Policy

Helmet with strict CSP:

```typescript
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'"],  // NO 'unsafe-inline'
    imgSrc: ["'self'", 'data:'],  // NO 'https:'
  }
}
```

See [SECURITY.md](./SECURITY.md) for details.

## Troubleshooting

### Storage: 403 Forbidden on Cloudflare R2 URLs

**Symptom**: Screenshots/replays return 403 errors when accessed

**Root Cause**: R2 requires virtual-hosted style URLs (`https://bucket.endpoint/key`), not path-style URLs (`https://endpoint/bucket/key`)

**Solution**:

- The backend automatically uses virtual-hosted style for AWS S3 and R2
- Ensure `S3_FORCE_PATH_STYLE` is NOT set in your environment (deprecated)
- For MinIO, `forcePathStyle: true` can be set programmatically in test code when needed

**On-Demand URL Generation**:
If stored URLs expire (6-day maximum for presigned URLs), use these endpoints to generate fresh URLs from storage keys:

```http
# Single URL
GET /api/v1/storage/url/:bugReportId/screenshot
GET /api/v1/storage/url/:bugReportId/replay

# Batch URLs (for list views)
POST /api/v1/storage/urls/batch
Content-Type: application/json

{
  "bugReportIds": ["uuid1", "uuid2"],
  "types": ["screenshot", "thumbnail"]
}
```

### Database Connection Issues

**Symptom**: `ECONNREFUSED` or timeout errors

**Solution**:

- Verify PostgreSQL is running: `pg_isready -h localhost -p 5432`
- Check `DATABASE_URL` format: `postgresql://user:pass@host:port/dbname`
- Increase `DB_CONNECTION_TIMEOUT_MS` if on slow networks

## Development

```bash
# Watch mode
pnpm dev

# Build
pnpm build

# Lint
pnpm lint

# Format
pnpm format
```

## License

MIT
