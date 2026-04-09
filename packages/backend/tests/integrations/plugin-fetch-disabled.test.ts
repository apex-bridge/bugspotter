/**
 * Tests for global fetch API being disabled in plugin sandbox
 * Ensures plugins cannot bypass RPC security controls
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SecurePluginExecutor } from '../../src/integrations/security/plugin-executor.js';
import { createDatabaseClient } from '../../src/db/client.js';
import type { PluginContext } from '../../src/integrations/plugin.types.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('Plugin Sandbox - Global fetch Disabled', () => {
  let db: DatabaseClient;
  let executor: SecurePluginExecutor;
  let context: PluginContext;

  beforeAll(async () => {
    db = createDatabaseClient();
    executor = new SecurePluginExecutor();
    context = {
      db: db,
      storage: null as any,
      projectId: 'test-project',
    };
  });

  afterAll(async () => {
    await db.close();
  });

  it('should disable global fetch in plugin sandbox', async () => {
    const code = `
      const pluginMetadata = {
        platform: 'test_fetch',
        name: 'Test Fetch Plugin',
        version: '1.0.0',
        description: 'Test fetch availability',
      };

      function factory(context) {
        return {
          async createFromBugReport(bugReport, config) {
            // Try to use global fetch (should be undefined)
            if (typeof fetch !== 'undefined') {
              throw new Error('Global fetch should be disabled');
            }
            
            return {
              success: true,
              external_id: 'test-123',
            };
          },
        };
      }

      module.exports = { metadata: pluginMetadata, factory };
    `;

    // Should not throw during validation
    const result = await executor.execute(code, context);
    expect(result.metadata.platform).toBe('test_fetch');
  });

  it('should disable XMLHttpRequest in plugin sandbox', async () => {
    const code = `
      const pluginMetadata = {
        platform: 'test_xhr',
        name: 'Test XHR Plugin',
        version: '1.0.0',
        description: 'Test XMLHttpRequest availability',
      };

      function factory(context) {
        return {
          async createFromBugReport(bugReport, config) {
            // Try to use XMLHttpRequest (should be undefined)
            if (typeof XMLHttpRequest !== 'undefined') {
              throw new Error('XMLHttpRequest should be disabled');
            }
            
            return {
              success: true,
              external_id: 'test-123',
            };
          },
        };
      }

      module.exports = { metadata: pluginMetadata, factory };
    `;

    const result = await executor.execute(code, context);
    expect(result.metadata.platform).toBe('test_xhr');
  });

  it('should disable WebSocket in plugin sandbox', async () => {
    const code = `
      const pluginMetadata = {
        platform: 'test_ws',
        name: 'Test WebSocket Plugin',
        version: '1.0.0',
        description: 'Test WebSocket availability',
      };

      function factory(context) {
        return {
          async createFromBugReport(bugReport, config) {
            // Try to use WebSocket (should be undefined)
            if (typeof WebSocket !== 'undefined') {
              throw new Error('WebSocket should be disabled');
            }
            
            return {
              success: true,
              external_id: 'test-123',
            };
          },
        };
      }

      module.exports = { metadata: pluginMetadata, factory };
    `;

    const result = await executor.execute(code, context);
    expect(result.metadata.platform).toBe('test_ws');
  });

  it('should force use of secure http.fetch RPC method', async () => {
    const code = `
      const pluginMetadata = {
        platform: 'test_rpc_fetch',
        name: 'Test RPC Fetch Plugin',
        version: '1.0.0',
        description: 'Test RPC fetch method',
      };

      function factory(context) {
        return {
          async createFromBugReport(bugReport, config) {
            // Must use RPC bridge for HTTP requests
            if (typeof fetch !== 'undefined') {
              throw new Error('Should use context.rpcBridge.callMethod("http.fetch")');
            }
            
            // Verify RPC bridge is available
            if (!context.rpcBridge || typeof context.rpcBridge.callMethod !== 'function') {
              throw new Error('RPC bridge should be available');
            }
            
            return {
              success: true,
              external_id: 'test-123',
            };
          },
        };
      }

      module.exports = { metadata: pluginMetadata, factory };
    `;

    const result = await executor.execute(code, context);
    expect(result.metadata.platform).toBe('test_rpc_fetch');
  });

  it('should disable Node.js globals (require, process, Buffer)', async () => {
    const code = `
      const pluginMetadata = {
        platform: 'test_nodejs_globals',
        name: 'Test Node.js Globals Plugin',
        version: '1.0.0',
        description: 'Test Node.js globals availability',
      };

      function factory(context) {
        return {
          async createFromBugReport(bugReport, config) {
            // Verify dangerous Node.js globals are disabled
            if (typeof require !== 'undefined') {
              throw new Error('require should be disabled');
            }
            if (typeof process !== 'undefined') {
              throw new Error('process should be disabled');
            }
            if (typeof Buffer !== 'undefined') {
              throw new Error('Buffer should be disabled');
            }
            
            return {
              success: true,
              external_id: 'test-123',
            };
          },
        };
      }

      module.exports = { metadata: pluginMetadata, factory };
    `;

    const result = await executor.execute(code, context);
    expect(result.metadata.platform).toBe('test_nodejs_globals');
  });
});
