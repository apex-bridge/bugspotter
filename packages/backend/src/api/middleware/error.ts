/**
 * Error Handling Middleware
 * Global error handler with structured responses
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { SqlValidationError } from '../../db/repositories/base-repository.js';

/**
 * Custom error class for application errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public error: string = 'InternalServerError',
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error for invalid input
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'ValidationError', details);
    this.name = 'ValidationError';
  }
}

/**
 * Configuration error for middleware/route setup issues
 * Indicates programmer error (misconfigured routes, missing middleware)
 * Should only occur during development
 */
export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly component: string
  ) {
    super(message);
    this.name = 'ConfigurationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Standardized error response structure
 */
export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
  requestId: string;
  details?: unknown;
}

/**
 * Processed error information
 */
interface ProcessedError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

/**
 * Database error types that should be mapped to HTTP status codes
 */
const DB_ERROR_CODES: Record<string, { statusCode: number; error: string; message: string }> = {
  '23505': {
    statusCode: 409,
    error: 'Conflict',
    message: 'Resource already exists',
  },
  '23503': {
    statusCode: 400,
    error: 'BadRequest',
    message: 'Referenced resource not found',
  },
  '23502': {
    statusCode: 400,
    error: 'BadRequest',
    message: 'Required field is missing',
  },
  '22P02': {
    statusCode: 400,
    error: 'BadRequest',
    message: 'Invalid data format',
  },
  '42P01': {
    statusCode: 500,
    error: 'InternalServerError',
    message: 'Database configuration error',
  },
};

/**
 * Build standardized error response (DRY)
 */
function buildErrorResponse(
  processed: ProcessedError,
  requestId: string,
  includeDetails: boolean = false
): ErrorResponse {
  return {
    success: false,
    error: processed.error,
    message: processed.message,
    statusCode: processed.statusCode,
    timestamp: new Date().toISOString(),
    requestId,
    // Always include details for client errors (4xx) — they help clients fix their request.
    // Only gate details on includeDetails for server errors (5xx) to avoid leaking internals.
    details:
      includeDetails || (processed.statusCode < 500 && processed.details !== undefined)
        ? processed.details
        : undefined,
  };
}

/**
 * Check if error is a validation error
 */
function isValidationError(error: FastifyError): boolean {
  return error.validation !== undefined;
}

/**
 * Process validation error
 */
function processValidationError(error: FastifyError): ProcessedError {
  return {
    statusCode: 400,
    error: 'ValidationError',
    message: 'Request validation failed',
    details: {
      validation: error.validation,
      validationContext: error.validationContext,
    },
  };
}

/**
 * Check if error is a custom AppError
 */
function isAppError(error: FastifyError): boolean {
  return error instanceof AppError;
}

/**
 * Process custom AppError
 */
function processAppError(error: FastifyError): ProcessedError {
  const appError = error as unknown as AppError;
  return {
    statusCode: appError.statusCode,
    error: appError.error,
    message: appError.message,
    details: appError.details,
  };
}

/**
 * Check if error is a SQL validation error
 */
function isSqlValidationError(error: FastifyError): boolean {
  return error instanceof SqlValidationError;
}

/**
 * Process SQL validation error
 */
function processSqlValidationError(error: FastifyError): ProcessedError {
  const sqlError = error as unknown as SqlValidationError;
  const isDevelopment = config.server.env === 'development';
  return {
    statusCode: 400,
    error: 'ValidationError',
    message: 'Invalid SQL parameter',
    details: isDevelopment
      ? {
          validationType: sqlError.validationType,
          invalidInput: sqlError.invalidInput,
          originalMessage: sqlError.message,
        }
      : undefined,
  };
}

/**
 * Check if error is a configuration error
 */
function isConfigurationError(error: FastifyError): boolean {
  return error instanceof ConfigurationError;
}

/**
 * Process configuration error
 */
function processConfigurationError(error: FastifyError): ProcessedError {
  const configError = error as unknown as ConfigurationError;
  // Always show full details for configuration errors (developer mistakes)
  return {
    statusCode: 500,
    error: 'InternalServerError',
    message: `Configuration Error: ${configError.message}`,
    details: {
      component: configError.component,
      stack: configError.stack,
    },
  };
}

/**
 * Check if error is a database error
 */
function isDatabaseError(error: FastifyError): boolean {
  const errorWithCode = error as Error & { code?: string };
  const hasDbMessage =
    error.message.includes('database') ||
    error.message.includes('postgres') ||
    error.message.includes('pg');
  const hasPgCode = !!errorWithCode.code && /^\d{5}$/.test(errorWithCode.code); // PostgreSQL 5-digit codes
  const hasConnError = errorWithCode.code === 'ECONNREFUSED';
  return hasDbMessage || hasPgCode || hasConnError;
}

/**
 * Process database error
 */
function processDatabaseError(error: FastifyError): ProcessedError {
  const pgError = error as Error & { code?: string; detail?: string; constraint?: string };
  const isDevelopment = config.server.env === 'development';

  // PostgreSQL error with known code
  if (pgError.code && DB_ERROR_CODES[pgError.code]) {
    const mapped = DB_ERROR_CODES[pgError.code];
    return {
      ...mapped,
      details: isDevelopment
        ? { code: pgError.code, detail: pgError.detail, constraint: pgError.constraint }
        : undefined,
    };
  }

  // Connection errors (check both code and message)
  if (
    pgError.code === 'ECONNREFUSED' ||
    error.message.includes('Connection') ||
    error.message.includes('ECONNREFUSED')
  ) {
    return {
      statusCode: 503,
      error: 'ServiceUnavailable',
      message: 'Database connection failed',
      details: isDevelopment ? { code: pgError.code, message: error.message } : undefined,
    };
  }

  // Default database error
  return {
    statusCode: 500,
    error: 'InternalServerError',
    message: 'Database operation failed',
    details: isDevelopment ? { code: pgError.code, message: error.message } : undefined,
  };
}

/**
 * Check if error is a JWT/authentication error
 */
function isJwtError(error: FastifyError): boolean {
  return error.message.includes('jwt') || error.message.includes('token');
}

/**
 * Process JWT error
 */
function processJwtError(): ProcessedError {
  return {
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Invalid or expired token',
  };
}

/**
 * Check if error is a rate limit error
 */
function isRateLimitError(error: FastifyError): boolean {
  return error.statusCode === 429;
}

/**
 * Process rate limit error
 */
function processRateLimitError(): ProcessedError {
  return {
    statusCode: 429,
    error: 'TooManyRequests',
    message: 'Rate limit exceeded. Please try again later',
  };
}

/**
 * Check if error is a file upload error
 */
function isFileUploadError(error: FastifyError): boolean {
  return error.message.includes('file') || error.message.includes('upload');
}

/**
 * Process file upload error
 */
function processFileUploadError(): ProcessedError {
  return {
    statusCode: 413,
    error: 'PayloadTooLarge',
    message: 'File upload failed. File may be too large',
  };
}

/**
 * Process unknown/default error
 */
function processDefaultError(error: FastifyError): ProcessedError {
  const statusCode = error.statusCode || 500;
  const isDevelopment = config.server.env === 'development';

  return {
    statusCode,
    error: error.name || 'InternalServerError',
    message: isDevelopment ? error.message : 'An unexpected error occurred',
    details: isDevelopment
      ? {
          stack: error.stack,
          code: error.code,
        }
      : undefined,
  };
}

/**
 * Error handler chain - processes error based on type (Strategy Pattern)
 */
const errorHandlers: Array<{
  matcher: (error: FastifyError) => boolean;
  processor: (error: FastifyError) => ProcessedError;
}> = [
  { matcher: isValidationError, processor: processValidationError },
  { matcher: isSqlValidationError, processor: processSqlValidationError },
  { matcher: isConfigurationError, processor: processConfigurationError },
  { matcher: isAppError, processor: processAppError },
  { matcher: isDatabaseError, processor: processDatabaseError },
  { matcher: isJwtError, processor: processJwtError },
  { matcher: isRateLimitError, processor: processRateLimitError },
  { matcher: isFileUploadError, processor: processFileUploadError },
];

/**
 * Global error handler for Fastify
 */
export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const requestId = request.id;
  const isDevelopment = config.server.env === 'development';

  // Log error with context
  request.log.error(
    {
      err: error,
      requestId,
      url: request.url,
      method: request.method,
      statusCode: error.statusCode || 500,
    },
    'Request error'
  );

  // Find matching error handler
  for (const { matcher, processor } of errorHandlers) {
    if (matcher(error)) {
      const processed = processor(error);
      const response = buildErrorResponse(processed, requestId, isDevelopment);
      return reply.code(response.statusCode).send(response);
    }
  }

  // Default error handling
  const processed = processDefaultError(error);
  const response = buildErrorResponse(processed, requestId, isDevelopment);
  return reply.code(response.statusCode).send(response);
}

/**
 * Not found (404) handler
 */
export async function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({
    success: false,
    error: 'NotFound',
    message: `Route ${request.method} ${request.url} not found`,
    statusCode: 404,
    timestamp: new Date().toISOString(),
    requestId: request.id,
  });
}
