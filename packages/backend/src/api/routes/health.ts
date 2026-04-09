/**
 * Health check routes
 * Provides liveness and readiness endpoints for monitoring
 *
 * REFACTORED: Now uses req.ctx.services pattern for dependency injection
 */

import type { FastifyInstance } from 'fastify';
import { getServices } from '../../container/index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Read build timestamp from package.json or use current timestamp
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let buildInfo: { version: string; buildTime: string };

try {
  const packageJson = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf-8'));
  buildInfo = {
    version: packageJson.version || '0.1.0',
    buildTime: new Date().toISOString(), // Will be set at container build time
  };
} catch {
  buildInfo = {
    version: '0.1.0',
    buildTime: new Date().toISOString(),
  };
}

export async function healthRoutes(fastify: FastifyInstance) {
  await Promise.resolve(); // Make function actually async
  /**
   * GET /health
   * Simple liveness check - returns 200 if server is running
   */
  fastify.get('/health', { config: { public: true } }, async (_request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      build: buildInfo,
    });
  });

  /**
   * GET /ready
   * Readiness check - verifies database connectivity and plugin execution capability
   * REFACTORED: Uses req.ctx.services to access database
   */
  fastify.get('/ready', { config: { public: true } }, async (request, reply) => {
    try {
      const services = getServices(request);

      // Check database connectivity
      const dbHealthy = await services.db.testConnection();

      // Check Redis connectivity (with 3s timeout to prevent hanging)
      // queueManager is optional — API-only deployments may not have Redis
      let redisStatus: 'healthy' | 'unhealthy' | 'not-configured' = 'not-configured';
      if (services.queueManager) {
        const pingResult = await Promise.race([
          services.queueManager
            .getConnection()
            .ping()
            .then(() => true)
            .catch(() => false),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
        ]);
        redisStatus = pingResult ? 'healthy' : 'unhealthy';
      }

      // Check isolated-vm availability for plugin execution
      let isolatedVmAvailable = false;
      try {
        await import('isolated-vm');
        isolatedVmAvailable = true;
      } catch {
        request.log.warn('isolated-vm module not available - plugin execution will fail');
      }

      const isReady = dbHealthy && redisStatus !== 'unhealthy';

      const checks = {
        database: dbHealthy ? 'healthy' : 'unhealthy',
        redis: redisStatus,
        plugins: isolatedVmAvailable ? 'healthy' : 'degraded',
      };

      return reply.code(isReady ? 200 : 503).send({
        status: isReady ? 'ready' : 'unavailable',
        timestamp: new Date().toISOString(),
        checks,
      });
    } catch (error) {
      request.log.error({ error }, 'Readiness check failed');
      return reply.code(503).send({
        status: 'unavailable',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'unhealthy',
          redis: 'unknown',
          plugins: 'unknown',
        },
      });
    }
  });
}
