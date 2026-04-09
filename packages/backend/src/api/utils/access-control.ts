/**
 * Access Control Utilities
 * Centralized logic for determining user access to resources
 */

import type { User, Project } from '../../db/types.js';
import type { DatabaseClient } from '../../db/client.js';
import { AppError } from '../middleware/error.js';
import { isPlatformAdmin } from '../middleware/auth.js';

/**
 * Resolve which project ID(s) or user ID a user can access for filtering/querying
 * Returns user_id for optimized JOIN-based access control when applicable
 *
 * @param requestedProjectId - The project ID requested in query params
 * @param authUser - Authenticated user from JWT
 * @param authProject - Authenticated project from API key
 * @param db - Database client
 * @returns Object with project_id (string), project_ids (string[]), or user_id (string)
 * @throws AppError if access is denied or authentication is missing
 */
export async function resolveAccessibleProjectId(
  requestedProjectId: string | undefined,
  authUser: User | undefined,
  authProject: Project | undefined,
  db: DatabaseClient
): Promise<string | string[] | undefined> {
  // API key auth - use authenticated project only (project-scoped access)
  if (authProject) {
    return authProject.id;
  }

  // JWT auth
  if (authUser) {
    // Platform admins can access any project or all projects
    if (isPlatformAdmin(authUser)) {
      return requestedProjectId;
    }

    // Regular users - check project access
    if (requestedProjectId) {
      const hasAccess = await db.projects.hasAccess(requestedProjectId, authUser.id);
      if (!hasAccess) {
        throw new AppError('Access denied to project', 403, 'Forbidden');
      }
      return requestedProjectId;
    }

    // No project specified - return user_id for optimized JOIN query
    // This replaces the old approach:
    // const projectIds = await db.projectMembers.getUserProjectIds(authUser.id);
    // return projectIds.length > 0 ? projectIds : undefined;
    // The repository will handle the JOIN directly
    return authUser.id;
  }

  // No authentication provided
  throw new AppError('Authentication required', 401, 'Unauthorized');
}
