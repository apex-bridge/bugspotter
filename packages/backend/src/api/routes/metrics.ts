/**
 * Prometheus Metrics Route
 * Exposes /metrics endpoint for Prometheus scraping.
 *
 * If METRICS_AUTH_TOKEN is set, requests must include
 * `Authorization: Bearer <token>`. This prevents unauthenticated
 * access to process/runtime internals on host-published ports.
 * When unset, the endpoint is open (backwards-compatible for dev).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { register } from '../../metrics/registry.js';

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/metrics',
    { config: { public: true } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const metricsToken = process.env.METRICS_AUTH_TOKEN ?? '';
      if (metricsToken && request.headers.authorization !== `Bearer ${metricsToken}`) {
        reply.code(401);
        return { error: 'Unauthorized' };
      }
      reply.type(register.contentType);
      return register.metrics();
    }
  );
}
