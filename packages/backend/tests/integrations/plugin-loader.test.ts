/**
 * Plugin Loader Tests
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { loadIntegrationPlugins } from '../../src/integrations/plugin-loader.js';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';

describe('loadIntegrationPlugins', () => {
  let registry: PluginRegistry;
  let mockDb: any;
  let mockStorage: any;

  beforeAll(() => {
    // Ensure ENCRYPTION_KEY is set before plugin loading
    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-min';
    }
  });

  beforeEach(() => {
    mockDb = {
      bugReports: {},
      projectIntegrations: {},
      tickets: {},
    };
    mockStorage = {};
    registry = new PluginRegistry(mockDb, mockStorage);
  });

  it('should load jira plugin successfully', async () => {
    await loadIntegrationPlugins(registry);

    expect(registry.isSupported('jira')).toBe(true);
    expect(registry.getSupportedPlatforms()).toContain('jira');
  });

  it('should load jira plugin metadata', async () => {
    await loadIntegrationPlugins(registry);

    const metadata = registry.getPluginMetadata('jira');
    expect(metadata).not.toBeNull();
    expect(metadata?.name).toBe('Jira Integration');
    expect(metadata?.platform).toBe('jira');
    expect(metadata?.version).toBeDefined();
  });

  it('should handle multiple plugin loads without duplicates', async () => {
    await loadIntegrationPlugins(registry);
    await loadIntegrationPlugins(registry);

    const platforms = registry.getSupportedPlatforms();
    expect(platforms.filter((p) => p === 'jira')).toHaveLength(1);
  });

  it('should complete loading without errors', async () => {
    await expect(loadIntegrationPlugins(registry)).resolves.not.toThrow();
    expect(registry.isSupported('jira')).toBe(true);
  });
});
