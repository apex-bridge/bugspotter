/**
 * Authentication and Authorization Middleware
 * Handles API key and JWT authentication with rate limiting
 *
 * This file re-exports functions from modular components for backward compatibility.
 * See auth/ directory for implementation details.
 */

// Re-export main authentication middleware
export { createAuthMiddleware, createBodyAuthMiddleware } from './auth/middleware.js';

// Re-export authorization middleware functions
export {
  requirePlatformAdmin,
  requireProject,
  requireUser,
  requireApiKey,
  requireAuth,
  requirePermission,
  requireProjectRole,
} from './auth/authorization.js';

// Re-export assertion helpers
export { isPlatformAdmin } from './auth/assertions.js';
