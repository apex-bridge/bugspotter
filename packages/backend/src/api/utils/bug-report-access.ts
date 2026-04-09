/**
 * Bug Report Access Control Utilities
 *
 * Centralizes access control logic for bug reports following SOLID principles:
 * - Single Responsibility: Each function has one clear purpose
 * - Open/Closed: Easy to extend with new access patterns
 * - DRY: Eliminates duplicated access control code across routes
 */

import type { User, Project, BugReportFilters } from '../../db/types.js';
import type { DatabaseClient } from '../../db/client.js';
import { AppError } from '../middleware/error.js';
import { isPlatformAdmin } from '../middleware/auth.js';

export interface AccessControlResult {
  filters: BugReportFilters;
  requiresValidation: boolean;
}

/**
 * Determine filters based on authentication context
 *
 * Returns filters and whether additional validation is needed.
 * This function implements the access control strategy:
 * - API key → direct project filter
 * - Admin user → optional project filter (sees all if not specified)
 * - Regular user with project_id → requires validation, then project filter
 * - Regular user without project_id → optimized user_id JOIN filter
 *
 * @param authUser - Authenticated user (JWT)
 * @param authProject - Authenticated project (API key)
 * @param requestedProjectId - Optional project_id from query params
 * @param additionalFilters - Additional filters (status, priority, dates, etc.)
 * @returns Object with filters to apply and validation requirement flag
 * @throws AppError(401) if not authenticated
 */
export function buildAccessFilters(
  authUser: User | undefined,
  authProject: Project | undefined,
  requestedProjectId?: string,
  additionalFilters?: Partial<BugReportFilters>
): AccessControlResult {
  // API key authentication - restrict to authenticated project only
  if (authProject) {
    return {
      filters: { project_id: authProject.id, ...additionalFilters },
      requiresValidation: false,
    };
  }

  // No authentication
  if (!authUser) {
    throw new AppError('Authentication required', 401, 'Unauthorized');
  }

  // Platform admin - can see all projects or filter by specific project
  if (isPlatformAdmin(authUser)) {
    return {
      filters: {
        ...(requestedProjectId && { project_id: requestedProjectId }),
        ...additionalFilters,
      },
      requiresValidation: false,
    };
  }

  // Regular user with specific project - needs access validation
  if (requestedProjectId) {
    return {
      filters: { project_id: requestedProjectId, ...additionalFilters },
      requiresValidation: true,
    };
  }

  // Regular user without project - use optimized JOIN with user_id
  // The repository will perform INNER JOIN to project_members table
  return {
    filters: { user_id: authUser.id, ...additionalFilters },
    requiresValidation: false,
  };
}

/**
 * Validate user has access to requested project
 *
 * @param projectId - Project ID to validate access for
 * @param userId - User ID to check
 * @param db - Database client
 * @throws AppError(403) if user doesn't have access to the project
 */
export async function validateProjectAccess(
  projectId: string,
  userId: string,
  db: DatabaseClient
): Promise<void> {
  const hasAccess = await db.projects.hasAccess(projectId, userId);
  if (!hasAccess) {
    throw new AppError('Access denied to project', 403, 'Forbidden');
  }
}
