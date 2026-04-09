/**
 * Auth module index
 * Re-exports all authentication and authorization functionality
 */

export { HTTP_STATUS, DEFAULT_RATE_LIMITS } from './constants.js';
export {
  sendUnauthorized,
  sendForbidden,
  sendRateLimitExceeded,
  sendInternalError,
} from './responses.js';
export { handleNewApiKeyAuth, handleJwtAuth } from './handlers.js';
export { createAuthMiddleware, createBodyAuthMiddleware } from './middleware.js';
export {
  requirePlatformAdmin,
  requireProject,
  requireUser,
  requireApiKey,
  requireAuth,
  requirePermission,
  requireProjectRole,
} from './authorization.js';
export { isPlatformAdmin } from './assertions.js';
