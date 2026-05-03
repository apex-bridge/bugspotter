/**
 * Project Role Types and Guards
 * Type safety utilities for project roles
 */

import { AppError } from '../api/middleware/error.js';
import type { OrgMemberRole } from '../db/types.js';

// ============================================================================
// TYPES
// ============================================================================

export type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * Array of all valid project roles (includes owner for type checking and hierarchy)
 */
export const ALL_PROJECT_ROLES: readonly ProjectRole[] = [
  'owner',
  'admin',
  'member',
  'viewer',
] as const;

/**
 * Array of assignable project roles (excludes owner, which is determined by created_by)
 */
export const ASSIGNABLE_PROJECT_ROLES: readonly Exclude<ProjectRole, 'owner'>[] = [
  'admin',
  'member',
  'viewer',
] as const;

/**
 * Legacy alias for backward compatibility - includes all roles
 * @deprecated Use ALL_PROJECT_ROLES or ASSIGNABLE_PROJECT_ROLES for semantic clarity
 */
export const PROJECT_ROLES = ALL_PROJECT_ROLES;

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if a value is a valid ProjectRole
 */
export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && PROJECT_ROLES.includes(value as ProjectRole);
}

/**
 * Assert that a value is a valid ProjectRole
 * Throws AppError if validation fails
 */
export function assertProjectRole(role: string): asserts role is ProjectRole {
  if (!isProjectRole(role)) {
    throw new AppError(
      `Invalid role: ${role}. Must be one of: ${PROJECT_ROLES.join(', ')}`,
      400,
      'BadRequest'
    );
  }
}

/**
 * Validate and return a ProjectRole
 * Throws AppError if validation fails
 */
export function validateProjectRole(role: string): ProjectRole {
  assertProjectRole(role);
  return role;
}

// ============================================================================
// ROLE HIERARCHY
// ============================================================================

/**
 * Role hierarchy levels (higher = more permissions)
 */
const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
} as const;

/**
 * Check if a role has sufficient permissions (equal or higher in hierarchy)
 */
export function hasPermissionLevel(userRole: ProjectRole, requiredRole: ProjectRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Check if a role can modify another role
 * Rules:
 * - Owners can modify anyone except themselves
 * - Admins can modify members and viewers
 * - Members and viewers cannot modify anyone
 */
export function canModifyRole(modifierRole: ProjectRole, targetRole: ProjectRole): boolean {
  if (modifierRole === 'owner') {
    return true; // Owners can modify anyone
  }

  if (modifierRole === 'admin') {
    return targetRole === 'member' || targetRole === 'viewer';
  }

  return false; // Members and viewers cannot modify anyone
}

// ============================================================================
// ORG-TO-PROJECT INHERITANCE
// ============================================================================

/**
 * Canonical mapping: org role → inherited project role.
 * This is THE single source of truth for inheritance.
 */
export const ORG_TO_PROJECT_ROLE: Record<OrgMemberRole, ProjectRole> = {
  owner: 'admin',
  admin: 'admin',
  member: 'viewer',
};

/**
 * Get the project role inherited from an org membership.
 * Pure function, no DB access.
 */
export function getInheritedProjectRole(orgRole: OrgMemberRole): ProjectRole {
  return ORG_TO_PROJECT_ROLE[orgRole];
}

/**
 * Compute effective project role as max(explicitRole, inheritedRole).
 * Returns undefined if neither role is present.
 * Pure function, no DB access.
 */
export function getEffectiveProjectRole(
  explicitRole: ProjectRole | undefined,
  orgRole: OrgMemberRole | undefined
): ProjectRole | undefined {
  const inherited = orgRole ? getInheritedProjectRole(orgRole) : undefined;
  if (!explicitRole) {
    return inherited;
  }
  if (!inherited) {
    return explicitRole;
  }
  return hasPermissionLevel(explicitRole, inherited) ? explicitRole : inherited;
}

/**
 * Pick the higher of two already-resolved project roles.
 *
 * Both `getEffectiveProjectRole` (above) and the `requireProjectAccess`
 * middleware need the same composition: given an explicit project role
 * and an inherited project role (either side may be null/undefined),
 * return the one with the higher permission level. The previous form was
 * inlined in both locations; centralising here keeps the rule in one
 * place so a future change to `ROLE_HIERARCHY` or to the picking policy
 * doesn't drift across callers.
 *
 * Pure function, no DB access. Accepts `null` for "role not set" so
 * callers don't need to defensively coerce undefined.
 */
export function pickHigherProjectRole(
  a: ProjectRole | null | undefined,
  b: ProjectRole | null | undefined
): ProjectRole | null {
  const left = a ?? null;
  const right = b ?? null;
  if (left && right) {
    return hasPermissionLevel(left, right) ? left : right;
  }
  return left ?? right ?? null;
}
