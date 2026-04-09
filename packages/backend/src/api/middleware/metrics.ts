/**
 * Fastify Metrics Plugin
 * Records HTTP request duration and count for Prometheus.
 * Wrapped with fastify-plugin to skip encapsulation — hooks apply to all routes.
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { httpRequestDuration, httpRequestTotal } from '../../metrics/registry.js';

declare module 'fastify' {
  interface FastifyRequest {
    metricsStartTime?: bigint;
  }
}

// Internal routes excluded from HTTP metrics — scrape and healthcheck traffic
// would skew user-facing latency percentiles and may trigger false alerts.
const IGNORED_ROUTES: ReadonlySet<string> = new Set(['/metrics', '/health', '/ready']);

export const metricsPlugin = fp(async function metricsPlugin(
  fastify: FastifyInstance
): Promise<void> {
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.metricsStartTime = process.hrtime.bigint();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.metricsStartTime === undefined) {
      return;
    }

    // Use route pattern (bounded cardinality) not actual URL
    const route = request.routeOptions?.url || 'unknown';

    if (IGNORED_ROUTES.has(route)) {
      return;
    }

    const durationNs = Number(process.hrtime.bigint() - request.metricsStartTime);
    const durationSec = durationNs / 1e9;

    const labels = {
      method: request.method,
      route,
      status_code: String(reply.statusCode),
    };

    httpRequestDuration.observe(labels, durationSec);
    httpRequestTotal.inc(labels);
  });
});
