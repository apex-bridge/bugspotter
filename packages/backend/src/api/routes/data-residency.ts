/**
 * Data Residency API Routes
 *
 * Endpoints for managing data residency policies, viewing audit logs,
 * and checking compliance status.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DatabaseClient } from '../../db/client.js';
import { requireProjectAccess } from '../middleware/project-access.js';
import { requireProjectRole } from '../utils/authorization.js';
import type { ProjectRole } from '../utils/authorization.js';
import { requireUser } from '../middleware/auth.js';
import { ValidationError } from '../middleware/error.js';
import { getLogger } from '../../logger.js';
import {
  type DataResidencyRegion,
  type DataResidencyPolicy,
  type StorageRegion,
  ALLOWED_STORAGE_REGIONS,
  DATA_RESIDENCY_PRESETS,
} from '../../data-residency/types.js';
import { isRegionAvailable } from '../../data-residency/config.js';
import { sendSuccess, sendPaginated } from '../utils/response.js';

const logger = getLogger();

// ============================================================================
// SCHEMAS
// ============================================================================

const projectIdParamsSchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    required: ['id'],
  },
};

const updatePolicySchema = z.object({
  region: z.enum(['kz', 'rf', 'eu', 'us', 'global']),
  storageRegion: z.string().optional(),
});

const auditQuerySchema = z.object({
  action: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).optional(),
  offset: z.coerce.number().min(0).optional(),
});

const violationQuerySchema = z.object({
  violationType: z.string().optional(),
  blocked: z.coerce.boolean().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().min(1).max(1000).optional(),
  offset: z.coerce.number().min(0).optional(),
});

// ============================================================================
// CONSTANTS
// ============================================================================

const USER_ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
} as const;

const ERROR_MESSAGES = {
  OWNER_OR_ADMIN_REQUIRED: 'Project owner or admin access required',
} as const;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get display name for a data residency region
 */
function getRegionDisplayName(region: DataResidencyRegion): string {
  const names: Record<DataResidencyRegion, string> = {
    kz: 'Kazakhstan',
    rf: 'Russia',
    eu: 'European Union',
    us: 'United States',
    global: 'Global (No Restrictions)',
  };
  return names[region] || region;
}

/**
 * Check if user has permission to modify data residency policy
 * Requires owner role (or admin override)
 */
async function requirePolicyModificationPermission(
  projectId: string,
  user: { id: string; role: string },
  db: DatabaseClient,
  projectRole?: ProjectRole
): Promise<void> {
  if (user.role === USER_ROLES.ADMIN) {
    return; // Admins bypass project role checks
  }

  await requireProjectRole(
    projectId,
    user.id,
    db,
    'owner',
    ERROR_MESSAGES.OWNER_OR_ADMIN_REQUIRED,
    projectRole ?? null
  );
}

// ============================================================================
// ROUTES
// ============================================================================

export function dataResidencyRoutes(fastify: FastifyInstance, db: DatabaseClient): void {
  /**
   * GET /api/v1/projects/:id/data-residency
   * Get data residency policy for a project
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/data-residency',
    {
      schema: projectIdParamsSchema,
      preHandler: [requireUser, requireProjectAccess(db)],
    },
    async (request, reply: FastifyReply) => {
      const { id: projectId } = request.params;

      const policy = await db.dataResidency.getProjectPolicy(projectId);

      // Get storage availability info
      const storageAvailable =
        policy.storageRegion === 'auto' || isRegionAvailable(policy.storageRegion);

      return sendSuccess(reply, {
        projectId,
        policy,
        storageAvailable,
        allowedRegions: ALLOWED_STORAGE_REGIONS[policy.region],
        presets: Object.keys(DATA_RESIDENCY_PRESETS),
      });
    }
  );

  /**
   * PUT /api/v1/projects/:id/data-residency
   * Update data residency policy for a project
   */
  fastify.put<{ Params: { id: string } }>(
    '/api/v1/projects/:id/data-residency',
    {
      schema: projectIdParamsSchema,
      preHandler: [requireUser, requireProjectAccess(db)],
    },
    async (request, reply: FastifyReply) => {
      const { id: projectId } = request.params;

      // Check if user has permission (owner or admin)
      await requirePolicyModificationPermission(
        projectId,
        request.authUser!,
        db,
        request.projectRole
      );

      // Validate request body
      const validation = updatePolicySchema.safeParse(request.body);
      if (!validation.success) {
        throw new ValidationError('Invalid data residency policy data', validation.error.issues);
      }

      const { region, storageRegion: requestedStorageRegion } = validation.data;

      // Get the preset for this region
      const preset = DATA_RESIDENCY_PRESETS[region as DataResidencyRegion];

      // Construct the policy object
      const policy: DataResidencyPolicy = {
        ...preset,
        region: region as DataResidencyRegion,
        storageRegion: requestedStorageRegion
          ? (requestedStorageRegion as StorageRegion)
          : preset.storageRegion,
      };

      // Delegate to service layer (validates, updates, and audits)
      await db.dataResidencyService.setProjectPolicy(projectId, policy, request.authUser!.id);

      // Get the updated policy
      const updatedPolicy = await db.dataResidency.getProjectPolicy(projectId);

      logger.info('Data residency policy updated', {
        projectId,
        region: policy.region,
        storageRegion: policy.storageRegion,
        userId: request.authUser!.id,
      });

      return sendSuccess(reply, {
        projectId,
        policy: updatedPolicy,
        message: 'Data residency policy updated successfully',
      });
    }
  );

  /**
   * GET /api/v1/projects/:id/data-residency/compliance
   * Get compliance summary for a project
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/projects/:id/data-residency/compliance',
    {
      schema: projectIdParamsSchema,
      preHandler: [requireUser, requireProjectAccess(db)],
    },
    async (request, reply: FastifyReply) => {
      const { id: projectId } = request.params;

      // Use service to get compliance summary with isCompliant calculated
      const summary = await db.dataResidencyService.getComplianceSummary(projectId);

      return sendSuccess(reply, {
        projectId,
        isCompliant: summary.isCompliant,
        policy: summary.policy,
        storageAvailable: summary.storageConfigured,
        violations: {
          count: summary.violationCount,
          recent: summary.recentViolations.map((v) => ({
            id: v.id,
            type: v.violationType,
            description: v.description,
            blocked: v.blocked,
            createdAt: v.createdAt,
          })),
        },
        auditEntries: {
          count: summary.auditCount,
        },
      });
    }
  );

  /**
   * GET /api/v1/projects/:id/data-residency/audit
   * Get audit log entries for a project
   */
  fastify.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/v1/projects/:id/data-residency/audit',
    {
      schema: projectIdParamsSchema,
      preHandler: [requireUser, requireProjectAccess(db)],
    },
    async (request, reply: FastifyReply) => {
      const { id: projectId } = request.params;

      // Parse query params
      const queryValidation = auditQuerySchema.safeParse(request.query);
      if (!queryValidation.success) {
        throw new ValidationError('Invalid audit query parameters', queryValidation.error.issues);
      }

      const { action, since, until, limit = 100, offset = 0 } = queryValidation.data;

      const [entries, totalCount] = await Promise.all([
        db.dataResidencyService.getProjectAuditEntries(projectId, {
          action,
          since: since ? new Date(since) : undefined,
          until: until ? new Date(until) : undefined,
          limit,
          offset,
        }),
        db.dataResidency.countProjectAuditEntries(projectId, {
          action,
          since: since ? new Date(since) : undefined,
          until: until ? new Date(until) : undefined,
        }),
      ]);

      const page = Math.floor(offset / limit) + 1;
      const totalPages = Math.ceil(totalCount / limit);

      return sendPaginated(
        reply,
        {
          projectId,
          entries: entries.map((e) => ({
            id: e.id,
            action: e.action,
            resourceType: e.resourceType,
            resourceId: e.resourceId,
            storageRegion: e.storageRegion,
            userId: e.userId,
            ipAddress: e.ipAddress,
            metadata: e.metadata,
            createdAt: e.createdAt,
          })),
        },
        { page, limit, total: totalCount, totalPages }
      );
    }
  );

  /**
   * GET /api/v1/projects/:id/data-residency/violations
   * Get data residency violations for a project
   */
  fastify.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/api/v1/projects/:id/data-residency/violations',
    {
      schema: projectIdParamsSchema,
      preHandler: [requireUser, requireProjectAccess(db)],
    },
    async (request, reply: FastifyReply) => {
      const { id: projectId } = request.params;

      // Parse query params
      const queryValidation = violationQuerySchema.safeParse(request.query);
      if (!queryValidation.success) {
        throw new ValidationError(
          'Invalid violations query parameters',
          queryValidation.error.issues
        );
      }

      const {
        violationType,
        blocked,
        since,
        until,
        limit = 100,
        offset = 0,
      } = queryValidation.data;

      const [violations, totalCount] = await Promise.all([
        db.dataResidencyService.getProjectViolations(projectId, {
          violationType,
          blocked,
          since: since ? new Date(since) : undefined,
          until: until ? new Date(until) : undefined,
          limit,
          offset,
        }),
        db.dataResidency.countProjectViolations(projectId, {
          violationType,
          blocked,
          since: since ? new Date(since) : undefined,
          until: until ? new Date(until) : undefined,
        }),
      ]);

      const page = Math.floor(offset / limit) + 1;
      const totalPages = Math.ceil(totalCount / limit);

      return sendPaginated(
        reply,
        {
          projectId,
          violations: violations.map((v) => ({
            id: v.id,
            type: v.violationType,
            description: v.description,
            attemptedAction: v.attemptedAction,
            sourceRegion: v.sourceRegion,
            targetRegion: v.targetRegion,
            blocked: v.blocked,
            userId: v.userId,
            createdAt: v.createdAt,
          })),
        },
        { page, limit, total: totalCount, totalPages }
      );
    }
  );

  /**
   * GET /api/v1/data-residency/regions
   * Get available data residency regions and their configurations
   * Public endpoint for SDK/client configuration
   */
  fastify.get(
    '/api/v1/data-residency/regions',
    {
      config: { public: true }, // Mark as public endpoint
    },
    async (_request, reply: FastifyReply) => {
      const regions = Object.entries(DATA_RESIDENCY_PRESETS).map(([key, preset]) => ({
        id: key,
        name: getRegionDisplayName(key as DataResidencyRegion),
        storageRegions: ALLOWED_STORAGE_REGIONS[key as DataResidencyRegion],
        defaultStorageRegion: preset.storageRegion,
        allowCrossRegionBackup: preset.allowCrossRegionBackup,
        allowCrossRegionProcessing: preset.allowCrossRegionProcessing,
        encryptionRequired: preset.encryptionRequired,
      }));

      return sendSuccess(reply, { regions });
    }
  );
}
