/**
 * Self-Service Resolution Plugin
 *
 * Registers self-service resolution routes when intelligence is enabled.
 * End users can check descriptions against known resolutions and record
 * deflection events when they self-resolve.
 *
 * Depends on the intelligence plugin being set up first (needs intelligenceClient).
 */

import type { FastifyInstance } from 'fastify';
import { selfServiceRoutes } from '../api/routes/self-service.js';
import { getLogger } from '../logger.js';
import type { IServiceContainer } from '../container/service-container.js';

export async function setupSelfService(fastify: FastifyInstance): Promise<void> {
  const logger = getLogger();

  if (!fastify.intelligenceClient) {
    logger.info('Self-service plugin: disabled (intelligence not enabled)');
    return;
  }

  const container = (fastify as FastifyInstance & { container?: IServiceContainer }).container;
  if (!container) {
    logger.warn(
      'Self-service plugin: enabled but routes NOT registered (database client unavailable)'
    );
    return;
  }

  selfServiceRoutes(fastify, container.db, fastify.intelligenceClient);
  logger.info('Self-service plugin: enabled and routes registered');
}
