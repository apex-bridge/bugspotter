/**
 * Authorization middleware functions
 * Role-based and permission-based access control
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ProjectRole } from '../../../types/project-roles.js';
import type { DatabaseClient } from '../../../db/client.js';
import { hasPermissionLevel } from '../../../types/project-roles.js';
import { sendUnauthorized, sendForbidden } from './responses.js';
import { isPlatformAdmin } from './assertions.js';
import { checkPermission as checkApiKeyPermission } from '../../../services/api-key/key-permissions.js';

/**
 * Role-based authorization middleware factory
 * Requires JWT authentication and checks user role
 * @deprecated Use requirePlatformAdmin() or org-level checks instead
 */
export function requireRole(...allowedRoles: Array<'admin' | 'user' | 'viewer'>) {
  return async function roleMiddleware(request: FastifyRequest, reply: FastifyReply) {
    if (!request.authUser) {
      return sendUnauthorized(reply, 'User authentication required');
    }

    if (!allowedRoles.includes(request.authUser.role)) {
      return sendForbidden(
        reply,
        `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}`
      );
    }
  };
}

/**
 * Platform admin authorization middleware.
 * Checks security.is_platform_admin (with legacy role fallback).
 * Use this for SaaS-operator-only routes (system health, global user mgmt, etc.)
 */
export function requirePlatformAdmin() {
  return async function platformAdminMiddleware(request: FastifyRequest, reply: FastifyReply) {
    if (!request.authUser) {
      return sendUnauthorized(reply, 'User authentication required');
    }

    if (!isPlatformAdmin(request)) {
      return sendForbidden(reply, 'Platform admin access required');
    }
  };
}

/**
 * Require project authentication (API key)
 * Supports both legacy project API keys and new API keys with allowed_projects
 */
export async function requireProject(request: FastifyRequest, reply: FastifyReply) {
  // Check legacy project authentication
  if (request.authProject) {
    return;
  }

  // Check new API key system with allowed_projects
  if (
    request.apiKey &&
    request.apiKey.allowed_projects &&
    request.apiKey.allowed_projects.length > 0
  ) {
    return;
  }

  // No project access
  return sendUnauthorized(reply, 'Project API key required (X-API-Key header)');
}

/**
 * Require user authentication (JWT)
 */
export async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  if (!request.authUser) {
    return sendUnauthorized(reply, 'User authentication required (Authorization Bearer token)');
  }
}

/**
 * Require API key authentication (not user JWT)
 */
export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  if (!request.apiKey) {
    return sendUnauthorized(reply, 'API key required (X-API-Key header)');
  }
}

/**
 * Enforce a specific permission on the authenticating API key.
 *
 * The key's `permissions` array is the source of truth for what an API key
 * can do. Before this middleware existed, the array was stored at key
 * creation time but never consulted at route-enforcement time — so a key
 * created with `permissions: ['reports:write']` could still perform reads
 * on any route it reached via `requireProject`/`requireAuth`. That made the
 * "ingest-only" property of self-service-signup-issued keys purely
 * advisory.
 *
 * This middleware delegates to the shared `checkPermission` in
 * `services/api-key/key-permissions.ts` so that enforcement rules match
 * what the ApiKeyService uses when creating/verifying keys — including:
 *   - The `'*'` wildcard (used by `full`-scope keys)
 *   - Defensive fallback: if `permissions` is empty but a non-custom
 *     `permission_scope` is set, resolve scope → permissions on the fly
 *     (handles pre-migration keys and cached keys fetched before the
 *     permissions-backfill migration ran).
 *
 * Behavior:
 * - **User (JWT) requests** pass through. System-role permission checks
 *   are handled separately by `requirePermission(db, resource, action)`;
 *   this middleware is an API-key-specific gate and must not double-block
 *   JWT users.
 * - **API-key requests** go through the shared `checkPermission`. A `full`
 *   scope (which resolves to `['*']`) satisfies every permission. A key
 *   missing the required permission → 403 Forbidden.
 * - **Unauthenticated requests** → 401 Unauthorized. This middleware
 *   is safe to use standalone on a route (it will fail closed rather
 *   than leak), but composing it after `requireAuth` or `requireProject`
 *   yields a clearer error message — the auth layer's 401 explains
 *   what's missing, where this middleware's 401 is more generic.
 *
 * Usage (on a route handler):
 *
 * ```ts
 * // Standalone — safe, gives a generic 401 when unauthenticated
 * fastify.get('/api/v1/reports', {
 *   preHandler: [requireApiKeyPermission('reports:read')],
 * });
 *
 * // Composed — preferred when the route already requires a specific
 * // auth mode; the outer middleware's 401 is more informative
 * fastify.post('/api/v1/reports', {
 *   preHandler: [requireProject, requireApiKeyPermission('reports:write')],
 * });
 * ```
 */
export function requireApiKeyPermission(permission: string) {
  return async function apiKeyPermissionMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // User (JWT) — bypass. Their permissions are checked via requirePermission.
    if (request.authUser) {
      return;
    }

    // Order matters: the API-key check MUST run before any `authProject`
    // fallback below.
    //
    // `handlers.ts:98` sets `request.authProject` alongside
    // `request.apiKey` (line 91) whenever a modern API key has
    // `allowed_projects.length === 1`. That includes the self-service-
    // signup-issued ingest-only key this middleware was written to
    // constrain. If an `authProject` check ran first, the signup key
    // would short-circuit past the permission gate and regain the
    // unrestricted read access this middleware was introduced to
    // remove. Running the `apiKey` check first means the 403 lands
    // before the fallback is reached.
    if (request.apiKey) {
      const result = checkApiKeyPermission(request.apiKey, permission);
      if (result.allowed) {
        return;
      }
      return sendForbidden(
        reply,
        result.reason ?? `API key does not have the required permission: ${permission}`
      );
    }

    // Defensive fallback: a request that carries `authProject` but no
    // `apiKey` doesn't exist in this codebase today (the only assignment
    // site always sets both). This branch matches how every sibling
    // `require*` middleware in this file treats `authProject` — as a
    // first-class auth mode — so if a future auth handler ever attaches
    // `authProject` without an `apiKey` (e.g. a project-scoped share-
    // token flow), the permissions middleware stays consistent with the
    // rest of the auth chain.
    if (request.authProject) {
      return;
    }

    return sendUnauthorized(reply, 'Authentication required');
  };
}

/**
 * Require any authentication (API key OR JWT user)
 * Use this for routes that should work with both SDK clients and dashboard users.
 * Full-scope API keys (no allowed_projects restriction) are accepted — project-level
 * access is enforced downstream by requireProjectAccess middleware.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (request.authProject || request.apiKey || request.authUser) {
    return;
  }

  // No valid authentication
  return sendUnauthorized(
    reply,
    'Authentication required (X-API-Key header or Authorization Bearer token)'
  );
}

/**
 * Project role-based authorization middleware factory.
 * Must be used AFTER requireProjectAccess in the preHandler chain.
 *
 * - System admins bypass the project role check.
 * - API key requests (no authUser) bypass the role check — API keys authenticate
 *   as machines, not project members. Project-level access is already validated
 *   by requireProjectAccess middleware.
 *
 * @param minRole - Minimum project role required (uses role hierarchy: owner > admin > member > viewer)
 *
 * @example
 * ```typescript
 * // JWT-only route
 * fastify.delete('/api/v1/projects/:id', {
 *   preHandler: [requireUser, requireProjectAccess(db), requireProjectRole('owner')],
 * }, handler);
 *
 * // Route accepting both JWT and API keys
 * fastify.post('/api/v1/integrations/:platform/:projectId', {
 *   preHandler: [requireAuth, requireProjectAccess(db, { paramName: 'projectId' }), requireProjectRole('admin')],
 * }, handler);
 * ```
 */
/**
 * System-level permission check middleware factory.
 * Queries the `permissions` table to verify the user's system role is allowed
 * to perform the given action on the given resource.
 *
 * - System admins always pass (bypass).
 * - API key requests (no authUser) bypass the check — API keys are machine
 *   credentials and don't have system roles.
 * - Must be used AFTER an auth middleware (requireUser or requireAuth).
 *
 * @param db - Database client for querying the permissions table
 * @param resource - Resource name (e.g., 'integration_rules')
 * @param action - Action name (e.g., 'create', 'read', 'update', 'delete')
 */
export function requirePermission(db: DatabaseClient, resource: string, action: string) {
  return async function permissionMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // API key requests bypass system permission checks — API keys are machine
    // credentials, not system users. Their access is validated by requireProjectAccess.
    if (!request.authUser && (request.authProject || request.apiKey)) {
      return;
    }

    if (!request.authUser) {
      return sendUnauthorized(reply, 'User authentication required');
    }

    // Platform admins always have permission
    if (isPlatformAdmin(request)) {
      return;
    }

    // Check permission in database
    const hasPermission = await db.query(
      'SELECT 1 FROM permissions WHERE role = $1 AND resource = $2 AND action = $3',
      [request.authUser.role, resource, action]
    );

    if (hasPermission.rows.length === 0) {
      return sendForbidden(reply, `Insufficient permissions to ${action} ${resource}`);
    }
  };
}

export function requireProjectRole(minRole: ProjectRole) {
  return async function projectRoleMiddleware(request: FastifyRequest, reply: FastifyReply) {
    // API key requests bypass project role checks — API keys are machine credentials,
    // not project members. Their project access is validated by requireProjectAccess.
    // This matches the existing behavior in checkProjectAccess() where API keys bypass minProjectRole.
    if (!request.authUser && (request.authProject || request.apiKey)) {
      return;
    }

    if (!request.authUser) {
      return sendUnauthorized(reply, 'User authentication required');
    }

    // Platform admins bypass project role checks
    if (isPlatformAdmin(request)) {
      return;
    }

    // projectRole is set by requireProjectAccess middleware
    if (!request.projectRole) {
      return sendForbidden(reply, 'You do not have a role in this project');
    }

    if (!hasPermissionLevel(request.projectRole, minRole)) {
      return sendForbidden(
        reply,
        `Insufficient project permissions. Required: ${minRole} or higher`
      );
    }
  };
}
