/**
 * Middleware Helper Utilities
 * Shared helpers for middleware validation and error handling
 */

import type { FastifyRequest } from 'fastify';
import { ConfigurationError } from './error.js';

/**
 * Extract route parameter or throw configuration error
 *
 * @param request - Fastify request object
 * @param paramName - Name of the route parameter to extract
 * @param middlewareName - Name of the middleware calling this helper (for error messages)
 * @returns The parameter value
 * @throws {ConfigurationError} If parameter not found in route
 *
 * @example
 * ```typescript
 * const projectId = extractRouteParam(request, 'id', 'requireProjectAccess');
 * // Returns the value of :id from route like /api/v1/projects/:id
 * ```
 */
export function extractRouteParam(
  request: FastifyRequest,
  paramName: string,
  middlewareName: string
): string {
  const params = request.params as Record<string, string>;
  const value = params[paramName];

  if (!value) {
    throw new ConfigurationError(
      `Route parameter '${paramName}' not found. ` +
        `Available parameters: ${Object.keys(params).join(', ') || 'none'}`,
      middlewareName
    );
  }

  return value;
}

/**
 * Validate authentication middleware ran before this middleware
 *
 * @param request - Fastify request object
 * @param middlewareName - Name of the middleware calling this helper (for error messages)
 * @param requiredAuth - Type of auth required: 'user' for JWT only, 'anyAuth' for JWT/API key
 * @throws {ConfigurationError} If required auth context is missing
 *
 * @example
 * ```typescript
 * // Require JWT user authentication only
 * requireAuthContext(request, 'requireOrgAccess', 'user');
 *
 * // Accept any authentication (JWT or API key)
 * requireAuthContext(request, 'requireProjectAccess', 'anyAuth');
 * ```
 */
export function requireAuthContext(
  request: FastifyRequest,
  middlewareName: string,
  requiredAuth: 'user' | 'anyAuth' = 'anyAuth'
): void {
  // Branch 1: JWT-only authentication (user must be logged in)
  if (requiredAuth === 'user') {
    // request.authUser = User object from JWT token (set by requireUser middleware)
    if (!request.authUser) {
      throw new ConfigurationError(
        `${middlewareName} requires requireUser middleware to run first. ` +
          'Add requireUser to the preHandler chain before this middleware.',
        middlewareName
      );
    }
    return;
  }

  // Branch 2: Accept any valid authentication method
  // This branch explicitly handles JWT and API key authentication:
  // - JWT tokens (request.authUser) - user logged in via web UI
  // - Project-scoped API keys (request.authProject) - SDK usage with bgs_ prefix
  // - Full-scope API keys (request.apiKey) - admin/service account keys
  // Note: Share tokens (request.authShareToken) are NOT checked here as they are
  // scoped to individual bug reports, not projects/orgs
  if (requiredAuth === 'anyAuth') {
    const hasJwtAuth = !!request.authUser; // JWT token authentication
    const hasProjectScopedKey = !!request.authProject; // SDK API key (project-scoped)
    const hasFullScopeKey = !!request.apiKey; // Admin/service API key (full-scope)

    const hasValidAuth = hasJwtAuth || hasProjectScopedKey || hasFullScopeKey;

    if (!hasValidAuth) {
      throw new ConfigurationError(
        `${middlewareName} requires requireUser, requireApiKey, or requireAuth middleware to run first. ` +
          'Add the appropriate auth middleware to the preHandler chain before this middleware.',
        middlewareName
      );
    }
    return;
  }

  // This should never happen due to TypeScript types, but provides runtime safety
  throw new ConfigurationError(
    `Invalid requiredAuth type: ${requiredAuth}. Must be 'user' or 'anyAuth'.`,
    middlewareName
  );
}
