/**
 * Authentication Assertion Helpers
 * Type-safe authentication checks
 */

import type { FastifyRequest } from 'fastify';
import type { User } from '../../../db/types.js';
import { AppError } from '../error.js';

/**
 * Assert that the user is authenticated
 * Throws 401 if not authenticated
 */
export function assertAuthUser(
  request: FastifyRequest
): asserts request is FastifyRequest & { authUser: User } {
  if (!request.authUser) {
    throw new AppError('User authentication required', 401, 'Unauthorized');
  }
}

/**
 * Assert that the user is an admin
 * Throws 401 if not authenticated, 403 if not admin
 */
export function assertAdmin(
  request: FastifyRequest
): asserts request is FastifyRequest & { authUser: User } {
  assertAuthUser(request);
  if (!isPlatformAdmin(request)) {
    throw new AppError('Admin access required', 403, 'Forbidden');
  }
}

/**
 * Check if user is admin (for conditional logic)
 * @deprecated Use isPlatformAdmin() instead
 */
export function isAdmin(request: FastifyRequest): boolean {
  return isPlatformAdmin(request);
}

/**
 * Check if user is a platform admin (SaaS operator).
 * Reads from security.is_platform_admin (new) with fallback to role === 'admin' (legacy).
 * Accepts either a FastifyRequest or a User object directly.
 */
export function isPlatformAdmin(requestOrUser: FastifyRequest | User): boolean {
  // Distinguish User (has 'role') from FastifyRequest (doesn't)
  const user =
    'role' in requestOrUser ? (requestOrUser as User) : (requestOrUser as FastifyRequest).authUser;
  if (!user) {
    return false;
  }
  // New: check security JSONB field
  if (user.security?.is_platform_admin === true) {
    return true;
  }
  // Legacy fallback: check role column (until role is dropped)
  return user.role === 'admin';
}
