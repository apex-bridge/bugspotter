/**
 * Integration Rules API Routes
 * CRUD endpoints for managing integration filtering rules
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { checkProjectAccess, findOrThrow } from '../utils/resource.js';
import { AppError } from '../middleware/error.js';
import { requireAuth, requirePermission, requireProjectRole } from '../middleware/auth.js';
import { requireProjectAccess } from '../middleware/project-access.js';
import { getLogger } from '../../logger.js';
import { getCacheService } from '../../cache/index.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';
import type { FilterCondition, ThrottleConfig } from '../../types/notifications.js';
import type { FieldMappings, AttachmentConfig } from '@bugspotter/types';
import {
  createIntegrationRuleSchema,
  updateIntegrationRuleSchema,
  listIntegrationRulesSchema,
  deleteIntegrationRuleSchema,
  copyIntegrationRuleSchema,
} from '../schemas/integration-rule-schema.js';

const logger = getLogger();

/**
 * Get integration_id by platform name
 * Throws AppError if platform not found in system
 */
async function getIntegrationIdByPlatform(platform: string, db: DatabaseClient): Promise<string> {
  const result = await db.query<{ id: string }>(
    'SELECT id FROM application.integrations WHERE type = $1',
    [platform.toLowerCase()]
  );

  if (result.rows.length === 0) {
    throw new AppError(`Integration platform '${platform}' not found in system`, 400, 'BadRequest');
  }

  return result.rows[0].id;
}

/**
 * Load integration plugin dynamically
 * @param platform - Platform identifier
 * @param registry - Plugin registry
 * @throws AppError with detailed message if plugin cannot be loaded
 */
async function loadIntegrationPlugin(platform: string, registry: PluginRegistry): Promise<void> {
  try {
    await registry.loadDynamicPlugin(platform);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new AppError(
      `Integration platform '${platform}' not supported: ${errorMessage}`,
      400,
      'BadRequest'
    );
  }
}

/**
 * Get integration for project with plugin loading
 * Combines plugin loading and integration lookup - common pattern used in all routes
 */
async function getIntegrationForProject(
  platform: string,
  projectId: string,
  registry: PluginRegistry,
  db: DatabaseClient
) {
  // Load plugin dynamically (supports both built-in and custom plugins)
  await loadIntegrationPlugin(platform, registry);

  // Look up integration_id by platform (avoids deprecated findByProjectAndPlatform)
  const integrationId = await getIntegrationIdByPlatform(platform, db);

  // Get integration using non-deprecated method
  const integration = await db.projectIntegrations.findByProjectAndIntegrationId(
    projectId,
    integrationId
  );

  if (!integration) {
    throw new AppError(`${platform} integration not found for project`, 404, 'NotFound');
  }

  return integration;
}

/**
 * Validate rule ownership and return the rule
 * Used in UPDATE, DELETE, and COPY routes to ensure rule belongs to integration
 */
async function validateRuleOwnership(ruleId: string, integrationId: string, db: DatabaseClient) {
  const rule = await db.integrationRules.findById(ruleId);

  if (!rule) {
    throw new AppError('Integration rule not found', 404, 'NotFound');
  }

  if (rule.integration_id !== integrationId) {
    throw new AppError('Rule does not belong to this integration', 403, 'Forbidden');
  }

  return rule;
}

/**
 * Invalidate integration rules cache for a project
 * Called after CREATE, UPDATE, DELETE, and COPY operations
 */
async function invalidateRulesCache(projectId: string): Promise<void> {
  const cache = getCacheService();
  await cache.invalidateIntegrationRules(projectId);
}

interface CreateRuleBody {
  name: string;
  enabled?: boolean;
  priority?: number;
  filters: FilterCondition[];
  throttle?: ThrottleConfig | null;
  auto_create?: boolean;
  field_mappings?: FieldMappings | null;
  description_template?: string | null;
  attachment_config?: AttachmentConfig | null;
}

interface UpdateRuleBody {
  name?: string;
  enabled?: boolean;
  priority?: number;
  filters?: FilterCondition[];
  throttle?: ThrottleConfig | null;
  auto_create?: boolean;
  field_mappings?: FieldMappings | null;
  description_template?: string | null;
  attachment_config?: AttachmentConfig | null;
}

/**
 * Register integration rules routes
 */
export async function registerIntegrationRuleRoutes(
  server: FastifyInstance,
  db: DatabaseClient,
  registry: PluginRegistry
): Promise<void> {
  /**
   * List all rules for an integration
   * GET /api/v1/integrations/:platform/:projectId/rules
   */
  server.get<{ Params: { platform: string; projectId: string } }>(
    '/api/v1/integrations/:platform/:projectId/rules',
    {
      schema: listIntegrationRulesSchema,
      preHandler: [
        requireAuth,
        requirePermission(db, 'integration_rules', 'read'),
        requireProjectAccess(db, { paramName: 'projectId' }),
      ],
    },
    async (request, reply) => {
      const { platform, projectId } = request.params;

      // Get integration (loads plugin + validates existence)
      const integration = await getIntegrationForProject(platform, projectId, registry, db);

      // List rules for integration (including disabled rules for management UI)
      const rules = await db.integrationRules.findByProjectAndPlatform(
        projectId,
        integration.id,
        true // Include disabled rules so users can manage them
      );

      logger.debug('Listed integration rules', {
        platform,
        projectId,
        integrationId: integration.id,
        rulesCount: rules.length,
        userId: request.authUser?.id || 'api-key',
      });

      return sendSuccess(reply, rules);
    }
  );

  /**
   * Create a new integration rule
   * POST /api/v1/integrations/:platform/:projectId/rules
   */
  server.post<{ Params: { platform: string; projectId: string }; Body: CreateRuleBody }>(
    '/api/v1/integrations/:platform/:projectId/rules',
    {
      schema: createIntegrationRuleSchema,
      preHandler: [
        requireAuth,
        requirePermission(db, 'integration_rules', 'create'),
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { platform, projectId } = request.params;
      const {
        name,
        enabled = true,
        priority = 0,
        filters,
        throttle = null,
        auto_create = false,
        field_mappings = null,
        description_template = null,
        attachment_config = null,
      } = request.body;

      // Get integration (loads plugin + validates existence)
      const integration = await getIntegrationForProject(platform, projectId, registry, db);

      logger.info('Creating integration rule', {
        platform,
        projectId,
        integrationId: integration.id,
        name,
        filtersCount: filters.length,
        userId: request.authUser?.id || 'api-key',
      });

      // Create rule with validation
      const rule = await db.integrationRules.createWithValidation({
        project_id: projectId,
        integration_id: integration.id,
        name,
        enabled,
        priority,
        filters,
        throttle,
        auto_create,
        field_mappings,
        description_template,
        attachment_config,
      });

      // Invalidate cache
      await invalidateRulesCache(projectId);

      return sendCreated(reply, rule);
    }
  );

  /**
   * Update an integration rule
   * PATCH /api/v1/integrations/:platform/:projectId/rules/:ruleId
   */
  server.patch<{
    Params: { platform: string; projectId: string; ruleId: string };
    Body: UpdateRuleBody;
  }>(
    '/api/v1/integrations/:platform/:projectId/rules/:ruleId',
    {
      schema: updateIntegrationRuleSchema,
      preHandler: [
        requireAuth,
        requirePermission(db, 'integration_rules', 'update'),
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { platform, projectId, ruleId } = request.params;
      const updateData = request.body;

      // Get integration (loads plugin + validates existence)
      const integration = await getIntegrationForProject(platform, projectId, registry, db);

      logger.info('Updating integration rule', {
        platform,
        projectId,
        integrationId: integration.id,
        ruleId,
        updateFields: Object.keys(updateData),
        userId: request.authUser?.id || 'api-key',
      });

      // Verify rule ownership before update
      await validateRuleOwnership(ruleId, integration.id, db);

      // Update rule with validation
      const updatedRule = await db.integrationRules.updateWithValidation(ruleId, updateData);

      // Invalidate cache
      await invalidateRulesCache(projectId);

      return sendSuccess(reply, updatedRule);
    }
  );

  /**
   * Delete an integration rule
   * DELETE /api/v1/integrations/:platform/:projectId/rules/:ruleId
   */
  server.delete<{ Params: { platform: string; projectId: string; ruleId: string } }>(
    '/api/v1/integrations/:platform/:projectId/rules/:ruleId',
    {
      schema: deleteIntegrationRuleSchema,
      preHandler: [
        requireAuth,
        requirePermission(db, 'integration_rules', 'delete'),
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { platform, projectId, ruleId } = request.params;

      // Get integration (loads plugin + validates existence)
      const integration = await getIntegrationForProject(platform, projectId, registry, db);

      // Verify rule ownership
      const rule = await validateRuleOwnership(ruleId, integration.id, db);

      logger.info('Deleting integration rule', {
        platform,
        projectId,
        integrationId: integration.id,
        ruleId,
        ruleName: rule.name,
        userId: request.authUser?.id || 'api-key',
      });

      // Delete rule
      await db.integrationRules.delete(ruleId);

      // Invalidate cache
      await invalidateRulesCache(projectId);

      return reply.code(200).send({
        success: true,
        message: `Integration rule '${rule.name}' deleted successfully`,
      });
    }
  );

  /**
   * Copy integration rule to another project
   * POST /api/v1/integrations/:platform/:projectId/rules/:ruleId/copy
   */
  server.post<{
    Params: { platform: string; projectId: string; ruleId: string };
    Body: { targetProjectId: string; targetIntegrationId?: string };
  }>(
    '/api/v1/integrations/:platform/:projectId/rules/:ruleId/copy',
    {
      schema: copyIntegrationRuleSchema,
      preHandler: [
        requireAuth,
        requirePermission(db, 'integration_rules', 'create'),
        requireProjectAccess(db, { paramName: 'projectId' }),
        // Source project requires `member` role minimum (closes
        // GH-96: cross-tenant exfiltration). Without this, a user
        // with only `viewer` membership on the source could read
        // the source rule's filters / field_mappings /
        // description_template / attachment_config and persist them
        // in a target project they admin — extracting business-
        // sensitive logic across project boundaries. The target
        // project still requires `admin` (inline check below).
        // API-key auth still bypasses this gate by design (see the
        // checkProjectAccess JSDoc on `minProjectRole`).
        requireProjectRole('member'),
      ],
    },
    async (request, reply) => {
      const { platform, projectId, ruleId } = request.params;
      const { targetProjectId, targetIntegrationId } = request.body;

      // Load target project up-front so we can both pass its
      // organization_id to the inline access check (skipping the
      // redundant findById inside lookupInheritedProjectRole) and
      // enforce the cross-org guard a few lines below.
      const targetProject = await findOrThrow(
        () => db.projects.findById(targetProjectId),
        'Target project'
      );

      // Source project: `member`+ enforced via preHandler above.
      // Target project requires `admin` — inline check needed since it's a different project
      await checkProjectAccess(
        targetProjectId,
        request.authUser,
        request.authProject,
        db,
        'Integration Rules',
        {
          apiKey: request.apiKey,
          minProjectRole: 'admin',
          organizationId: targetProject.organization_id,
        }
      );

      // Cross-organisation guard (closes GH-101). Even a user who
      // satisfies BOTH project-level gates above cannot copy rules
      // across organisation boundaries: rule configurations contain
      // tenant-specific business logic (custom field mappings,
      // PII filters, internal description templates) that should
      // stay within the org they originated in. Strict equality
      // handles all four cases:
      //   - both null  → standalone projects, equal, allowed
      //   - both same  → same org, allowed
      //   - one null, one set → not equal, blocked
      //   - different orgs  → not equal, blocked
      // The check applies uniformly to JWT and API-key auth — full-
      // scope keys still need source and target to be in the same
      // org. If a future deployment legitimately needs cross-org
      // copying for sufficiently-privileged callers, add an explicit
      // bypass rather than relaxing this guard.
      const sourceProject = request.project;
      if (sourceProject?.organization_id !== targetProject.organization_id) {
        throw new AppError('Cannot copy rules across organizations', 403, 'Forbidden');
      }

      // Get source rule to verify ownership
      const sourceRule = await db.integrationRules.findById(ruleId);

      if (!sourceRule) {
        throw new AppError('Integration rule not found', 404, 'NotFound');
      }

      // Verify source rule belongs to source project
      if (sourceRule.project_id !== projectId) {
        throw new AppError('Integration rule not found in this project', 404, 'NotFound');
      }

      // Get source integration to verify platform
      const sourceIntegration = await db.projectIntegrations.findByIdWithType(
        sourceRule.integration_id
      );

      if (!sourceIntegration || sourceIntegration.integration_type !== platform) {
        throw new AppError('Integration mismatch', 400, 'BadRequest');
      }

      // Get or find target integration
      let targetIntegration;
      if (targetIntegrationId) {
        targetIntegration = await db.projectIntegrations.findByIdWithType(targetIntegrationId);
        if (
          !targetIntegration ||
          targetIntegration.project_id !== targetProjectId ||
          targetIntegration.integration_type !== platform
        ) {
          throw new AppError(
            'Target integration not found or platform mismatch',
            400,
            'BadRequest'
          );
        }
      } else {
        // Auto-detect: find first enabled integration of same platform in target project
        const integrationId = await getIntegrationIdByPlatform(platform, db);

        // Get integration using non-deprecated method
        const targetIntegrationData = await db.projectIntegrations.findByProjectAndIntegrationId(
          targetProjectId,
          integrationId
        );

        if (!targetIntegrationData) {
          throw new AppError(`No ${platform} integration found in target project`, 404, 'NotFound');
        }

        // Convert to WithType format for consistency
        targetIntegration = {
          ...targetIntegrationData,
          integration_type: platform,
        };
      }

      logger.info('Copying integration rule to another project', {
        sourceRuleId: ruleId,
        sourceProjectId: projectId,
        targetProjectId,
        targetIntegrationId: targetIntegration.id,
        platform,
        userId: request.authUser?.id || 'api-key',
      });

      // Copy rule using repository method
      const copiedRule = await db.integrationRules.copyToProject(
        ruleId,
        targetProjectId,
        targetIntegration.id
      );

      // Invalidate cache for target project
      await invalidateRulesCache(targetProjectId);

      return sendCreated(reply, {
        message: `Rule '${sourceRule.name}' copied to target project successfully`,
        rule: copiedRule,
      });
    }
  );

  logger.info('Integration rules routes registered');
}
