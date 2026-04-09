/**
 * Response utilities
 * Standardized API response formatting
 */

import type { FastifyReply } from 'fastify';
import type { ErrorResponse } from '../middleware/error.js';

interface SuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

interface PaginatedResponse<T> extends SuccessResponse<T> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Send a successful response
 */
export function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200): FastifyReply {
  return reply.code(statusCode).send({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  } satisfies SuccessResponse<T>);
}

/**
 * Send a successful response with pagination
 */
export function sendPaginated<T>(
  reply: FastifyReply,
  data: T,
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  },
  statusCode = 200
): FastifyReply {
  return reply.code(statusCode).send({
    success: true,
    data,
    pagination,
    timestamp: new Date().toISOString(),
  } satisfies PaginatedResponse<T>);
}

/**
 * Send a created (201) response
 */
export function sendCreated<T>(reply: FastifyReply, data: T): FastifyReply {
  return sendSuccess(reply, data, 201);
}

/**
 * Send a 204 No Content response (for DELETE operations)
 */
export function sendNoContent(reply: FastifyReply): FastifyReply {
  return reply.code(204).send();
}

/**
 * Send a standardized error response
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
  requestId: string,
  details?: unknown
): FastifyReply {
  const response: ErrorResponse = {
    success: false,
    error,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
    requestId,
  };

  if (details !== undefined) {
    response.details = details;
  }

  return reply.code(statusCode).send(response);
}
