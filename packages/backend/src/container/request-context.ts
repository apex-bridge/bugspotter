/**
 * Request Context Middleware
 *
 * Attaches service container and request-specific context to each request.
 * Makes services available via req.ctx.services pattern.
 */

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import type { IServiceContainer } from './service-container.js';
import { getLogger } from '../logger.js';
import { AppError } from '../api/middleware/error.js';

/**
 * Request Context Interface
 * Available on req.ctx for all routes
 */
export interface RequestContext {
  services: IServiceContainer;
  requestId: string;
  startTime: number;
  metadata: Record<string, unknown>;
}

/**
 * Extend Fastify Request type to include context
 * Optional since it's only available after middleware runs
 */
declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext;
  }
}

/**
 * Create request context middleware
 * Attaches services and metadata to each request
 */
export function createRequestContextMiddleware(container: IServiceContainer) {
  return function requestContextMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply,
    done: HookHandlerDoneFunction
  ) {
    // Attach request context
    request.ctx = {
      services: container,
      requestId: request.id,
      startTime: Date.now(),
      metadata: {},
    };

    // Log context creation in debug mode
    const logger = getLogger();
    logger.debug('Request context created', {
      requestId: request.id,
      method: request.method,
      url: request.url,
    });

    done();
  };
}

/**
 * Helper to get services from request
 * Provides type-safe access to service container
 */
export function getServices(request: FastifyRequest): IServiceContainer {
  if (!request.ctx || !request.ctx.services) {
    throw new AppError(
      'Request context not initialized. Ensure middleware is registered.',
      500,
      'InternalServerError'
    );
  }
  return request.ctx.services;
}

/**
 * Helper to set request metadata
 * Useful for passing data between middleware and route handlers
 */
export function setRequestMetadata(request: FastifyRequest, key: string, value: unknown): void {
  if (!request.ctx) {
    throw new AppError(
      'Request context not initialized. Ensure middleware is registered.',
      500,
      'InternalServerError'
    );
  }
  request.ctx.metadata[key] = value;
}

/**
 * Helper to get request metadata
 */
export function getRequestMetadata<T = unknown>(
  request: FastifyRequest,
  key: string
): T | undefined {
  if (!request.ctx) {
    throw new AppError(
      'Request context not initialized. Ensure middleware is registered.',
      500,
      'InternalServerError'
    );
  }
  return request.ctx.metadata[key] as T;
}

/**
 * Helper to get request duration in milliseconds
 */
export function getRequestDuration(request: FastifyRequest): number {
  if (!request.ctx) {
    throw new AppError(
      'Request context not initialized. Ensure middleware is registered.',
      500,
      'InternalServerError'
    );
  }
  return Date.now() - request.ctx.startTime;
}
