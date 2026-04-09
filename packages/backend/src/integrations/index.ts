/**
 * Integration Plugin System
 * Exports plugin architecture components
 */

export { PluginRegistry } from './plugin-registry.js';
export { loadIntegrationPlugins } from './plugin-loader.js';
export type {
  IntegrationPlugin,
  AdvancedIntegrationPlugin,
  PluginContext,
  PluginMetadata,
  PluginFactory,
  PluginLifecycle,
} from './plugin.types.js';
export type { IntegrationService, IntegrationResult } from './base-integration.service.js';
