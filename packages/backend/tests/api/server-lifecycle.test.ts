/**
 * Server Lifecycle Tests
 * Validates proper resource cleanup during server shutdown
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createServer, shutdownServer } from '../../src/api/server.js';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import type { QueueManager } from '../../src/queue/queue-manager.js';
import type { RetentionService } from '../../src/retention/retention-service.js';
import type { RetentionScheduler } from '../../src/retention/retention-scheduler.js';
import type { IServiceContainer } from '../../src/container/service-container.js';

describe('Server Lifecycle', () => {
  let mockDb: DatabaseClient;
  let mockStorage: IStorageService;
  let mockPluginRegistry: PluginRegistry;
  let mockQueueManager: QueueManager;
  let mockRetentionService: RetentionService;
  let mockRetentionScheduler: RetentionScheduler;

  beforeEach(() => {
    // Create comprehensive mocks
    mockDb = {
      testConnection: vi.fn().mockResolvedValue(true),
      close: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
      getPool: vi.fn().mockReturnValue({}),
      bugReports: {} as unknown,
      projects: {} as unknown,
      users: {} as unknown,
      sessions: {} as unknown,
      tickets: {} as unknown,
      projectMembers: {} as unknown,
      auditLogs: {} as unknown,
      analytics: {} as unknown,
    } as unknown as DatabaseClient;

    mockStorage = {
      healthCheck: vi.fn().mockResolvedValue(true),
      uploadFile: vi.fn(),
      getSignedUrl: vi.fn(),
    } as unknown as IStorageService;

    mockPluginRegistry = {
      getPlugins: vi.fn().mockReturnValue([]),
      listPlugins: vi.fn().mockReturnValue([]),
      getSupportedPlatforms: vi.fn().mockReturnValue([]),
    } as unknown as PluginRegistry;

    mockQueueManager = {
      healthCheck: vi.fn().mockResolvedValue(true),
      shutdown: vi.fn().mockResolvedValue(undefined),
      initialize: vi.fn().mockResolvedValue(undefined),
    } as unknown as QueueManager;

    mockRetentionService = {} as unknown as RetentionService;

    mockRetentionScheduler = {
      stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as RetentionScheduler;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createServer', () => {
    it('should attach service container to Fastify instance', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      // Verify container is attached
      const container = (server as FastifyInstance & { container: IServiceContainer }).container;
      expect(container).toBeDefined();
      expect(container.db).toBe(mockDb);
      expect(container.storage).toBe(mockStorage);
      expect(container.pluginRegistry).toBe(mockPluginRegistry);

      await server.close();
    });

    it('should attach container with all optional services', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
        retentionService: mockRetentionService,
        retentionScheduler: mockRetentionScheduler,
      });

      const container = (server as FastifyInstance & { container: IServiceContainer }).container;
      expect(container.queueManager).toBe(mockQueueManager);
      expect(container.retentionService).toBe(mockRetentionService);
      expect(container.retentionScheduler).toBe(mockRetentionScheduler);

      await server.close();
    });
  });

  describe('shutdownServer', () => {
    it('should call container.dispose() during shutdown', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      // Get reference to container and spy on dispose
      const container = (server as FastifyInstance & { container: IServiceContainer }).container;
      const disposeSpy = vi.spyOn(container, 'dispose');

      await shutdownServer(server);

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it('should close database connections via container disposal', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      await shutdownServer(server);

      // Database close should be called by container.dispose()
      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });

    it('should shutdown queue manager via container disposal', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });

      await shutdownServer(server);

      // Queue manager shutdown should be called by container.dispose()
      expect(mockQueueManager.shutdown).toHaveBeenCalledTimes(1);
    });

    it('should stop retention scheduler via container disposal', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        retentionScheduler: mockRetentionScheduler,
      });

      await shutdownServer(server);

      // Retention scheduler stop should be called by container.dispose()
      expect(mockRetentionScheduler.stop).toHaveBeenCalledTimes(1);
    });

    it('should close server before disposing container', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });

      const closeSpy = vi.spyOn(server, 'close');
      const container = (server as FastifyInstance & { container: IServiceContainer }).container;
      const disposeSpy = vi.spyOn(container, 'dispose');

      await shutdownServer(server);

      // Verify order: server close happens before container disposal
      expect(closeSpy).toHaveBeenCalled();
      expect(disposeSpy).toHaveBeenCalled();

      // Check that close was called before dispose (using mock call order)
      const closeCallOrder = closeSpy.mock.invocationCallOrder[0];
      const disposeCallOrder = disposeSpy.mock.invocationCallOrder[0];
      expect(closeCallOrder).toBeLessThan(disposeCallOrder);
    });

    it('should handle missing container gracefully', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      // Remove container to simulate edge case
      (server as unknown as { container: undefined }).container = undefined;

      // Should not throw
      await expect(shutdownServer(server)).resolves.not.toThrow();
    });

    it('should throw error if container disposal fails', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      // Make dispose fail
      const container = (server as FastifyInstance & { container: IServiceContainer }).container;
      vi.spyOn(container, 'dispose').mockRejectedValue(new Error('Disposal failed'));

      await expect(shutdownServer(server)).rejects.toThrow('Disposal failed');
    });

    it('should prevent resource leaks by disposing all services', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
        retentionScheduler: mockRetentionScheduler,
      });

      await shutdownServer(server);

      // Verify all cleanup methods were called
      expect(mockDb.close).toHaveBeenCalledTimes(1);
      expect(mockQueueManager.shutdown).toHaveBeenCalledTimes(1);
      expect(mockRetentionScheduler.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('Resource Leak Prevention', () => {
    it('should not leak database connections when server is created and destroyed', async () => {
      const server1 = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });
      await shutdownServer(server1);

      const server2 = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });
      await shutdownServer(server2);

      // Database should be closed twice (once per server lifecycle)
      expect(mockDb.close).toHaveBeenCalledTimes(2);
    });

    it('should not leak queue manager connections across server restarts', async () => {
      const server1 = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });
      await shutdownServer(server1);

      const server2 = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
        queueManager: mockQueueManager,
      });
      await shutdownServer(server2);

      // Queue manager should be shut down twice
      expect(mockQueueManager.shutdown).toHaveBeenCalledTimes(2);
    });

    it('should dispose container only once even if shutdown is called multiple times', async () => {
      const server = await createServer({
        db: mockDb,
        storage: mockStorage,
        pluginRegistry: mockPluginRegistry,
      });

      const container = (server as FastifyInstance & { container: IServiceContainer }).container;
      const disposeSpy = vi.spyOn(container, 'dispose');

      await shutdownServer(server);

      // Container's dispose is idempotent, so calling shutdown again should work
      // but the underlying resources should already be closed
      await shutdownServer(server);

      // dispose() is called twice, but the container's dispose() is idempotent
      expect(disposeSpy).toHaveBeenCalledTimes(2);

      // But database should only be closed once (container's dispose is idempotent)
      expect(mockDb.close).toHaveBeenCalledTimes(1);
    });
  });
});
