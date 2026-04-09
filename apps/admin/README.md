# BugSpotter Admin Panel

Professional web-based admin control panel for managing BugSpotter self-hosted instances.

## Features

### 🚀 Setup Wizard

- One-time initialization flow for new installations
- Create admin account
- Configure storage (MinIO/AWS S3)
- Test storage connections before saving
- Set instance name and URL

### ⚙️ Settings Management

- **Instance Configuration**: Name, URL, support email
- **Storage Settings**: S3/MinIO credentials, bucket configuration
- **Security Settings**: JWT token expiry, rate limits, CORS origins
- **Retention Policies**: Data retention days, max reports per project
- **Feature Flags**: Toggle session replay on/off

### Bug Reports Management

- **Browse & Filter**: List all bug reports with advanced filtering (project, status, priority, date range)
- **Detailed View**: Full bug report details with metadata, screenshots, console logs
- **Session Replay**: View rrweb session recordings with timeline controls
- **Public Replay Sharing**: Create shareable links for session replays
  - Optional password protection (min 8 characters)
  - Configurable expiration (1-720 hours)
  - View count tracking
  - Copy share URL to clipboard
  - Revoke access anytime
  - **Public Viewer**: Share links open in public viewer (no login required)
    - Password protection with unlock UI
    - Bug report metadata display
    - Session replay player
    - View count and expiration info
    - Mobile responsive
    - WCAG 2.1 AA accessible
- **Status Management**: Update bug status (open → in_progress → resolved → closed)
- **Priority Control**: Set priority levels (low, medium, high, critical)
- **Network Analysis**: View network requests with timing and payload details
- **Browser Metadata**: Inspect user agent, viewport, and environment info
- **Bulk Operations**: Delete multiple reports at once

### Project Management

- List all projects
- Create new projects
- Delete projects (with confirmation)
- View project statistics (report count, creation date)

### 🔗 Integration Management

- **Configure Integrations**: Set up Jira, GitHub, Linear, and other third-party integrations
- **Filtering Rules**: Control which bug reports trigger ticket creation
  - Create rules with multiple filter conditions (priority, status, browser, OS, URL, error message)
  - Support for 7 operators: equals, contains, regex, in, not_in, starts_with, ends_with
  - Priority-based execution (higher priority rules execute first)
  - Enable/disable rules without deleting them
- **Throttling**: Prevent spam with rate-limiting configuration
  - Max tickets per hour/day
  - Group throttling by user, URL, or error type
  - Optional digest mode for batched notifications
- **Credential Management**: Securely store API tokens with AES-256-GCM encryption
- **Connection Testing**: Validate credentials before saving

### 🏥 System Health

- Real-time health monitoring (auto-refresh every 30s)
- Database, Redis, and Storage status
- System metrics (disk space, worker queue depth, uptime)
- Color-coded status indicators

## Tech Stack

- **Frontend**: React 18.3.1 + TypeScript
- **Build Tool**: Vite 5.2.8
- **Styling**: Tailwind CSS 3.4.3
- **UI Components**: Custom components with Lucide React 0.363.0 icons
- **State Management**: TanStack Query 5.28.4 (React Query)
- **HTTP Client**: Axios 1.6.8 with auto token refresh
- **Routing**: React Router 6.22.3
- **Session Replay**: rrweb-player 1.0.0-alpha.4
- **Notifications**: Sonner 1.4.41 toast library
- **Testing**: Vitest 3.2.4 + Playwright 1.56.0 + Testing Library
- **Production**: Nginx Alpine for static file serving
- **Shared Types**: @bugspotter/types (workspace package for type consistency)

## Development

### Prerequisites

- Node.js 20+
- pnpm 8+

### Install Dependencies

```bash
cd apps/admin
pnpm install
```

**Note on dependencies**: The `baseline-browser-mapping` package is a peer dependency of `browserslist` (used by Vite and PostCSS). It's included to suppress build warnings about missing browser mapping data.

### Development Server

```bash
pnpm dev
```

The dev server runs on `http://localhost:3001` with API proxy to `http://localhost:3000`.

### Build

```bash
pnpm build
```

Output in `dist/` directory.

### Code Quality

```bash
pnpm lint    # ESLint
pnpm format  # Prettier
```

## Docker Deployment

### Build Image

```bash
# Production build (strict CSP)
docker build -t bugspotter-admin:latest apps/admin

# Development build (relaxed CSP for Vite HMR)
docker build -t bugspotter-admin:dev \
  --build-arg NGINX_CONFIG=nginx.dev.conf \
  apps/admin
```

### Run Container

```bash
docker run -d \
  --name bugspotter-admin \
  -p 3001:80 \
  -e VITE_API_URL=/api \
  bugspotter-admin:latest
```

### With Docker Compose

```bash
# Production (default - strict CSP)
docker-compose up -d admin

# Development (relaxed CSP for Vite HMR)
ADMIN_NGINX_CONFIG=nginx.dev.conf docker-compose up -d admin
```

Access at `http://localhost:3001`

## Configuration

### Environment Variables

- `VITE_API_URL`: Backend API base URL (default: `/api` for proxying)
- `ADMIN_NGINX_CONFIG`: Nginx config file (default: `nginx.conf`, dev: `nginx.dev.conf`)

### Nginx Configuration

Two configurations available:

**Production (`nginx.conf` - default)**:

- ✅ React/Vite compatible - Allows `unsafe-inline` for styles (required for dynamic React components)
- ✅ External resource support - Allows demo.bugspotter.io subdomains for fonts/images
- ✅ R2 storage access - Allows CloudFlare R2 for screenshots/replays
- SPA routing, API proxy, static caching, gzip, security headers

**Development (`nginx.dev.conf`)**:

- ⚠️ Relaxed CSP - Allows `unsafe-inline`, `unsafe-eval` for Vite HMR
- ⚠️ WebSocket support for hot reloading
- Same features as production config

### Content Security Policy (CSP)

| Feature         | Production   | Development                  |
| --------------- | ------------ | ---------------------------- |
| Inline scripts  | ✅ Allowed   | ✅ Allowed (`unsafe-inline`) |
| Inline styles   | ✅ Allowed   | ✅ Allowed (`unsafe-inline`) |
| Eval            | ❌ Blocked   | ✅ Allowed (`unsafe-eval`)   |
| External images | ✅ Allowed\* | ✅ Allowed                   |
| External fonts  | ✅ Allowed\* | ✅ Allowed                   |
| WebSocket       | ❌ Blocked   | ✅ Allowed (HMR)             |

\*Only from trusted domains: `*.demo.bugspotter.io`, `*.r2.cloudflarestorage.com`

**Why allow unsafe-inline in production?**

- React and Vite require inline styles for dynamic component rendering
- Modern React uses style attributes for conditional styling
- Still secure: other directives (frame-ancestors, form-action, object-src) remain strict
- Strict CSP in production prevents XSS attacks

## API Integration

### Authentication

The admin panel uses JWT-based authentication with automatic token refresh:

1. User logs in with email/password
2. Receives `access_token` (1h) in response body, `refresh_token` (7d) in httpOnly cookie
3. **Access token stored in memory** (React state) - XSS protection
4. **Refresh token stored in httpOnly cookie** (backend-managed) - Maximum security
5. API client uses accessor functions to get tokens from auth context
6. Automatically refreshes expired tokens via interceptor using httpOnly cookie
7. On refresh failure, clears all tokens and redirects to login

**Security Note**: Refresh tokens are never exposed to JavaScript. The backend sets them as httpOnly cookies, preventing XSS token theft entirely.

### API Endpoints Used

#### Authentication (`/api/v1/auth`)

| Method | Endpoint         | Description                  | Auth Required |
| ------ | ---------------- | ---------------------------- | ------------- |
| POST   | `/auth/register` | Register new user            | No            |
| POST   | `/auth/login`    | User login (returns JWT)     | No            |
| POST   | `/auth/logout`   | User logout (clears cookies) | Yes (JWT)     |
| POST   | `/auth/refresh`  | Refresh access token         | Yes (Cookie)  |
| GET    | `/auth/me`       | Get current user profile     | Yes (JWT)     |
| PATCH  | `/auth/me`       | Update current user profile  | Yes (JWT)     |
| PATCH  | `/auth/password` | Change password              | Yes (JWT)     |

#### API Keys (`/api/v1/api-keys`)

| Method | Endpoint               | Description                        | Auth Required |
| ------ | ---------------------- | ---------------------------------- | ------------- |
| GET    | `/api-keys`            | List API keys for user projects    | Yes (JWT)     |
| POST   | `/api-keys`            | Create new API key                 | Yes (JWT)     |
| PATCH  | `/api-keys/:id`        | Update API key (name, permissions) | Yes (JWT)     |
| DELETE | `/api-keys/:id`        | Revoke API key                     | Yes (JWT)     |
| POST   | `/api-keys/:id/rotate` | Rotate API key secret              | Yes (JWT)     |
| GET    | `/api-keys/:id/usage`  | Get API key usage statistics       | Yes (JWT)     |

**API Key System Features:**

- **Prefix-based validation**: `bgs_test_*` (development) vs `bgs_prod_*` (production)
- **Scoped permissions**: read, write, admin
- **Rate limiting**: Configurable per key (max requests, window size)
- **Hashed storage**: Only prefix stored in plaintext, full key hashed with bcrypt
- **Usage tracking**: Request counts, last used timestamp, IP addresses
- **Automatic rotation**: Generate new key while keeping old valid for transition period
- **Project scoping**: Each key belongs to one project
- **Type safety**: Uses shared types from `@bugspotter/types` for consistency with backend

#### Setup (`/api/v1/setup`)

| Method | Endpoint              | Description                  | Auth Required |
| ------ | --------------------- | ---------------------------- | ------------- |
| GET    | `/setup/status`       | Check if system initialized  | No            |
| POST   | `/setup/initialize`   | Initialize system (one-time) | No            |
| POST   | `/setup/test-storage` | Test storage connection      | No            |

#### Admin (`/api/v1/admin`)

| Method | Endpoint                    | Description                | Auth Required |
| ------ | --------------------------- | -------------------------- | ------------- |
| GET    | `/admin/health`             | System health status       | Yes (Admin)   |
| GET    | `/admin/settings`           | Get instance settings      | Yes (Admin)   |
| PATCH  | `/admin/settings`           | Update settings            | Yes (Admin)   |
| GET    | `/admin/users`              | List all users             | Yes (Admin)   |
| POST   | `/admin/users`              | Create user                | Yes (Admin)   |
| PATCH  | `/admin/users/:id`          | Update user (role, status) | Yes (Admin)   |
| DELETE | `/admin/users/:id`          | Delete user                | Yes (Admin)   |
| GET    | `/admin/integrations`       | List all integrations      | Yes (Admin)   |
| GET    | `/admin/integrations/:type` | Get integration by type    | Yes (Admin)   |
| POST   | `/admin/integrations`       | Create integration         | Yes (Admin)   |
| PATCH  | `/admin/integrations/:id`   | Update integration         | Yes (Admin)   |
| DELETE | `/admin/integrations/:id`   | Delete integration         | Yes (Admin)   |

#### Projects (`/api/v1/projects`)

| Method | Endpoint                        | Description           | Auth Required |
| ------ | ------------------------------- | --------------------- | ------------- |
| GET    | `/projects`                     | List user's projects  | Yes (JWT)     |
| POST   | `/projects`                     | Create project        | Yes (JWT)     |
| GET    | `/projects/:id`                 | Get project by ID     | Yes (JWT)     |
| PATCH  | `/projects/:id`                 | Update project        | Yes (JWT)     |
| DELETE | `/projects/:id`                 | Delete project        | Yes (JWT)     |
| GET    | `/projects/:id/members`         | List project members  | Yes (JWT)     |
| POST   | `/projects/:id/members`         | Add member to project | Yes (JWT)     |
| DELETE | `/projects/:id/members/:userId` | Remove member         | Yes (JWT)     |

#### Bug Reports (`/api/v1/reports`)

| Method | Endpoint                   | Description                            | Auth Required |
| ------ | -------------------------- | -------------------------------------- | ------------- |
| GET    | `/reports`                 | List bug reports (filters, pagination) | Yes (JWT)     |
| POST   | `/reports`                 | Create bug report                      | Yes (API Key) |
| GET    | `/reports/:id`             | Get bug report by ID                   | Yes (JWT)     |
| PATCH  | `/reports/:id`             | Update bug report (status, priority)   | Yes (JWT)     |
| DELETE | `/reports/:id`             | Delete bug report                      | Yes (JWT)     |
| POST   | `/reports/bulk-delete`     | Bulk delete bug reports                | Yes (JWT)     |
| GET    | `/reports/:id/sessions`    | Get session replays                    | Yes (JWT)     |
| POST   | `/reports/:id/attachments` | Upload attachment                      | Yes (API Key) |

**Query Parameters for `/reports`:**

- `project_id` - Filter by project
- `status` - Filter by status (open, in_progress, resolved, closed)
- `priority` - Filter by priority (low, medium, high, critical)
- `created_after` - Filter by date (ISO 8601)
- `created_before` - Filter by date (ISO 8601)
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20, max: 100)
- `sort_by` - Sort field (created_at, updated_at, priority)
- `sort_order` - Sort direction (asc, desc)

#### Uploads (`/api/v1/uploads`)

| Method | Endpoint                   | Description                      | Auth Required |
| ------ | -------------------------- | -------------------------------- | ------------- |
| POST   | `/uploads/screenshot`      | Get presigned URL for screenshot | Yes (API Key) |
| POST   | `/uploads/replay/metadata` | Get presigned URL for metadata   | Yes (API Key) |
| POST   | `/uploads/replay/chunk`    | Get presigned URL for chunk      | Yes (API Key) |
| POST   | `/uploads/attachment`      | Get presigned URL for attachment | Yes (API Key) |

**Presigned URL Flow:**

1. SDK requests presigned URL from backend (with filename, size, content type)
2. Backend generates S3 presigned URL (expires in 15 minutes)
3. SDK uploads directly to S3 using presigned URL (no backend proxy)
4. SDK notifies backend of successful upload
5. Backend validates and associates file with bug report

#### Integrations (`/api/v1/integrations`)

| Method | Endpoint                                           | Description             | Auth Required |
| ------ | -------------------------------------------------- | ----------------------- | ------------- |
| GET    | `/integrations/jira/:projectId`                    | Get Jira integration    | Yes (JWT)     |
| POST   | `/integrations/jira/:projectId`                    | Link Jira integration   | Yes (JWT)     |
| PATCH  | `/integrations/jira/:projectId`                    | Update Jira config      | Yes (JWT)     |
| DELETE | `/integrations/jira/:projectId`                    | Unlink Jira integration | Yes (JWT)     |
| POST   | `/integrations/jira/:projectId/test`               | Test Jira connection    | Yes (JWT)     |
| POST   | `/integrations/jira/:projectId/sync`               | Trigger manual sync     | Yes (JWT)     |
| GET    | `/integrations/:platform/:projectId/rules`         | List integration rules  | Yes (JWT)     |
| POST   | `/integrations/:platform/:projectId/rules`         | Create integration rule | Yes (JWT)     |
| PATCH  | `/integrations/:platform/:projectId/rules/:ruleId` | Update integration rule | Yes (JWT)     |
| DELETE | `/integrations/:platform/:projectId/rules/:ruleId` | Delete integration rule | Yes (JWT)     |

#### Notifications (`/api/v1/notifications`)

| Method | Endpoint                           | Description                | Auth Required |
| ------ | ---------------------------------- | -------------------------- | ------------- |
| GET    | `/notifications/channels`          | List notification channels | Yes (JWT)     |
| POST   | `/notifications/channels`          | Create channel             | Yes (JWT)     |
| PATCH  | `/notifications/channels/:id`      | Update channel             | Yes (JWT)     |
| DELETE | `/notifications/channels/:id`      | Delete channel             | Yes (JWT)     |
| POST   | `/notifications/channels/:id/test` | Test channel               | Yes (JWT)     |
| GET    | `/notifications/rules`             | List notification rules    | Yes (JWT)     |
| POST   | `/notifications/rules`             | Create rule                | Yes (JWT)     |
| PATCH  | `/notifications/rules/:id`         | Update rule                | Yes (JWT)     |
| DELETE | `/notifications/rules/:id`         | Delete rule                | Yes (JWT)     |
| GET    | `/notifications/templates`         | List templates             | Yes (JWT)     |
| POST   | `/notifications/templates`         | Create template            | Yes (JWT)     |
| PATCH  | `/notifications/templates/:id`     | Update template            | Yes (JWT)     |
| DELETE | `/notifications/templates/:id`     | Delete template            | Yes (JWT)     |
| GET    | `/notifications/history`           | List notification history  | Yes (JWT)     |

**Supported Channels:** Email (SendGrid, AWS SES, Postmark, Resend, SMTP), Slack, Discord, Webhooks

#### Audit Logs (`/api/v1/audit-logs`)

| Method | Endpoint            | Description                           | Auth Required |
| ------ | ------------------- | ------------------------------------- | ------------- |
| GET    | `/audit-logs`       | List audit logs (filters, pagination) | Yes (Admin)   |
| GET    | `/audit-logs/stats` | Get audit log statistics              | Yes (Admin)   |

**Query Parameters:**

- `action` - Filter by HTTP method (GET, POST, PATCH, DELETE)
- `resource` - Filter by resource path
- `user_id` - Filter by user
- `status_code` - Filter by HTTP status
- `start_date` - Filter by date range
- `end_date` - Filter by date range
- `page` - Page number
- `limit` - Items per page

#### Retention (`/api/v1/retention`)

| Method | Endpoint                  | Description                    | Auth Required |
| ------ | ------------------------- | ------------------------------ | ------------- |
| GET    | `/retention/policies`     | List retention policies        | Yes (Admin)   |
| POST   | `/retention/policies`     | Create retention policy        | Yes (Admin)   |
| PATCH  | `/retention/policies/:id` | Update retention policy        | Yes (Admin)   |
| DELETE | `/retention/policies/:id` | Delete retention policy        | Yes (Admin)   |
| POST   | `/retention/execute`      | Execute retention job manually | Yes (Admin)   |

#### Health & Jobs (`/api/v1`)

| Method | Endpoint    | Description                   | Auth Required |
| ------ | ----------- | ----------------------------- | ------------- |
| GET    | `/health`   | Liveness probe                | No            |
| GET    | `/ready`    | Readiness probe               | No            |
| GET    | `/jobs/:id` | Get job status (queue worker) | Yes (JWT)     |
| GET    | `/jobs`     | List jobs                     | Yes (Admin)   |

## Usage Guide

### Managing Integration Rules

Integration rules control which bug reports trigger ticket creation in third-party platforms (Jira, GitHub, Linear, etc.). Rules support filtering by multiple criteria and rate-limiting to prevent spam.

#### Accessing Integration Rules

1. Navigate to **Integrations** page
2. Find your configured integration (e.g., Jira)
3. Click **"Manage Rules"** button
4. You'll see the rules management page at `/integrations/:platform/:projectId/rules`

#### Creating a Rule

**Basic Rule (No Filters)**:

1. Click **"Create Rule"** button
2. Fill in required fields:
   - **Name**: Descriptive name (e.g., "All Production Bugs")
   - **Description**: Optional details about the rule
   - **Priority**: Execution order (higher priority runs first, e.g., 100)
   - **Enabled**: Toggle to activate/deactivate rule
3. Click **"Save Rule"**

**Rule with Filters**:

1. Click **"Create Rule"**
2. Fill basic details (name, priority, enabled)
3. Click **"Add Filter"** to add conditions:
   - **Field**: Select field to match (priority, status, browser, OS, URL, error message, user email)
   - **Operator**: Select comparison method:
     - `equals` - Exact match (case-insensitive)
     - `contains` - Substring match
     - `regex` - Regular expression match
     - `in` - Matches any value in comma-separated list
     - `not_in` - Does not match any value in list
     - `starts_with` - String starts with value
     - `ends_with` - String ends with value
   - **Value**: Enter value to match
   - **Case Sensitive**: Toggle for case-sensitive matching (optional)
4. Add multiple filters by clicking **"Add Filter"** again (all filters must match - AND logic)
5. Click **"Save Rule"**

**Example: High Priority Chrome Errors**

```
Name: High Priority Chrome Errors
Priority: 200
Enabled: ✓
Filters:
  - Field: priority, Operator: equals, Value: high
  - Field: browser, Operator: contains, Value: Chrome
```

**Rule with Throttling**:

1. Create rule as above
2. Enable **"Enable Throttling"** checkbox
3. Configure throttle settings:
   - **Max Per Hour**: Maximum tickets per hour (e.g., 5)
   - **Max Per Day**: Maximum tickets per day (e.g., 20)
   - **Group By**: How to group throttle counts:
     - `user` - Per user (prevents single user spam)
     - `url` - Per URL (prevents page-specific spam)
     - `error_type` - Per error signature (prevents repeated error spam)
   - **Digest Mode** (optional): Batch tickets into digest
   - **Digest Interval** (minutes): Batch interval if digest enabled
4. Click **"Save Rule"**

**Example: Throttled Production Errors**

```
Name: Production Critical Errors
Priority: 150
Enabled: ✓
Filters:
  - Field: url_pattern, Operator: contains, Value: production.example.com
  - Field: priority, Operator: in, Value: high,critical
Throttling:
  - Max Per Hour: 5
  - Max Per Day: 20
  - Group By: error_type
```

#### Editing a Rule

1. Find the rule in the list
2. Click **"Edit"** button (pencil icon)
3. Modify any fields (name, filters, throttling, etc.)
4. Click **"Save Rule"**

#### Toggling Rule Status

1. Find the rule in the list
2. Click **"Enable"** or **"Disable"** button
3. Rule status updates immediately (badge changes: Active/Inactive)

#### Deleting a Rule

1. Find the rule in the list
2. Click **"Delete"** button (trash icon)
3. Confirm deletion in dialog
4. Rule is permanently removed

#### Understanding Rule Priority

Rules are evaluated in **priority order (highest first)**:

- Priority 200 executes before Priority 100
- **All matching rules execute** (not just first match)
- Each matching rule can create a ticket (unless throttled)

**Best Practices**:

- Use high priorities (200+) for critical bugs
- Use medium priorities (100-199) for standard bugs
- Use low priorities (1-99) for informational bugs
- **Avoid overlapping filters** unless you want multiple tickets
- Disable lower-priority rules if they overlap with higher-priority ones

**Example Priority Strategy**:

```
Priority 300: Critical Production Errors → Immediate Jira ticket
Priority 200: High Priority Bugs → Standard Jira ticket
Priority 100: All Bugs → Log only, no ticket (disabled by default)
```

#### Filter Field Reference

| Field           | Description                    | Example Values                          |
| --------------- | ------------------------------ | --------------------------------------- |
| `priority`      | Bug report priority            | `critical`, `high`, `medium`, `low`     |
| `status`        | Bug report status              | `open`, `in_progress`, `resolved`       |
| `browser`       | User's browser                 | `Chrome`, `Firefox`, `Safari`, `Edge`   |
| `os`            | User's operating system        | `Windows`, `macOS`, `Linux`, `iOS`      |
| `url_pattern`   | Page URL where bug occurred    | `https://example.com/checkout`          |
| `user_email`    | Email of user who reported bug | `user@example.com`                      |
| `error_message` | Error message text             | `Cannot read property 'x' of undefined` |
| `project`       | Project identifier (internal)  | `project-uuid`                          |

#### Troubleshooting

**Rule not creating tickets:**

1. Check rule is **enabled** (Active badge)
2. Verify filters match bug report fields (check bug report details)
3. Check throttle limits haven't been reached
4. Verify integration is configured and enabled
5. Check backend logs for integration worker errors

**Too many tickets created:**

1. Add throttling configuration (max_per_hour, max_per_day)
2. Make filters more specific (add more conditions)
3. Disable lower-priority overlapping rules
4. Use `group_by` to prevent single-source spam

**Filters not working as expected:**

1. Check operator - `equals` is case-insensitive by default
2. For exact matching, use `equals` instead of `contains`
3. For multiple values, use `in` operator with comma-separated list (e.g., `high,critical`)
4. Test regex patterns in regex tester before using
5. Check `case_sensitive` checkbox for case-sensitive matching

## Project Structure

```
apps/admin/
├── src/
│   ├── components/
│   │   ├── ui/                           # Reusable UI components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── badge.tsx
│   │   │   └── spinner.tsx
│   │   ├── settings/                     # Settings feature components
│   │   │   ├── settings-section.tsx      # Reusable settings wrapper
│   │   │   ├── instance-settings.tsx     # Instance config section
│   │   │   ├── storage-settings.tsx      # Storage config section
│   │   │   ├── security-settings.tsx     # Security settings section
│   │   │   ├── retention-settings.tsx    # Retention policy section
│   │   │   └── feature-settings.tsx      # Feature flags section
│   │   ├── bug-reports/                  # Bug reports feature components
│   │   │   ├── bug-report-list.tsx             # Bug report table
│   │   │   ├── bug-report-detail.tsx           # Full bug report view
│   │   │   ├── bug-report-filters.tsx          # Filter controls
│   │   │   ├── bug-report-status-controls.tsx  # Status/priority UI
│   │   │   ├── bug-report-browser-metadata.tsx # Browser info display
│   │   │   ├── bug-report-console-logs.tsx     # Console logs viewer
│   │   │   ├── bug-report-network-table.tsx    # Network requests table
│   │   │   ├── session-replay-player.tsx       # rrweb player wrapper
│   │   │   └── share-token-manager.tsx         # Public replay sharing UI
│   │   ├── dashboard-layout.tsx
│   │   └── protected-route.tsx
│   ├── contexts/
│   │   └── auth-context.tsx              # Auth state (memory-only tokens)
│   ├── lib/
│   │   └── api-client.ts                 # Axios with token accessors
│   ├── pages/
│   │   ├── bug-reports.tsx               # Bug reports management (NEW)
│   │   ├── health.tsx                    # System health dashboard
│   │   ├── login.tsx                     # Login page
│   │   ├── projects.tsx                  # Project management
│   │   ├── settings.tsx                  # Settings page (refactored)
│   │   ├── setup.tsx                     # Setup wizard
│   │   └── shared-replay-viewer.tsx      # Public replay viewer (no auth)
│   ├── services/
│   │   └── api.ts                        # API service functions
│   ├── types/
│   │   └── index.ts                      # TypeScript interfaces
│   ├── tests/
│   │   ├── lib/
│   │   │   └── api-client.test.ts
│   │   └── pages/
│   │       ├── login.test.tsx
│   │       ├── setup.test.tsx
│   │       └── health.test.tsx
│   ├── App.tsx                           # Root component with routing
│   ├── index.css                         # Tailwind styles
│   └── main.tsx                          # React entry point
├── Dockerfile                            # Multi-stage build
├── nginx.conf                            # Production nginx with strict CSP
├── nginx.dev.conf                        # Development nginx with relaxed CSP
├── SECURITY.md                           # Security documentation
├── REACT_PATTERNS.md                     # React best practices
├── package.json
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── playwright.config.ts
```

## Security

### Authentication & Token Storage

**⚠️ IMPORTANT**: Tokens are stored securely to prevent XSS attacks:

- **Access Tokens**: Stored in **memory only** (React state) - NOT in localStorage
- **Refresh Tokens**: Stored in **httpOnly cookies** (backend-managed) - NOT accessible to JavaScript
- **User Data**: Stored in sessionStorage (non-sensitive profile data only)

**Why this matters**: `localStorage` is vulnerable to XSS attacks. Any malicious script can steal tokens. Memory-only storage provides strong XSS protection.

**Token Accessor Pattern**: The API client uses accessor functions to get tokens from auth context, keeping auth logic decoupled from HTTP client.

### Security Headers

- **Content Security Policy (CSP)**: Modern XSS protection (replaces deprecated X-XSS-Protection)
- **X-Frame-Options**: Prevents clickjacking
- **X-Content-Type-Options**: Prevents MIME sniffing
- **Referrer-Policy**: Controls referrer information
- **HTTPS Ready**: Nginx configured for TLS termination

### Other Security Measures

- **JWT Authentication**: All admin routes require valid JWT token
- **Token Refresh**: Automatic token refresh on expiry
- **Input Validation**: Client-side form validation with min/max constraints
- **API Key Masking**: Sensitive data handled securely
- **Error Handling**: Distinguishes expected vs unexpected errors, logs appropriately

## Testing

### Unit Tests (Vitest)

```bash
pnpm test              # Run all unit tests
pnpm test:ui           # Run tests with Vitest UI
pnpm test:coverage     # Generate coverage report
```

### E2E Tests (Playwright)

**✅ All 232 tests passing (100%)** - December 2025

```bash
# One command - that's it!
pnpm test:e2e                        # Run all E2E tests (headless)
pnpm test:e2e:ui                     # Run with Playwright UI (interactive)
pnpm test:e2e:notifications          # Run notification delivery tests
pnpm test:e2e:notifications:headed   # Watch notification tests in browser
```

**Prerequisites**:

- Docker must be running (tests use Testcontainers for isolated PostgreSQL databases)
- No port conflicts (port 4000 for E2E backend)
- Your development backend on port 3000 can remain running (no conflicts)

**Automatic Setup**: Tests automatically start a PostgreSQL testcontainer, run migrations, and spawn a backend server on port 4000. No manual backend setup required!

**See [E2E_TESTING.md](./E2E_TESTING.md) for detailed setup and troubleshooting.**

**Notification E2E Tests**: Comprehensive tests for Email, Slack, and Discord delivery. See [NOTIFICATION_E2E_TESTS.md](./NOTIFICATION_E2E_TESTS.md) for setup and configuration.

### Test Structure

```
tests/
├── e2e/                                    # Playwright E2E tests (232 total)
│   ├── audit-logs.spec.ts                  # Audit log page tests
│   ├── bug-reports.spec.ts                 # Bug report page tests
│   ├── integrations.spec.ts                # Integration management tests (17 tests)
│   ├── jira-integration.spec.ts            # Jira-specific integration tests
│   ├── notification-delivery.spec.ts       # Full notification flow tests (NEW)
│   ├── notifications.spec.ts               # Notification UI tests
│   ├── public-replay-sharing.spec.ts       # Share token manager tests (18 tests)
│   ├── shared-replay-viewer.spec.ts        # Public viewer tests (19 tests)
│   └── global-setup.ts                     # E2E test setup
├── lib/
│   └── api-client.test.ts                  # API client unit tests
└── pages/
    ├── login.test.tsx                      # Login page unit tests
    ├── setup.test.tsx                      # Setup wizard unit tests
    └── health.test.tsx                     # Health dashboard unit tests
```

## Browser Support

- Chrome 60+ (ES2017)
- Firefox 55+ (ES2017)
- Safari 11+ (ES2017)
- Edge 79+ (Chromium-based)

**Note**: Modern JavaScript features (async/await, Object.entries, etc.) are used without transpilation.

## Code Quality & Best Practices

### React Patterns (See REACT_PATTERNS.md for details)

**Critical Anti-Patterns to Avoid:**

1. ❌ **Never setState during render** - Use `useEffect` for side effects
2. ❌ **Don't create functions in JSX** - Use `useCallback` to memoize
3. ❌ **Don't silently ignore errors** - Always log and handle appropriately
4. ❌ **Don't forget form reset after mutations** - Sync with server values

**Best Practices:**

- ✅ Memoize callbacks with `useCallback`
- ✅ Use `useEffect` for side effects
- ✅ Extract large components into smaller, focused ones
- ✅ Validate number inputs with min/max constraints
- ✅ Reset forms to server values after successful updates

### Component Architecture

**Settings Page Refactoring** (250+ lines → 115 lines + 6 focused components):

- Components extracted into `components/settings/` directory
- Each section is self-contained and testable
- Eliminated ~200 lines of duplicated Card/CardContent boilerplate
- Improved maintainability through Single Responsibility Principle

**Bug Reports Feature** (New in 2025):

- 8 specialized components in `components/bug-reports/`
- Full CRUD operations with filtering, sorting, pagination
- Session replay integration with rrweb-player
- Network analysis and console log viewers
- Responsive design with mobile support

### Security Checklist

Before deploying admin panel changes:

- [ ] No tokens in `localStorage` (use memory or `sessionStorage`)
- [ ] Errors logged appropriately (not silently ignored)
- [ ] Network errors show user feedback
- [ ] No setState during render
- [ ] Callbacks memoized where appropriate
- [ ] Forms reset after successful mutations
- [ ] Input validation in place (min/max, type checking)
- [ ] TypeScript compiles without errors (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] CSP headers don't block functionality
- [ ] Vite production build succeeds without warnings

## Troubleshooting

### Admin panel shows blank page

Check browser console for errors. Common issues:

- API URL not configured correctly
- CORS issues (ensure admin domain in `CORS_ORIGINS`)
- CSP headers blocking resources (check nginx.conf)

### Cannot login

- Verify backend is running and accessible
- Check admin user exists in database
- Verify JWT_SECRET is set correctly
- Check browser console for authentication errors

### Setup wizard redirects to login

System already initialized. Admin user already exists.

### "Unable to connect to server" error

Network connectivity issue. Check:

1. Backend is running at correct URL
2. Admin panel can reach backend (test with `curl`)
3. CORS origins include admin panel URL
4. Firewall/network policies allow connection

### Tokens not persisting across page refresh

**This is expected behavior** - Access tokens are stored in memory for security. On page reload:

- Access token is cleared (requires automatic token refresh)
- Refresh token in httpOnly cookie is automatically sent to backend
- Backend validates cookie and issues new access token
- User data restored from sessionStorage

If automatic refresh fails (invalid/expired cookie), user is redirected to login (expected).

### Settings changes not saving

Check:

1. Form validation passes (check console for errors)
2. API returns 200 OK (check Network tab)
3. Form resets to server values after success
4. No React errors in console (setState during render, etc.)

### Bug reports not loading or filtering not working

Check:

1. Backend API is running and accessible
2. Projects exist in the database
3. Bug reports exist for selected filters
4. Network tab shows successful API responses
5. Console shows no CORS or authentication errors

### Session replay player not working

Check:

1. Session replay is enabled in settings (feature flags)
2. Bug report has associated session data
3. rrweb-player CSS is loaded correctly
4. Browser console shows no errors from player
5. Storage service is accessible and serving replay files

## Common Development Tasks

### Adding a New Page

1. Create page component in `src/pages/new-page.tsx`
2. Add route in `src/App.tsx`
3. Add navigation link in `src/components/dashboard-layout.tsx`
4. Create API service functions in `src/services/api.ts`
5. Add TypeScript types in `src/types/index.ts`
6. Write tests in `src/tests/pages/new-page.test.tsx`

### Adding a New API Endpoint

1. Add service function in `src/services/api.ts`
2. Add TypeScript types in `src/types/index.ts`
3. Use TanStack Query hooks in components:
   - `useQuery` for GET requests
   - `useMutation` for POST/PATCH/DELETE
4. Handle loading/error states
5. Add toast notifications for success/error feedback

## License

MIT
