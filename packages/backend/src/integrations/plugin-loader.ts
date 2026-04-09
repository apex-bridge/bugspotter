/**
 * Plugin Loader
 * Auto-discovers and loads integration plugins
 */

import type { PluginRegistry } from './plugin-registry.js';
import { jiraPlugin } from './jira/plugin.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * Load all available integration plugins
 * @param registry - Plugin registry to load plugins into
 */
export async function loadIntegrationPlugins(registry: PluginRegistry): Promise<void> {
  const plugins = [
    jiraPlugin,
    // Add more plugins here as they are implemented
  ];

  logger.info('Loading integration plugins', { count: plugins.length });

  const results = await Promise.allSettled(
    plugins.map(async (plugin) => {
      try {
        await registry.register(plugin);
        return { success: true, platform: plugin.metadata.platform };
      } catch (error) {
        logger.error('Failed to load plugin', {
          platform: plugin.metadata.platform,
          error: error instanceof Error ? error.message : String(error),
        });
        return { success: false, platform: plugin.metadata.platform, error };
      }
    })
  );

  const successful = results.filter((r) => r.status === 'fulfilled' && r.value.success).length;
  const failed = results.length - successful;

  logger.info('Plugin loading complete', {
    successful,
    failed,
    platforms: registry.getSupportedPlatforms(),
  });

  if (failed > 0) {
    logger.warn('Some plugins failed to load', { failed });
  }
}
