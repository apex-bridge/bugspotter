# BugSpotter API Documentation

**Version**: 1.0.0  
**Base URL**: `http://localhost:3000`  
**Protocol**: HTTP/1.1  
**Content Type**: `application/json`

## Table of Contents

1. [Authentication](#authentication)
2. [Error Handling](#error-handling)
3. [Core Endpoints](#core-endpoints)
   - [Health & System](#health--system)
   - [Authentication & User Management](#authentication--user-management)
   - [Projects](#projects)
   - [Bug Reports](#bug-reports)
   - [File Uploads](#file-uploads)
   - [Share Tokens](#share-tokens)
4. [Admin Endpoints](#admin-endpoints)
   - [System Administration](#system-administration)
   - [Analytics](#analytics)
   - [User Management](#user-management)
   - [API Key Management](#api-key-management)
   - [Audit Logs](#audit-logs)
   - [Data Retention](#data-retention)
   - [Notifications](#notifications)
   - [Organization Management](#organization-management)
   - [Invitations](#invitations)
5. [Integration Endpoints](#integration-endpoints)
   - [User Integration Management](#user-integration-management)
   - [Admin Integration Management](#admin-integration-management)
   - [Automatic Ticket Creation](#automatic-ticket-creation)
6. [Intelligence Endpoints](#intelligence-endpoints)
   - [Intelligence Proxy](#intelligence-proxy)
   - [Intelligence Settings](#intelligence-settings)
   - [Enrichment](#enrichment)
   - [Feedback](#feedback)
   - [Self-Service Resolution](#self-service-resolution)
7. [Queue & Job Management](#queue--job-management)
8. [Setup & Configuration](#setup--configuration)
9. [Response Formats](#response-formats)
10. [Rate Limiting](#rate-limiting)
11. [Security Features](#security-features)

---

## Authentication

BugSpotter uses a dual authentication system:

### 1. JWT Bearer Tokens (User Authentication)

```http
Authorization: Bearer <access_token>
```

### 2. API Keys (SDK Authentication)

```http
X-API-Key: bgs_<key>
```

### Token Management

- **Access Token**: 1 hour expiry (configurable)
- **Refresh Token**: 7 days expiry (httpOnly cookie)
- **API Keys**: No expiration (can be set with custom expiry)

---

## Error Handling

All API errors follow a consistent format:

```json
{
  "success": false,
  "error": "ErrorType",
  "message": "Human-readable error description",
  "statusCode": 400,
  "timestamp": "2025-10-31T12:00:00.000Z"
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request / Validation Error
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `429` - Rate Limit Exceeded
- `500` - Internal Server Error
- `503` - Service Unavailable

---

## Core Endpoints

### Health & System

#### Get Server Info

```http
GET /
```

**Public**: Yes  
**Description**: Basic server information and API status.

**Response**:

```json
{
  "name": "BugSpotter API",
  "version": "1.0.0",
  "status": "running",
  "documentation": "/api/v1/docs",
  "timestamp": "2025-10-31T12:00:00.000Z"
}
```

#### Health Check

```http
GET /health
```

**Public**: Yes  
**Description**: Simple liveness check for load balancers.

**Response**:

```json
{
  "status": "ok",
  "timestamp": "2025-10-31T12:00:00.000Z",
  "build": {
    "version": "1.0.0",
    "buildTime": "2025-10-31T10:00:00.000Z"
  }
}
```

#### Readiness Check

```http
GET /ready
```

**Public**: Yes  
**Description**: Readiness check including database connectivity.

**Response**:

```json
{
  "status": "ready",
  "timestamp": "2025-10-31T12:00:00.000Z",
  "checks": {
    "database": "healthy"
  }
}
```

---

### Authentication & User Management

#### Register User

```http
POST /api/v1/auth/register
```

**Public**: Yes

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "Jane Doe",
  "invite_token": "a1b2c3...64-char-hex"
}
```

| Field          | Required | Notes                                                                                 |
| -------------- | -------- | ------------------------------------------------------------------------------------- |
| `email`        | Yes      | Valid email (RFC 5322)                                                                |
| `password`     | Yes      | 8-128 characters                                                                      |
| `name`         | No       | Display name                                                                          |
| `invite_token` | No       | 64-char hex invitation token. **Required** when `REQUIRE_INVITATION_TO_REGISTER=true` |

**Errors**:

| Code | Error Code           | Condition                                           |
| ---- | -------------------- | --------------------------------------------------- |
| 403  | `Forbidden`          | Registration disabled (`ALLOW_REGISTRATION=false`)  |
| 403  | `InvitationRequired` | Invitation-only mode and no `invite_token` provided |
| 403  | `EmailMismatch`      | Email doesn't match the invitation                  |
| 404  | `NotFound`           | Invalid or unknown invitation token                 |
| 400  | `BadRequest`         | Invitation already accepted/canceled                |
| 409  | `Conflict`           | User with this email already exists                 |
| 410  | `Gone`               | Invitation has expired                              |

**Response** (201 Created):

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "name": "Jane Doe",
      "role": "user",
      "created_at": "2025-10-31T12:00:00.000Z"
    },
    "access_token": "jwt_token",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
}
```

#### Login

```http
POST /api/v1/auth/login
```

**Public**: Yes

**Request Body**:

```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response**: Same as register

#### Refresh Token

```http
POST /api/v1/auth/refresh
```

**Public**: Yes  
**Description**: Refresh access token using httpOnly cookie or request body.

**Request Body** (optional):

```json
{
  "refresh_token": "jwt_refresh_token"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "access_token": "new_jwt_token",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
}
```

#### Logout

```http
POST /api/v1/auth/logout
```

**Public**: Yes  
**Description**: Clear refresh token cookie.

**Response**:

```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

#### Magic Login

```http
POST /api/v1/auth/magic-login
```

**Public**: Yes  
**Description**: Passwordless authentication using JWT magic tokens. Requires magic login to be enabled in the target organization's settings (`settings.magic_login_enabled = true` in the organizations table).

**Request Body**:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "demo@example.com",
      "role": "admin",
      "created_at": "2025-11-17T12:00:00.000Z"
    },
    "access_token": "jwt_token",
    "expires_in": 3600,
    "token_type": "Bearer"
  }
}
```

**Error Responses**:

- `403 Forbidden` - Magic login is not enabled for this organization
- `404 Not Found` - Organization not found
- `403 Forbidden` - User is not a member of this organization
- `401 Unauthorized` - Invalid token type (missing `type: 'magic'`)
- `401 Unauthorized` - Missing organization scope in token
- `401 Unauthorized` - Token expired or malformed
- `404 Not Found` - User not found
- `400 Bad Request` - Token is required

**Usage Example**:

```bash
# Generate a magic token (backend)
const magicToken = generateMagicToken(fastify, userId, 'viewer', orgId, '24h');

# Frontend login URL format
https://demo.bugspotter.io/login?token=YOUR_MAGIC_TOKEN

# The frontend will automatically detect the token parameter and call the API
```

**Notes**:

- Tokens must include `type: 'magic'` in JWT payload
- Tokens must include `organizationId` — the organization the token is scoped to
- The organization must have `settings.magic_login_enabled = true` (toggled via admin API)
- The user must be a member of the specified organization
- Tokens must include either `userId` (custom claim) or `sub` (standard JWT Subject claim) - both are accepted
- If both `userId` and `sub` are present, `userId` takes precedence
- Tokens are reusable until expiration (no single-use restriction)
- Used for demo environments and temporary user access
- Frontend URL format: `/login?token=YOUR_TOKEN` (NOT `/auth/magic-login?token=...`)
- The login page automatically detects and processes the token parameter
- Generate tokens using the exported `generateMagicToken(fastify, userId, role, organizationId, expiresIn)` helper function from `packages/backend/src/api/routes/auth.ts`

#### Registration Status

```http
GET /api/v1/auth/registration-status
```

**Public**: Yes
**Description**: Check whether self-registration is enabled and whether an invitation is required.

**Response**:

```json
{
  "success": true,
  "data": {
    "allowed": true,
    "requireInvitation": true
  }
}
```

| Field               | Type    | Description                                             |
| ------------------- | ------- | ------------------------------------------------------- |
| `allowed`           | boolean | `true` when `ALLOW_REGISTRATION` is enabled             |
| `requireInvitation` | boolean | `true` when `REQUIRE_INVITATION_TO_REGISTER` is enabled |

The frontend uses this to decide whether to show the "Sign up" link on the login page. When `requireInvitation` is `true`, the sign-up link is only shown if an `invite_token` query parameter is present.

---

### Projects

#### List Projects

```http
GET /api/v1/projects
```

**Auth**: User required  
**Description**: Get all projects accessible to the authenticated user.

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "My App",
      "settings": {},
      "created_at": "2025-10-31T12:00:00.000Z",
      "created_by": "user_uuid"
    }
  ]
}
```

#### Create Project

```http
POST /api/v1/projects
```

**Auth**: User required

**Request Body**:

```json
{
  "name": "New Project",
  "organization_id": "uuid-of-target-organization",
  "settings": {
    "tier": "free",
    "retention": {
      "bugReportRetentionDays": 90
    }
  }
}
```

**Organization scoping (SaaS mode)**:

- **Org subdomain** (e.g. `acme.bugspotter.io`): `organization_id` is resolved automatically from the subdomain by the tenant middleware. Any `organization_id` in the request body is ignored.
- **Hub domain** (e.g. `app.bugspotter.io`): `organization_id` is **required** in the request body. Returns `400 ValidationError` if missing.
- **Self-hosted**: `organization_id` is not used. Projects are created without org association.

#### Get Project

```http
GET /api/v1/projects/{id}
```

**Auth**: User required (with project access)

#### Update Project

```http
PATCH /api/v1/projects/{id}
```

**Auth**: User required (with project access)

**Request Body**:

```json
{
  "name": "Updated Project Name",
  "settings": {
    "tier": "pro"
  }
}
```

#### Delete Project

```http
DELETE /api/v1/projects/{id}
```

**Auth**: Admin required

---

### Project Members

#### List Project Members

```http
GET /api/v1/projects/{id}/members
```

**Auth**: User required (with project access)  
**Description**: Get all members of a project with their roles and user details.

**Response** (200 OK):

```json
{
  "success": true,
  "data": [
    {
      "id": "member-uuid",
      "project_id": "project-uuid",
      "user_id": "user-uuid",
      "role": "admin",
      "created_at": "2025-11-06T12:00:00.000Z",
      "user_email": "user@example.com",
      "user_name": "John Doe"
    }
  ]
}
```

**Role Types**:

- `owner` - Project creator, full control (cannot be changed/removed)
- `admin` - Can manage members and project settings
- `member` - Can create and manage bug reports
- `viewer` - Read-only access

#### Add Project Member

```http
POST /api/v1/projects/{id}/members
```

**Auth**: User required (project owner or admin)  
**Description**: Add a new member to a project.

**Request Body**:

```json
{
  "user_id": "user-uuid",
  "role": "member"
}
```

**Response** (201 Created):

```json
{
  "success": true,
  "data": {
    "id": "member-uuid",
    "project_id": "project-uuid",
    "user_id": "user-uuid",
    "role": "member",
    "created_at": "2025-11-06T12:00:00.000Z"
  }
}
```

**Error Responses**:

- `400 Bad Request`: Invalid role value
- `403 Forbidden`: Only project owners and admins can add members
- `404 Not Found`: Project or user not found
- `409 Conflict`: User is already a member of this project

**Restrictions**:

- Cannot assign `owner` role (only one owner per project)
- Must be project owner or admin to add members

#### Update Project Member Role

```http
PATCH /api/v1/projects/{id}/members/{userId}
```

**Auth**: User required (project owner or admin)  
**Description**: Change a project member's role.

**Request Body**:

```json
{
  "role": "admin"
}
```

**Response** (200 OK):

```json
{
  "success": true,
  "data": {
    "id": "member-uuid",
    "project_id": "project-uuid",
    "user_id": "user-uuid",
    "role": "admin",
    "created_at": "2025-11-06T12:00:00.000Z"
  }
}
```

**Error Responses**:

- `400 Bad Request`: Invalid role value
- `403 Forbidden`: Only owners can change admin roles, only owners can promote to admin, cannot change your own role, cannot change owner role
- `404 Not Found`: User is not a member of this project

**Restrictions**:

- Cannot change to/from `owner` role
- Only owners can modify admin roles (both FROM admin and TO admin)
- Cannot change your own role

#### Remove Project Member

```http
DELETE /api/v1/projects/{id}/members/{userId}
```

**Auth**: User required (project owner or admin)  
**Description**: Remove a member from a project.

**Response** (200 OK):

```json
{
  "success": true,
  "message": "Member removed successfully"
}
```

**Error Responses**:

- `403 Forbidden`: Only owners can remove admins, only admins/owners can remove members, cannot remove project owner, cannot remove yourself from the project
- `404 Not Found`: User is not a member of this project

**Restrictions**:

- Cannot remove project owner
- Only owners can remove admins
- Cannot remove yourself from the project

---

### Bug Reports

#### Create Bug Report

```http
POST /api/v1/reports
```

**Auth**: API Key or User required

**Request Body**:

```json
{
  "title": "Button not working",
  "description": "The submit button doesn't respond to clicks",
  "priority": "medium",
  "report": {
    "console": ["Error: Cannot read property..."],
    "network": [
      {
        "url": "https://api.example.com/submit",
        "method": "POST",
        "status": 500
      }
    ],
    "metadata": {
      "userAgent": "Mozilla/5.0...",
      "url": "https://example.com/form",
      "viewport": { "width": 1920, "height": 1080 }
    }
  },
  "hasScreenshot": true,
  "hasReplay": true
}
```

**Response** (with presigned URLs for optimized upload flow):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "project_id": "uuid",
    "title": "Button not working",
    "description": "The submit button doesn't respond to clicks",
    "priority": "medium",
    "status": "open",
    "metadata": {
      "console": ["Error: Cannot read property..."],
      "network": [...],
      "metadata": {...}
    },
    "screenshot_url": null,
    "replay_url": null,
    "upload_status": "pending",
    "replay_upload_status": "pending",
    "created_at": "2025-10-31T12:00:00.000Z",
    "presignedUrls": {
      "screenshot": {
        "uploadUrl": "https://s3.amazonaws.com/bucket/screenshots/...",
        "storageKey": "screenshots/project/bug/screenshot.png"
      },
      "replay": {
        "uploadUrl": "https://s3.amazonaws.com/bucket/replays/...",
        "storageKey": "replays/project/bug/replay.gz"
      }
    }
  }
}
```

**Note**:

- `presignedUrls` are **only included** when `hasScreenshot` or `hasReplay` flags are set to `true`
- The SDK automatically detects screenshot/replay data and sets these flags
- Clients upload files directly to S3 using these URLs (bypassing the API server)
- After uploading, clients **must** call `/api/v1/reports/{id}/confirm-upload` for each file
- `upload_status` is `"pending"` until confirmed, then updates to `"completed"`

**Optimized Upload Flow (SDK v0.1.0+)**:

1. SDK calls `POST /api/v1/reports` with `hasScreenshot: true, hasReplay: true`
2. Backend returns bug report + presigned URLs for both files
3. SDK uploads screenshot.png and replay.gz to S3 in parallel
4. SDK calls `/api/v1/reports/{id}/confirm-upload` for each file
5. Backend worker processes uploads and generates **signed URLs with 6-day expiration**
6. Worker updates `screenshot_url`, `replay_url`, and sets `upload_status: "completed"`

**Benefits**: 40% fewer HTTP requests (3 vs 5), direct S3 uploads, concurrent file uploads

**Important**: `screenshot_url` and `replay_url` are **signed URLs** that expire after 6 days (S3 Signature v4 maximum is 7 days). This is required for private S3 buckets (R2, B2, private AWS S3). If URLs expire, use the replay/screenshot endpoints to regenerate fresh signed URLs.

#### List Bug Reports

```http
GET /api/v1/reports?page=1&limit=20&status=open&priority=high&project_id=uuid&created_after=2025-10-01&created_before=2025-10-31&sort_by=created_at&order=desc
```

**Auth**: API Key or User required

**Query Parameters**:

- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20, max: 100)
- `status` (string): Filter by status (`open`, `in_progress`, `resolved`, `closed`)
- `priority` (string): Filter by priority (`low`, `medium`, `high`, `critical`)
- `project_id` (string): Filter by project UUID
- `created_after` (string): ISO date string
- `created_before` (string): ISO date string
- `sort_by` (string): Sort field (`created_at`, `updated_at`, `priority`, `status`)
- `order` (string): Sort order (`asc`, `desc`)

**Response**:

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### Get Bug Report

```http
GET /api/v1/reports/{id}
```

**Auth**: API Key or User required (with project access)

#### Update Bug Report

```http
PATCH /api/v1/reports/{id}
```

**Auth**: User required (with project access)

**Request Body**:

```json
{
  "status": "resolved",
  "priority": "low",
  "description": "Updated description"
}
```

---

### File Uploads

#### Generate Presigned Upload URL

```http
POST /api/v1/uploads/presigned-url
```

**Auth**: API Key or User required

**Request Body**:

```json
{
  "projectId": "uuid",
  "bugId": "uuid",
  "fileType": "screenshot",
  "filename": "error-screenshot.png",
  "contentType": "image/png"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://s3.amazonaws.com/bucket/path?signature=...",
    "storageKey": "screenshots/project/bug/error-screenshot.png",
    "expiresIn": 3600,
    "contentType": "image/png"
  }
}
```

#### Confirm Upload

```http
POST /api/v1/reports/{id}/confirm-upload
```

**Auth**: API Key or User required

**Request Body**:

```json
{
  "fileType": "screenshot"
}
```

#### Get Screenshot URL

```http
GET /api/v1/reports/{id}/screenshot-url
```

**Auth**: User required (with project access)

**Response**:

```json
{
  "success": true,
  "data": {
    "url": "https://signed-url-to-screenshot",
    "expiresIn": 900
  }
}
```

#### Get Session Replay URL

```http
GET /api/v1/reports/{id}/replay-url
```

**Auth**: User required (with project access)

---

### Share Tokens

Public replay sharing allows admins to create shareable links for session replays. These links can be password-protected and have configurable expiration times.

#### Create Share Token

```http
POST /api/v1/replays/{id}/share
```

**Auth**: User required (with project access)  
**Description**: Generate a public share token for a bug report's session replay.

**Request Body**:

```json
{
  "expires_in_hours": 24,
  "password": "SecurePass123"
}
```

**Parameters**:

- `expires_in_hours` (optional): Token expiration in hours (1-720, default: 24)
- `password` (optional): Password protection (min 8 characters, bcrypt hashed)

**Response** (201):

```json
{
  "success": true,
  "data": {
    "token": "a7f3c9e2d1b8f4a6...",
    "expires_at": "2025-11-28T14:30:00.000Z",
    "share_url": "https://app.bugspotter.com/shared/a7f3c9e2d1b8f4a6...",
    "password_protected": true
  },
  "timestamp": "2025-11-27T14:30:00.000Z"
}
```

**Errors**:

- `400` - Invalid expiration range or password length
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (no project access)
- `404` - Bug report not found or no replay available

**Notes**:

- Creating a new token automatically revokes any existing active token for the same bug report
- Tokens are 43-character URL-safe base64-encoded strings
- Share URLs expire automatically after the configured duration

#### Get Active Share Token

```http
GET /api/v1/replays/{id}/share
```

**Auth**: User required (with project access)  
**Description**: Retrieve the currently active share token for a bug report.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "token": "a7f3c9e2d1b8f4a6...",
    "expires_at": "2025-11-28T14:30:00.000Z",
    "share_url": "https://app.bugspotter.com/shared/a7f3c9e2d1b8f4a6...",
    "password_protected": true,
    "view_count": 5,
    "created_by": "550e8400-e29b-41d4-a716-446655440001",
    "created_at": "2025-11-27T14:30:00.000Z"
  },
  "timestamp": "2025-11-27T15:00:00.000Z"
}
```

**Errors**:

- `404` - No active share token exists (returns 404, not an error)
- `401` - Unauthorized
- `403` - Forbidden (no project access)

#### Access Shared Replay (Public)

```http
GET /api/v1/replays/shared/{token}
```

**Auth**: None (public endpoint)  
**Description**: Access a shared session replay using a public token.

**Query Parameters**:

- `password` (optional): Password if token is password-protected

**Example**:

```http
GET /api/v1/replays/shared/a7f3c9e2d1b8f4a6?password=SecurePass123
```

**Response** (200):

```json
{
  "success": true,
  "data": {
    "bug_report": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Login button unresponsive on mobile",
      "description": "User unable to submit login form",
      "created_at": "2025-11-27T10:00:00.000Z"
    },
    "replay_url": "https://s3.presigned-url.amazonaws.com/...",
    "view_count": 6,
    "expires_at": "2025-11-28T14:30:00.000Z"
  },
  "timestamp": "2025-11-27T15:00:00.000Z"
}
```

**Errors**:

- `401` - Invalid or missing password
- `404` - Token not found, expired, or revoked
- `500` - Failed to generate presigned URL

**Notes**:

- Each access increments the view count atomically
- Presigned URLs for replay files expire after 1 hour (configurable)
- Tokens are checked for expiration on every access
- No authentication required (public access)

#### Revoke Share Token

```http
DELETE /api/v1/replays/share/{token}
```

**Auth**: User required (must be token creator or project owner)  
**Description**: Revoke (soft delete) a share token, making it inaccessible.

**Response** (200):

```json
{
  "success": true,
  "data": {
    "message": "Share token revoked successfully"
  },
  "timestamp": "2025-11-27T15:30:00.000Z"
}
```

**Errors**:

- `401` - Unauthorized
- `403` - Forbidden (not token creator or project owner)
- `404` - Token not found or already revoked

**Notes**:

- Soft delete preserves audit trail (sets `deleted_at` timestamp)
- Revoked tokens return 404 when accessed
- Share URLs immediately stop working after revocation

---

## Admin Endpoints

### System Administration

#### Get System Health

```http
GET /api/v1/admin/health
```

**Auth**: Admin required

**Response**:

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "services": {
      "database": {
        "status": "up",
        "response_time": 25,
        "last_check": "2025-10-31T12:00:00.000Z"
      },
      "redis": {
        "status": "up",
        "response_time": 10,
        "last_check": "2025-10-31T12:00:00.000Z"
      },
      "storage": {
        "status": "up",
        "response_time": 50,
        "last_check": "2025-10-31T12:00:00.000Z"
      }
    },
    "system": {
      "disk_space_available": 85899345920,
      "disk_space_total": 107374182400,
      "worker_queue_depth": 5,
      "uptime": 86400
    }
  }
}
```

#### Get Instance Settings

```http
GET /api/v1/admin/settings
```

**Auth**: Admin required

**Response**:

```json
{
  "success": true,
  "data": {
    "instance_name": "BugSpotter",
    "instance_url": "https://bugspotter.company.com",
    "support_email": "support@company.com",
    "storage_type": "s3",
    "storage_bucket": "bugspotter-prod",
    "storage_region": "us-east-1",
    "jwt_access_expiry": 3600,
    "jwt_refresh_expiry": 604800,
    "rate_limit_max": 1000,
    "rate_limit_window": 900,
    "cors_origins": ["https://app.company.com"],
    "retention_days": 90,
    "max_reports_per_project": 10000,
    "session_replay_enabled": true
  }
}
```

#### Update Instance Settings

```http
PATCH /api/v1/admin/settings
```

**Auth**: Admin required

**Request Body**: Any subset of the settings from GET response

#### Get Replay Quality Settings

```http
GET /api/v1/settings/replay
```

**Auth**: API Key required  
**Rate Limit**: 10 requests/minute per API key  
**Cache**: 5 minutes (public cache with per-key isolation)

**Description**: Public endpoint for SDKs to fetch replay quality configuration. Used during SDK initialization to apply backend-controlled replay settings.

**Response**:

```json
{
  "success": true,
  "data": {
    "inline_stylesheets": true,
    "inline_images": false,
    "collect_fonts": true,
    "record_canvas": false,
    "record_cross_origin_iframes": false
  }
}
```

**Response Headers**:

```http
Cache-Control: public, max-age=300
Vary: Authorization
```

**Error Responses**:

- `401 Unauthorized`: Missing or invalid API key
- `429 Too Many Requests`: Rate limit exceeded (10 requests/minute)

**Resilience Behavior**:

- **Server Errors**: On database failures or internal errors, the endpoint returns `200 OK` with safe default settings instead of failing. This ensures SDK functionality is maintained even during backend issues.
- **Default Values**: `{ inline_stylesheets: true, inline_images: false, collect_fonts: true, record_canvas: false, record_cross_origin_iframes: false }`

**Notes**:

- SDK sends API key in `x-api-key` header
- Falls back to hardcoded defaults on authentication failure (401)
- Aggressive rate limiting appropriate for once-per-session usage
- HTTP caching reduces database load by ~98.8%
- Settings configured via Admin Panel (`GET/PATCH /api/v1/admin/settings`)

**Usage Example**:

```javascript
// SDK automatically calls this during initialization
await BugSpotter.init({
  auth: { apiKey: 'bgs_your_key', projectId: 'uuid' },
  endpoint: 'https://api.bugspotter.dev',
});

// SDK fetches settings with authentication:
// GET https://api.bugspotter.dev/api/v1/settings/replay
// Headers: { x-api-key: 'bgs_your_key' }
```

---

### Analytics

#### Dashboard Metrics

```http
GET /api/v1/analytics/dashboard
```

**Auth**: Admin required

**Response**:

```json
{
  "success": true,
  "data": {
    "bug_reports": {
      "by_status": {
        "open": 150,
        "in_progress": 25,
        "resolved": 75,
        "closed": 200,
        "total": 450
      },
      "by_priority": {
        "low": 100,
        "medium": 200,
        "high": 120,
        "critical": 30
      }
    },
    "projects": {
      "total": 12,
      "total_reports": 450,
      "avg_reports_per_project": 37.5
    },
    "users": {
      "total": 25
    },
    "time_series": [
      {
        "date": "2025-10-01",
        "count": 15
      }
    ],
    "top_projects": [
      {
        "id": "uuid",
        "name": "Main App",
        "report_count": 120
      }
    ]
  }
}
```

#### Report Trends

```http
GET /api/v1/analytics/reports/trend?days=30
```

**Auth**: Admin required

**Query Parameters**:

- `days` (number): Time period (1-365, default: 30)

#### Project Statistics

```http
GET /api/v1/analytics/projects/stats
```

**Auth**: Admin required

---

### User Management

#### List Users

```http
GET /api/v1/admin/users?page=1&limit=20&role=user&email=@company.com
```

**Auth**: Admin required

**Query Parameters**:

- `page` (number): Page number
- `limit` (number): Items per page (max: 100)
- `role` (string): Filter by role (`admin`, `user`, `viewer`)
- `email` (string): Filter by email substring

#### Create User

```http
POST /api/v1/admin/users
```

**Auth**: Admin required

**Request Body**:

```json
{
  "email": "newuser@company.com",
  "name": "John Doe",
  "password": "securePassword123",
  "role": "user"
}
```

#### Update User

```http
PATCH /api/v1/admin/users/{id}
```

**Auth**: Admin required

**Request Body**:

```json
{
  "name": "Jane Doe",
  "role": "admin",
  "email": "jane@company.com"
}
```

#### Delete User

```http
DELETE /api/v1/admin/users/{id}
```

**Auth**: Admin required

**Response** (200 OK):

```json
{
  "success": true,
  "message": "User deleted successfully"
}
```

**Error Responses**:

- `404 Not Found`: User not found
- `400 Bad Request`: Cannot delete your own account
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Admin role required

#### Get User's Projects

```http
GET /api/v1/admin/users/{id}/projects
```

**Auth**: Admin required  
**Description**: Get all projects a user has access to with their role in each project.

**Response** (200 OK):

```json
{
  "success": true,
  "data": [
    {
      "id": "project-uuid",
      "name": "Main Application",
      "role": "admin",
      "created_at": "2025-11-06T12:00:00.000Z"
    },
    {
      "id": "project-uuid-2",
      "name": "Mobile App",
      "role": "member",
      "created_at": "2025-10-15T08:00:00.000Z"
    }
  ]
}
```

**Error Responses**:

- `404 Not Found`: User not found
- `401 Unauthorized`: Authentication required
- `403 Forbidden`: Admin role required

---

### API Key Management

#### Create API Key

```http
POST /api/v1/api-keys
```

**Auth**: Admin required

**Request Body**:

```json
{
  "name": "Production Frontend",
  "type": "production",
  "permission_scope": "project_specific",
  "permissions": ["create_reports", "upload_files"],
  "allowed_projects": ["uuid1", "uuid2"],
  "allowed_origins": ["https://app.company.com"],
  "rate_limit_per_minute": 100,
  "rate_limit_per_hour": 5000,
  "rate_limit_per_day": 50000,
  "expires_at": "2026-01-01T00:00:00.000Z"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "api_key": "bgs_prod_abc123def456...",
    "key_details": {
      "id": "uuid",
      "name": "Production Frontend",
      "type": "production",
      "status": "active",
      "created_at": "2025-10-31T12:00:00.000Z"
    }
  }
}
```

#### List API Keys

```http
GET /api/v1/api-keys?page=1&limit=20&type=production&status=active&sort_by=created_at&sort_order=desc
```

**Auth**: User required (Admin sees all, users see own)

#### Revoke API Key

```http
POST /api/v1/api-keys/{id}/revoke
```

**Auth**: User required (own keys) or Admin

**Request Body**:

```json
{
  "reason": "Key compromised"
}
```

#### Rotate API Key

```http
POST /api/v1/api-keys/{id}/rotate
```

**Auth**: User required (own keys) or Admin

**Response**:

```json
{
  "success": true,
  "data": {
    "new_api_key": "bgs_prod_new123...",
    "key_details": {
      "id": "uuid",
      "status": "active",
      "created_at": "2025-10-31T12:00:00.000Z"
    }
  }
}
```

#### Get API Key Usage

```http
GET /api/v1/api-keys/{id}/usage?limit=100&offset=0
```

**Auth**: User required (own keys) or Admin

#### Get Rate Limit Status

```http
GET /api/v1/api-keys/{id}/rate-limits
```

**Auth**: User required (own keys) or Admin

**Response**:

```json
{
  "success": true,
  "data": {
    "per_minute": {
      "limit": 100,
      "remaining": 85,
      "reset_time": "2025-10-31T12:01:00.000Z"
    },
    "per_hour": {
      "limit": 5000,
      "remaining": 4850,
      "reset_time": "2025-10-31T13:00:00.000Z"
    },
    "per_day": {
      "limit": 50000,
      "remaining": 48500,
      "reset_time": "2025-11-01T00:00:00.000Z"
    }
  }
}
```

---

### Audit Logs

#### List Audit Logs

```http
GET /api/v1/audit-logs?user_id=uuid&action=create&resource=bug_report&success=true&start_date=2025-10-01&end_date=2025-10-31&sort_by=timestamp&sort_order=desc&page=1&limit=50
```

**Auth**: Admin required

**Query Parameters**:

- `user_id` (string): Filter by user UUID
- `action` (string): Filter by action type
- `resource` (string): Filter by resource type
- `success` (boolean): Filter by success status
- `start_date` (string): ISO date string
- `end_date` (string): ISO date string
- `sort_by` (string): Sort field (`timestamp`, `action`, `resource`)
- `sort_order` (string): Sort order (`asc`, `desc`)
- `page` (number): Page number
- `limit` (number): Items per page (max: 100)

#### Get Audit Log

```http
GET /api/v1/audit-logs/{id}
```

**Auth**: Admin required

#### Get Audit Statistics

```http
GET /api/v1/audit-logs/statistics
```

**Auth**: Admin required

#### Get Recent Audit Logs

```http
GET /api/v1/audit-logs/recent?limit=100
```

**Auth**: Admin required

#### Get User Audit Logs

```http
GET /api/v1/audit-logs/user/{userId}?limit=100
```

**Auth**: Admin required

**Query Parameters**:

- `limit` (number): Items to return (default: 100, max: 500)

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "user_uuid",
      "action": "create",
      "resource": "bug_report",
      "resource_id": "report_uuid",
      "success": true,
      "metadata": {
        "project_id": "project_uuid",
        "title": "Login button not working"
      },
      "timestamp": "2025-11-06T12:00:00.000Z"
    }
  ],
  "count": 45
}
```

---

### Data Retention

#### Get Retention Policy

```http
GET /api/v1/admin/retention
```

**Auth**: Admin required

#### Update Global Retention Policy

```http
PUT /api/v1/admin/retention
```

**Auth**: Admin required

**Request Body**:

```json
{
  "bugReportRetentionDays": 365,
  "dataClassification": "sensitive",
  "autoDeleteEnabled": true
}
```

#### Get Project Retention Settings

```http
GET /api/v1/projects/{id}/retention
```

**Auth**: User required (with project access)

#### Update Project Retention Settings

```http
PUT /api/v1/projects/{id}/retention
```

**Auth**: Project Owner or Admin required

#### Preview Retention Policy

```http
POST /api/v1/admin/retention/preview?projectId=uuid
```

**Auth**: Admin required

#### Apply Retention Policy

```http
POST /api/v1/admin/retention/apply
```

**Auth**: Admin required

**Request Body**:

```json
{
  "dryRun": false,
  "batchSize": 100,
  "maxErrorRate": 0.05,
  "confirm": true
}
```

#### Set Legal Hold

```http
POST /api/v1/admin/retention/legal-hold
```

**Auth**: Admin required

**Request Body**:

```json
{
  "reportIds": ["uuid1", "uuid2"],
  "hold": true
}
```

#### Restore Reports

```http
POST /api/v1/admin/retention/restore
```

**Auth**: Admin required

**Request Body**:

```json
{
  "reportIds": ["uuid1", "uuid2"]
}
```

#### Hard Delete Reports

```http
DELETE /api/v1/admin/retention/hard-delete
```

**Auth**: Admin required

**Request Body**:

```json
{
  "reportIds": ["uuid1", "uuid2"],
  "confirm": true,
  "generateCertificate": true
}
```

---

### Notifications

#### List Notification Channels

```http
GET /api/v1/notifications/channels?project_id=uuid&type=email&active=true&page=1&limit=20
```

**Auth**: User required

#### Create Notification Channel

```http
POST /api/v1/notifications/channels
```

**Auth**: User required

**Request Body**:

```json
{
  "project_id": "uuid",
  "name": "Team Email",
  "type": "email",
  "config": {
    "recipients": ["team@company.com"],
    "smtp": {
      "host": "smtp.company.com",
      "port": 587,
      "secure": false,
      "auth": {
        "user": "alerts@company.com",
        "pass": "password"
      }
    }
  },
  "active": true
}
```

#### Test Notification Channel

```http
POST /api/v1/notifications/channels/{id}/test
```

**Auth**: User required

**Request Body**:

```json
{
  "test_message": "This is a test notification from BugSpotter"
}
```

#### List Notification Rules

```http
GET /api/v1/notifications/rules?project_id=uuid&enabled=true&page=1&limit=20
```

**Auth**: User required

#### Create Notification Rule

```http
POST /api/v1/notifications/rules
```

**Auth**: User required

**Request Body**:

```json
{
  "project_id": "uuid",
  "name": "Critical Bug Alerts",
  "enabled": true,
  "triggers": [
    {
      "type": "bug_created",
      "conditions": {
        "priority": "critical"
      }
    }
  ],
  "filters": [
    {
      "type": "project_filter",
      "value": "uuid"
    }
  ],
  "throttle": {
    "type": "time_window",
    "duration": 300
  },
  "priority": 9,
  "channel_ids": ["channel_uuid1", "channel_uuid2"]
}
```

#### List Notification Templates

```http
GET /api/v1/notifications/templates?channel_type=email&trigger_type=bug_created&is_active=true&page=1&limit=20
```

**Auth**: Admin required

#### Preview Notification Template

```http
POST /api/v1/notifications/templates/preview
```

**Auth**: Admin required

**Request Body**:

```json
{
  "template_body": "New bug report: {{title}} in project {{project.name}}",
  "subject": "Critical Bug Alert: {{title}}",
  "context": {
    "title": "Database connection error",
    "project": {
      "name": "Production App"
    },
    "priority": "critical"
  }
}
```

#### List Notification History

```http
GET /api/v1/notifications/history?channel_id=uuid&rule_id=uuid&bug_id=uuid&status=sent&created_after=2025-10-01&created_before=2025-10-31&page=1&limit=20
```

**Auth**: User required

**Query Parameters**:

- `channel_id` (string): Filter by notification channel UUID
- `rule_id` (string): Filter by notification rule UUID
- `bug_id` (string): Filter by bug report UUID
- `status` (string): Filter by delivery status (`pending`, `sent`, `failed`)
- `created_after` (string): ISO date string - filter notifications created after this date
- `created_before` (string): ISO date string - filter notifications created before this date
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20, max: 100)

**Response**:

```json
{
  "success": true,
  "data": {
    "history": [
      {
        "id": "uuid",
        "channel_id": "uuid",
        "rule_id": "uuid",
        "bug_id": "uuid",
        "status": "sent",
        "created_at": "2025-10-15T14:30:00.000Z",
        "sent_at": "2025-10-15T14:30:05.000Z",
        "error_message": null
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

---

### Organization Management

Admin endpoints for managing organizations, subscriptions, and invitations. All require platform `admin` role.

#### Create Organization

```http
POST /api/v1/admin/organizations
Authorization: Bearer <admin_token>
```

```json
{
  "name": "Demo Inc",
  "subdomain": "demo-inc",
  "owner_user_id": "uuid",
  "plan_name": "professional",
  "data_residency_region": "kz"
}
```

| Field                   | Type   | Required | Notes                                              |
| ----------------------- | ------ | -------- | -------------------------------------------------- |
| `name`                  | string | Yes      | 1-255 chars                                        |
| `subdomain`             | string | Yes      | 3-63 chars, lowercase alphanumeric + hyphens       |
| `owner_user_id`         | uuid   | Yes      | Must be an existing user                           |
| `plan_name`             | string | No       | trial (default), starter, professional, enterprise |
| `data_residency_region` | string | No       | kz, rf, eu, us, global                             |

**Response** `201 Created`:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Demo Inc",
    "subdomain": "demo-inc",
    "subscription_status": "active",
    "data_residency_region": "kz",
    "created_at": "2026-02-15T..."
  }
}
```

#### Set/Change Plan

```http
PATCH /api/v1/admin/organizations/:id/subscription
Authorization: Bearer <admin_token>
```

```json
{
  "plan_name": "enterprise",
  "status": "active"
}
```

| Field       | Type   | Required | Notes                                                             |
| ----------- | ------ | -------- | ----------------------------------------------------------------- |
| `plan_name` | string | Yes      | trial, starter, professional, enterprise                          |
| `status`    | string | No       | Billing status override (trial, active, past_due, canceled, etc.) |

### Invitations

#### Invite User (Admin Override)

```http
POST /api/v1/admin/organizations/:id/invitations
Authorization: Bearer <admin_token>
```

```json
{
  "email": "user@example.com",
  "role": "member",
  "locale": "en"
}
```

| Field    | Required | Description                                                |
| -------- | -------- | ---------------------------------------------------------- |
| `email`  | Yes      | Invitee email address                                      |
| `role`   | Yes      | `"admin"` or `"member"`                                    |
| `locale` | No       | Email language: `"en"`, `"ru"`, or `"kk"` (default `"en"`) |

**Response** `201 Created`:

```json
{
  "success": true,
  "data": {
    "invitation": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "member",
      "token": "hex-token",
      "status": "pending",
      "expires_at": "2026-02-22T..."
    },
    "email_sent": true
  }
}
```

#### Invite User (Org Admin)

```http
POST /api/v1/organizations/:id/invitations
Authorization: Bearer <org_admin_token>
```

Same body and response as admin override. Requires org admin or owner role.

#### List Pending Invitations

```http
GET /api/v1/admin/organizations/:id/invitations
GET /api/v1/organizations/:id/invitations
```

#### Cancel Invitation

```http
DELETE /api/v1/admin/organizations/:id/invitations/:invitationId
DELETE /api/v1/organizations/:id/invitations/:invitationId
```

**Response**: `204 No Content`

#### Preview Invitation (Public)

```http
GET /api/v1/invitations/preview?token=<64-char-hex-token>
```

No authentication required. Returns display-safe invitation details for login/register pages.

**Response** `200 OK`:

```json
{
  "success": true,
  "data": {
    "organization_name": "Demo Inc",
    "organization_subdomain": "demo",
    "email": "user@example.com",
    "role": "member",
    "status": "pending",
    "expires_at": "2026-02-22T...",
    "inviter_name": "Alice"
  }
}
```

| Error        | Status | Description                             |
| ------------ | ------ | --------------------------------------- |
| `NotFound`   | 404    | Token does not match any invitation     |
| `BadRequest` | 400    | Invitation already accepted or canceled |
| `Gone`       | 410    | Invitation has expired                  |

#### Accept Invitation

```http
POST /api/v1/invitations/accept
Authorization: Bearer <any_user_token>
```

```json
{
  "token": "64-char-hex-token"
}
```

The token must be exactly 64 lowercase hex characters (`[0-9a-f]{64}`).

**Response** `200 OK`:

```json
{
  "success": true,
  "data": {
    "invitation": {
      "id": "uuid",
      "organization_id": "uuid",
      "organization_name": "Demo Inc",
      "status": "accepted"
    },
    "joined": true
  }
}
```

`joined: false` if the user was already a member (invitation still marked accepted).

**Error** `403 EmailMismatch` — the authenticated user's email does not match the invitation email:

```json
{
  "success": false,
  "error": "EmailMismatch",
  "message": "This invitation was sent to a different email address",
  "details": {
    "invitation_email": "alice@example.com",
    "current_user_email": "bob@example.com"
  }
}
```

---

## Integration Endpoints

### User Integration Management

#### List Available Platforms

```http
GET /api/v1/integrations/platforms
```

**Auth**: User required

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "platform": "jira",
      "name": "Atlassian Jira",
      "description": "Create tickets in Jira for bug reports",
      "supported": true
    },
    {
      "platform": "github",
      "name": "GitHub Issues",
      "description": "Create GitHub issues for bug reports",
      "supported": true
    }
  ]
}
```

#### Test Integration

```http
POST /api/v1/integrations/{platform}/test
```

**Auth**: User required

**Request Body** (example for Jira):

```json
{
  "url": "https://company.atlassian.net",
  "username": "api-user@company.com",
  "api_token": "ATATT3xFfGF0...",
  "project_key": "BUGS"
}
```

#### Save Integration Configuration

```http
POST /api/v1/integrations/{platform}/{projectId}
```

**Auth**: User required (with project access)

**Request Body**:

```json
{
  "config": {
    "url": "https://company.atlassian.net",
    "project_key": "BUGS",
    "issue_type": "Bug",
    "priority": "High",
    "assignee": "john.doe",
    "labels": "bugspotter,automated",
    "custom_template": "Bug: {{title}}\n\nDescription: {{description}}\n\nURL: {{url}}",
    "field_mappings": {
      "summary": "{{title}}",
      "description": "{{description}}",
      "environment": "{{metadata.browser}} {{metadata.browserVersion}}"
    },
    "include_console_logs": true,
    "include_network_logs": true,
    "console_log_limit": 50,
    "network_log_limit": 20,
    "network_filter": "failures_only"
  },
  "credentials": {
    "username": "api-user@company.com",
    "api_token": "ATATT3xFfGF0..."
  },
  "enabled": true
}
```

**Configuration Fields** (platform-specific):

**Jira Platform**:

- `url` / `instanceUrl` / `serverUrl` (string): Jira instance URL (required)
- `project_key` / `projectKey` (string): Jira project key (required, e.g., "PROJ", "BUG")
- `issue_type` / `issueType` (string): Default issue type (default: "Bug")
- `priority` (string): Default priority ("Highest", "High", "Medium", "Low", "Lowest")
- `assignee` (string): Default assignee username
- `labels` (string): Comma-separated labels
- `custom_template` (string): Custom description template with variable placeholders
- `field_mappings` (object): Map Jira fields to bug report data using templates
- `include_console_logs` (boolean): Include console logs in ticket description (default: true)
- `include_network_logs` (boolean): Include network logs in ticket description (default: true)
- `console_log_limit` (number): Maximum console logs to include (default: 50)
- `network_log_limit` (number): Maximum network requests to include (default: 20)
- `network_filter` (string): "all" or "failures_only" (default: "failures_only")

**Template Variables** (available in `custom_template` and `field_mappings`):

- `{{title}}` - Bug report title
- `{{description}}` - Bug report description
- `{{url}}` - Page URL where bug occurred
- `{{status}}` - Bug status (open, in_progress, resolved, closed)
- `{{priority}}` - Bug priority (low, medium, high, critical)
- `{{created_at}}` - ISO timestamp
- `{{user_agent}}` - Browser user agent string
- `{{metadata.*}}` - Any metadata field (e.g., `{{metadata.browser}}`, `{{metadata.userId}}`)

**Note**: The backend automatically normalizes field name variations:

- `url` / `instanceUrl` / `serverUrl` / `host` / `baseUrl` → all map to same field
- `username` / `email` → authentication username
- `api_token` / `password` → authentication token/password

**Credentials**: Always stored encrypted (AES-256-GCM) and never returned in GET requests.

#### Get Integration Configuration

```http
GET /api/v1/integrations/{platform}/{projectId}
```

**Auth**: User required (with project access)

**Response**:

```json
{
  "success": true,
  "data": {
    "platform": "jira",
    "enabled": true,
    "config": {
      "url": "https://company.atlassian.net",
      "project_key": "BUGS"
    }
  }
}
```

**Note**: Credentials are never returned in GET requests.

#### Update Integration Status

```http
PATCH /api/v1/integrations/{platform}/{projectId}
```

**Auth**: User required (with project access)

**Request Body**:

```json
{
  "enabled": false
}
```

#### Delete Integration

```http
DELETE /api/v1/integrations/{platform}/{projectId}
```

**Auth**: User required (with project access)

---

### Admin Integration Management

#### Analyze Plugin Code

```http
POST /api/v1/admin/integrations/analyze-code
```

**Auth**: Admin required  
**Description**: Analyze custom plugin code for security violations before deployment

**Request Body**:

```json
{
  "code": "function createTicket(bugReport) { /* plugin code */ }"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "safe": true,
    "violations": [],
    "warnings": ["Uses HTTP requests - ensure credentials are secured"],
    "risk_level": "low",
    "code_hash": "sha256:abc123..."
  }
}
```

**Security Note**: Custom plugin execution is currently disabled due to sandbox escape vulnerabilities. Plugin code will be stored but cannot be executed until secure bridging is implemented.

#### Create Integration

```http
POST /api/v1/admin/integrations
```

**Auth**: Admin required  
**Description**: Create a new integration type (max 10 integrations per instance)

**Request Body**:

```json
{
  "type": "custom_tracker",
  "name": "Custom Issue Tracker",
  "description": "Internal issue tracking system",
  "is_custom": true,
  "plugin_source": "generic_http",
  "trust_level": "custom",
  "config": {
    "base_url": "https://tracker.company.com"
  },
  "plugin_code": "// Optional custom plugin code",
  "allow_code_execution": false
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "custom_tracker",
    "name": "Custom Issue Tracker",
    "status": "not_configured",
    "is_custom": true,
    "plugin_source": "generic_http",
    "trust_level": "custom",
    "created_at": "2025-11-06T12:00:00.000Z"
  }
}
```

#### List Integrations

```http
GET /api/v1/admin/integrations?status=active&page=1&limit=20
```

**Auth**: Admin required

**Query Parameters**:

- `status` (string): Filter by status (`not_configured`, `active`, `error`, `disabled`)
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "jira",
      "name": "Atlassian Jira",
      "status": "active",
      "last_sync_at": "2025-11-06T11:30:00.000Z",
      "stats": {
        "last_sync_at": "2025-11-06T11:30:00.000Z",
        "total": 152,
        "success": 150,
        "failed": 2,
        "avg_duration_ms": 1250
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

#### Get Integration Status

```http
GET /api/v1/admin/integrations/{type}/status
```

**Auth**: Admin required

**Response**:

```json
{
  "success": true,
  "data": {
    "type": "jira",
    "name": "Atlassian Jira",
    "status": "active",
    "last_sync_at": "2025-11-06T11:30:00.000Z",
    "stats": {
      "success": 150,
      "failed": 2,
      "pending": 0,
      "avg_duration_ms": 1250
    }
  }
}
```

#### Get Integration Configuration

```http
GET /api/v1/admin/integrations/{type}/config
```

**Auth**: Admin required  
**Note**: Excludes sensitive OAuth tokens and webhook secrets from response

#### Update Integration Configuration

```http
PUT /api/v1/admin/integrations/{type}/config
```

**Auth**: Admin required

**Request Body**:

```json
{
  "name": "Updated Integration Name",
  "status": "active",
  "config": {
    "base_url": "https://new-url.com"
  },
  "field_mappings": {
    "title": "summary",
    "description": "description",
    "priority": "priority"
  },
  "sync_rules": {
    "auto_sync": true,
    "sync_interval": 3600
  }
}
```

#### Reset Integration Configuration

```http
DELETE /api/v1/admin/integrations/{type}/config
```

**Auth**: Admin required  
**Description**: Resets integration to `not_configured` status and clears all sensitive data including OAuth tokens

#### Delete Integration

```http
DELETE /api/v1/admin/integrations/{type}
```

**Auth**: Admin required  
**Description**: Completely removes the integration and all associated OAuth tokens

#### Toggle Code Execution

```http
POST /api/v1/admin/integrations/{type}/toggle-code-execution
```

**Auth**: Admin required  
**Description**: Enable/disable code execution for custom plugin integrations

**Request Body**:

```json
{
  "allow_code_execution": true
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "type": "custom_tracker",
    "allow_code_execution": true,
    "message": "Code execution enabled"
  }
}
```

**Security Warning**: Custom plugin execution is currently disabled system-wide due to sandbox escape vulnerabilities. This setting will have no effect until secure bridging is implemented.

#### Test Integration Connection

```http
POST /api/v1/admin/integrations/{type}/test
```

**Auth**: Admin required

**Request Body** (optional - uses existing config if not provided):

```json
{
  "config": {
    "base_url": "https://test.company.com",
    "api_key": "test_key"
  }
}
```

**Response** (success):

```json
{
  "success": true,
  "data": {
    "message": "Connection test successful",
    "tested_at": "2025-11-06T12:00:00.000Z",
    "duration_ms": 234
  }
}
```

**Response** (failure):

```json
{
  "success": false,
  "message": "Connection test failed",
  "error": "Connection refused: ECONNREFUSED"
}
```

#### Get Integration Activity Log

```http
GET /api/v1/admin/integrations/activity?integration_type=jira&status=success&page=1&limit=50
```

**Auth**: Admin required

**Query Parameters**:

- `integration_type` (string): Filter by integration type
- `bug_id` (string): Filter by bug report UUID
- `status` (string): Filter by status (`pending`, `success`, `failed`, `skipped`)
- `action` (string): Filter by action (`create`, `update`, `sync`, `test`, `error`)
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 50, max: 100)

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "integration_type": "jira",
      "bug_id": "bug_uuid",
      "action": "create",
      "status": "success",
      "duration_ms": 1234,
      "error": null,
      "metadata": {
        "ticket_id": "PROJ-123",
        "ticket_url": "https://company.atlassian.net/browse/PROJ-123"
      },
      "created_at": "2025-11-06T11:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### List Integration Webhooks

```http
GET /api/v1/admin/integrations/{type}/webhooks
```

**Auth**: Admin required

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "integration_type": "jira",
      "endpoint_url": "https://company.com/webhooks/jira",
      "secret": "whsec_...",
      "events": ["issue.created", "issue.updated"],
      "active": true,
      "created_at": "2025-11-06T10:00:00.000Z"
    }
  ]
}
```

#### Create Webhook

```http
POST /api/v1/admin/integrations/{type}/webhooks
```

**Auth**: Admin required

**Request Body**:

```json
{
  "endpoint_url": "https://company.com/webhooks/jira",
  "events": ["issue.created", "issue.updated"],
  "active": true
}
```

**Response** (includes auto-generated 256-bit cryptographic secret):

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "integration_type": "jira",
    "endpoint_url": "https://company.com/webhooks/jira",
    "secret": "whsec_abc123def456...",
    "events": ["issue.created", "issue.updated"],
    "active": true,
    "created_at": "2025-11-06T12:00:00.000Z"
  }
}
```

**Important**: Store the webhook secret securely. It cannot be retrieved later and is used to validate webhook authenticity.

#### Update Webhook

```http
PUT /api/v1/admin/integrations/{type}/webhooks/{id}
```

**Auth**: Admin required

**Request Body**:

```json
{
  "endpoint_url": "https://new-url.com/webhook",
  "events": ["issue.created"],
  "active": false
}
```

#### Delete Webhook

```http
DELETE /api/v1/admin/integrations/{type}/webhooks/{id}
```

**Auth**: Admin required

---

### Automatic Ticket Creation

BugSpotter can automatically create tickets in external systems (Jira, GitHub, etc.) when bug reports are submitted, based on configurable rules.

#### How It Works

1. **Bug report submitted** via SDK or API
2. **Rule evaluation** checks all enabled rules against the bug report
3. **Automatic ticket creation** if a rule matches (with throttling)
4. **Metadata tracking** records which rule created the ticket

**Key Features**:

- Rule-based filtering (priority, browser, custom fields)
- Priority ordering (highest priority rule wins)
- Throttling (hourly/daily limits per rule)
- Field mapping (bug report fields → ticket fields)
- Transactional safety (rollback on failure)

---

#### Create Automatic Ticket Rule

```http
POST /api/v1/integrations/{platform}/{projectId}/rules
```

**Auth**: User required (project owner or admin)

**Path Parameters**:

- `platform` - Integration platform (jira, github, linear, slack)
- `projectId` - Project UUID

**Request Body**:

```json
{
  "name": "Critical bugs to Jira",
  "enabled": true,
  "priority": 100,
  "filters": [
    {
      "field": "priority",
      "operator": "equals",
      "value": "critical"
    },
    {
      "field": "browser",
      "operator": "equals",
      "value": "chrome"
    }
  ],
  "field_mappings": {
    "priority": "High",
    "labels": ["auto-created", "critical"],
    "assignee": "auto-triage-team",
    "issue_type": "Bug"
  },
  "throttle": {
    "max_per_hour": 5,
    "max_per_day": 20
  }
}
```

**Filter Operators**:

- `equals` - Exact match (case-insensitive)
- `contains` - Substring match (for text fields)
- `in` - Value in array (future)
- `greater_than` - Numeric comparison (future)

**Supported Filter Fields**:

- `priority` - Bug priority level (low, medium, high, critical)
- `status` - Bug status (open, in_progress, resolved, closed)
- `browser` - Browser name (chrome, firefox, safari, edge)
- `os` - Operating system (windows, macos, linux, ios, android)
- `title` - Bug report title (use `contains` operator)
- `description` - Bug description (use `contains` operator)
- Custom metadata fields (e.g., `environment`, `version`)

**Field Mappings** (Platform-Specific):

**Jira**:

- `priority` - Issue priority (Highest, High, Medium, Low, Lowest)
- `issue_type` - Issue type (Bug, Task, Story, Epic)
- `labels` - Array of labels
- `assignee` - Assignee username or email
- `components` - Array of component names
- `fix_versions` - Array of version names

**GitHub**:

- `labels` - Array of label names
- `assignees` - Array of usernames
- `milestone` - Milestone title

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "integration_id": "uuid",
    "name": "Critical bugs to Jira",
    "enabled": true,
    "priority": 100,
    "filters": [...],
    "field_mappings": {...},
    "throttle": {
      "max_per_hour": 5,
      "max_per_day": 20
    },
    "stats": {
      "total_created": 0,
      "last_created_at": null
    },
    "created_at": "2025-12-08T12:00:00.000Z",
    "updated_at": "2025-12-08T12:00:00.000Z"
  }
}
```

---

#### List Automatic Ticket Rules

```http
GET /api/v1/integrations/{platform}/{projectId}/rules
```

**Auth**: User required (project member)

**Path Parameters**:

- `platform` - Integration platform (jira, github, linear, slack)
- `projectId` - Project UUID

**Note**: Returns all rules (including disabled) for management UI. Use client-side filtering if needed.

**Response**:

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Critical bugs to Jira",
      "enabled": true,
      "priority": 100,
      "filters": [
        {
          "field": "priority",
          "operator": "equals",
          "value": "critical"
        }
      ],
      "field_mappings": {
        "priority": "High",
        "labels": ["auto-created"]
      },
      "throttle": {
        "max_per_hour": 5,
        "max_per_day": 20
      },
      "stats": {
        "total_created": 42,
        "last_created_at": "2025-12-08T11:30:00.000Z",
        "hourly_count": 3,
        "daily_count": 15
      }
    }
  ]
}
```

---

#### Update Automatic Ticket Rule

```http
PATCH /api/v1/integrations/{platform}/{projectId}/rules/{ruleId}
```

**Auth**: User required (project owner or admin)

**Path Parameters**:

- `platform` - Integration platform (jira, github, linear, slack)
- `projectId` - Project UUID
- `ruleId` - Rule UUID

**Request Body** (all fields optional):

```json
{
  "name": "Updated rule name",
  "enabled": false,
  "priority": 90,
  "filters": [...],
  "field_mappings": {...},
  "throttle": {
    "max_per_hour": 10,
    "max_per_day": 50
  }
}
```

**Response**: Updated rule object.

---

#### Delete Automatic Ticket Rule

```http
DELETE /api/v1/integrations/{platform}/{projectId}/rules/{ruleId}
```

**Auth**: User required (project owner or admin)

**Path Parameters**:

- `platform` - Integration platform (jira, github, linear, slack)
- `projectId` - Project UUID
- `ruleId` - Rule UUID

**Response**:

```json
{
  "success": true,
  "message": "Rule deleted successfully"
}
```

---

#### Configuration Examples

**Example 1: Critical Bugs Only**

```json
{
  "name": "Critical P0 bugs",
  "enabled": true,
  "priority": 100,
  "filters": [
    {
      "field": "priority",
      "operator": "equals",
      "value": "critical"
    }
  ],
  "field_mappings": {
    "priority": "Highest",
    "labels": ["P0", "auto-created"],
    "assignee": "on-call-engineer"
  },
  "throttle": {
    "max_per_hour": 10,
    "max_per_day": 50
  }
}
```

**Example 2: Production Environment Crashes**

```json
{
  "name": "Production crashes",
  "enabled": true,
  "priority": 95,
  "filters": [
    {
      "field": "environment",
      "operator": "equals",
      "value": "production"
    },
    {
      "field": "title",
      "operator": "contains",
      "value": "crash"
    }
  ],
  "field_mappings": {
    "priority": "Critical",
    "labels": ["production", "crash", "auto-created"],
    "components": ["Backend"]
  },
  "throttle": {
    "max_per_hour": 5,
    "max_per_day": 20
  }
}
```

**Example 3: Browser-Specific Issues**

```json
{
  "name": "Safari rendering bugs",
  "enabled": true,
  "priority": 50,
  "filters": [
    {
      "field": "browser",
      "operator": "equals",
      "value": "safari"
    },
    {
      "field": "priority",
      "operator": "equals",
      "value": "high"
    }
  ],
  "field_mappings": {
    "priority": "Medium",
    "labels": ["safari", "rendering", "auto-created"],
    "components": ["Frontend", "UI"]
  },
  "throttle": {
    "max_per_hour": 3,
    "max_per_day": 15
  }
}
```

---

#### Rule Evaluation Logic

**Priority System**:

- Rules are evaluated in **descending priority order** (100 → 1)
- **First matching rule wins** - subsequent rules are not evaluated
- If no rules match, no automatic ticket is created

**Filter Matching**:

- **All filters must match** (AND logic)
- Future: Support for OR logic with filter groups
- Case-insensitive matching for string operators
- Null/undefined fields never match

**Throttling**:

- Separate counters per rule (not per integration)
- Hourly window: Rolling 60-minute window (last hour from now)
- Daily window: Rolling 24-hour window (last 24 hours from now)
- When throttled: Rule skips ticket creation, logs warning
- Throttle status included in rule stats API

**Transactional Safety** (Transactional Outbox Pattern):

- ✅ **Outbox Pattern Implemented**: Ticket creation intent stored in database transaction
- ✅ **Atomic Operations**: Bug report + outbox entry created together (both succeed or both fail)
- ✅ **No Orphaned Tickets**: External API called AFTER database transaction commits
- ✅ **Async Processing**: Background worker processes outbox entries (30-second polling)
- ✅ **Automatic Retries**: Exponential backoff (1min, 5min, 30min, 2h, 12h)
- ✅ **Dead Letter Queue**: Failed entries after max retries move to admin review queue
- ✅ **Idempotency**: Each outbox entry has unique key to prevent duplicate tickets
- ⏱️ **Eventual Consistency**: Tickets created asynchronously (~30-60 seconds after bug report)

For implementation details, see: `packages/backend/docs/TRANSACTIONAL_OUTBOX.md`

---

#### Monitoring & Troubleshooting

**Check Rule Stats**:

```http
GET /api/v1/projects/{projectId}/integrations/{integrationId}/rules/{ruleId}
```

Response includes:

- `stats.total_created` - Total tickets created by this rule
- `stats.last_created_at` - Timestamp of last ticket creation
- `stats.hourly_count` - Tickets created in last hour (rolling 60-minute window)
- `stats.daily_count` - Tickets created in last 24 hours (rolling window)

**View Audit Logs**:

```http
GET /api/v1/admin/audit-logs?action=automatic_ticket_creation
```

Shows:

- Which rule triggered
- Bug report details
- External ticket ID
- Failure reasons (if any)

**Common Issues**:

1. **Rule not triggering**:
   - Check `enabled: true`
   - Verify filter fields match bug report data
   - Check filter operators (use `contains` for partial matches)
   - Review audit logs for evaluation results

2. **Throttled**:
   - Check `stats.hourly_count` and `stats.daily_count`
   - Increase throttle limits if needed
   - Review if multiple rules are needed

3. **Ticket creation failing**:
   - Verify integration credentials are valid
   - Check field mappings match target system
   - Review integration status: `GET /api/v1/integrations/{platform}/{projectId}`
   - Check audit logs for error details

4. **Wrong priority rule firing**:
   - Higher priority number = higher precedence
   - Use `priority: 100` for most important rules
   - Review rule filters for overlap

---

## Intelligence Endpoints

AI-powered bug analysis, duplicate detection, enrichment, and self-service resolution. See [Intelligence Integration Guide](docs/INTELLIGENCE_INTEGRATION_GUIDE.md) for architecture and configuration details.

### Intelligence Proxy

These routes proxy requests to the intelligence service. Only registered when `INTELLIGENCE_ENABLED=true`.

#### Health Check

```http
GET /api/v1/intelligence/health
Authorization: Bearer <token>
```

Returns service health status and circuit breaker state.

#### Find Similar Bugs

```http
GET /api/v1/intelligence/projects/{projectId}/bugs/{bugId}/similar?threshold=0.75&limit=10
Authorization: Bearer <token>
```

| Parameter   | Type   | Default | Description                    |
| ----------- | ------ | ------- | ------------------------------ |
| `threshold` | number | `0.75`  | Minimum similarity score (0–1) |
| `limit`     | number | `10`    | Max results (1–50)             |

#### Get Mitigation Suggestions

```http
GET /api/v1/intelligence/projects/{projectId}/bugs/{bugId}/mitigation?use_similar_bugs=true
Authorization: Bearer <token>
```

#### Search Bugs (Natural Language)

```http
POST /api/v1/intelligence/projects/{projectId}/search
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "login page crashes on submit",
  "mode": "fast",
  "limit": 10,
  "offset": 0,
  "status": "open",
  "date_from": "2026-01-01T00:00:00Z",
  "date_to": "2026-12-31T23:59:59Z"
}
```

#### Ask (Q&A with Context)

```http
POST /api/v1/intelligence/projects/{projectId}/ask
Authorization: Bearer <token>
Content-Type: application/json

{
  "question": "What are the most common causes of login failures?",
  "context": ["auth module", "session management"],
  "temperature": 0.7,
  "max_tokens": 1024
}
```

### Intelligence Settings

Admin-only routes for per-organization intelligence configuration. Always registered.

#### Get Settings

```http
GET /api/v1/organizations/{id}/intelligence/settings
Authorization: Bearer <token>
```

Returns current settings and API key status.

#### Update Settings

```http
PATCH /api/v1/organizations/{id}/intelligence/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "intelligence_enabled": true,
  "intelligence_auto_analyze": true,
  "intelligence_auto_enrich": true,
  "intelligence_similarity_threshold": 0.75,
  "intelligence_dedup_enabled": true,
  "intelligence_dedup_action": "flag",
  "intelligence_self_service_enabled": true
}
```

All fields are optional — only provided fields are updated.

#### Provision API Key

```http
POST /api/v1/organizations/{id}/intelligence/key
Authorization: Bearer <token>
Content-Type: application/json

{ "api_key": "sk-..." }
```

Keys are encrypted with AES-256-GCM. Must be provisioned before intelligence can be enabled.

#### Revoke API Key

```http
DELETE /api/v1/organizations/{id}/intelligence/key
Authorization: Bearer <token>
```

Returns `204 No Content`. Automatically disables intelligence for the organization.

### Enrichment

Routes for AI-generated bug enrichment data. Always registered.

#### Get Enrichment Data

```http
GET /api/v1/intelligence/bugs/{bugId}/enrichment
Authorization: Bearer <token>
```

Returns AI-generated summary, severity, category, tags, root cause, and components.

#### Trigger Enrichment

```http
POST /api/v1/intelligence/bugs/{bugId}/enrich
Authorization: Bearer <token>
```

Manually triggers AI enrichment for a bug report. Requires intelligence to be enabled.

### Feedback

Routes for feedback on intelligence suggestions. Always registered.

#### Submit Feedback

```http
POST /api/v1/intelligence/feedback
Authorization: Bearer <token>
Content-Type: application/json

{
  "bug_report_id": "uuid",
  "suggestion_bug_id": "uuid",
  "project_id": "uuid",
  "suggestion_type": "similar_bugs",
  "rating": 1,
  "comment": "The suggested duplicate was accurate"
}
```

#### Get Feedback Stats

```http
GET /api/v1/intelligence/projects/{projectId}/feedback/stats
Authorization: Bearer <token>
```

#### Get Bug Feedback

```http
GET /api/v1/intelligence/bugs/{bugId}/feedback
Authorization: Bearer <token>
```

### Self-Service Resolution

End-user routes for checking known resolutions. Only registered when `INTELLIGENCE_ENABLED=true`. Returns `403` when `intelligence_self_service_enabled` is disabled for the organization.

#### Check for Resolutions

```http
POST /api/v1/self-service/check
Authorization: Bearer <token>  |  X-API-Key: bgs_<key>
Content-Type: application/json

{
  "description": "My login page crashes when I click submit",
  "project_id": "uuid"
}
```

**Response:**

```json
{
  "data": {
    "matches": [
      {
        "bug_id": "uuid",
        "title": "Login form crash on submit",
        "resolution": "Fixed by updating form validation...",
        "similarity": 0.92,
        "status": "resolved"
      }
    ],
    "has_resolution": true
  }
}
```

#### Record Deflection

```http
POST /api/v1/self-service/deflected
Authorization: Bearer <token>  |  X-API-Key: bgs_<key>
Content-Type: application/json

{
  "project_id": "uuid",
  "matched_bug_id": "uuid",
  "description": "My login page crashes when I click submit"
}
```

Returns `201 Created` with the deflection record. Idempotent — duplicate submissions return the existing record.

#### Get Deflection Stats

```http
GET /api/v1/self-service/stats?project_id={projectId}
Authorization: Bearer <token>
```

JWT only (no API key auth). Returns total deflections, last 7/30 day counts, and top matched bugs.

---

## Queue & Job Management

#### Get Job Status

```http
GET /api/v1/queues/{queueName}/jobs/{id}
```

**Auth**: User required

**Response**:

```json
{
  "success": true,
  "data": {
    "id": "job_id",
    "name": "process-screenshot",
    "status": "completed",
    "progress": 100,
    "result": {
      "processed": true,
      "url": "https://signed-url"
    },
    "created_at": "2025-10-31T12:00:00.000Z",
    "completed_at": "2025-10-31T12:01:00.000Z"
  }
}
```

#### Get Queue Metrics

```http
GET /api/v1/queues/metrics
```

**Auth**: User required

**Response**:

```json
{
  "success": true,
  "data": {
    "queues": [
      {
        "queue": "screenshots",
        "waiting": 5,
        "active": 2,
        "completed": 1250,
        "failed": 12
      }
    ]
  }
}
```

#### Queue Health Check

```http
GET /api/v1/queues/health
```

**Public**: Yes

#### Trigger Integration Job

```http
POST /api/v1/admin/integrations/{platform}/trigger
```

**Auth**: Admin required

**Request Body**:

```json
{
  "bugReportId": "uuid",
  "projectId": "uuid"
}
```

---

## Setup & Configuration

#### Check Setup Status

```http
GET /api/v1/setup/status
```

**Public**: Yes

**Response**:

```json
{
  "success": true,
  "data": {
    "initialized": false,
    "requiresSetup": true
  }
}
```

#### Initialize System

```http
POST /api/v1/setup/initialize
```

**Public**: Yes (only when not initialized)

**Request Body**:

```json
{
  "admin_email": "admin@company.com",
  "admin_password": "securePassword123",
  "instance_name": "Company BugSpotter",
  "instance_url": "https://bugspotter.company.com",
  "storage_type": "s3",
  "storage_endpoint": "https://s3.amazonaws.com",
  "storage_access_key": "AKIA...",
  "storage_secret_key": "secret...",
  "storage_bucket": "company-bugspotter",
  "storage_region": "us-east-1"
}
```

#### Test Storage Configuration

```http
POST /api/v1/setup/test-storage
```

**Public**: Yes

**Request Body**: Same storage fields as initialize

---

## Response Formats

### Success Response

```json
{
  "success": true,
  "data": {...}
}
```

### Paginated Response

```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": "ValidationError",
  "message": "Invalid email format",
  "statusCode": 400,
  "timestamp": "2025-10-31T12:00:00.000Z"
}
```

---

## Rate Limiting

- **Default Limit**: 1000 requests per 15 minutes
- **Header**: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **API Keys**: Custom rate limits per key
- **Test Environment**: 10,000 requests per window

### Rate Limit Headers

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1698739200
```

---

## Security Features

### Content Security Policy

- **Default**: `'self'` only
- **Images**: `'self'` and `data:` URIs
- **No**: `'unsafe-inline'` or `'unsafe-eval'`

### CORS Configuration

- **Origins**: Configurable allowed origins
- **Credentials**: Supported for authenticated requests
- **Methods**: GET, POST, PUT, PATCH, DELETE, OPTIONS
- **Headers**: Content-Type, Authorization, X-API-Key

### Input Validation

BugSpotter enforces strict validation rules on all API endpoints using Fastify JSON Schema validation. All requests are validated before processing.

#### Field Validation Rules

##### API Keys (`POST /api/v1/api-keys`)

**Required Fields:**

- `name` (string): 1-255 characters
- `type` (enum): `production`, `development`, or `test`

**Optional Fields:**

- `description` (string): max 1000 characters
- `permission_scope` (enum): `full`, `read_only`, `project_specific`, `custom`
- `permissions` (array): max 50 items, each 1-100 characters
- `allowed_projects` (array of UUIDs): max 100 items
- `allowed_environments` (array): max 4 items (`production`, `staging`, `development`, `test`)
- `rate_limit_per_minute` (integer): 0-10,000
- `rate_limit_per_hour` (integer): 0-100,000
- `rate_limit_per_day` (integer): 0-1,000,000
- `burst_limit` (integer): 0-100
- `per_endpoint_limits` (object): max 50 properties, each value ≥ 0
- `ip_whitelist` (array): max 100 IP addresses/CIDR ranges (format: `192.168.1.0/24`)
- `allowed_origins` (array): max 50 URLs, each max 255 characters
- `user_agent_pattern` (string): max 500 characters (regex pattern)
- `expires_at` (ISO 8601 datetime): future date
- `rotate_at` (ISO 8601 datetime): future date
- `grace_period_days` (number): 0-90
- `team_id` (UUID)
- `tags` (array): max 20 tags, each 1-50 characters

**Update Restrictions (`PATCH /api/v1/api-keys/:id`):**

- At least 1 field required
- `status` can only be set to `active` or `revoked` (not `expiring`/`expired` - system-managed)
- Cannot set `description` to non-null after being null (validation enforces `null` in schema)

##### Projects (`POST /api/v1/projects`)

**Required Fields:**

- `name` (string): 1-255 characters
- `organization_id` (UUID): Required in SaaS mode when requesting from the hub domain (no subdomain). Ignored when the request comes from an org subdomain (tenant middleware resolves it). Not used in self-hosted mode.

**Optional Fields:**

- `settings` (object): max 100 properties, total request body limited to 1MB

**Update Rules (`PATCH /api/v1/projects/:id`):**

- At least 1 field required
- `name`: 1-255 characters
- `settings`: max 100 properties

##### Bug Reports (`POST /api/v1/reports`)

**Required Fields:**

- `title` (string): 1-500 characters
- `report` (object):
  - `console` (array of objects): SDK console capture data
  - `network` (array of objects): Network activity logs
  - `metadata` (object): Browser/environment info

**Optional Fields:**

- `description` (string): max 5000 characters
- `priority` (enum): `low`, `medium`, `high`, `critical` (default: `medium`)
- `report.screenshotKey` (string): S3 storage key from presigned URL upload
- `report.replayKey` (string): S3 storage key from presigned URL upload

**Update Rules (`PATCH /api/v1/reports/:id`):**

- At least 1 field required
- `status` (enum): `open`, `in-progress`, `resolved`, `closed`
- `priority` (enum): `low`, `medium`, `high`, `critical`
- `description` (string): max 5000 characters

##### Authentication (`POST /api/v1/auth/register`, `POST /api/v1/auth/login`)

**Required Fields:**

- `email` (string): valid email format (RFC 5322)
- `password` (string): 8-128 characters

**Optional Fields (register only):**

- `name` (string): Display name
- `invite_token` (string): 64-char hex invitation token (required when `REQUIRE_INVITATION_TO_REGISTER=true`)

**Password Requirements:**

- Minimum 8 characters
- Maximum 128 characters
- No complexity requirements enforced (allows passphrases)

##### User Management (`PATCH /api/v1/admin/users/:id`)

**Optional Fields (at least 1 required):**

- `email` (string): valid email format
- `role` (enum): `admin`, `user`, `viewer`

#### Common Validation Patterns

**UUIDs:**

- All ID fields (project_id, user_id, team_id, etc.) must be valid UUID v4 format
- Example: `123e4567-e89b-12d3-a456-426614174000`

**Pagination:**

- `page` (integer): ≥ 1 (default: 1)
- `limit` (integer): 1-100 (default: 20)
- `offset` (integer): ≥ 0 (used in some endpoints instead of page)

**Sorting:**

- `sort_order` or `order` (enum): `asc` or `desc` (default: `desc`)
- `sort_by`: varies by endpoint (e.g., `created_at`, `updated_at`, `name`)

**Date Filters:**

- `created_after`, `created_before`: ISO 8601 date format (`YYYY-MM-DD`)
- `start_date`, `end_date`: ISO 8601 datetime format (`YYYY-MM-DDTHH:mm:ss.sssZ`)

**IP Addresses:**

- Single IP: `192.168.1.1`
- CIDR notation: `192.168.1.0/24`
- Regex pattern: `^(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?:/[0-9]{1,2})?$`

**Array Limits:**

- Most array fields have max item limits (20-100 depending on field)
- Empty arrays (`[]`) are valid unless field is required

**Null Handling:**

- Fields marked `nullable: true` accept `null` or omit the field
- Non-nullable fields reject `null` values
- Updates can set nullable fields to `null` to clear them

#### SQL Injection Prevention

- **Parameterized Queries**: All database queries use PostgreSQL `$1`, `$2` placeholders
- **Identifier Validation**: Column names validated with regex `^[a-zA-Z0-9_]+$`
- **Input Sanitization**: User input never interpolated into SQL strings

#### Path Traversal Prevention

- **Filename Sanitization**: `path.basename()` extracts filename only
- **URL Decoding**: Safely decodes `%2e%2e%2f` attacks
- **Control Character Removal**: Strips null bytes and path separators
- **Storage Key Validation**: Whitelist check for resource types (`screenshots`, `replays`, `attachments`)

#### XSS Prevention

- **Template Escaping**: Auto-escaped rendering (not applicable - API only)
- **Content-Type Enforcement**: JSON responses only
- **CSP Headers**: Helmet.js with strict Content Security Policy (admin panel)

#### DoS Prevention

- **Request Body Limit**: Global 1MB limit on all request bodies (JSON payloads)
- **File Upload Limit**: Separate configurable limit for multipart uploads (default 10MB)
- **Object Property Limits**: Max 100 properties for `settings` objects
- **Rate Limiting**: Per-API-key and global rate limits prevent abuse

### Authentication Security

- **JWT**: RS256 signing with configurable expiry
- **API Keys**: `bgs_` prefix with hash storage
- **Refresh Tokens**: httpOnly cookies
- **Rate Limiting**: Per-key and global limits

---

## SDK Integration

For frontend integration, use the BugSpotter SDK (now available in separate repository):

```javascript
import BugSpotter from '@bugspotter/sdk';

BugSpotter.init({
  apiKey: 'bgs_your_api_key',
  endpoint: 'https://your-bugspotter-api.com',
  projectId: 'your-project-uuid',
});
```

> **Note**: The SDK has been migrated to a separate repository at https://github.com/apex-bridge/bugspotter-sdk

// Automatic error capture
BugSpotter.captureError(error);

// Manual bug report
BugSpotter.captureMessage('Custom issue description');

```

---

## Bug Report Query Patterns & Security Analysis

### Query Pattern Analysis: "Do all bug queries include WHERE project_id = ?"

**Answer: FALSE** - Bug queries follow different patterns based on their purpose and security requirements.

#### **When Bug Queries INCLUDE `WHERE project_id = ?`:**

1. **Repository-level filtering operations**
   - **API Calls**: `GET /api/v1/reports` (with project_id filter)
   - **Purpose**: User-scoped bug report listings with pagination
   - **ProjectId Filter**: ✅ **APPLIED** - Direct filtering in repository query

2. **Retention operations**
   - **API Calls**: `GET /api/v1/projects/{id}/retention`, `POST /api/v1/admin/retention/preview?projectId=uuid`
   - **Purpose**: Project-specific data retention management
   - **ProjectId Filter**: ✅ **APPLIED** - Scoped to specific project for policy application

#### **When Bug Queries DO NOT INCLUDE `WHERE project_id = ?`:**

1. **Admin analytics queries** - intentionally query across all projects
   - **API Calls**: `GET /api/v1/analytics/dashboard`, `GET /api/v1/analytics/reports/trend`, `GET /api/v1/analytics/projects/stats`
   - **Purpose**: System-wide metrics and reporting for administrators
   - **Security**: Admin-only endpoints with role-based access control
   - **ProjectId Filter**: ❌ **NOT APPLIED** - Intentionally aggregates across all projects

2. **Individual lookups** - use ID-based queries with post-fetch access control
   - **API Calls**: `GET /api/v1/reports/{id}`, `GET /api/v1/reports/{id}/screenshot-url`, `GET /api/v1/reports/{id}/replay-url`, `POST /api/v1/reports/{id}/confirm-upload`
   - **Pattern**: Fetch by UUID first, then verify project access via `checkProjectAccess()`
   - **Security**: Defense-in-depth with API-level access verification
   - **ProjectId Filter**: ❌ **NOT APPLIED** - Uses `WHERE id = ?` then validates project access

3. **Background workers** - update records by ID without project filtering
   - **API Calls**: `POST /api/v1/uploads/presigned-url` (triggers worker updates), `POST /api/v1/admin/integrations/{platform}/trigger`
   - **Context**: Workers operate on pre-authorized bug reports via job queues
   - **Security**: Job context includes pre-validated project permissions
   - **ProjectId Filter**: ❌ **NOT APPLIED** - Updates by bug report ID only

4. **Audit/legal operations** - may need cross-project visibility
   - **API Calls**: `POST /api/v1/admin/retention/legal-hold`, `POST /api/v1/admin/retention/restore`, `DELETE /api/v1/admin/retention/hard-delete`, `GET /api/v1/audit-logs`
   - **Scope**: Admin-only operations that may span multiple projects for compliance
   - **Security**: Administrative privileges with comprehensive audit logging
   - **ProjectId Filter**: ❌ **NOT APPLIED** - Cross-project operations for compliance

### Security Model: Multi-Layer Defense

The system uses **defense-in-depth** rather than universal project filtering:

1. **API Layer**: Route-level authentication and authorization
2. **Access Control**: Project membership verification via `checkProjectAccess()`
3. **Role-Based**: Admin users have cross-project visibility where appropriate
4. **Audit Trail**: All administrative actions are logged for compliance

This approach provides **flexibility for legitimate cross-project operations** (analytics, compliance) while maintaining **strict access control** for user-facing functionality.

### ProjectId Filter Application Summary

#### **✅ APIs that APPLY `WHERE project_id = ?` filter:**

- `GET /api/v1/reports` (with project_id parameter)
- `GET /api/v1/projects/{id}/retention`
- `POST /api/v1/admin/retention/preview?projectId=uuid`

#### **❌ APIs that DO NOT APPLY `WHERE project_id = ?` filter:**

- `GET /api/v1/analytics/dashboard`
- `GET /api/v1/analytics/reports/trend`
- `GET /api/v1/analytics/projects/stats`
- `GET /api/v1/reports/{id}`
- `GET /api/v1/reports/{id}/screenshot-url`
- `GET /api/v1/reports/{id}/replay-url`
- `POST /api/v1/reports/{id}/confirm-upload`
- `POST /api/v1/uploads/presigned-url` (worker triggers)
- `POST /api/v1/admin/integrations/{platform}/trigger`
- `POST /api/v1/admin/retention/legal-hold`
- `POST /api/v1/admin/retention/restore`
- `DELETE /api/v1/admin/retention/hard-delete`
- `GET /api/v1/audit-logs`

---

For more detailed implementation examples, see the [SDK Documentation](./packages/sdk/README.md) and [Admin Panel Documentation](./apps/admin/README.md).
```
