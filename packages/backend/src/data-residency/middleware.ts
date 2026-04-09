/**
 * Data Residency Middleware
 *
 * Express/Fastify middleware for enforcing data residency policies
 * on API requests.
 */

import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { getLogger } from '../logger.js';
import { AppError } from '../api/middleware/error.js';
import type { DataResidencyService } from './data-residency-service.js';
import type { DataResidencyContext } from '../api/types.js';
import { STRICT_DATA_RESIDENCY_REGIONS } from './types.js';

const logger = getLogger();

/**
 * Extract project ID from request
 * Looks in params, body, and query string
 */
function extractProjectId(request: FastifyRequest): string | null {
  // Check route params
  const params = request.params as Record<string, string>;
  if (params.projectId) {
    return params.projectId;
  }
  if (params.id && request.url.includes('/projects/')) {
    return params.id;
  }

  // Check body
  const body = request.body as Record<string, unknown> | null;
  if (body?.projectId && typeof body.projectId === 'string') {
    return body.projectId;
  }
  if (body?.project_id && typeof body.project_id === 'string') {
    return body.project_id;
  }

  // Check query string
  const query = request.query as Record<string, string>;
  if (query.projectId) {
    return query.projectId;
  }
  if (query.project_id) {
    return query.project_id;
  }

  return null;
}

/**
 * Data residency enforcement middleware factory
 *
 * Attaches data residency context to requests and enforces policies
 * for projects with strict residency requirements (KZ, RF).
 */
export function createDataResidencyMiddleware(service: DataResidencyService) {
  return async (
    request: FastifyRequest,
    _reply: FastifyReply,
    done: HookHandlerDoneFunction
  ): Promise<void> => {
    const projectId = extractProjectId(request);

    if (!projectId) {
      // No project context, allow request
      done();
      return;
    }

    try {
      const policy = await service.getProjectPolicy(projectId);

      // Attach data residency context to request
      request.dataResidency = {
        projectId,
        region: policy.region,
        strictResidency: STRICT_DATA_RESIDENCY_REGIONS.has(policy.region),
        storageRegion: policy.storageRegion,
      };

      // Log for audit (if enabled for this project)
      if (policy.auditDataAccess) {
        const action = methodToAction(request.method);
        await service.auditDataAccess({
          projectId,
          action,
          resourceType: extractResourceType(request.url),
          storageRegion: policy.storageRegion,
          userId: request.authUser?.id,
          ipAddress: request.ip,
          metadata: {
            method: request.method,
            url: request.url,
            userAgent: request.headers['user-agent'],
          },
        });
      }

      done();
    } catch (error) {
      logger.error('Data residency middleware error', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Security: Fail closed to prevent bypassing residency checks on error
      // Return standardized AppError with 500 status
      done(
        new AppError('Unable to verify data residency policy', 500, 'DataResidencyError', {
          originalError: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };
}

/**
 * Strict data residency enforcement middleware factory
 *
 * For routes that handle data storage operations, this middleware
 * validates that the operation is allowed by the data residency policy.
 *
 * Use this on routes that create, update, or export data.
 */
export function createStrictDataResidencyMiddleware(
  service: DataResidencyService,
  operation: 'create' | 'read' | 'update' | 'delete' | 'export'
) {
  return async (
    request: FastifyRequest,
    _reply: FastifyReply,
    done: HookHandlerDoneFunction
  ): Promise<void> => {
    const projectId = extractProjectId(request);

    if (!projectId) {
      done();
      return;
    }

    try {
      const validation = await service.validateStorageOperation(projectId, operation);

      if (!validation.allowed) {
        logger.warn('Data residency policy violation blocked', {
          projectId,
          operation,
          reason: validation.reason,
          ip: request.ip,
        });

        done(
          new AppError(
            validation.reason ?? 'Data residency policy violation',
            403,
            'DataResidencyViolation',
            {
              code: 'DATA_RESIDENCY_VIOLATION',
            }
          )
        );
        return;
      }

      // Log warnings if any
      if (validation.warnings && validation.warnings.length > 0) {
        logger.info('Data residency warnings', {
          projectId,
          operation,
          warnings: validation.warnings,
        });
      }

      done();
    } catch (error) {
      logger.error('Strict data residency middleware error', {
        projectId,
        operation,
        error: error instanceof Error ? error.message : String(error),
      });

      // Security: Fail closed for strict compliance
      // Return standardized AppError with 500 status
      done(
        new AppError('Unable to verify data residency policy', 500, 'DataResidencyError', {
          originalError: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };
}

/**
 * Cross-region transfer validation middleware factory
 *
 * Validates that data transfers between regions are allowed
 * by the project's data residency policy.
 */
export function createCrossRegionTransferMiddleware(service: DataResidencyService) {
  return async (
    request: FastifyRequest,
    _reply: FastifyReply,
    done: HookHandlerDoneFunction
  ): Promise<void> => {
    const projectId = extractProjectId(request);

    if (!projectId) {
      done();
      return;
    }

    // Check if request includes target region
    const body = request.body as Record<string, unknown> | null;
    const targetRegion = body?.targetRegion as string | undefined;

    if (!targetRegion) {
      done();
      return;
    }

    try {
      const policy = await service.getProjectPolicy(projectId);

      // Validate cross-region transfer
      const validation = await service.validateCrossRegionTransfer(
        projectId,
        policy.storageRegion,
        targetRegion as import('./types.js').StorageRegion
      );

      if (!validation.allowed) {
        logger.warn('Cross-region transfer blocked', {
          projectId,
          sourceRegion: policy.storageRegion,
          targetRegion,
          reason: validation.reason,
        });

        done(
          new AppError(
            validation.reason ?? 'Cross-region transfer blocked',
            403,
            'CrossRegionTransferBlocked',
            {
              code: 'CROSS_REGION_TRANSFER_BLOCKED',
            }
          )
        );
        return;
      }

      done();
    } catch (error) {
      logger.error('Cross-region transfer middleware error', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Security: Fail closed to prevent bypassing transfer validation on error
      // Return standardized AppError with 500 status
      done(
        new AppError('Unable to verify cross-region transfer policy', 500, 'DataResidencyError', {
          originalError: error instanceof Error ? error.message : String(error),
        })
      );
    }
  };
}

/**
 * Convert HTTP method to audit action
 */
function methodToAction(
  method: string
): 'data_created' | 'data_read' | 'data_updated' | 'data_deleted' | 'data_exported' {
  switch (method.toUpperCase()) {
    case 'POST':
      return 'data_created';
    case 'PUT':
    case 'PATCH':
      return 'data_updated';
    case 'DELETE':
      return 'data_deleted';
    case 'GET':
    default:
      return 'data_read';
  }
}

/**
 * Extract resource type from URL path
 */
function extractResourceType(url: string): string {
  const parts = url.split('/').filter(Boolean);

  // Remove version prefix if present (e.g., 'v1', 'v2')
  const firstPart = parts[0];
  if (firstPart?.startsWith('v')) {
    const versionPart = firstPart.slice(1);
    // Check if all characters after 'v' are digits
    if (versionPart.length > 0 && [...versionPart].every((c) => c >= '0' && c <= '9')) {
      parts.shift();
    }
  }

  // Common resource patterns
  const resourceTypes = [
    'bug-reports',
    'projects',
    'users',
    'integrations',
    'screenshots',
    'replays',
    'attachments',
  ];

  for (const part of parts) {
    if (resourceTypes.includes(part)) {
      return part.replace(/-/g, '_');
    }
  }

  return parts[0] || 'unknown';
}

/**
 * Get data residency headers for response
 * Useful for clients that need to know the data residency context
 */
export function getDataResidencyHeaders(context: DataResidencyContext): Record<string, string> {
  return {
    'X-Data-Residency-Region': context.region,
    'X-Storage-Region': context.storageRegion,
    'X-Strict-Residency': context.strictResidency ? 'true' : 'false',
  };
}
