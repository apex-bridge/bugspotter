/**
 * Deployment Configuration Route
 * Exposes deployment mode and feature flags to the frontend.
 * Public endpoint — no authentication required.
 */
import type { FastifyInstance } from 'fastify';
import { sendSuccess } from '../utils/response.js';
import { getDeploymentConfig } from '../../saas/config.js';

export function deploymentRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/v1/deployment', { config: { public: true } }, async (_request, reply) => {
    const config = getDeploymentConfig();
    return sendSuccess(reply, {
      mode: config.mode,
      features: config.features,
    });
  });
}
