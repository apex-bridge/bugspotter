/**
 * Intelligence Plugin
 *
 * Self-contained Fastify plugin that wires up the bugspotter-intelligence
 * integration. When INTELLIGENCE_ENABLED=true, it:
 *   1. Instantiates an IntelligenceClient (HTTP + circuit breaker)
 *   2. Registers proxy routes for health, similar bugs, mitigation, search, ask
 *   3. Decorates the Fastify instance so other plugins/routes can access the client
 *
 * When INTELLIGENCE_ENABLED=false (or unset), the plugin is a no-op — no routes
 * are registered and no decoration is added beyond the undefined marker.
 */

import type { FastifyInstance } from 'fastify';
import { getIntelligenceConfig } from '../config/intelligence.config.js';
import { IntelligenceClient } from '../services/intelligence/intelligence-client.js';
import { IntelligenceClientFactory } from '../services/intelligence/tenant-config.js';
import { getEncryptionService } from '../utils/encryption.js';
import { intelligenceRoutes } from '../api/routes/intelligence.js';
import { getLogger } from '../logger.js';
import type { IServiceContainer } from '../container/service-container.js';

declare module 'fastify' {
  interface FastifyInstance {
    intelligenceClient?: IntelligenceClient;
  }
}

/**
 * Set up intelligence integration directly on the Fastify instance.
 * Called from server.ts — avoids fastify.register() encapsulation issues
 * that can interfere with the global error handler.
 */
export async function setupIntelligence(fastify: FastifyInstance): Promise<void> {
  const logger = getLogger();
  const config = getIntelligenceConfig();

  if (!config.enabled) {
    logger.info('Intelligence plugin: disabled (INTELLIGENCE_ENABLED != true)');
    fastify.decorate('intelligenceClient', undefined);
    return;
  }

  const client = new IntelligenceClient(config.client);
  fastify.decorate('intelligenceClient', client);

  // Register intelligence API routes (requires container.db for project access checks)
  const container = (fastify as FastifyInstance & { container?: IServiceContainer }).container;
  if (container) {
    // Create per-org client factory for tenant-scoped intelligence calls
    const clientFactory = new IntelligenceClientFactory(
      container.db,
      config,
      getEncryptionService()
    );
    intelligenceRoutes(fastify, client, container.db, clientFactory);
    logger.info('Intelligence plugin: enabled and routes registered');
  } else {
    logger.warn(
      'Intelligence plugin: enabled but routes NOT registered (database client unavailable)'
    );
  }
}
