/**
 * Project Access Middleware
 * Fastify preHandler middleware for project-level access control
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { findOrThrow, checkProjectAccess, lookupInheritedProjectRole } from '../utils/resource.js';
import { isProjectRole, pickHigherProjectRole } from '../../types/project-roles.js';
import { extractRouteParam, requireAuthContext } from './helpers.js';

/**
 * Create project access middleware
 * Verifies project exists and user has access
 *
 * @param db - Database client
 * @param options - Optional configuration
 * @param options.paramName - Route parameter name containing project ID (default: 'id')
 * @returns Fastify preHandler middleware
 *
 * @throws {Error} If no auth middleware was called before this middleware
 *
 * @remarks
 * **IMPORTANT**: This middleware must be used after an auth middleware (requireUser,
 * requireAuth, or requireApiKey) in the preHandler chain.
 * It validates that request.authUser, request.authProject, or request.apiKey exists.
 *
 * **Authentication branch order** (within `checkProjectAccess`):
 * 1. `request.apiKey` without `authUser` — full-scope/multi-project API key
 * 2. `request.authProject` — project-scoped (single-project) API key
 * 3. `request.authUser` — JWT path
 *
 * **Caveat**: the upstream auth middleware (`auth/middleware.ts:54-76`) tries
 * the `x-api-key` header first and short-circuits as soon as the key
 * validates — JWT is only consulted when no API-key header is present. So
 * a request that arrives with BOTH headers reaches this middleware with
 * `request.authUser = undefined` and `request.apiKey` populated, meaning
 * branch (1) above runs and any JWT-based restrictions are NOT enforced.
 * Earlier wording in this docstring claimed "JWT takes highest priority"
 * — that was aspirational, not what the code does.
 *
 * This is not a privilege-escalation surface in itself: a leaked full-scope
 * API key already grants the same access; presenting a JWT alongside adds
 * nothing. But callers MUST NOT rely on "user restrictions still apply when
 * both are present" — they don't. See `src/api/utils/resource.ts`'s
 * `checkProjectAccess` JSDoc for the full caveat.
 *
 * @example
 * ```typescript
 * // Standard usage (uses :id parameter)
 * fastify.get('/api/v1/projects/:id', {
 *   preHandler: [requireUser, requireProjectAccess(db)],
 * }, async (request, reply) => {
 *   // request.project is guaranteed to exist
 *   return sendSuccess(reply, request.project);
 * });
 *
 * // Custom parameter name
 * fastify.get('/api/v1/custom/:projectId/data', {
 *   preHandler: [requireUser, requireProjectAccess(db, { paramName: 'projectId' })],
 * }, async (request, reply) => {
 *   return sendSuccess(reply, request.project);
 * });
 * ```
 */
export function requireProjectAccess(db: DatabaseClient, options: { paramName?: string } = {}) {
  const paramName = options.paramName || 'id';

  return async (request: FastifyRequest, _reply: FastifyReply) => {
    // Runtime assertion: Verify authentication middleware ran first
    requireAuthContext(request, 'requireProjectAccess', 'anyAuth');

    // Extract project ID from route parameters
    const projectId = extractRouteParam(request, paramName, 'requireProjectAccess');

    // Check if project exists
    const project = await findOrThrow(() => db.projects.findById(projectId), 'Project');

    // Verify project access using centralized logic (handles JWT, project-scoped, and full-scope API keys)
    // Pass organization_id so the inherited-role lookup inside
    // checkProjectAccess can skip the redundant `db.projects.findById`
    // (we already loaded `project` two lines above).
    await checkProjectAccess(project.id, request.authUser, request.authProject, db, 'Project', {
      apiKey: request.apiKey,
      organizationId: project.organization_id,
    });

    // Fetch the user's effective project role for downstream authorization
    // checks. Effective = max(explicit project_members row, org-inherited
    // role). `getUserRole` only sees explicit project membership rows
    // (and the `created_by` owner shortcut); a user whose project access
    // is granted via org membership inheritance has `getUserRole` returning
    // null. Without combining both, downstream `requireProjectRole`
    // false-negatives every org-inherited member with a misleading
    // "You do not have a role in this project" 403 — even though
    // `requireProjectAccess` (above) just admitted them via the inherited
    // path in `checkProjectAccess`.
    //
    // Both lookups run in parallel — they're independent (different
    // tables, no shared rows). `lookupInheritedProjectRole` takes the
    // already-fetched `project.organization_id` so it doesn't re-query
    // the projects table for a row we just loaded above.
    if (request.authUser) {
      const [explicitRole, inheritedRole] = await Promise.all([
        db.projects.getUserRole(project.id, request.authUser.id),
        lookupInheritedProjectRole(project.id, request.authUser.id, db, project.organization_id),
      ]);

      // Pick the higher of explicit and inherited via the shared helper
      // (`types/project-roles.ts:pickHigherProjectRole`) so the rule
      // stays in one place — same call inside checkProjectAccess.
      const explicit = isProjectRole(explicitRole) ? explicitRole : null;
      const effectiveRole = pickHigherProjectRole(explicit, inheritedRole);

      if (effectiveRole) {
        request.projectRole = effectiveRole;
      }
      // If both lookups returned null, leave request.projectRole undefined.
      // Downstream authorization checks (e.g., requireProjectRole) handle
      // missing roles appropriately.
    }

    // Attach project ID and project to request for downstream handlers
    request.projectId = projectId;
    request.project = project;
  };
}
