/**
 * API Key Management Routes
 * Endpoints for managing API keys with RBAC
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { ApiKeyFilters, PermissionScope, OrgMemberRole } from '../../db/types.js';
import { getEffectiveProjectRole } from '../../types/project-roles.js';
import { hasPermissionLevel } from '../../types/project-roles.js';
import { requireUser } from '../middleware/auth.js';
import { assertAuthUser, isPlatformAdmin } from '../middleware/auth/assertions.js';
import { AppError } from '../middleware/error.js';
import { sendSuccess, sendCreated, sendPaginated } from '../utils/response.js';
import { RATE_LIMITS } from '../utils/constants.js';
import { ApiKeyService } from '../../services/api-key/index.js';
import { mapUpdateFields, getRateLimitStatus } from '../utils/api-key-helpers.js';
import {
  createApiKeySchema,
  listApiKeysSchema,
  getApiKeySchema,
  updateApiKeySchema,
  revokeApiKeySchema,
  rotateApiKeySchema,
  getApiKeyUsageSchema,
  getApiKeyAuditSchema,
} from '../schemas/api-key-schema.js';

/**
 * Helper function to fetch and authorize access to an API key
 * Non-admin users can only access their own keys
 *
 * @throws {AppError} 404 if key not found
 * @throws {AppError} 403 if user doesn't have access
 */
async function authorizeApiKeyAccess(
  apiKeyService: ApiKeyService,
  keyId: string,
  userId: string,
  isAdminUser: boolean
) {
  const apiKey = await apiKeyService.getKeyById(keyId);

  if (!apiKey) {
    throw new AppError('API key not found', 404, 'NotFound');
  }

  // Non-admin users can only manage their own keys
  if (!isAdminUser && apiKey.created_by !== userId) {
    throw new AppError('Access denied', 403, 'Forbidden');
  }

  return apiKey;
}

/**
 * Check if a user has org membership covering at least one of the given projects.
 * Used by per-key read access (authorizeApiKeyReadAccess).
 */
async function isOrgMemberForProjects(
  db: DatabaseClient,
  userId: string,
  projectIds: string[]
): Promise<boolean> {
  if (!projectIds.length) {
    return false;
  }
  const result = await db.query(
    `SELECT 1 FROM application.projects p
     JOIN saas.organization_members om ON om.organization_id = p.organization_id
     WHERE om.user_id = $1 AND p.id = ANY($2)
     LIMIT 1`,
    [userId, projectIds]
  );
  return result.rows.length > 0;
}

/**
 * Read-only access: allows org members to view keys for projects in their org.
 * Used for GET endpoints (view details, usage). Mutation endpoints use authorizeApiKeyAccess.
 * Strips key_hash for non-creator/non-admin users.
 */
async function authorizeApiKeyReadAccess(
  apiKeyService: ApiKeyService,
  keyId: string,
  userId: string,
  isAdminUser: boolean,
  db: DatabaseClient
) {
  const apiKey = await apiKeyService.getKeyById(keyId);

  if (!apiKey) {
    throw new AppError('API key not found', 404, 'NotFound');
  }

  if (isAdminUser || apiKey.created_by === userId) {
    return apiKey;
  }

  if (apiKey.allowed_projects?.length) {
    const hasAccess = await isOrgMemberForProjects(db, userId, apiKey.allowed_projects);
    if (hasAccess) {
      // Strip sensitive fields for read-only org members
      const { key_hash: _hash, ...safeKey } = apiKey;
      return safeKey;
    }
  }

  throw new AppError('Access denied', 403, 'Forbidden');
}

export function apiKeyRoutes(fastify: FastifyInstance, db: DatabaseClient) {
  const apiKeyService = new ApiKeyService(db);

  // Create new API key (viewers cannot create API keys)
  fastify.post(
    '/api/v1/api-keys',
    {
      preHandler: [requireUser],
      schema: createApiKeySchema,
    },
    async (request, reply) => {
      assertAuthUser(request);
      if (!isPlatformAdmin(request) && request.authUser.role === 'viewer') {
        throw new AppError('Viewers cannot create API keys', 403, 'Forbidden');
      }

      const {
        name,
        type,
        permission_scope,
        permissions = [],
        allowed_projects = [],
        allowed_origins = [],
        rate_limit_per_minute,
        rate_limit_per_hour,
        rate_limit_per_day,
        expires_at,
      } = request.body as {
        name: string;
        type: 'development' | 'test' | 'production';
        permission_scope: PermissionScope;
        permissions?: string[];
        allowed_projects?: string[];
        allowed_origins?: string[];
        rate_limit_per_minute?: number;
        rate_limit_per_hour?: number;
        rate_limit_per_day?: number;
        expires_at?: string;
      };

      // Authorization: Platform admins can create keys for any projects
      // Other users need owner/admin role (explicit or inherited from org) for all specified projects
      if (!isPlatformAdmin(request)) {
        if (allowed_projects.length === 0) {
          throw new AppError('Non-admin users must specify at least one project', 403, 'Forbidden');
        }

        // Step 1: Batch-fetch explicit project roles
        const roleMap = await db.projects.getUserRolesForProjects(
          allowed_projects,
          request.authUser.id
        );

        // Step 2: Identify projects needing org inheritance check
        const needsOrgCheck = allowed_projects.filter((pid) => {
          const role = roleMap.get(pid);
          return role !== 'owner' && role !== 'admin';
        });

        // Step 3: Batch-fetch org memberships for projects lacking explicit admin access
        const orgMembershipMap = new Map<string, OrgMemberRole>();
        if (needsOrgCheck.length > 0) {
          // Single query to fetch all projects needing org check
          const projects = (await db.projects.findByIds(needsOrgCheck)) as Array<{
            id: string;
            organization_id?: string;
          }>;
          const projectMap = new Map(projects.map((p) => [p.id, p]));

          // Reject any unknown project IDs
          for (const pid of needsOrgCheck) {
            if (!projectMap.has(pid)) {
              throw new AppError(`Project not found: ${pid}`, 404, 'NotFound');
            }
          }

          const orgIds = [
            ...new Set(projects.map((p) => p.organization_id).filter(Boolean) as string[]),
          ];

          // Fetch user's memberships for all relevant orgs in one query
          if (orgIds.length > 0) {
            const memberships = await db.organizationMembers.findByUserId(request.authUser.id);
            for (const m of memberships) {
              if (orgIds.includes(m.organization_id)) {
                orgMembershipMap.set(m.organization_id, m.role as OrgMemberRole);
              }
            }
          }

          // Step 4: Validate each project using effective role
          for (const project of projects) {
            const explicitRole = roleMap.get(project.id);
            const orgRole = project.organization_id
              ? orgMembershipMap.get(project.organization_id)
              : undefined;
            const effectiveRole = getEffectiveProjectRole(
              explicitRole ? (explicitRole as 'owner' | 'admin' | 'member' | 'viewer') : undefined,
              orgRole
            );
            if (!effectiveRole || !hasPermissionLevel(effectiveRole, 'admin')) {
              throw new AppError(
                `Access denied: You must be owner or admin of project ${project.id}`,
                403,
                'Forbidden'
              );
            }
          }
        }
      }

      // Create API key (validation handled in service)
      const result = await apiKeyService.createKey({
        name,
        type,
        permission_scope,
        permissions,
        created_by: request.authUser.id,
        allowed_projects: allowed_projects.length > 0 ? allowed_projects : undefined,
        allowed_origins: allowed_origins.length > 0 ? allowed_origins : undefined,
        rate_limit_per_minute: rate_limit_per_minute ?? RATE_LIMITS.DEFAULT_PER_MINUTE,
        rate_limit_per_hour: rate_limit_per_hour ?? RATE_LIMITS.DEFAULT_PER_HOUR,
        rate_limit_per_day: rate_limit_per_day ?? RATE_LIMITS.DEFAULT_PER_DAY,
        expires_at: expires_at ? new Date(expires_at) : undefined,
      });

      return sendCreated(reply, {
        api_key: result.plaintext,
        key_details: result.key,
      });
    }
  );

  // List API keys with filtering and pagination
  fastify.get(
    '/api/v1/api-keys',
    {
      preHandler: requireUser,
      schema: listApiKeysSchema,
    },
    async (request, reply) => {
      assertAuthUser(request);

      const {
        page = 1,
        limit = 20,
        type,
        status,
        created_by,
        sort_by = 'created_at',
        sort_order = 'desc',
      } = request.query as {
        page?: number;
        limit?: number;
        type?: 'development' | 'test' | 'production';
        status?: 'active' | 'revoked' | 'expired';
        permission_scope?: PermissionScope;
        created_by?: string;
        sort_by?: 'created_at' | 'updated_at' | 'last_used_at' | 'name';
        sort_order?: 'asc' | 'desc';
      };

      // Build filters with proper type
      const filters: Partial<ApiKeyFilters> = {};
      if (type) {
        filters.type = type;
      }
      if (status) {
        filters.status = status;
      }

      // Non-admin users see their own keys + keys for projects in their org
      if (!isPlatformAdmin(request)) {
        filters.accessible_by_user_id = request.authUser.id;
      } else if (created_by) {
        filters.created_by = created_by;
      }

      const result = await apiKeyService.listKeys(
        filters,
        { sort_by, order: sort_order },
        { page, limit }
      );

      // Strip key_hash from keys the user didn't create (non-admin)
      const isAdmin = isPlatformAdmin(request);
      const data = isAdmin
        ? result.data
        : result.data.map((key) => {
            if (key.created_by === request.authUser.id) {
              return key;
            }
            const { key_hash: _hash, ...safeKey } = key;
            return safeKey;
          });

      return sendPaginated(reply, data, result.pagination);
    }
  );

  // Get single API key
  fastify.get(
    '/api/v1/api-keys/:id',
    {
      preHandler: requireUser,
      schema: getApiKeySchema,
    },
    async (request, reply) => {
      assertAuthUser(request);
      const { id } = request.params as { id: string };

      const apiKey = await authorizeApiKeyReadAccess(
        apiKeyService,
        id,
        request.authUser.id,
        isPlatformAdmin(request),
        db
      );

      return sendSuccess(reply, apiKey);
    }
  );

  // Update API key
  fastify.patch(
    '/api/v1/api-keys/:id',
    {
      preHandler: requireUser,
      schema: updateApiKeySchema,
    },
    async (request, reply) => {
      assertAuthUser(request);
      const { id } = request.params as { id: string };
      const requestBody = request.body as {
        name?: string;
        permission_scope?: PermissionScope;
        permissions?: string[];
        allowed_projects?: string[];
        allowed_origins?: string[];
        rate_limit_per_minute?: number | null;
        rate_limit_per_hour?: number | null;
        rate_limit_per_day?: number | null;
        expires_at?: string | null;
      };

      await authorizeApiKeyAccess(apiKeyService, id, request.authUser.id, isPlatformAdmin(request));

      // Map request body to updates object
      const updates = mapUpdateFields(requestBody);

      // Validation handled in service
      const updated = await apiKeyService.updateKey(id, updates, request.authUser.id);

      return sendSuccess(reply, updated);
    }
  );

  // Delete API key (soft delete — viewers cannot delete API keys)
  fastify.delete(
    '/api/v1/api-keys/:id',
    {
      preHandler: [requireUser],
    },
    async (request, reply) => {
      assertAuthUser(request);
      if (!isPlatformAdmin(request) && request.authUser.role === 'viewer') {
        throw new AppError('Viewers cannot delete API keys', 403, 'Forbidden');
      }
      const { id } = request.params as { id: string };

      await authorizeApiKeyAccess(apiKeyService, id, request.authUser.id, isPlatformAdmin(request));

      await apiKeyService.deleteKey(id, request.authUser.id);

      return sendSuccess(reply, { message: 'API key deleted successfully' });
    }
  );

  // Revoke API key
  fastify.post(
    '/api/v1/api-keys/:id/revoke',
    {
      preHandler: requireUser,
      schema: revokeApiKeySchema,
    },
    async (request, reply) => {
      assertAuthUser(request);
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason?: string };

      await authorizeApiKeyAccess(apiKeyService, id, request.authUser.id, isPlatformAdmin(request));

      await apiKeyService.revokeKey(id, request.authUser.id, reason);

      return sendSuccess(reply, { message: 'API key revoked successfully' });
    }
  );

  // Rotate API key
  fastify.post(
    '/api/v1/api-keys/:id/rotate',
    {
      preHandler: requireUser,
      schema: rotateApiKeySchema,
    },
    async (request, reply) => {
      assertAuthUser(request);
      const { id } = request.params as { id: string };

      await authorizeApiKeyAccess(apiKeyService, id, request.authUser.id, isPlatformAdmin(request));

      const result = await apiKeyService.rotateKey(id, request.authUser.id);

      return sendSuccess(reply, {
        new_api_key: result.plaintext,
        key_details: result.key,
      });
    }
  );

  // Get usage logs
  fastify.get(
    '/api/v1/api-keys/:id/usage',
    {
      preHandler: requireUser,
      schema: getApiKeyUsageSchema,
    },
    async (request, reply) => {
      assertAuthUser(request);
      const { id } = request.params as { id: string };
      const { limit = 100, offset = 0 } = request.query as { limit?: number; offset?: number };

      await authorizeApiKeyReadAccess(
        apiKeyService,
        id,
        request.authUser.id,
        isPlatformAdmin(request),
        db
      );

      const logs = await apiKeyService.getUsageLogs(id, limit, offset);

      return sendSuccess(reply, logs);
    }
  );

  // Get audit logs
  fastify.get(
    '/api/v1/api-keys/:id/audit',
    {
      preHandler: requireUser,
      schema: getApiKeyAuditSchema,
    },
    async (request, reply) => {
      assertAuthUser(request);
      const { id } = request.params as { id: string };
      const { limit = 100, offset = 0 } = request.query as { limit?: number; offset?: number };

      await authorizeApiKeyReadAccess(
        apiKeyService,
        id,
        request.authUser.id,
        isPlatformAdmin(request),
        db
      );

      const logs = await apiKeyService.getAuditLogs(id, limit, offset);

      return sendSuccess(reply, logs);
    }
  );

  // Get rate limit status
  fastify.get(
    '/api/v1/api-keys/:id/rate-limits',
    {
      preHandler: requireUser,
    },
    async (request, reply) => {
      assertAuthUser(request);
      const { id } = request.params as { id: string };

      const apiKey = await authorizeApiKeyAccess(
        apiKeyService,
        id,
        request.authUser.id,
        isPlatformAdmin(request)
      );

      const rateLimitStatus = await getRateLimitStatus(apiKeyService, id, apiKey);

      return sendSuccess(reply, rateLimitStatus);
    }
  );
}
