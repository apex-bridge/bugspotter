/**
 * Authorization Utilities
 * Reusable helpers for project-level authorization checks
 */

import type { DatabaseClient } from '../../db/client.js';
import { AppError } from '../middleware/error.js';
import type { ProjectRole } from '../../types/project-roles.js';
import { ASSIGNABLE_PROJECT_ROLES, isProjectRole } from '../../types/project-roles.js';

// Re-export for backward compatibility
export type { ProjectRole } from '../../types/project-roles.js';

/**
 * Project role hierarchy for authorization checks
 */
const ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
} as const;

/**
 * Require user to have minimum project role
 *
 * @param projectId - Project ID to check access for
 * @param userId - User ID to check
 * @param db - Database client
 * @param minRole - Minimum required role (default: 'admin')
 * @param customMessage - Optional custom error message
 * @param cachedRole - Optional pre-fetched role from middleware (avoids DB query)
 * @returns User's actual role (for further checks if needed)
 * @throws AppError (403) if user doesn't have required role
 *
 * @example
 * ```typescript
 * // Require admin or owner (will query database)
 * await requireProjectRole(projectId, userId, db, 'admin');
 *
 * // Use cached role from middleware (no DB query)
 * await requireProjectRole(projectId, userId, db, 'owner', undefined, request.projectRole);
 * ```
 */
export async function requireProjectRole(
  projectId: string,
  userId: string,
  db: DatabaseClient,
  minRole: ProjectRole = 'admin',
  customMessage?: string,
  cachedRole?: ProjectRole | null
): Promise<ProjectRole> {
  // Use cached role if available, otherwise query database
  const rawRole = cachedRole ?? (await db.projects.getUserRole(projectId, userId));

  // Check if user has no role (not a member)
  if (!rawRole) {
    const message =
      customMessage ||
      `Only project ${minRole}s${minRole === 'owner' ? '' : ' and above'} can perform this action`;
    throw new AppError(message, 403, 'Forbidden');
  }

  // Validate role is a valid ProjectRole (security check)
  if (!isProjectRole(rawRole)) {
    // This should never happen in production if database constraints are correct,
    // but we check defensively to prevent security bypasses
    throw new AppError('Access denied: Invalid project role', 403, 'Forbidden');
  }

  // Now TypeScript knows rawRole is a valid ProjectRole
  const role: ProjectRole = rawRole;

  // Check if role meets minimum requirement
  if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minRole]) {
    const message =
      customMessage ||
      `Only project ${minRole}s${minRole === 'owner' ? '' : ' and above'} can perform this action`;
    throw new AppError(message, 403, 'Forbidden');
  }

  return role;
}

/**
 * Check if user can modify a project member
 * Enforces business rules:
 * - Only admins/owners can modify members
 * - Cannot modify project owner
 * - Only owners can modify admin roles
 * - Cannot modify your own role
 *
 * @param params - Validation parameters
 * @throws AppError if modification is not allowed
 */
export async function validateMemberModification(params: {
  projectId: string;
  targetUserId: string;
  requesterId: string;
  db: DatabaseClient;
  project: { created_by: string | null };
  operation: 'update' | 'remove';
  newRole?: string;
  cachedRole?: ProjectRole | null;
}): Promise<{ requesterRole: ProjectRole; currentMemberRole?: ProjectRole }> {
  const { projectId, targetUserId, requesterId, db, project, operation, newRole, cachedRole } =
    params;

  // 1. Verify requester has admin or owner role
  const requesterRole = await requireProjectRole(
    projectId,
    requesterId,
    db,
    'admin',
    `Only project owners and admins can ${operation} members`,
    cachedRole
  );

  // 2. Cannot modify project owner
  if (targetUserId === project.created_by) {
    throw new AppError(
      operation === 'update' ? 'Cannot change owner role' : 'Cannot remove project owner',
      403,
      'Forbidden'
    );
  }

  // 3. Get current member (will be null if not a member)
  const member = await db.projectMembers.getMemberByUserId(projectId, targetUserId);
  if (!member) {
    throw new AppError('User is not a member of this project', 404, 'NotFound');
  }

  const currentMemberRole = member.role as ProjectRole;

  // 4. Cannot modify your own role (check this before admin checks)
  if (targetUserId === requesterId) {
    throw new AppError(
      operation === 'update'
        ? 'Cannot change your own role'
        : 'Cannot remove yourself from the project',
      403,
      'Forbidden'
    );
  }

  // 5. Only owners can modify admin roles
  if (currentMemberRole === 'admin' && requesterRole !== 'owner') {
    throw new AppError(
      operation === 'update'
        ? 'Only project owners can change admin roles'
        : 'Only project owners can remove admins',
      403,
      'Forbidden'
    );
  }

  // 6. For updates: only owners can promote to admin
  if (operation === 'update' && newRole === 'admin' && requesterRole !== 'owner') {
    throw new AppError('Only project owners can promote users to admin', 403, 'Forbidden');
  }

  return { requesterRole, currentMemberRole };
}

/**
 * Validate role is a valid assignable project role (excludes owner)
 *
 * @param role - Role to validate
 * @throws AppError (400) if role is invalid or not assignable
 */
export function validateRole(role: string): asserts role is Exclude<ProjectRole, 'owner'> {
  if (!ASSIGNABLE_PROJECT_ROLES.includes(role as (typeof ASSIGNABLE_PROJECT_ROLES)[number])) {
    throw new AppError(
      `Invalid role. Must be one of: ${ASSIGNABLE_PROJECT_ROLES.join(', ')}`,
      400,
      'BadRequest'
    );
  }
}
