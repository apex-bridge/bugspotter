/**
 * Public settings routes
 * SDK can fetch replay quality configuration without authentication
 *
 * Uses server-side caching to reduce database load for frequently accessed settings.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { sendSuccess } from '../utils/response.js';
import { getBooleanSetting, getNumberSetting } from '../utils/settings-helpers.js';
import { getCacheService } from '../../cache/index.js';

interface ReplaySettings {
  duration: number;
  inline_stylesheets: boolean;
  inline_images: boolean;
  collect_fonts: boolean;
  record_canvas: boolean;
  record_cross_origin_iframes: boolean;
  sampling_mousemove: number;
  sampling_scroll: number;
}

export async function settingsRoutes(fastify: FastifyInstance, db: DatabaseClient): Promise<void> {
  /**
   * GET /api/v1/settings/replay
   * SDK fetches replay quality configuration on initialization
   * Requires: Valid API key (validates project exists)
   * Rate limit: 10 requests per minute per API key
   * Cache: 5 minutes (settings rarely change)
   */
  fastify.get(
    '/api/v1/settings/replay',
    {
      config: {
        rateLimit: {
          max: 10, // 10 requests per minute per API key
          timeWindow: '1 minute',
        },
      },
    },
    async (_request, reply) => {
      // Add cache headers - settings rarely change
      reply.header('Cache-Control', 'public, max-age=300'); // 5 minutes
      reply.header('Vary', 'Authorization'); // Cache per API key

      try {
        // Fetch instance settings with caching (reduces database load)
        const cache = getCacheService();
        const config = await cache.getSystemConfig('instance_settings', () =>
          db.systemConfig.get('instance_settings')
        );
        const dbSettings = config?.value || {};

        // Extract replay settings with defaults
        const replaySettings: ReplaySettings = {
          duration: getNumberSetting(dbSettings, 'replay_duration', 15),
          inline_stylesheets: getBooleanSetting(dbSettings, 'replay_inline_stylesheets', true),
          inline_images: getBooleanSetting(dbSettings, 'replay_inline_images', false),
          collect_fonts: getBooleanSetting(dbSettings, 'replay_collect_fonts', true),
          record_canvas: getBooleanSetting(dbSettings, 'replay_record_canvas', false),
          record_cross_origin_iframes: getBooleanSetting(
            dbSettings,
            'replay_record_cross_origin_iframes',
            false
          ),
          sampling_mousemove: getNumberSetting(dbSettings, 'replay_sampling_mousemove', 50),
          sampling_scroll: getNumberSetting(dbSettings, 'replay_sampling_scroll', 100),
        };

        return sendSuccess(reply, replaySettings);
      } catch (error) {
        fastify.log.error({ error }, 'Failed to fetch replay settings');

        // Return defaults on error so SDK doesn't break
        const defaultSettings: ReplaySettings = {
          duration: 15,
          inline_stylesheets: true,
          inline_images: false,
          collect_fonts: true,
          record_canvas: false,
          record_cross_origin_iframes: false,
          sampling_mousemove: 50,
          sampling_scroll: 100,
        };

        return sendSuccess(reply, defaultSettings);
      }
    }
  );
}
