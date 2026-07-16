/**
 * Shared threshold validation utilities for intelligence routes.
 * Both /similar and /mitigations accept an optional ?threshold query param
 * that overrides the service-level SIMILARITY_THRESHOLD env default.
 */

// TODO: import AppError from your actual middleware once the package is wired up
// import { AppError } from '../middleware/error.js';
import type { FastifyInstance, FastifyError } from 'fastify';

export const THRESHOLD_MIN = 0.5;
export const THRESHOLD_MAX = 1.0;
const THRESHOLD_ENV_DEFAULT = 0.85;

/**
 * Resolve the effective similarity threshold.
 * - Query param present and valid  → use it
 * - Query param absent             → fall back to SIMILARITY_THRESHOLD env var
 * - Env var missing / invalid      → fall back to hardcoded default (0.85)
 * - Query param out of range       → throw 422
 */
export function resolveThreshold(rawQueryThreshold: number | undefined): number {
  const envRaw = Number(process.env.SIMILARITY_THRESHOLD ?? String(THRESHOLD_ENV_DEFAULT));
  const envDefault =
    isNaN(envRaw) || envRaw < THRESHOLD_MIN || envRaw > THRESHOLD_MAX
      ? THRESHOLD_ENV_DEFAULT
      : envRaw;

  if (rawQueryThreshold === undefined) {
    return envDefault;
  }

  if (isNaN(rawQueryThreshold)) {
    // TODO: replace with `throw new AppError(...)` once AppError is available
    const err = new Error('threshold must be a number between 0.5 and 1.0') as Error & {
      statusCode: number;
    };
    err.statusCode = 422;
    throw err;
  }

  if (rawQueryThreshold < THRESHOLD_MIN || rawQueryThreshold > THRESHOLD_MAX) {
    const err = new Error(
      `threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}`
    ) as Error & { statusCode: number };
    err.statusCode = 422;
    throw err;
  }

  return rawQueryThreshold;
}

/** HTTP status code → reason phrase mapping for common 4xx/5xx codes. */
function statusPhrase(code: number): string {
  const phrases: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return phrases[code] ?? 'Internal Server Error';
}

/**
 * Register a scoped error handler that maps querystring validation errors and
 * AppError-shaped errors to structured JSON, with correct status/reason phrases.
 * Call once per route plugin.
 */
export function registerThresholdErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError & { statusCode?: number }, _request, reply) => {
    if (error.validation && error.validationContext === 'querystring') {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: error.message,
      });
    }
    const code = error.statusCode ?? 500;
    return reply.status(code).send({
      statusCode: code,
      error: statusPhrase(code),
      message: error.message,
    });
  });
}
