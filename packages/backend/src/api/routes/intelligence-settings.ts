/**
 * Intelligence Settings Routes
 *
 * Admin routes for per-org intelligence configuration:
 *   GET    /api/v1/organizations/:id/intelligence/settings      — read settings + key status (admin)
 *   PATCH  /api/v1/organizations/:id/intelligence/settings      — update settings (admin)
 *   POST   /api/v1/organizations/:id/intelligence/key           — provision API key (admin)
 *   POST   /api/v1/organizations/:id/intelligence/key/generate  — generate + auto-provision key (admin)
 *   DELETE /api/v1/organizations/:id/intelligence/key           — revoke API key (admin)
 *
 * Member-readable status route:
 *   GET    /api/v1/organizations/:id/intelligence/status        — { intelligence_enabled }
 *     Used by the bug-report-detail UI to gate enrichment / similar-bugs
 *     / suggest-fix affordances. Any org member may read.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';

import { guard } from '../authorization/index.js';
import { sendSuccess, sendNoContent } from '../utils/response.js';
import { successResponseSchema } from '../schemas/common-schema.js';
import { getEncryptionService } from '../../utils/encryption.js';
import { IntelligenceKeyProvisioning } from '../../services/intelligence/key-provisioning.js';
import {
  IntelligenceClientFactory,
  resolveOrgIntelligenceSettings,
} from '../../services/intelligence/tenant-config.js';
import { getIntelligenceConfig } from '../../config/intelligence.config.js';

// ============================================================================
// Schemas
// ============================================================================

const orgIdParams = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const settingsResponse = {
  200: successResponseSchema,
} as const;

const provisionKeyBody = {
  type: 'object',
  required: ['api_key'],
  properties: {
    api_key: { type: 'string', minLength: 1, maxLength: 512 },
  },
} as const;

const updateSettingsBody = {
  type: 'object',
  properties: {
    intelligence_enabled: { type: 'boolean' },
    intelligence_provider: { type: ['string', 'null'] },
    intelligence_auto_analyze: { type: 'boolean' },
    intelligence_auto_enrich: { type: 'boolean' },
    intelligence_similarity_threshold: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    intelligence_dedup_enabled: { type: 'boolean' },
    intelligence_dedup_action: { type: ['string', 'null'], enum: ['flag', 'auto_close', null] },
    intelligence_self_service_enabled: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

// ============================================================================
// Route types
// ============================================================================

interface ProvisionKeyBody {
  api_key: string;
}

interface UpdateSettingsBody {
  intelligence_enabled?: boolean;
  intelligence_provider?: string | null;
  intelligence_auto_analyze?: boolean;
  intelligence_auto_enrich?: boolean;
  intelligence_similarity_threshold?: number | null;
  intelligence_dedup_enabled?: boolean;
  intelligence_dedup_action?: 'flag' | 'auto_close' | null;
  intelligence_self_service_enabled?: boolean;
}

// ============================================================================
// Route registration
// ============================================================================

export function intelligenceSettingsRoutes(fastify: FastifyInstance, db: DatabaseClient): void {
  const encryption = getEncryptionService();
  const globalConfig = getIntelligenceConfig();
  const clientFactory = new IntelligenceClientFactory(db, globalConfig, encryption);
  const provisioning = new IntelligenceKeyProvisioning(
    db,
    encryption,
    clientFactory,
    globalConfig.adminBaseUrl,
    globalConfig.masterApiKey
  );

  const adminPreHandler = [
    guard(db, {
      auth: 'user',
      resource: { type: 'organization' },
      orgRole: 'admin',
      action: 'manage',
    }),
  ];

  // Any-member preHandler — used for the read-only `/status` endpoint
  // so bug-detail UI can gate intelligence widgets without requiring
  // admin role.
  const memberPreHandler = [
    guard(db, {
      auth: 'user',
      resource: { type: 'organization' },
    }),
  ];

  // GET /api/v1/organizations/:id/intelligence/status
  // Lightweight feature-flag read. Returns just `intelligence_enabled`
  // so bug-detail consumers (any org member) can hide enrichment /
  // similar-bugs / suggest-fix UI without the admin-only settings call.
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/intelligence/status',
    {
      preHandler: memberPreHandler,
      schema: {
        params: orgIdParams,
        response: {
          200: {
            type: 'object',
            required: ['success', 'data', 'timestamp'],
            properties: {
              success: { type: 'boolean', enum: [true] },
              data: {
                type: 'object',
                required: ['intelligence_enabled'],
                properties: {
                  intelligence_enabled: { type: 'boolean' },
                },
              },
              timestamp: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const settings = resolveOrgIntelligenceSettings(request.organization!.settings);
      return sendSuccess(reply, {
        intelligence_enabled: settings.intelligence_enabled === true,
      });
    }
  );

  // GET /api/v1/organizations/:id/intelligence/settings
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/intelligence/settings',
    {
      preHandler: adminPreHandler,
      schema: { params: orgIdParams, response: settingsResponse },
    },
    async (request, reply) => {
      const { id } = request.params;

      // Derive from org already loaded by guard() middleware — no extra DB query
      const settings = resolveOrgIntelligenceSettings(request.organization!.settings);
      const keyStatus = await provisioning.getKeyStatus(id, settings);

      const { intelligence_api_key: _key, ...safeSettings } = settings;
      return sendSuccess(reply, {
        ...safeSettings,
        key_status: keyStatus,
      });
    }
  );

  // PATCH /api/v1/organizations/:id/intelligence/settings
  fastify.patch<{ Params: { id: string }; Body: UpdateSettingsBody }>(
    '/api/v1/organizations/:id/intelligence/settings',
    {
      preHandler: adminPreHandler,
      schema: {
        params: orgIdParams,
        body: updateSettingsBody,
        response: settingsResponse,
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const updates = request.body;

      const settings = await provisioning.updateSettings(id, updates);

      const { intelligence_api_key: _key, ...safeSettings } = settings;
      return sendSuccess(reply, safeSettings);
    }
  );

  // POST /api/v1/organizations/:id/intelligence/key
  fastify.post<{ Params: { id: string }; Body: ProvisionKeyBody }>(
    '/api/v1/organizations/:id/intelligence/key',
    {
      preHandler: adminPreHandler,
      schema: {
        params: orgIdParams,
        body: provisionKeyBody,
        response: settingsResponse,
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { api_key } = request.body;

      const result = await provisioning.provisionKey(id, api_key, request.authUser!.id);

      return sendSuccess(reply, result);
    }
  );

  // POST /api/v1/organizations/:id/intelligence/key/generate
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/intelligence/key/generate',
    {
      preHandler: adminPreHandler,
      schema: { params: orgIdParams, response: settingsResponse },
    },
    async (request, reply) => {
      const { id } = request.params;

      const result = await provisioning.generateAndProvisionKey(id, request.authUser!.id);

      return sendSuccess(reply, result);
    }
  );

  // DELETE /api/v1/organizations/:id/intelligence/key
  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/organizations/:id/intelligence/key',
    {
      preHandler: adminPreHandler,
      schema: { params: orgIdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      await provisioning.revokeKey(id);

      return sendNoContent(reply);
    }
  );
}
