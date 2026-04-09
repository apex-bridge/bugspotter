/**
 * Bug Report Helper Utilities
 * Common operations for bug report access control
 */

import type { DatabaseClient } from '../../db/client.js';
import type { User, Project, BugReport, ApiKey } from '../../db/types.js';
import type { ProjectRole } from '../../types/project-roles.js';
import { findOrThrow, checkProjectAccess } from './resource.js';

/**
 * Find a bug report and verify user has access to its project
 * Throws 404 if not found, 403 if no access
 *
 * @param id - Bug report ID
 * @param authUser - Authenticated user (for user-based auth)
 * @param authProject - Authenticated project (for API key auth)
 * @param db - Database client
 * @param apiKey - Optional full-scope API key (for routes using requireAuth)
 * @param minProjectRole - Optional minimum project role required
 * @returns Bug report if found and accessible
 * @throws NotFoundError if report doesn't exist
 * @throws ForbiddenError if user/project doesn't have access
 */
export async function findReportWithAccess(
  id: string,
  authUser: User | undefined,
  authProject: Project | undefined,
  db: DatabaseClient,
  apiKey?: ApiKey,
  minProjectRole?: ProjectRole
): Promise<BugReport> {
  const report = await findOrThrow(() => db.bugReports.findById(id), 'Bug report');
  await checkProjectAccess(report.project_id, authUser, authProject, db, 'Bug report', {
    apiKey,
    minProjectRole,
  });
  return report;
}
