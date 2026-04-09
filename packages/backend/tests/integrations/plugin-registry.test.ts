/**
 * Plugin Registry Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginRegistry } from '../../src/integrations/plugin-registry.js';
import type {
  IntegrationPlugin,
  AdvancedIntegrationPlugin,
} from '../../src/integrations/plugin.types.js';
import type { IntegrationService } from '../../src/integrations/base-integration.service.js';

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  let mockDb: any;
  let mockStorage: any;

  beforeEach(() => {
    mockDb = {
      bugReports: {},
      projectIntegrations: {},
      tickets: {},
    };
    mockStorage = {};
    registry = new PluginRegistry(mockDb, mockStorage);
  });

  describe('register', () => {
    it('should register a basic plugin', async () => {
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
      };

      await registry.register(plugin);

      expect(registry.isSupported('test')).toBe(true);
      expect(registry.get('test')).toBe(mockService);
    });

    it('should call onLoad lifecycle hook', async () => {
      const onLoad = vi.fn();
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: AdvancedIntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
        lifecycle: {
          onLoad,
        },
      };

      await registry.register(plugin);

      expect(onLoad).toHaveBeenCalledOnce();
    });

    it('should call validate lifecycle hook', async () => {
      const validate = vi.fn().mockResolvedValue(true);
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: AdvancedIntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
        lifecycle: {
          validate,
        },
      };

      await registry.register(plugin);

      expect(validate).toHaveBeenCalledOnce();
    });

    it('should throw error if validation fails', async () => {
      const validate = vi.fn().mockResolvedValue(false);
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: AdvancedIntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
        lifecycle: {
          validate,
        },
      };

      await expect(registry.register(plugin)).rejects.toThrow('Plugin validation failed');
    });

    it('should throw error if metadata is invalid', async () => {
      const plugin = {
        metadata: {
          name: '',
          platform: '',
          version: '',
        },
        factory: () => ({}) as IntegrationService,
      };

      await expect(registry.register(plugin)).rejects.toThrow('Invalid plugin metadata');
    });

    it('should skip if plugin already registered', async () => {
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
      };

      await registry.register(plugin);
      await registry.register(plugin); // Should skip

      expect(registry.getSupportedPlatforms()).toEqual(['test']);
    });

    it('should normalize platform name to lowercase', async () => {
      const mockService: IntegrationService = {
        platform: 'Test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'Test',
          version: '1.0.0',
        },
        factory: () => mockService,
      };

      await registry.register(plugin);

      expect(registry.isSupported('test')).toBe(true);
      expect(registry.isSupported('Test')).toBe(true);
      expect(registry.isSupported('TEST')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should unregister a plugin', async () => {
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
      };

      await registry.register(plugin);
      expect(registry.isSupported('test')).toBe(true);

      await registry.unregister('test');
      expect(registry.isSupported('test')).toBe(false);
    });

    it('should call onUnload lifecycle hook', async () => {
      const onUnload = vi.fn();
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: AdvancedIntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
        lifecycle: {
          onUnload,
        },
      };

      await registry.register(plugin);
      await registry.unregister('test');

      expect(onUnload).toHaveBeenCalledOnce();
    });

    it('should handle unregistering non-existent plugin', async () => {
      await expect(registry.unregister('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('get', () => {
    it('should return service for registered platform', async () => {
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
      };

      await registry.register(plugin);

      expect(registry.get('test')).toBe(mockService);
    });

    it('should return null for non-existent platform', () => {
      expect(registry.get('nonexistent')).toBeNull();
    });

    it('should be case-insensitive', async () => {
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
      };

      await registry.register(plugin);

      expect(registry.get('test')).toBe(mockService);
      expect(registry.get('Test')).toBe(mockService);
      expect(registry.get('TEST')).toBe(mockService);
    });
  });

  describe('isSupported', () => {
    it('should return true for registered platform', async () => {
      const mockService: IntegrationService = {
        platform: 'test',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
        },
        factory: () => mockService,
      };

      await registry.register(plugin);

      expect(registry.isSupported('test')).toBe(true);
    });

    it('should return false for non-existent platform', () => {
      expect(registry.isSupported('nonexistent')).toBe(false);
    });
  });

  describe('getSupportedPlatforms', () => {
    it('should return empty array when no plugins registered', () => {
      expect(registry.getSupportedPlatforms()).toEqual([]);
    });

    it('should return array of registered platforms', async () => {
      const plugin1: IntegrationPlugin = {
        metadata: {
          name: 'Plugin 1',
          platform: 'test1',
          version: '1.0.0',
        },
        factory: () => ({
          platform: 'test1',
          createFromBugReport: vi.fn(),
          testConnection: vi.fn(),
        }),
      };

      const plugin2: IntegrationPlugin = {
        metadata: {
          name: 'Plugin 2',
          platform: 'test2',
          version: '1.0.0',
        },
        factory: () => ({
          platform: 'test2',
          createFromBugReport: vi.fn(),
          testConnection: vi.fn(),
        }),
      };

      await registry.register(plugin1);
      await registry.register(plugin2);

      const platforms = registry.getSupportedPlatforms();
      expect(platforms).toHaveLength(2);
      expect(platforms).toContain('test1');
      expect(platforms).toContain('test2');
    });
  });

  describe('getAll', () => {
    it('should return empty array when no plugins registered', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('should return all registered services', async () => {
      const service1: IntegrationService = {
        platform: 'test1',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const service2: IntegrationService = {
        platform: 'test2',
        createFromBugReport: vi.fn(),
        testConnection: vi.fn(),
      };

      const plugin1: IntegrationPlugin = {
        metadata: {
          name: 'Plugin 1',
          platform: 'test1',
          version: '1.0.0',
        },
        factory: () => service1,
      };

      const plugin2: IntegrationPlugin = {
        metadata: {
          name: 'Plugin 2',
          platform: 'test2',
          version: '1.0.0',
        },
        factory: () => service2,
      };

      await registry.register(plugin1);
      await registry.register(plugin2);

      const services = registry.getAll();
      expect(services).toHaveLength(2);
      expect(services).toContain(service1);
      expect(services).toContain(service2);
    });
  });

  describe('getPluginMetadata', () => {
    it('should return metadata for registered plugin', async () => {
      const plugin: IntegrationPlugin = {
        metadata: {
          name: 'Test Plugin',
          platform: 'test',
          version: '1.0.0',
          description: 'A test plugin',
          author: 'Test Author',
        },
        factory: () => ({
          platform: 'test',
          createFromBugReport: vi.fn(),
          testConnection: vi.fn(),
        }),
      };

      await registry.register(plugin);

      const metadata = registry.getPluginMetadata('test');
      expect(metadata).toEqual(plugin.metadata);
    });

    it('should return null for non-existent plugin', () => {
      expect(registry.getPluginMetadata('nonexistent')).toBeNull();
    });
  });

  describe('getAllPluginMetadata', () => {
    it('should return empty array when no plugins registered', () => {
      expect(registry.getAllPluginMetadata()).toEqual([]);
    });

    it('should return metadata for all plugins', async () => {
      const plugin1: IntegrationPlugin = {
        metadata: {
          name: 'Plugin 1',
          platform: 'test1',
          version: '1.0.0',
        },
        factory: () => ({
          platform: 'test1',
          createFromBugReport: vi.fn(),
          testConnection: vi.fn(),
        }),
      };

      const plugin2: IntegrationPlugin = {
        metadata: {
          name: 'Plugin 2',
          platform: 'test2',
          version: '2.0.0',
        },
        factory: () => ({
          platform: 'test2',
          createFromBugReport: vi.fn(),
          testConnection: vi.fn(),
        }),
      };

      await registry.register(plugin1);
      await registry.register(plugin2);

      const metadata = registry.getAllPluginMetadata();
      expect(metadata).toHaveLength(2);
      expect(metadata).toContainEqual(plugin1.metadata);
      expect(metadata).toContainEqual(plugin2.metadata);
    });
  });
});
