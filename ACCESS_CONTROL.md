# BugSpotter Access Control Model

This document defines the role-based access control (RBAC) model for BugSpotter.
It is the authoritative reference for what each role can and cannot do.

## Role Hierarchy

BugSpotter uses a unified role system centered on organization membership,
with a separate platform admin flag for SaaS operator access.

### 1. Platform Admin

Platform admins are identified by the `security.is_platform_admin` flag in the
`users` table (JSONB column). This replaces the old `role = 'admin'` check.

| Check                   | Source                             | Description                                                   |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------- |
| `isPlatformAdmin(user)` | `users.security.is_platform_admin` | Full system access — bypasses all project and org role checks |

The `isPlatformAdmin()` helper (backend and frontend) checks `security.is_platform_admin`
first, with a legacy fallback to `role === 'admin'` for backward compatibility.

### 2. Organization Roles

Assigned per-organization via membership. This is the primary role for non-admin users.

| Role     | Description                               |
| -------- | ----------------------------------------- |
| `owner`  | Can manage org settings, members, billing |
| `admin`  | Can manage invitations                    |
| `member` | Basic org membership                      |

### 3. Project Roles

Assigned per-project via membership. Uses a numeric hierarchy for permission checks.
Org owners/admins inherit project `admin` role; org members inherit project `viewer`.

| Role     | Level | Description                              |
| -------- | ----- | ---------------------------------------- |
| `owner`  | 4     | Full project control, can delete project |
| `admin`  | 3     | Can manage integrations, rules, members  |
| `member` | 2     | Can upload reports, create API keys      |
| `viewer` | 1     | Read-only access to project data         |

**Platform admins bypass all project and org role checks.**

---

## Permission Matrix

### System-Level Actions

| Action                  | Required Role               | Backend Middleware         |
| ----------------------- | --------------------------- | -------------------------- |
| System settings         | Platform admin              | `requirePlatformAdmin()`   |
| User management (CRUD)  | Platform admin              | `requirePlatformAdmin()`   |
| Notification templates  | Platform admin              | `requirePlatformAdmin()`   |
| Audit logs              | Platform admin or org admin | `requireAuditAccess()`     |
| Background jobs         | Platform admin              | `requirePlatformAdmin()`   |
| Platform org management | Platform admin              | `requirePlatformAdmin()`   |
| Analytics (global)      | Platform admin              | `requireAnalyticsAccess()` |
| Cache management        | Platform admin              | `requirePlatformAdmin()`   |

### Organization-Level Actions

| Action              | Required Role | Backend Middleware                  |
| ------------------- | ------------- | ----------------------------------- |
| View org dashboard  | Org member    | `requireOrgAccess(db)`              |
| View org usage      | Org member    | `requireOrgAccess(db)`              |
| Update org settings | Org `owner`   | `requireOrgRole(db, 'owner')`       |
| Manage members      | Org `owner`   | `requireOrgRole(db, 'owner')`       |
| Manage invitations  | Org `admin+`  | `requireOrgRole(db, 'admin')`       |
| Billing             | Org `owner`   | `requireTenantOrgRole(db, 'owner')` |
| Org analytics       | Org `admin+`  | `requireOrgRole(db, 'admin')`       |

### Project Lifecycle

| Action             | Required Role                       | Backend Middleware                                                         |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------- |
| List projects      | Any authenticated user              | `requireUser`                                                              |
| **Create project** | Any authenticated user (not viewer) | `requireUser` + inline viewer check                                        |
| View project       | Project `viewer+`                   | `requireUser` + `requireProjectAccess(db)`                                 |
| **Update project** | Project `admin+`                    | `requireUser` + `requireProjectAccess(db)` + `requireProjectRole('admin')` |
| **Delete project** | Project `owner` or platform admin   | `requireUser` + `requireProjectAccess(db)` + `requireProjectRole('owner')` |

### Bug Reports

| Action            | Required Role    | Backend Enforcement                              |
| ----------------- | ---------------- | ------------------------------------------------ |
| Create report     | API key holder   | `requireProject` + `requireQuota()`              |
| List reports      | Project access   | Access filters in handler                        |
| View report       | Project access   | `findReportWithAccess()`                         |
| Update report     | Project access   | `findReportWithAccess()`                         |
| **Delete report** | Project `admin+` | `findReportWithAccess(... , 'admin')`            |
| **Bulk delete**   | Project `admin+` | `findReportWithAccess(... , 'admin')` per report |

### API Keys

| Action         | Required Role                                     | Backend Enforcement                       |
| -------------- | ------------------------------------------------- | ----------------------------------------- |
| **Create key** | Project `admin+` (explicit or inherited from org) | `requireUser` + inline role check         |
| List keys      | Any authenticated user (own keys)                 | `requireUser` (non-admin sees own only)   |
| View key       | Key owner or platform admin                       | `requireUser` + `authorizeApiKeyAccess()` |
| Update key     | Key owner or platform admin                       | `requireUser` + `authorizeApiKeyAccess()` |
| **Delete key** | Any authenticated user (not viewer)               | `requireUser` + inline viewer check       |
| Revoke key     | Key owner or platform admin                       | `requireUser` + `authorizeApiKeyAccess()` |
| Rotate key     | Key owner or platform admin                       | `requireUser` + `authorizeApiKeyAccess()` |

### Integration Management

| Action                | Required Role     | Backend Enforcement                                                                                  |
| --------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| View config           | Project `viewer+` | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})`                                 |
| Configure integration | Project `admin+`  | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})` + `requireProjectRole('admin')` |
| Toggle integration    | Project `admin+`  | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})` + `requireProjectRole('admin')` |
| Delete integration    | Project `admin+`  | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})` + `requireProjectRole('admin')` |
| Search users          | Project `viewer+` | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})`                                 |
| Test integration      | Any authenticated | Handler checks auth                                                                                  |

### Integration Rules

| Action      | Required Role                       | Backend Enforcement                                                                                  |
| ----------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| List rules  | Project `viewer+`                   | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})`                                 |
| Create rule | Project `admin+`                    | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})` + `requireProjectRole('admin')` |
| Update rule | Project `admin+`                    | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})` + `requireProjectRole('admin')` |
| Delete rule | Project `admin+`                    | `requireAuth` + `requireProjectAccess(db, {paramName: 'projectId'})` + `requireProjectRole('admin')` |
| Copy rule   | Source: `viewer+`, Target: `admin+` | Middleware for source + inline `checkProjectAccess()` for target                                     |

### Project Members

| Action            | Required Role     | Backend Middleware                                                         |
| ----------------- | ----------------- | -------------------------------------------------------------------------- |
| List members      | Project `viewer+` | `requireUser` + `requireProjectAccess(db)`                                 |
| **Add member**    | Project `admin+`  | `requireUser` + `requireProjectAccess(db)` + `requireProjectRole('admin')` |
| **Update role**   | Project `admin+`  | `requireUser` + `requireProjectAccess(db)` + `requireProjectRole('admin')` |
| **Remove member** | Project `admin+`  | `requireUser` + `requireProjectAccess(db)` + `requireProjectRole('admin')` |

---

## Permissions API

### `GET /api/v1/me/permissions`

Centralized permission resolution endpoint. Returns computed permissions for the
authenticated user, scoped by optional `projectId` and `organizationId` query params.

**This is the single source of truth** for permission checks. Frontend hooks fetch
from this endpoint instead of re-deriving permissions client-side.

```json
{
  "system": { "role": "user", "isAdmin": true },
  "project": {
    "role": "admin",
    "canManageIntegrations": true,
    "canEditProject": true,
    "canDeleteProject": false,
    "canManageMembers": true,
    "canDeleteReports": true,
    "canUpload": true,
    "canView": true
  },
  "organization": {
    "role": "owner",
    "canManageMembers": true,
    "canManageInvitations": true,
    "canManageBilling": true
  }
}
```

---

## Frontend Gating

Frontend permission checks are a **UX convenience**, not a security boundary.
The backend always enforces permissions regardless of frontend state.

### Permission Hooks

Both hooks fetch from `GET /api/v1/me/permissions` as the single source of truth.
`isSystemAdmin` is derived from the backend response, with `isPlatformAdmin(user)`
as a fallback before the permissions query resolves.

| Hook                      | Returns                                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `useProjectPermissions()` | `canManageIntegrations`, `canEditProject`, `canDeleteProject`, `canManageMembers`, `canDeleteReports`, `canUpload`, `canView`, `isSystemAdmin` |
| `useOrgPermissions()`     | `canManageMembers`, `canManageInvitations`, `canManageBilling`                                                                                 |
| `isPlatformAdmin(user)`   | Checks `security.is_platform_admin` with legacy `role` fallback                                                                                |

### Page-Level Gating

| Page                 | Gated Actions                                                            |
| -------------------- | ------------------------------------------------------------------------ |
| Projects             | Create button disabled for viewers; Delete disabled for viewers          |
| Bug Reports          | Delete button disabled for viewers (readOnly prop)                       |
| API Keys             | Create button disabled for viewers; Revoke/rotate disabled for viewers   |
| Project Members      | Add/change-role/remove disabled if not `canManageMembers`                |
| Project Integrations | Add integration disabled if not `canManageIntegrations`                  |
| Integration Rules    | Create disabled; edit opens read-only form; toggle/copy/delete disabled  |
| Integration Config   | Save/test/delete disabled if not `canManageIntegrations`                 |
| Org Members          | Add/remove gated by `canManageMembers`; Invite by `canManageInvitations` |
| Org Billing          | Upgrade/cancel gated by `canManageBilling`                               |
| Notifications        | New channel/rule disabled if not platform admin                          |

---

## Key Middleware

| Middleware                   | Location                           | Purpose                                                                    |
| ---------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| `requireUser`                | `middleware/auth/authorization.ts` | Requires JWT authentication                                                |
| `requirePlatformAdmin()`     | `middleware/auth/authorization.ts` | Requires platform admin (`security.is_platform_admin`)                     |
| `requireProjectAccess(db)`   | `middleware/project-access.ts`     | Validates project exists + user has access; attaches `request.projectRole` |
| `requireProjectRole(min)`    | `middleware/auth/authorization.ts` | Requires minimum project role in hierarchy; platform admins bypass         |
| `requireOrgAccess(db)`       | `middleware/org-access.ts`         | Validates org membership                                                   |
| `requireOrgRole(db, min)`    | `middleware/org-access.ts`         | Requires minimum org role                                                  |
| `requireAuth`                | `middleware/auth/authorization.ts` | Any auth method (JWT or API key)                                           |
| `requireProject`             | `middleware/auth/authorization.ts` | Requires project-scoped API key                                            |
| `isPlatformAdmin(req\|user)` | `middleware/auth/assertions.ts`    | Check if user is platform admin (helper, not middleware)                   |

---

## Role Summary by Persona

### Platform Admin

- Full access to everything
- Bypasses all project and org role checks
- Can manage users, settings, notifications, audit logs
- Identified by `security.is_platform_admin = true`

### Organization Owner

- Can manage org settings, members, billing
- Inherits project `admin` role for all projects in the org
- Can create API keys for org projects (via inheritance)

### Organization Admin

- Can manage org invitations
- Inherits project `admin` role for all projects in the org

### Organization Member

- Basic org membership
- Inherits project `viewer` role for org projects

### Project Owner

- Full project control, can delete project
- Can manage integrations, rules, members

### Project Admin

- Can manage integrations and rules
- Can add/remove/update project members
- Can delete bug reports, create API keys

### Project Member

- Can upload bug reports, update status
- Can create API keys for this project

### Project Viewer

- Read-only access to project data
- Cannot modify anything

---

## Test Coverage

- **Platform admin tests**: `tests/api/middleware/platform-admin.test.ts` — isPlatformAdmin + requirePlatformAdmin
- **Backend middleware tests**: `tests/api/middleware/require-project-role.test.ts` — 27 tests (includes API key bypass)
- **Backend RBAC matrix**: `tests/api/routes/rbac-enforcement.test.ts` — 60 tests (full permission matrix)
- **Backend permissions endpoint**: `tests/api/routes/permissions.test.ts` — 17 tests (system/project/org permissions)
- **JWT payload**: `tests/api/auth-jwt-payload.test.ts` — 12 tests (validateJwtPayload with isPlatformAdmin)
- **API key org inheritance**: `tests/api/api-key-org-inheritance.test.ts` — 16 tests (org role → project role)
- **Frontend isPlatformAdmin**: `apps/admin/src/tests/utils/is-platform-admin.test.ts` — 9 tests
- **Frontend UI gating**: `apps/admin/src/tests/components/rbac-ui-gating.test.tsx` — 7 tests
- **Existing middleware tests**: `tests/api/middleware/authorization.test.ts` — 29 tests
