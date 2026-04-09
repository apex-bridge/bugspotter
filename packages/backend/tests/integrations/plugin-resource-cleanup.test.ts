/**
 * Tests for plugin resource cleanup (isolate disposal)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecurePluginExecutor } from '../../src/integrations/security/plugin-executor.js';
import type { PluginContext } from '../../src/integrations/plugin.types.js';

describe('Plugin Resource Cleanup', () => {
  let executor: SecurePluginExecutor;
  let context: PluginContext;

  beforeEach(() => {
    executor = new SecurePluginExecutor({ timeout: 5000, memoryLimit: 128 });
    context = {
      db: {} as any,
      storage: {} as any,
      projectId: 'test-project-id',
    };
  });

  it('should return dispose method from executeFactory', async () => {
    const pluginCode = `
      module.exports.metadata = {
        name: 'Test Plugin',
        platform: 'test',
        version: '1.0.0',
      };

      module.exports.factory = function({ rpcBridge, config }) {
        return {
          async createFromBugReport(bugReport, projectId) {
            return {
              success: true,
              external_id: 'test-123',
            };
          }
        };
      };
    `;

    const service = await executor.executeFactory(pluginCode, 'test', context, {});

    // Verify service has both methods
    expect(service).toHaveProperty('createFromBugReport');
    expect(service).toHaveProperty('dispose');
    expect(typeof service.createFromBugReport).toBe('function');
    expect(typeof service.dispose).toBe('function');

    // Cleanup
    service.dispose();
  });

  it('should allow dispose to be called multiple times safely', async () => {
    const pluginCode = `
      module.exports.metadata = {
        name: 'Test Plugin',
        platform: 'test',
        version: '1.0.0',
      };

      module.exports.factory = function({ rpcBridge, config }) {
        return {
          async createFromBugReport(bugReport, projectId) {
            return {
              success: true,
              external_id: 'test-123',
            };
          }
        };
      };
    `;

    const service = await executor.executeFactory(pluginCode, 'test', context, {});

    // Call dispose multiple times - should not throw
    expect(() => service.dispose()).not.toThrow();
    expect(() => service.dispose()).not.toThrow();
  });

  it('should fail to execute methods after dispose', async () => {
    const pluginCode = `
      module.exports.metadata = {
        name: 'Test Plugin',
        platform: 'test',
        version: '1.0.0',
      };

      module.exports.factory = function({ rpcBridge, config }) {
        return {
          async createFromBugReport(bugReport, projectId) {
            return {
              success: true,
              external_id: 'test-123',
            };
          }
        };
      };
    `;

    const service = await executor.executeFactory(pluginCode, 'test', context, {});

    // Dispose the isolate
    service.dispose();

    // Try to call method after disposal - should fail
    const result = await service.createFromBugReport(
      {
        id: 'bug-123',
        title: 'Test Bug',
        description: 'Test description',
        priority: 'medium',
        status: 'open',
      } as any,
      'project-123'
    );

    // Should return error result since isolate is disposed
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should clean up isolate resources when dispose is called', async () => {
    const pluginCode = `
      module.exports.metadata = {
        name: 'Test Plugin',
        platform: 'test',
        version: '1.0.0',
      };

      module.exports.factory = function({ rpcBridge, config }) {
        return {
          async createFromBugReport(bugReport, projectId) {
            return {
              success: true,
              external_id: 'test-123',
              url: 'https://example.com/issue/test-123',
            };
          }
        };
      };
    `;

    const service = await executor.executeFactory(pluginCode, 'test', context, {});

    // Call a method before disposal - should succeed
    const result1 = await service.createFromBugReport(
      {
        id: 'bug-123',
        title: 'Test Bug',
        description: 'Test description',
        priority: 'medium',
        status: 'open',
      } as any,
      'project-123'
    );
    expect(result1.success).toBe(true);
    expect(result1.external_id).toBe('test-123');

    // Dispose the isolate
    service.dispose();

    // Call method after disposal - should fail with error
    const result2 = await service.createFromBugReport(
      {
        id: 'bug-456',
        title: 'Another Bug',
        description: 'Test description',
        priority: 'high',
        status: 'open',
      } as any,
      'project-123'
    );
    expect(result2.success).toBe(false);
    expect(result2.error).toBe('Service has been disposed');
  });
});
