/**
 * Admin routes
 * System health monitoring and settings management
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { sendSuccess } from '../utils/response.js';
import { requirePlatformAdmin } from '../middleware/auth.js';
import { getLogger } from '../../logger.js';
import { getCacheService } from '../../cache/index.js';
import { HealthCheckService } from '../services/health-check-service.js';
import { SettingsService, type InstanceSettings } from '../services/settings-service.js';
import os from 'os';

const logger = getLogger();

export async function adminRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  pluginRegistry?: import('../../integrations/plugin-registry.js').PluginRegistry
): Promise<void> {
  // Initialize services
  const healthCheckService = new HealthCheckService(db, pluginRegistry);
  const settingsService = new SettingsService(db);

  /**
   * GET /api/v1/admin/health
   * Get comprehensive system health status
   * Includes services, workers, queues, plugins, and system metrics
   * Requires: platform admin
   */
  fastify.get(
    '/api/v1/admin/health',
    { onRequest: [requirePlatformAdmin()] },
    async (_request, reply) => {
      const health = await healthCheckService.getComprehensiveHealth();

      // Map ComprehensiveHealth to API format
      const response = {
        status:
          health.status === 'up'
            ? ('healthy' as const)
            : health.status === 'degraded'
              ? ('degraded' as const)
              : ('unhealthy' as const),
        timestamp: new Date().toISOString(),
        services: health.services,
        workers: health.workers,
        queues: health.queues,
        plugins: health.plugins,
        system: {
          disk_space_available: health.system.disk.available,
          disk_space_total: health.system.disk.total,
          worker_queue_depth: health.system.queue_depth,
          uptime: health.process.uptime,
          node_version: health.process.nodeVersion,
          process_memory_mb: Math.round(health.process.memory.rss / 1024 / 1024),
          system_memory_mb: Math.round(os.totalmem() / 1024 / 1024),
          heap_used_mb: Math.round(health.process.memory.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(health.process.memory.heapTotal / 1024 / 1024),
          heap_usage_percent: health.process.memory.heapUsagePercent,
        },
      };

      return sendSuccess(reply, response);
    }
  );

  /**
   * GET /api/v1/admin/cache/stats
   * Get cache statistics for monitoring
   * Returns hit/miss ratios, cache sizes, and health status
   * Requires: platform admin
   */
  fastify.get(
    '/api/v1/admin/cache/stats',
    { onRequest: [requirePlatformAdmin()] },
    async (_request, reply) => {
      const cache = getCacheService();

      const [stats, health] = await Promise.all([cache.getStats(), cache.isHealthy()]);

      // Calculate combined stats
      const memoryHitRatio = stats.memory ? Math.round(stats.memory.hitRatio * 100) : 0;
      const redisHitRatio = stats.redis ? Math.round(stats.redis.hitRatio * 100) : 0;

      // Determine overall status:
      // - Both healthy → 'healthy'
      // - One unhealthy → 'degraded'
      // - Both unhealthy → 'unhealthy'
      let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
      const memoryEnabled = stats.memory !== null;
      const redisEnabled = stats.redis !== null;

      if (memoryEnabled && redisEnabled) {
        // Both layers enabled
        if (health.memory && health.redis) {
          overallStatus = 'healthy';
        } else if (!health.memory && !health.redis) {
          overallStatus = 'unhealthy';
        } else {
          overallStatus = 'degraded';
        }
      } else if (memoryEnabled || redisEnabled) {
        // Only one layer enabled
        overallStatus = health.memory || health.redis ? 'healthy' : 'unhealthy';
      } else {
        // No layers enabled
        overallStatus = 'unhealthy';
      }

      return sendSuccess(reply, {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        layers: {
          memory: stats.memory
            ? {
                enabled: true,
                healthy: health.memory,
                hits: stats.memory.hits,
                misses: stats.memory.misses,
                size: stats.memory.size,
                hitRatio: `${memoryHitRatio}%`,
                memoryUsageBytes: stats.memory.memoryUsage,
              }
            : { enabled: false },
          redis: stats.redis
            ? {
                enabled: true,
                healthy: health.redis,
                hits: stats.redis.hits,
                misses: stats.redis.misses,
                size: stats.redis.size,
                hitRatio: `${redisHitRatio}%`,
              }
            : { enabled: false },
        },
      });
    }
  );

  /**
   * POST /api/v1/admin/cache/clear
   * Clear all cache entries
   * Warning: Use with caution in production
   * Requires: platform admin
   */
  fastify.post(
    '/api/v1/admin/cache/clear',
    { onRequest: [requirePlatformAdmin()] },
    async (request, reply) => {
      const cache = getCacheService();
      await cache.clear();

      logger.warn('Cache cleared by admin', {
        userId: request.authUser?.id,
      });

      return sendSuccess(reply, {
        message: 'Cache cleared successfully',
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/admin/settings
   * Get instance settings
   * Note: Writable settings from database, read-only from environment
   * Requires: platform admin
   */
  fastify.get(
    '/api/v1/admin/settings',
    { onRequest: [requirePlatformAdmin()] },
    async (_request, reply) => {
      const settings = await settingsService.getCompleteSettings();
      return sendSuccess(reply, settings);
    }
  );

  /**
   * PATCH /api/v1/admin/settings
   * Update instance settings
   * Stores writable settings in database (no restart required)
   * Requires: platform admin
   */
  fastify.patch<{ Body: Partial<InstanceSettings> }>(
    '/api/v1/admin/settings',
    { onRequest: [requirePlatformAdmin()] },
    async (request, reply) => {
      const updates = request.body;
      const userId = request.authUser!.id;

      // Validate updates
      if (
        'instance_name' in updates &&
        (!updates.instance_name || updates.instance_name.length < 1)
      ) {
        return reply.code(400).send({ error: 'Instance name cannot be empty' });
      }

      // Write changes to database
      try {
        await settingsService.updateInstanceSettings(updates, userId);
        request.log.info({ updates, userId }, 'Settings updated in database');
      } catch (error) {
        request.log.error({ error, updates }, 'Failed to update settings');
        return reply.code(500).send({ error: 'Failed to update settings' });
      }

      // Fetch updated settings
      const settings = await settingsService.getCompleteSettings();

      return sendSuccess(reply, settings);
    }
  );
}
