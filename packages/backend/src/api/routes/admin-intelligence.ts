/**
 * Admin Intelligence Routes
 * Platform-admin (operator) view of the intelligence service.
 *
 * GET /api/v1/admin/intelligence/status proxies the upstream master-key
 * endpoint GET /api/v1/admin/status — active provider/model, cloud-key
 * presence (booleans only), thresholds, and embedding-pipeline health.
 * Service-global (one intelligence service), so it uses the master-key
 * admin channel rather than a per-org client.
 */

import type { FastifyInstance } from 'fastify';
import { sendSuccess } from '../utils/response.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { getIntelligenceConfig } from '../../config/intelligence.config.js';
import { IntelligenceClient } from '../../services/intelligence/intelligence-client.js';

export async function adminIntelligenceRoutes(fastify: FastifyInstance): Promise<void> {
  const config = getIntelligenceConfig();

  // Construct the master-keyed admin client once (the status endpoint is
  // service-global). Null when the master channel isn't configured.
  const adminClient =
    config.masterApiKey && config.adminBaseUrl
      ? new IntelligenceClient({
          ...config.client,
          baseUrl: config.adminBaseUrl,
          apiKey: config.masterApiKey,
        })
      : null;

  /**
   * GET /api/v1/admin/intelligence/status
   * Operator service status. Requires: platform admin.
   */
  fastify.get(
    '/api/v1/admin/intelligence/status',
    { onRequest: [requirePlatformAdmin()] },
    async (_request, reply) => {
      if (!config.enabled || !adminClient) {
        throw new AppError('Intelligence service is not configured', 503, 'ServiceUnavailable');
      }
      const status = await adminClient.getServiceStatus();
      return sendSuccess(reply, status);
    }
  );
}
