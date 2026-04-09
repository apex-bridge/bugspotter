# Changelog

All notable changes to the BugSpotter project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### ⚠️ BREAKING CHANGES

- **BaseRepository Constructor Signature Change** - Multi-tenancy schema parameter added
  - **Old Signature**: `constructor(pool, tableName, jsonFields)`
  - **New Signature**: `constructor(pool, schema, tableName, jsonFields)`
  - **Impact**: All custom repository classes extending `BaseRepository` must be updated
  - **Schema Parameter**: Second parameter, type `DatabaseSchemas` (e.g., 'application', 'system')
  - **Default Value**: `'application'` (if not specified)
  - **Migration**:
    ```typescript
    // Before (OLD - will break):
    class MyRepository extends BaseRepository<MyType> {
      constructor(pool: Pool) {
        super(pool, 'my_table', ['json_column']);
      }
    }
    
    // After (NEW - required):
    class MyRepository extends BaseRepository<MyType> {
      constructor(pool: Pool) {
        super(pool, 'application', 'my_table', ['json_column']);
      }
    }
    ```
  - **Affected Code**:
    - All repository subclasses in `packages/backend/src/db/repositories/`
    - Test repositories in `packages/backend/tests/db/`
    - Any custom repositories in other branches or external codebases
  - **Action Required**: Search your codebase for `extends BaseRepository` and update all constructor calls
  - Date: January 29, 2026

### ✨ Features

- **Jira Integration Phase 4 Complete** - Enhanced Jira tickets with comprehensive debugging information
  - **Console Logs**: Last N console entries with severity-based formatting (errors, warnings, info)
    - Configurable limit via `templateConfig.consoleLogLimit` (default: 50 entries)
    - Grouped by severity level for quick triage
  - **Network Logs**: Failed HTTP requests (4xx/5xx) with timing information
    - Configurable filter: 'all' requests or 'failures' only (default: failures)
    - Configurable limit via `templateConfig.networkLogLimit` (default: 20 entries)
  - **Share Replay Auto-Generation**: Automatic 30-day shareable session replay URLs
    - Generates cryptographically secure tokens on ticket creation
    - Token reuse prevents duplicates for same bug report
    - Configurable expiration via `templateConfig.shareReplayExpiration` (default: 720 hours)
    - Graceful degradation if token generation fails
  - **Browser Metadata**: Enhanced environment information formatting
  - **Template Configuration**: Per-project customization via `JiraTemplateConfig`
    - Enable/disable logs, set limits, configure share replay behavior
    - Stored in `project_integrations.config.templateConfig` (JSONB)
  - **Architecture**: Strategy pattern with `BaseFormatter` → `ADFFormatter` + `PlainTextFormatter`
  - **Test Coverage**: 139 backend tests passing, formatters fully tested
  - **Implementation**: Complete in `packages/backend/src/integrations/jira/`
  - Date: November 29, 2025

- **Automatic Integration Triggering** - Bug reports now automatically create external platform tickets
  - **Behavior**: When a bug report is created via `POST /api/v1/reports`, integration jobs are automatically queued for all enabled integrations (Jira, GitHub, Linear, etc.)
  - **Configuration**: Respects `project_integrations.enabled` flag per project
  - **Multi-Platform**: Supports multiple simultaneous integrations (e.g., Jira + GitHub)
  - **Error Handling**: Non-blocking with graceful degradation - bug report creation succeeds even if integration queueing fails
  - **Security**: Credentials decrypted securely before queuing, encrypted at rest in Redis queue
  - **Implementation**:
    - New utility: `packages/backend/src/api/utils/integration-trigger.ts`
    - Modified: `packages/backend/src/api/routes/reports.ts` to call trigger after bug report creation
    - Pattern: Follows existing `notification-trigger.ts` pattern for consistency
  - **Documentation**: Updated `jira/README.md` and `queue/README.md` with accurate automatic workflow
  - **Test Coverage**: 10 comprehensive unit tests in `tests/api/integration-trigger.test.ts`
  - Date: November 29, 2025

### 🐛 Bug Fixes

- **Cloudflare R2 403 Forbidden Errors** - Fixed presigned URLs returning 403 on R2 storage
  - **Root Cause**: `S3_FORCE_PATH_STYLE=true` generated path-style URLs incompatible with R2
    - R2 requires virtual-hosted style: `https://bucket.endpoint/key`
    - Path-style URLs (`https://endpoint/bucket/key`) are deprecated and fail on R2
  - **Solution**: Removed `S3_FORCE_PATH_STYLE` environment variable support
    - Now always uses virtual-hosted style (works for AWS S3 and R2)
    - MinIO can still set `forcePathStyle: true` programmatically in tests
  - **New Features**: Added on-demand URL generation endpoints
    - `GET /api/v1/storage/url/:bugReportId/:type` - Generate fresh URL from storage key
    - `POST /api/v1/storage/urls/batch` - Batch URL generation for list views
    - URLs never expire from user perspective (regenerated on-demand)
  - Date: November 19, 2025

- **Worker Process Deployment & Signed URLs** - Fixed missing URLs for uploaded screenshots and replays
  - **Root Cause 1**: Worker process was not included in unified Docker deployment
    - Added worker to supervisord configuration alongside API and nginx
    - Jobs were queued but never processed (workers not running)
  - **Root Cause 2**: Storage service generated public URLs for private S3 buckets
    - Changed from `buildObjectUrl()` to `getSignedUrl()` with 30-day expiration
    - Public URLs returned 403 Forbidden for private buckets (R2, B2, private S3)
  - **Impact**: `screenshot_url` and `replay_url` fields now populate correctly with accessible signed URLs
  - All 79 storage tests passing (includes 3 new tests for signed URL generation)
  - Date: November 17, 2025

### ✨ Features

- **DB-Backed Per-Organization Magic Login Settings** - Magic login toggle stored in JSONB `settings` column on organizations table
  - New migration `006_organization_settings.sql` adds `settings JSONB NOT NULL DEFAULT '{}'` to `saas.organizations`
  - Replaced `MAGIC_LOGIN_ALLOWED_ORGS` env var with `settings.magic_login_enabled` per-org DB flag
  - Magic tokens require `organizationId` claim; handler validates org settings + user membership
  - Admin endpoints: `GET` + `PATCH /api/v1/admin/organizations/:id/magic-login-status`
  - Admin UI toggle switch to enable/disable magic login per organization (no server restart required)
  - `OrganizationSettings` interface for typed access to per-org feature flags
  - Prevents enabling passwordless auth across entire shared SaaS instance
  - **Breaking**: `MAGIC_LOGIN_ALLOWED_ORGS` env var removed; use admin API or DB to enable per-org
  - Date: March 2026

- **Magic Login JWT Claim Flexibility** - Enhanced magic login to accept both standard and custom JWT claims
  - Now accepts both `userId` (custom claim) and `sub` (standard JWT Subject claim)
  - Prioritizes `userId` if both claims are present for backward compatibility
  - Improves interoperability with standard JWT libraries and external identity providers
  - All 17 magic login integration tests passing (includes 2 new tests for `sub` claim support)
  - Date: November 17, 2025

- **Magic Login Authentication** - JWT-based passwordless authentication for demo environments
  - One-click login via URL query parameter (`?token=xxx`)
  - Feature toggle via organization `settings.magic_login_enabled` (DB-backed per-org flag)
  - Tokens include `type: 'magic'` discriminator for validation
  - Configurable expiration (1h, 24h, 7d, etc.)
  - No database changes required - pure JWT implementation
  - Endpoint: `POST /api/v1/auth/magic-login`
  - Frontend auto-login on detection of `?token=` parameter
  - Generate tokens using exported `generateMagicToken()` helper function
  - Comprehensive test coverage: 10 integration tests validating security, expiration, error handling
  - Date: November 17, 2025

- **Replay Worker Presigned URL Support** - Replay worker now handles both legacy inline data and presigned URL uploads
  - Client can upload compressed replay files directly to S3 using presigned URLs
  - Worker validates, decompresses, and extracts metadata from uploaded files
  - Generates signed URLs with 30-day expiration for replay access
  - Full support for both upload flows: legacy `replayData` and modern `replayKey`
  - All 155 integration tests passing

### ⚡ Performance Improvements

- **SQL Query Optimization - listByUserAccess** - Rewrote user access query for better index usage and parallel execution
  - **Optimization 1**: Added 3 composite indexes via migration 005:
    - `idx_bug_reports_active_project_status_created` - Partial index for status filtering (WHERE deleted_at IS NULL)
    - `idx_bug_reports_active_project_priority_created` - Partial index for priority filtering
    - `idx_projects_created_by_id` - Composite index for ownership lookups
  - **Optimization 2**: Replaced JOIN with OR condition → UNION ALL approach
    - Old: `JOIN projects p LEFT JOIN project_members pm WHERE (p.created_by = $1 OR pm.user_id = $1)` prevented index usage
    - New: Separate branches for owned vs member projects, each uses optimal index path
  - **Optimization 3**: Parallel query execution using `Promise.all()` for count + data queries
  - **Optimization 4**: DISTINCT ON (id) only in subquery, final sorting applied after deduplication
  - **Benefits**: Better index utilization, reduced query latency, maintains correctness (all 29 tests passing)
  - Applied SOLID/DRY/KISS refactoring: extracted validation helpers, reduced code duplication by 40+ lines
  - Date: November 17, 2025

- **Async gzip decompression** - Replaced blocking `gunzipSync` with async `gunzip` using promisify
  - Prevents event loop blocking during gzip content-type parsing
  - Significantly improves server responsiveness under concurrent load
  - All 12 gzip parser tests + 446 API tests passing

### 🐛 Bug Fixes

- **CRITICAL: listByUserAccess pagination SQL error** - Fixed production bug causing 500 errors on demo.api.bugspotter.io
  - **Impact**: GET `/api/v1/reports?user_id=...` returned "syntax error at or near ["
  - **Root cause**: Pagination parameters (LIMIT/OFFSET) were not included in the parameterized query values array, causing PostgreSQL parameter number mismatch
  - **Fix**: Use `buildPaginationClause()` helper to properly generate pagination clause and values array, ensuring parameters are correctly numbered and passed to query execution
  - **Second bug**: JOIN query only checked project_members, missed project owners (users with `created_by` on projects table)
  - **Fix**: Added LEFT JOIN with projects table to include both ownership (`p.created_by = $1`) and membership (`pm.user_id = $1`)
  - **Test coverage**: Added comprehensive test suite with 29 tests covering access control, pagination, sorting, filters, soft-delete handling, edge cases
  - **Prevention**: Regression test specifically validates pagination parameter binding with `user_id` filter
  - Date: November 17, 2025
  - All 2532 backend tests passing

- **SQL Injection Prevention: listByUserAccess** - Replaced template literals with parameterized queries for LIMIT/OFFSET
  - **Impact**: LIMIT/OFFSET values were concatenated directly into SQL string using `${limit}` and `${(page - 1) * limit}`
  - **Security risk**: Potential SQL injection if pagination parameters are derived from untrusted input
  - **Fix**: Use `buildPaginationClause()` helper function to generate parameterized pagination with proper parameter numbering
  - **Code consistency**: Now follows same pattern as `BaseRepository.listPaginated()` and other repository methods
  - **Defense in depth**: Follows project security best practices requiring parameterized queries for all dynamic values
  - Date: November 17, 2025
  - All 29 listByUserAccess tests passing

- **Timezone-dependent test failure** - Fixed parseDateFilter test that failed in non-UTC timezones
  - **Issue**: `getFullYear()` returns local year, not UTC year - '2099-12-31T23:59:59.999Z' becomes 2100-01-01 in UTC+1 timezone
  - **Fix**: Use `getUTCFullYear()` instead of `getFullYear()` for timezone-agnostic year comparison
  - All 97 query-builder tests passing

- **Orphaned API keys after project deletion** - API keys are now automatically revoked when all their allowed projects are deleted
  - Added migration 004 to revoke existing orphaned keys (empty `allowed_projects` arrays)
  - Enhanced `cleanup_api_keys_on_project_delete` trigger to automatically revoke keys that become orphaned
  - Fixed PostgreSQL quirk: `array_length([], 1)` returns NULL not 0, required special handling
  - Admin panel no longer shows useless API keys with no project access
  - All 5 API key cleanup tests passing + 149 integration tests passing

- **Corepack signature verification** - Removed workaround from integration tests
  - Updated Corepack from 0.29.4 to 0.34.3 to fix signature verification bug
  - Integration tests now use standard `pnpm migrate` instead of `npx tsx` workaround
  - All 149 integration tests passing with standard tooling
  - Documentation updated in E2E_TESTING.md and E2E_TESTING_LOCAL.md

- **Rate-limited stream robustness improvements**
  - Fixed infinite loop in `createRateLimitedStream()` tests with async/await
  - Implemented proper rate limiting that enforces bytesPerSecond limit with chunk splitting across multiple 1-second windows
  - Added timer cleanup on stream destroy to prevent memory leaks
  - Implemented cancelable timers to prevent deadlocks when stream destroyed during await
  - Fixed callback contract to signal error (not success) when stream destroyed mid-processing
  - Fixed race condition in destroy() by capturing resolve reference atomically before clearing timer
  - All 57 stream utility tests passing
  - Note: Function is exported but currently unused in production (future bandwidth throttling)

- **Date filter PostgreSQL error** - Fixed HTTP 500 error when using `created_after` or `created_before` filters
  - Added explicit `::timestamptz` type casting to date parameters
  - Previously returned PostgreSQL error 42P18 "could not determine data type of parameter"
  - Now correctly returns empty list when no reports match date filters
  - Verified with 24 passing unit tests and E2E test coverage

### 🎨 Admin Panel

- **Full-featured web control panel** built with React 18 + TypeScript
- **5 core pages**: Setup wizard, Login, Health monitoring, Projects, Settings
- **Bug Report Dashboard**: Filters, list view, detail modal with session replay player
- **JWT authentication** with automatic token refresh
- **Professional UI** with Tailwind CSS and responsive design
- **Docker integration** with Nginx and multi-stage builds
- **Test coverage**: 33 tests (25 passing, 8 in progress for accessibility)

### 🔐 Security Enhancements

- **httpOnly Cookie Authentication** (XSS protection)
  - Refresh tokens stored in httpOnly cookies (JavaScript-inaccessible)
  - Access tokens in memory only (React state)
  - Cookie options: `httpOnly: true`, `secure: true` (production), `sameSite: 'strict'`
  - Automatic cookie rotation on token refresh
  - Logout endpoint clears cookies properly
- **Modern CSP headers** replacing deprecated X-XSS-Protection
- **114 auth integration tests** ensuring cookie security

### 📧 Email Integration

- **Comprehensive email provider guide** with 5 production-ready options:
  - SendGrid (recommended for quick start)
  - AWS SES (best for scale)
  - Postmark (best deliverability)
  - Resend (modern choice)
  - Nodemailer + SMTP (self-hosted)
- Complete implementation examples for each provider
- Environment variable configuration templates

### 🔔 Notification System

- **Strategy Pattern implementation** for notifications
- **Registry Pattern** for dynamic notifier discovery
- **3 notification types**: Webhook, Slack, Email (structure ready)
- Queue-based notification processing with BullMQ
- Decentralized config: each notifier manages its own configuration

### 📚 Documentation

- Created comprehensive SYSTEM_SUMMARY.md (2000-word overview)
- Updated README.md with latest features (httpOnly, admin panel, email)
- Added EMAIL_INTEGRATION.md with provider comparisons
- Added SECURITY.md for admin panel (httpOnly cookies, CSP)
- Added REACT_PATTERNS.md for React best practices
- Removed obsolete ADMIN_PANEL_SUMMARY.md (consolidated)
- Removed obsolete httpOnly-implementation.md (in SECURITY.md)
- Updated test counts: 1,608 tests (1,575 passing)

## [0.3.0] - 2025-10-05

### 🔒 PII Detection & Sanitization

Major security update adding comprehensive PII detection and sanitization.

### ✨ Added

#### PII Sanitization

- **Automatic PII detection** and masking before sending bug reports
- **Built-in patterns** for sensitive data:
  - Email addresses (`user@example.com` → `[REDACTED-EMAIL]`)
  - Phone numbers - international formats (`+1-555-1234` → `[REDACTED-PHONE]`)
  - Credit cards - all major formats (`4532-1488-0343-6467` → `[REDACTED-CREDITCARD]`)
  - Social Security Numbers (`123-45-6789` → `[REDACTED-SSN]`)
  - Kazakhstan IIN/BIN numbers with date validation (`950315300123` → `[REDACTED-IIN]`)
  - IP addresses - IPv4 and IPv6 (`192.168.1.1` → `[REDACTED-IP]`)
- **Custom regex patterns** support for app-specific sensitive data
- **Exclude selectors** to preserve public data (e.g., support emails)
- **Cyrillic text support** for Russian and Kazakh content
- **Performance optimized** - <10ms overhead per bug report

#### Sanitization Coverage

- Console logs and error messages
- Network request/response data (URLs, headers, bodies)
- Error stack traces
- DOM text content in session replays
- Metadata (URLs, user agents)

#### Configuration

- Enable/disable sanitization globally
- Select specific PII patterns to detect
- Define custom patterns with regex
- Exclude DOM elements from sanitization

#### Testing

- 52 comprehensive sanitization tests
- **Total SDK tests: 226** (up from 174)

### 📝 Changed

- All capture modules accept optional `Sanitizer` instance
- DOM collector uses rrweb's `maskTextFn` for text sanitization
- Default: sanitization **enabled** with all built-in patterns

See [packages/sdk/README.md](./packages/sdk/README.md) for configuration details.

## [0.2.0] - 2025-10-04

### 🎥 Session Replay Feature

Major update adding comprehensive session replay functionality.

### ✨ Added

#### Session Replay

- **rrweb integration** for DOM recording and playback
- **Circular buffer** with time-based event management (15-30s configurable)
- **DOMCollector class** for recording user interactions
- **Event types** captured:
  - DOM mutations (additions, removals, attribute changes)
  - Mouse movements (throttled to 50ms)
  - Mouse interactions (clicks, double-clicks)
  - Scroll events (throttled to 100ms)
  - Form inputs
  - Viewport changes
- **Performance optimizations**:
  - Sampling rates for mousemove and scroll
  - Slim DOM options to reduce payload
  - Automatic pruning of old events
- **Interactive replay player** in demo using rrweb-player
- **Persistent database** for backend-mock (JSON file storage)

#### Documentation

- Session replay guide: [packages/sdk/docs/SESSION_REPLAY.md](./packages/sdk/docs/SESSION_REPLAY.md)
- Demo guide: [apps/demo/README.md](./apps/demo/README.md)

#### Testing

- 17 tests for CircularBuffer
- 13 tests for DOMCollector
- 3 integration tests for replay
- **Total SDK tests: 174** (up from 129)

### 📝 Changed

- Bundle size increased to ~99 KB (from 29.2 KB) due to rrweb
- Memory usage increased to ~15 MB (from ~10 MB) with 30s buffer
- Demo now includes replay player with controls
- Backend logs now show replay event breakdown

### 🔧 Dependencies

- rrweb@2.0.0-alpha.4, rrweb-snapshot@2.0.0-alpha.4, @rrweb/types@2.0.0-alpha.18

## [0.1.0] - 2025-10-03

### 🎉 Initial Release

This is the first working version of BugSpotter SDK with full capture, widget, and API functionality.

### ✨ Added

#### Core SDK

- **BugSpotter class** with singleton pattern
- **Automatic capture** of screenshots, console logs, network requests, and metadata
- **Configuration system** with API key and endpoint support
- **TypeScript support** with full type definitions
- **Webpack build** producing minified bundle

#### Capture Modules

- **Screenshot Capture**
  - CSP-safe using html-to-image library
  - Full page capture as Base64 PNG
  - Error handling with fallback message
  - ~500ms average capture time

- **Console Capture**
  - Captures log, warn, error, info, debug levels
  - Stack traces for errors
  - Timestamps for all entries
  - Object stringification with circular reference handling
  - Configurable max logs (default: 100)

- **Network Capture**
  - Fetch API interception
  - XMLHttpRequest monitoring
  - Request/response timing
  - HTTP status codes
  - Error tracking
  - Singleton pattern

- **Metadata Capture**
  - Browser detection (Chrome, Firefox, Safari, Edge, Opera, etc.)
  - OS detection (Windows, macOS, Linux, iOS, Android, ChromeOS)
  - Viewport dimensions
  - User agent string
  - Current URL
  - Capture timestamp

#### Widget Components

- **FloatingButton**
  - Customizable position (4 corners)
  - Custom icon support (emoji/text)
  - Configurable colors and size
  - Smooth animations
  - Shadow DOM isolation
  - Show/hide controls
  - Dynamic updates (icon, color)

- **BugReportModal**
  - Professional design with animations
  - Form validation (title and description required)
  - Screenshot preview
  - **Async submission support** (handles Promise callbacks)
  - Loading state during submission
  - Error handling with user feedback
  - Escape key to close
  - Click X button to close
  - Prevents accidental close (no click-outside)
  - Shadow DOM isolation

#### API Integration

- **HTTP submission** with fetch API
- **Bearer token authentication**
- **JSON payload** structure
- **Error handling** for 4xx/5xx responses
- **Network error** handling
- **Response parsing**

#### Backend (Mock Server)

- **Express.js server** on port 4000
- **CORS enabled** for cross-origin requests
- **POST /api/bugs** - Submit bug reports
- **GET /api/bugs** - List all reports
- **GET /api/bugs/:id** - Get specific report
- **DELETE /api/bugs** - Clear all reports
- **POST /api/bugs/error/:code** - Simulate errors (testing)
- **Enhanced logging** with formatted output:
  - Console logs display (first 10 entries)
  - Network requests display (first 5 requests)
  - Detailed metadata logging
- **File persistence** - Auto-save reports to `bug-reports/` directory
- **Timestamped filenames** for easy tracking
- **JSON formatting** with pretty-print
- **Request validation** with error messages
- **Health check** endpoint

#### Testing

- **129 comprehensive tests** - All passing ✅
  - 27 Core SDK tests
  - 13 Console capture tests
  - 12 Network capture tests
  - 5 Screenshot capture tests
  - 16 Metadata capture tests
  - 19 Button widget tests
  - 25 Modal widget tests
  - 12 API submission tests
- **Vitest** testing framework
- **JSDOM** for DOM testing
- **Mock implementations** for browser APIs
- **Integration tests** for full workflows
- **Unit tests** for individual components

#### Demo Application

- **Professional UI** with corporate blue theme (#1a365d)
- **Interactive test buttons** for console/network testing
- **Live capture** demonstration
- **API integration** example
- **Browser-sync** for live reload
- **Responsive design**

#### Documentation

- **README.md** - Project overview and quick start
- **packages/sdk/README.md** - SDK API documentation
- **docs/API_TESTING.md** - Complete API testing guide
- **docs/ENHANCED_LOGGING.md** - Backend logging features
- **docs/TECH_STACK.md** - Technology overview
- **packages/backend-mock/README.md** - Mock backend API documentation

### 🎨 Design Improvements

- **Professional color scheme** - Navy blue (#1a365d) corporate theme
- **Subtle animations** - Smooth transitions and effects
- **Clean typography** - Modern font stack
- **Shadow DOM** - Isolated styling for widgets
- **Responsive layout** - Mobile-friendly design

### 🔒 Security

- **CSP-safe** screenshot capture
- **Input validation** on all forms
- **Bearer token** authentication
- **No inline scripts** in widgets
- **Sanitized outputs** in logging

### 📊 Performance

- Bundle: 29.2 KB minified
- Load: < 100ms
- Memory: < 10 MB
- Screenshot: ~500ms

### 🐛 Bug Fixes

- Fixed duplicate floating buttons issue
- Fixed modal closing on outside click (UX improvement)
- Fixed async modal submission handling

### 🔧 Technical

- TypeScript strict mode
- Webpack 5 build system
- pnpm workspace monorepo
- 129 comprehensive tests

---

## Future Releases

### [0.2.0] - Planned

- NPM package publication
- React integration example
- Vue integration example
- Angular integration example
- Enhanced error boundary handling

### [0.3.0] - Planned

- Production backend template
- PostgreSQL integration
- Cloud storage for screenshots
- Authentication system
- Rate limiting

### [1.0.0] - Planned

- Public stable release
- Complete documentation
- Video tutorials
- Dashboard UI
- Team features
- Analytics integration

---

## Development Notes

### Breaking Changes

None - this is the initial release.

### Deprecations

None - this is the initial release.

### Migration Guide

None - this is the initial release.

---

**Contributors:** ApexBridge Team
**Released:** October 3, 2025
**License:** MIT
