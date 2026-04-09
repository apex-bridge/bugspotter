/**
 * Custom Plugin Loading Integration Test
 * Tests that custom plugins can be loaded from database and instantiated correctly
 *
 * This test verifies the fixes for:
 * 1. isolated-vm CommonJS import (ivmModule.Isolate not a constructor)
 * 2. Platform name mismatch (metadata.platform vs database type)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { createStorageFromEnv } from '../../src/storage/index.js';
import type { IStorageService } from '../../src/storage/types.js';

describe('Custom Plugin Loading', () => {
  let db: DatabaseClient;
  let storage: IStorageService;
  let registry: PluginRegistry;
  let testProjectId: string;
  let integrationId: string;

  const customPluginCode = `
    // Custom Jira plugin code
    module.exports.factory = function({ rpcBridge, config }) {
      return {
        async createFromBugReport(bugReport, projectId, integrationId) {
          return {
            externalId: 'TEST-123',
            externalUrl: 'https://test.atlassian.net/browse/TEST-123',
            platform: 'jira'
          };
        },
        
        async testConnection(projectId) {
          return true;
        }
      };
    };
    
    module.exports.metadata = {
      name: 'Custom Jira Integration',
      platform: 'jira', // Note: platform is 'jira' but DB type will be 'jira_custom'
      version: '1.0.0',
      description: 'Custom Jira integration for testing'
    };
  `;

  beforeAll(async () => {
    db = createDatabaseClient();
    storage = await createStorageFromEnv();

    // Create test project (no api_key in projects table)
    const project = await db.projects.create({
      name: 'Test Project for Custom Plugin',
    });
    testProjectId = project.id;

    // Create custom integration using repository (follows Repository Pattern)
    const integration = await db.integrations.create({
      type: 'jira_custom', // Database type
      name: 'Test Custom Jira',
      status: 'active',
      config: { baseUrl: 'https://test.atlassian.net' },
      plugin_code: customPluginCode,
      allow_code_execution: true,
      code_hash: '013d922121e065e58553ad13608590df4d907ebf7beb0a4354e3c4ce2b68fdcf', // SHA-256 hash (without trim)
      trust_level: 'custom',
      is_custom: true,
      plugin_source: 'filesystem',
    });
    integrationId = integration.id;

    // Initialize plugin registry (correct constructor: 2 args, no wrapper object)
    registry = new PluginRegistry(db, storage);
  });

  afterAll(async () => {
    // Cleanup
    if (integrationId) {
      await db.integrations.delete(integrationId);
    }
    if (testProjectId) {
      await db.projects.delete(testProjectId);
    }
    await db.close();
  });

  it('should load custom plugin with platform name different from database type', async () => {
    // This tests the fix for platform name mismatch
    // Database has type='jira_custom', but plugin metadata has platform='jira'

    const service = await registry.loadDynamicPlugin('jira_custom');

    expect(service).toBeDefined();
    expect(typeof service.createFromBugReport).toBe('function');
  });

  it('should successfully execute plugin code using isolated-vm', async () => {
    // This tests the fix for isolated-vm import
    // Should not throw "ivmModule.Isolate is not a constructor"

    const service = await registry.loadDynamicPlugin('jira_custom');

    // Test that testConnection method works
    const result = await service.testConnection(testProjectId);

    expect(result).toBe(true);
  });

  it('should handle createFromBugReport with correct isolated-vm execution', async () => {
    const service = await registry.loadDynamicPlugin('jira_custom');

    const mockBugReport = {
      id: 'test-bug-id',
      title: 'Test Bug',
      description: 'Test Description',
      project_id: testProjectId,
    };

    const result = await service.createFromBugReport(
      mockBugReport as any,
      testProjectId,
      integrationId
    );

    expect(result).toBeDefined();
    expect(result.externalId).toBe('TEST-123');
    expect(result.externalUrl).toBe('https://test.atlassian.net/browse/TEST-123');
    expect(result.platform).toBe('jira');
  });

  it('should normalize platform names to lowercase', async () => {
    // Registry should handle case-insensitive platform lookups
    const service1 = await registry.loadDynamicPlugin('jira_custom');
    const service2 = await registry.loadDynamicPlugin('JIRA_CUSTOM');

    expect(service1).toBe(service2); // Should return same cached instance
  });

  it('should normalize platform in database query (loadFromDatabase robustness)', async () => {
    // Create a second integration with mixed case type to verify database query normalization
    const code = `
          module.exports.factory = function({ rpcBridge, config }) {
            return {
              async testConnection() { return true; }
            };
          };
          module.exports.metadata = {
            name: 'Test Mixed Case',
            platform: 'test_mixed_case',
            version: '1.0.0'
          };
        `;
    const crypto = await import('crypto');
    const correctHash = crypto.createHash('sha256').update(code).digest('hex');

    const mixedCaseIntegration = await db.integrations.create({
      type: 'test_mixed_case', // Lowercase database type (constraint requirement)
      name: 'Test Mixed Case Integration',
      status: 'active',
      config: { test: true },
      plugin_code: code,
      allow_code_execution: true,
      code_hash: correctHash,
      trust_level: 'custom',
      is_custom: true,
      plugin_source: 'filesystem',
    });

    const mixedCaseId = mixedCaseIntegration.id;

    try {
      // Should successfully load with mixed case (database query normalizes it)
      const service = await registry.loadDynamicPlugin('Test_Mixed_CASE');
      expect(service).toBeDefined();
      expect(typeof service.testConnection).toBe('function');

      const result = await service.testConnection(testProjectId);
      expect(result).toBe(true);
    } finally {
      // Cleanup
      await db.integrations.delete(mixedCaseId);
    }
  });

  it('should cache service under both database type and metadata platform', async () => {
    // First load uses database type 'jira_custom'
    const service1 = await registry.loadDynamicPlugin('jira_custom');
    expect(service1).toBeDefined();

    // Second load should hit cache (not reload from database)
    // This tests the fix where service is cached under both 'jira_custom' and 'jira'
    const service2 = await registry.loadDynamicPlugin('jira_custom');
    expect(service2).toBe(service1); // Same instance = cache hit

    // Should also be retrievable by metadata platform name
    const service3 = await registry.loadDynamicPlugin('jira');
    expect(service3).toBe(service1); // Same instance

    // Verify both lookups work via get()
    expect(registry.get('jira_custom')).toBe(service1);
    expect(registry.get('jira')).toBe(service1);
  });
});
