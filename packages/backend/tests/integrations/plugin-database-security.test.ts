/**
 * Plugin Registry - Database Plugin Security Tests
 * Tests security validation before code execution
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import { vi } from 'vitest';

describe('PluginRegistry - Database Plugin Security', () => {
  let db: DatabaseClient;
  let mockStorage: IStorageService;
  let registry: PluginRegistry;
  const createdIntegrationIds: string[] = [];

  /**
   * Helper to track created integrations for cleanup
   */
  function track(id: string): string {
    createdIntegrationIds.push(id);
    return id;
  }

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
    // Cleanup created integrations
    if (createdIntegrationIds.length > 0) {
      await db.query('DELETE FROM integrations WHERE id = ANY($1)', [createdIntegrationIds]);
    }
    await db.close();
  });

  describe('Security Validation', () => {
    it('should reject code with require() calls', async () => {
      const maliciousCode = `
        const fs = require('fs');
        module.exports = {
          metadata: { name: 'Test', platform: 'test', version: '1.0.0' },
          factory: () => ({})
        };
      `;

      const integration = await db.integrations.create({
        type: 'test_require_blocked',
        name: 'Test Require Blocked',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: maliciousCode,
        allow_code_execution: true,
      });
      track(integration.id);

      await expect(registry.loadDynamicPlugin('test_require_blocked')).rejects.toThrow(
        /security validation failed/i
      );
    });

    it('should reject code with process access', async () => {
      const maliciousCode = `
        const env = process.env;
        module.exports = {
          metadata: { name: 'Test', platform: 'test', version: '1.0.0' },
          factory: () => ({
            platform: 'test',
            createTicket: async () => ({ id: 'test', url: 'http://test', platform: 'test' }),
            updateTicket: async () => ({ id: 'test', url: 'http://test', platform: 'test' }),
            getTicket: async () => ({ id: 'test', url: 'http://test', status: 'open', platform: 'test' })
          })
        };
      `;

      const integration = await db.integrations.create({
        type: 'test_process_blocked',
        name: 'Test Process Blocked',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: maliciousCode,
        allow_code_execution: true,
      });
      track(integration.id);

      // SECURITY: Should fail in sandbox - process is undefined and accessing .env fails
      await expect(registry.loadDynamicPlugin('test_process_blocked')).rejects.toThrow(
        /Cannot read properties of undefined|process is not defined/i
      );
    });

    it('should reject code with eval()', async () => {
      const maliciousCode = `
        eval('console.log("test")');
        module.exports = {
          metadata: { name: 'Test', platform: 'test', version: '1.0.0' },
          factory: () => ({})
        };
      `;

      const integration = await db.integrations.create({
        type: 'test_eval_blocked',
        name: 'Test Eval Blocked',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: maliciousCode,
        allow_code_execution: true,
      });
      track(integration.id);

      await expect(registry.loadDynamicPlugin('test_eval_blocked')).rejects.toThrow(
        /security validation failed/i
      );
    });

    it('should reject code with child_process', async () => {
      const maliciousCode = `
        const { exec } = require('child_process');
        module.exports = {
          metadata: { name: 'Test', platform: 'test', version: '1.0.0' },
          factory: () => ({})
        };
      `;

      const integration = await db.integrations.create({
        type: 'test_child_process_blocked',
        name: 'Test Child Process Blocked',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: maliciousCode,
        allow_code_execution: true,
      });
      track(integration.id);

      await expect(registry.loadDynamicPlugin('test_child_process_blocked')).rejects.toThrow(
        /security validation failed/i
      );
    });

    it('should validate code hash if provided', async () => {
      const safeCode = `
        module.exports = {
          metadata: {
            name: 'Hash Test Plugin',
            platform: 'hash_test',
            version: '1.0.0'
          },
          factory: (context) => ({
            platform: 'hash_test',
            createTicket: async () => ({ id: 'test', url: 'http://test', platform: 'hash_test' }),
            updateTicket: async () => ({ id: 'test', url: 'http://test', platform: 'hash_test' }),
            getTicket: async () => ({ id: 'test', url: 'http://test', status: 'open', platform: 'hash_test' })
          })
        };
      `;

      // Create integration with mismatched hash
      const integration = await db.integrations.create({
        type: 'hash_test',
        name: 'Hash Test Plugin',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: safeCode,
        code_hash: 'invalid_hash_12345',
        allow_code_execution: true,
      });
      track(integration.id);

      // SECURITY: Should fail on hash validation
      await expect(registry.loadDynamicPlugin('hash_test')).rejects.toThrow(/hash mismatch/i);
    });
  });

  describe('Plugin Structure Validation', () => {
    it('should reject plugin without metadata', async () => {
      const invalidCode = `
        module.exports = {
          factory: (context) => ({
            platform: 'no_metadata',
            createTicket: async () => ({ id: 'test', url: 'http://test', platform: 'no_metadata' }),
            updateTicket: async () => ({ id: 'test', url: 'http://test', platform: 'no_metadata' }),
            getTicket: async () => ({ id: 'test', url: 'http://test', status: 'open', platform: 'no_metadata' })
          })
        };
      `;

      const integration = await db.integrations.create({
        type: 'no_metadata',
        name: 'No Metadata Plugin',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: invalidCode,
        code_hash: undefined, // No hash check
        allow_code_execution: true,
      });
      track(integration.id);

      // SECURITY: Should fail on missing metadata during validation
      await expect(registry.loadDynamicPlugin('no_metadata')).rejects.toThrow(
        /must export metadata and factory/i
      );
    });

    it('should reject plugin without factory', async () => {
      const invalidCode = `
        module.exports = {
          metadata: {
            name: 'No Factory Plugin',
            platform: 'no_factory',
            version: '1.0.0'
          }
        };
      `;

      const integration = await db.integrations.create({
        type: 'no_factory',
        name: 'No Factory Plugin',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: invalidCode,
        code_hash: undefined, // No hash check
        allow_code_execution: true,
      });
      track(integration.id);

      // SECURITY: Should fail on missing factory during validation
      await expect(registry.loadDynamicPlugin('no_factory')).rejects.toThrow(
        /must export metadata and factory/i
      );
    });

    it('should reject plugin with non-function factory', async () => {
      const invalidCode = `
        module.exports = {
          metadata: {
            name: 'Invalid Factory Plugin',
            platform: 'invalid_factory',
            version: '1.0.0'
          },
          factory: 'not a function'
        };
      `;

      const integration = await db.integrations.create({
        type: 'invalid_factory',
        name: 'Invalid Factory Plugin',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: invalidCode,
        code_hash: undefined, // No hash check
        allow_code_execution: true,
      });
      track(integration.id);

      // SECURITY: Should fail on invalid factory type during validation
      await expect(registry.loadDynamicPlugin('invalid_factory')).rejects.toThrow(
        /must export metadata and factory/i
      );
    });
  });

  describe('Configuration Requirements', () => {
    it('should require plugin_code for database loading', async () => {
      const integration = await db.integrations.create({
        type: 'no_code',
        name: 'No Code Integration',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        allow_code_execution: true,
      });
      track(integration.id);

      // Should fail since no plugin code and not a built-in plugin
      await expect(registry.loadDynamicPlugin('no_code')).rejects.toThrow(
        /not found|does not have plugin code/i
      );
    });

    it('should require allow_code_execution to be enabled', async () => {
      const integration = await db.integrations.create({
        type: 'execution_disabled',
        name: 'Execution Disabled',
        status: 'active',
        is_custom: true,
        plugin_source: 'filesystem',
        trust_level: 'custom',
        plugin_code: 'module.exports = {}',
        allow_code_execution: false,
      });
      track(integration.id);

      // Should fail - either with "code execution is disabled" or "execution failed"
      await expect(registry.loadDynamicPlugin('execution_disabled')).rejects.toThrow(
        /code execution is disabled|execution failed/i
      );
    });
  });
});
