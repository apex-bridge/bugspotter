/**
 * Project Access Middleware
 * Fastify preHandler middleware for project-level access control
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { findOrThrow, checkProjectAccess } from '../utils/resource.js';
import { isProjectRole } from '../../types/project-roles.js';
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
    await checkProjectAccess(project.id, request.authUser, request.authProject, db, 'Project', {
      apiKey: request.apiKey,
    });

    // Fetch and attach user's role for downstream authorization checks (avoids N+1 queries)
    if (request.authUser) {
      const role = await db.projects.getUserRole(project.id, request.authUser.id);

      // Validate role before attaching to request (defensive check against invalid DB data)
      if (role && isProjectRole(role)) {
        request.projectRole = role;
      }
      // If role is null or invalid, leave request.projectRole as undefined
      // Downstream authorization checks will handle missing roles appropriately
    }

    // Attach project ID and project to request for downstream handlers
    request.projectId = projectId;
    request.project = project;
  };
}
