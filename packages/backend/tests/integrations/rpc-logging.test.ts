/**
 * Tests for RPC logging methods (log, logError, logWarn)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RpcBridge } from '../../src/integrations/security/rpc-bridge.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import { getLogger } from '../../src/logger.js';

describe('RPC Bridge - Logging Methods', () => {
  let rpcBridge: RpcBridge;
  let mockDb: DatabaseClient;
  let mockStorage: IStorageService;

  beforeEach(() => {
    mockDb = {} as DatabaseClient;
    mockStorage = {} as IStorageService;
    rpcBridge = new RpcBridge(mockDb, mockStorage, 'test-project-123');

    // Spy on logger methods
    const logger = getLogger();
    vi.spyOn(logger, 'info');
    vi.spyOn(logger, 'error');
    vi.spyOn(logger, 'warn');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log method', () => {
    it('should allow log method', async () => {
      const result = await rpcBridge.handleCall({
        method: 'log',
        args: ['Test message'],
        requestId: 'test-1',
      });

      expect(result.success).toBe(true);
      expect(getLogger().info).toHaveBeenCalledWith('[Plugin RPC]', {
        message: 'Test message',
        project_id: 'test-project-123',
      });
    });

    it('should concatenate multiple arguments', async () => {
      await rpcBridge.handleCall({
        method: 'log',
        args: ['Created ticket', 123, 'for bug', 'bug-456'],
        requestId: 'test-2',
      });

      expect(getLogger().info).toHaveBeenCalledWith('[Plugin RPC]', {
        message: 'Created ticket 123 for bug bug-456',
        project_id: 'test-project-123',
      });
    });
  });

  describe('logError method', () => {
    it('should allow logError method', async () => {
      const result = await rpcBridge.handleCall({
        method: 'logError',
        args: ['Error occurred'],
        requestId: 'test-3',
      });

      expect(result.success).toBe(true);
      expect(getLogger().error).toHaveBeenCalledWith('[Plugin RPC]', {
        message: 'Error occurred',
        project_id: 'test-project-123',
      });
    });

    it('should concatenate multiple error arguments', async () => {
      await rpcBridge.handleCall({
        method: 'logError',
        args: ['Failed to create ticket:', 'Network timeout'],
        requestId: 'test-4',
      });

      expect(getLogger().error).toHaveBeenCalledWith('[Plugin RPC]', {
        message: 'Failed to create ticket: Network timeout',
        project_id: 'test-project-123',
      });
    });
  });

  describe('logWarn method', () => {
    it('should allow logWarn method', async () => {
      const result = await rpcBridge.handleCall({
        method: 'logWarn',
        args: ['Warning: API rate limit approaching'],
        requestId: 'test-5',
      });

      expect(result.success).toBe(true);
      expect(getLogger().warn).toHaveBeenCalledWith('[Plugin RPC]', {
        message: 'Warning: API rate limit approaching',
        project_id: 'test-project-123',
      });
    });

    it('should concatenate multiple warning arguments', async () => {
      await rpcBridge.handleCall({
        method: 'logWarn',
        args: ['Retry attempt', 2, 'of', 3],
        requestId: 'test-6',
      });

      expect(getLogger().warn).toHaveBeenCalledWith('[Plugin RPC]', {
        message: 'Retry attempt 2 of 3',
        project_id: 'test-project-123',
      });
    });
  });

  describe('Method Whitelist', () => {
    it('should have log, logError, and logWarn in whitelist', async () => {
      // Test that all three methods are allowed
      const logResult = await rpcBridge.handleCall({
        method: 'log',
        args: ['info'],
        requestId: 'test-7',
      });
      expect(logResult.success).toBe(true);

      const errorResult = await rpcBridge.handleCall({
        method: 'logError',
        args: ['error'],
        requestId: 'test-8',
      });
      expect(errorResult.success).toBe(true);

      const warnResult = await rpcBridge.handleCall({
        method: 'logWarn',
        args: ['warning'],
        requestId: 'test-9',
      });
      expect(warnResult.success).toBe(true);
    });
  });
});
