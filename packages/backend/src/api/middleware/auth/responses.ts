/**
 * Authentication response helpers
 * Standardized error responses for auth failures
 */

import type { FastifyReply } from 'fastify';
import { HTTP_STATUS } from './constants.js';

export function sendUnauthorized(reply: FastifyReply, message: string) {
  return reply.code(HTTP_STATUS.UNAUTHORIZED).send({
    success: false,
    error: 'Unauthorized',
    message,
    statusCode: HTTP_STATUS.UNAUTHORIZED,
    timestamp: new Date().toISOString(),
  });
}

export function sendForbidden(reply: FastifyReply, message: string) {
  return reply.code(HTTP_STATUS.FORBIDDEN).send({
    success: false,
    error: 'Forbidden',
    message,
    statusCode: HTTP_STATUS.FORBIDDEN,
    timestamp: new Date().toISOString(),
  });
}

export function sendRateLimitExceeded(reply: FastifyReply, window: string, retryAfter: number) {
  return reply
    .code(HTTP_STATUS.TOO_MANY_REQUESTS)
    .header('Retry-After', retryAfter)
    .send({
      success: false,
      error: 'TooManyRequests',
      message: `Rate limit exceeded for ${window} window. Try again in ${retryAfter}s`,
      retryAfter,
      statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
      timestamp: new Date().toISOString(),
    });
}

export function sendInternalError(reply: FastifyReply, message: string) {
  return reply.code(HTTP_STATUS.INTERNAL_SERVER_ERROR).send({
    success: false,
    error: 'InternalServerError',
    message,
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send account locked response (429 Too Many Requests)
 * Used when account is locked due to too many failed login attempts
 *
 * @param reply - Fastify reply object
 * @param retryAfter - Seconds until the account lockout expires
 * @returns Fastify reply with 429 status and account locked error message
 */
export function sendAccountLocked(reply: FastifyReply, retryAfter: number) {
  const minutes = Math.ceil(retryAfter / 60);
  return reply
    .code(HTTP_STATUS.TOO_MANY_REQUESTS)
    .header('Retry-After', retryAfter)
    .send({
      success: false,
      error: 'AccountLocked',
      message: `Account locked due to too many failed login attempts. Please try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`,
      retryAfter,
      statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
      timestamp: new Date().toISOString(),
    });
}

/**
 * Send unauthorized response with remaining attempts info
 * Used for failed login when account is not yet locked
 *
 * @param reply - Fastify reply object
 * @param message - Error message to display
 * @param remainingAttempts - Number of login attempts remaining before lockout
 * @returns Fastify reply with 401 status and remaining attempts information
 */
export function sendUnauthorizedWithAttempts(
  reply: FastifyReply,
  message: string,
  remainingAttempts: number
) {
  return reply.code(HTTP_STATUS.UNAUTHORIZED).send({
    success: false,
    error: 'Unauthorized',
    message,
    remainingAttempts,
    statusCode: HTTP_STATUS.UNAUTHORIZED,
    timestamp: new Date().toISOString(),
  });
}
