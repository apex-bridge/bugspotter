/**
 * Unit tests for ServiceContainer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServiceContainer, createServiceContainer } from '../../src/container/service-container.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import type { QueueManager } from '../../src/queue/queue-manager.js';
import type { RetentionScheduler } from '../../src/retention/retention-scheduler.js';

describe('ServiceContainer', () => {
  // Mock services
  let mockDb: DatabaseClient;
  let mockStorage: IStorageService;
  let mockPluginRegistry: PluginRegistry;
  let mockQueueManager: QueueManager;

  beforeEach(() => {
    // Create mock database
    mockDb = {
      testConnection: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      getPool: vi.fn().mockReturnValue({}), // Mock pool for NotificationService
    } as unknown as DatabaseClient;

    // Create mock storage
    mockStorage = {
      healthCheck: vi.fn().mockResolvedValue(true),
    } as unknown as IStorageService;

    // Create mock plugin registry
    mockPluginRegistry = {
      getPlugins: vi.fn().mockReturnValue([]),
    } as unknown as PluginRegistry;

    // Create mock queue manager
    mockQueueManager = {
      healthCheck: vi.fn().mockResolvedValue(true),
      shutdown: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueueManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create container with core services', () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      expect(container.db).toBe(mockDb);
      expect(container.storage).toBe(mockStorage);
      expect(container.pluginRegistry).toBe(mockPluginRegistry);
      expect(container.isInitialized()).toBe(true);
    });

    it('should create container with optional services', () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });

      expect(container.queueManager).toBe(mockQueueManager);
    });
  });

  describe('getNotificationService', () => {
    it('should return undefined when queueManager is not provided', () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      const notificationService = container.getNotificationService();
      expect(notificationService).toBeUndefined();
    });

    it('should lazy-load notification service when queueManager is provided', () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });

      const notificationService1 = container.getNotificationService();
      expect(notificationService1).toBeDefined();

      // Should return same instance on subsequent calls (singleton)
      const notificationService2 = container.getNotificationService();
      expect(notificationService2).toBe(notificationService1);
    });
  });

  describe('isInitialized', () => {
    it('should return true after construction', () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      expect(container.isInitialized()).toBe(true);
    });

    it('should return false after disposal', async () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      await container.dispose();
      expect(container.isInitialized()).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should close database connections', async () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      await container.dispose();
      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('should shutdown queue manager when provided', async () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });

      await container.dispose();
      expect(mockQueueManager.shutdown).toHaveBeenCalledTimes(1);
      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('should stop retention scheduler when provided', async () => {
      const mockScheduler = {
        stop: vi.fn().mockResolvedValue(undefined),
      };

      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        retentionScheduler: mockScheduler as unknown as RetentionScheduler,
      });

      await container.dispose();
      expect(mockScheduler.stop).toHaveBeenCalledTimes(1);
    });

    it('should only dispose once (idempotent)', async () => {
      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });

      await container.dispose();
      await container.dispose(); // Second call should be no-op

      expect(mockDb.close).toHaveBeenCalledTimes(1);
      expect(mockQueueManager.shutdown).toHaveBeenCalledTimes(1);
    });

    it('should throw error if disposal fails', async () => {
      const errorMessage = 'Database close failed';
      mockDb.close = vi.fn().mockRejectedValue(new Error(errorMessage));

      const container = new ServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      await expect(container.dispose()).rejects.toThrow(errorMessage);
    });
  });

  describe('createServiceContainer factory', () => {
    it('should create container using factory function', () => {
      const container = createServiceContainer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      expect(container).toBeInstanceOf(ServiceContainer);
      expect(container.db).toBe(mockDb);
      expect(container.isInitialized()).toBe(true);
    });
  });
});
