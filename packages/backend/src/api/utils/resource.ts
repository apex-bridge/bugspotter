/**
 * Resource utilities
 * Common resource operations and checks
 */

import { AppError } from '../middleware/error.js';
import { isPlatformAdmin } from '../middleware/auth.js';
import type { User, Project, ApiKey, OrgMemberRole } from '../../db/types.js';
import type { DatabaseClient } from '../../db/client.js';
import type { ProjectRole } from '../../types/project-roles.js';
import {
  hasPermissionLevel,
  isProjectRole,
  getInheritedProjectRole,
} from '../../types/project-roles.js';
import { checkProjectPermission } from '../../services/api-key/key-permissions.js';

/**
 * Look up inherited project role from org membership.
 * Maps the user's org membership role via shared getInheritedProjectRole.
 * Returns null if no inheritance applies (project has no org, or user is
 * not an org member).
 *
 * Callers that already have the project's `organization_id` in hand
 * SHOULD pass it as the optional fourth argument — this skips a
 * `db.projects.findById` round-trip. Hot paths like `requireProjectAccess`
 * fetch the project for their own use a few lines earlier; without the
 * override this helper would re-fetch on every JWT-authenticated request.
 */
export async function lookupInheritedProjectRole(
  projectId: string,
  userId: string,
  db: DatabaseClient,
  organizationId?: string | null
): Promise<ProjectRole | null> {
  let orgId: string | null | undefined = organizationId;
  if (orgId === undefined) {
    const project = await db.projects.findById(projectId);
    orgId = project?.organization_id ?? null;
  }
  if (!orgId) {
    return null;
  }

  const { membership } = await db.organizationMembers.checkOrganizationAccess(orgId, userId);
  if (!membership) {
    return null;
  }

  return getInheritedProjectRole(membership.role as OrgMemberRole);
}

/**
 * Find a resource or throw 404 error
 */
export async function findOrThrow<T>(
  findFn: () => Promise<T | null>,
  resourceName: string
): Promise<T> {
  const resource = await findFn();

  if (!resource) {
    throw new AppError(`${resourceName} not found`, 404, 'NotFound');
  }

  return resource;
}

/**
 * Check if user has permission to perform an action on a resource
 * Uses the permissions table for fine-grained access control
 */
export async function checkPermission(
  authUser: User | undefined,
  resource: string,
  action: string,
  db: DatabaseClient
): Promise<void> {
  if (!authUser) {
    throw new AppError('Authentication required', 401, 'Unauthorized');
  }

  // Platform admins always have permission
  if (isPlatformAdmin(authUser)) {
    return;
  }

  // Check permission in database
  const hasPermission = await db.query(
    'SELECT 1 FROM permissions WHERE role = $1 AND resource = $2 AND action = $3',
    [authUser.role, resource, action]
  );

  if (hasPermission.rows.length === 0) {
    throw new AppError(`Insufficient permissions to ${action} ${resource}`, 403, 'Forbidden');
  }
}

/**
 * Check if user has access to a project resource
 * For JWT authenticated users, verifies project ownership or membership
 * For API keys with allowed_projects, verifies project is in the allowed list
 * For full-scope API keys (null/empty allowed_projects), grants unrestricted access
 * Optionally checks permissions for specific resource/action
 * Optionally enforces a minimum project role (e.g., 'admin' for config changes)
 *
 * **Authentication branch order** (within this function): the first matching
 * branch returns and the rest are skipped.
 *
 *   1. `options.apiKey && !authUser` — API-key-only request (full-scope or
 *      multi-project). Validated against `checkProjectPermission` only.
 *      **`options.minProjectRole` is NOT enforced on this branch** — API
 *      keys authenticate as a machine, not a project member, so callers
 *      that pass `minProjectRole: 'admin'` (or similar) are NOT given that
 *      gate against API-key auth. If the route needs admin-level
 *      enforcement against API keys, either reject API-key auth at the
 *      preHandler or add a separate explicit check. Same applies to
 *      `options.resource` / `options.action` (system-permission check) —
 *      those run only on the JWT branch.
 *   2. `authProject` — project-scoped (single-project) API key. Project must
 *      match. `minProjectRole` also bypassed (same reason).
 *   3. `authUser` — JWT path. Platform admin bypass first; otherwise checks
 *      explicit/inherited project role + optional `resource:action`
 *      permission. This is the ONLY branch that honours
 *      `options.minProjectRole`.
 *
 * **Important caveat**: `request.authUser` is set ONLY by the JWT auth
 * handler (`handleJwtAuth`). The auth middleware (`auth/middleware.ts:54-76`)
 * tries the `x-api-key` header first and short-circuits as soon as the
 * key validates — JWT is only consulted when no API-key header is present.
 * So a request that arrives with BOTH headers reaches this function with
 * `authUser = undefined` and `apiKey` populated, meaning branch (1) above
 * runs and any JWT-based restrictions are NOT enforced. The "JWT takes
 * highest priority" wording that previously sat in this docstring was
 * aspirational — the middleware ordering makes it unreachable in practice.
 *
 * That's not currently a privilege-escalation surface: a leaked full-scope
 * API key alone already grants the same access an attacker would get by
 * also presenting a JWT, so adding the JWT yields nothing extra. But if
 * any future caller relies on "user restrictions still apply when both
 * are present", they need to authenticate JWT-only or change the auth
 * middleware to populate `authUser` even when an API key is also present.
 */
export async function checkProjectAccess(
  projectId: string,
  authUser: User | undefined,
  authProject: Project | undefined,
  db: DatabaseClient,
  resourceName: string = 'Resource',
  options?: {
    /** Resource name for permission check (e.g., 'integration_rules') */
    resource?: string;
    /** Action for permission check (e.g., 'read', 'create', 'update', 'delete') */
    action?: string;
    /** Full-scope API key (for routes using requireAuth instead of requireProjectAccess middleware) */
    apiKey?: ApiKey;
    /** Minimum project role required (e.g., 'admin' for config, 'member' for data). API keys bypass this. */
    minProjectRole?: ProjectRole;
  }
): Promise<void> {
  // API key authentication without JWT user — verify project permission via API key rules
  // This handles both full-scope keys and multi-project keys
  // (Single-project keys set authProject and skip this branch)
  // Note: API keys bypass minProjectRole — they authenticate as a machine, not a project member
  if (options?.apiKey && !authUser) {
    const permission = checkProjectPermission(options.apiKey, projectId);
    if (!permission.allowed) {
      throw new AppError(`Access denied to ${resourceName}`, 403, 'Forbidden');
    }
    // If authProject is set (single-project key), verify it matches
    if (authProject && authProject.id !== projectId) {
      throw new AppError(`Access denied to ${resourceName}`, 403, 'Forbidden');
    }
    return;
  }

  // Project-scoped API key authentication - project must match
  // Note: API keys bypass minProjectRole
  if (authProject) {
    if (authProject.id !== projectId) {
      throw new AppError(`Access denied to ${resourceName}`, 403, 'Forbidden');
    }
    return;
  }

  // JWT authentication - check user access
  // This takes precedence over full-scope API keys to prevent privilege escalation
  if (authUser) {
    // Platform admins have access to everything
    if (isPlatformAdmin(authUser)) {
      return;
    }

    // If resource and action specified, check system-level permissions first
    if (options?.resource && options?.action) {
      await checkPermission(authUser, options.resource, options.action, db);
    }

    // If minProjectRole specified, check effective role = max(explicit, inherited)
    if (options?.minProjectRole) {
      const explicitRole = await db.projects.getUserRole(projectId, authUser.id);
      const inheritedRole = await lookupInheritedProjectRole(projectId, authUser.id, db);

      // Pick the higher of explicit and inherited
      let effectiveRole: ProjectRole | null = null;
      const explicit = explicitRole && isProjectRole(explicitRole) ? explicitRole : null;
      if (explicit && inheritedRole) {
        effectiveRole = hasPermissionLevel(explicit, inheritedRole) ? explicit : inheritedRole;
      } else {
        effectiveRole = explicit ?? inheritedRole;
      }

      if (!effectiveRole) {
        throw new AppError(`Access denied to ${resourceName}`, 403, 'Forbidden');
      }
      if (!hasPermissionLevel(effectiveRole, options.minProjectRole)) {
        throw new AppError(
          `Insufficient project role for ${resourceName}. Requires ${options.minProjectRole} or above.`,
          403,
          'Forbidden'
        );
      }
      return;
    }

    // Fallback: check boolean membership (backward compatible)
    const hasAccess = await db.projects.hasAccess(projectId, authUser.id);
    if (!hasAccess) {
      // Check org inheritance as fallback
      const inheritedRole = await lookupInheritedProjectRole(projectId, authUser.id, db);
      if (!inheritedRole) {
        throw new AppError(`Access denied to ${resourceName}`, 403, 'Forbidden');
      }
    }
    return;
  }

  // No authentication provided
  throw new AppError('Authentication required', 401, 'Unauthorized');
}

/**
 * Remove sensitive fields from an object
 */
export function omitFields<T, K extends keyof T>(obj: T, ...fields: K[]): Omit<T, K> {
  const result = { ...obj } as T;
  for (const field of fields) {
    delete (result as Record<string, unknown>)[field as string];
  }
  return result as Omit<T, K>;
}
