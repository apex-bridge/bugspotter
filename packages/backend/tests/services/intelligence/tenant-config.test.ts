/**
 * Intelligence Tenant Config Tests
 *
 * Unit tests for settings resolution, LRU cache, TTL expiry,
 * and client factory behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveOrgIntelligenceSettings,
  getOrgIntelligenceSettings,
  IntelligenceClientFactory,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '../../../src/services/intelligence/tenant-config.js';
import type { OrganizationSettings } from '../../../src/db/types.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { IntelligenceConfig } from '../../../src/config/intelligence.config.js';
import type { CredentialEncryption } from '../../../src/utils/encryption.js';

// Mock IntelligenceClient to avoid real HTTP
vi.mock('../../../src/services/intelligence/intelligence-client.js', () => ({
  IntelligenceClient: vi.fn().mockImplementation((config: unknown) => ({
    _config: config,
    analyzeBug: vi.fn(),
  })),
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(orgSettings?: OrganizationSettings | null): Partial<DatabaseClient> {
  return {
    organizations: {
      findById: vi
        .fn()
        .mockResolvedValue(
          orgSettings === null ? null : { id: 'org-1', settings: orgSettings ?? {} }
        ),
      updateSettings: vi.fn().mockResolvedValue({ id: 'org-1', settings: orgSettings ?? {} }),
    } as unknown as DatabaseClient['organizations'],
  };
}

function createMockEncryption(): CredentialEncryption {
  return {
    encrypt: vi.fn((val: string) => `encrypted:${val}`),
    decrypt: vi.fn((val: string) => val.replace('encrypted:', '')),
  } as unknown as CredentialEncryption;
}

function createGlobalConfig(overrides?: Partial<IntelligenceConfig>): IntelligenceConfig {
  return {
    enabled: true,
    client: {
      baseUrl: 'http://intelligence:8000',
      apiKey: 'global-key',
      timeout: 5000,
      maxRetries: 2,
      backoffDelay: 1000,
      circuitBreaker: { enabled: false, failureThreshold: 5, resetTimeoutMs: 30000 },
    },
    ...overrides,
  } as IntelligenceConfig;
}

// ============================================================================
// resolveOrgIntelligenceSettings
// ============================================================================

describe('resolveOrgIntelligenceSettings', () => {
  it('returns defaults for empty settings', () => {
    const result = resolveOrgIntelligenceSettings({});
    expect(result).toEqual(INTELLIGENCE_SETTINGS_DEFAULTS);
  });

  it('merges provided values with defaults', () => {
    const result = resolveOrgIntelligenceSettings({
      intelligence_enabled: true,
      intelligence_similarity_threshold: 0.9,
    });
    expect(result.intelligence_enabled).toBe(true);
    expect(result.intelligence_similarity_threshold).toBe(0.9);
    expect(result.intelligence_auto_analyze).toBe(true); // default
  });

  it('null values fall back to defaults', () => {
    const result = resolveOrgIntelligenceSettings({
      intelligence_similarity_threshold: null,
      intelligence_dedup_action: null,
    });
    expect(result.intelligence_similarity_threshold).toBe(0.75);
    expect(result.intelligence_dedup_action).toBe('flag');
  });
});

// ============================================================================
// getOrgIntelligenceSettings
// ============================================================================

describe('getOrgIntelligenceSettings', () => {
  it('returns defaults when org not found', async () => {
    const db = createMockDb(null);
    const result = await getOrgIntelligenceSettings(db as DatabaseClient, 'nonexistent');
    expect(result).toEqual(INTELLIGENCE_SETTINGS_DEFAULTS);
  });

  it('resolves settings from existing org', async () => {
    const db = createMockDb({ intelligence_enabled: true });
    const result = await getOrgIntelligenceSettings(db as DatabaseClient, 'org-1');
    expect(result.intelligence_enabled).toBe(true);
    expect(result.intelligence_auto_analyze).toBe(true); // default
  });
});

// ============================================================================
// IntelligenceClientFactory
// ============================================================================

describe('IntelligenceClientFactory', () => {
  let mockDb: Partial<DatabaseClient>;
  let mockEncryption: CredentialEncryption;
  let globalConfig: IntelligenceConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEncryption = createMockEncryption();
    globalConfig = createGlobalConfig();
  });

  describe('getGlobalClient', () => {
    it('returns global client when config enabled with API key', () => {
      mockDb = createMockDb();
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption
      );
      expect(factory.getGlobalClient()).not.toBeNull();
    });

    it('returns null when config disabled', () => {
      mockDb = createMockDb();
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        createGlobalConfig({ enabled: false }),
        mockEncryption
      );
      expect(factory.getGlobalClient()).toBeNull();
    });
  });

  describe('getClientForOrg', () => {
    it('returns null when org intelligence is disabled', async () => {
      mockDb = createMockDb({ intelligence_enabled: false, intelligence_api_key: 'encrypted:key' });
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption
      );
      const client = await factory.getClientForOrg('org-1');
      expect(client).toBeNull();
    });

    it('returns null when org has no API key', async () => {
      mockDb = createMockDb({ intelligence_enabled: true });
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption
      );
      const client = await factory.getClientForOrg('org-1');
      expect(client).toBeNull();
    });

    it('returns client when org has enabled + key', async () => {
      mockDb = createMockDb({ intelligence_enabled: true, intelligence_api_key: 'encrypted:key' });
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption
      );
      const client = await factory.getClientForOrg('org-1');
      expect(client).not.toBeNull();
    });

    it('returns null when decryption fails', async () => {
      mockDb = createMockDb({ intelligence_enabled: true, intelligence_api_key: 'corrupted' });
      mockEncryption.decrypt = vi.fn().mockImplementation(() => {
        throw new Error('decryption failed');
      });
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption
      );
      const client = await factory.getClientForOrg('org-1');
      expect(client).toBeNull();
    });

    it('caches client and returns from cache on second call', async () => {
      mockDb = createMockDb({ intelligence_enabled: true, intelligence_api_key: 'encrypted:key' });
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption
      );

      const client1 = await factory.getClientForOrg('org-1');
      const client2 = await factory.getClientForOrg('org-1');

      expect(client1).toBe(client2);
      // findById should only be called once (second call hits cache)
      expect(mockDb.organizations!.findById).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTL expiry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('refreshes client after TTL expires', async () => {
      vi.useFakeTimers();
      mockDb = createMockDb({ intelligence_enabled: true, intelligence_api_key: 'encrypted:key' });
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption,
        { ttlMs: 1000 }
      );

      const client1 = await factory.getClientForOrg('org-1');
      vi.advanceTimersByTime(1500);
      const client2 = await factory.getClientForOrg('org-1');

      expect(client1).not.toBe(client2); // New client after TTL
      expect(mockDb.organizations!.findById).toHaveBeenCalledTimes(2);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when cache is full', async () => {
      const orgSettings = { intelligence_enabled: true, intelligence_api_key: 'encrypted:key' };
      mockDb = createMockDb(orgSettings);
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption,
        { maxSize: 2 }
      );

      await factory.getClientForOrg('org-a');
      await factory.getClientForOrg('org-b');
      await factory.getClientForOrg('org-c'); // Should evict org-a

      // Access org-a again — should trigger DB lookup (was evicted)
      (mockDb.organizations!.findById as ReturnType<typeof vi.fn>).mockClear();
      await factory.getClientForOrg('org-a');
      expect(mockDb.organizations!.findById).toHaveBeenCalledTimes(1);
    });

    it('cache hit reorders LRU (recently used not evicted)', async () => {
      const orgSettings = { intelligence_enabled: true, intelligence_api_key: 'encrypted:key' };
      mockDb = createMockDb(orgSettings);
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption,
        { maxSize: 2 }
      );

      await factory.getClientForOrg('org-a');
      await factory.getClientForOrg('org-b');
      await factory.getClientForOrg('org-a'); // Re-access org-a (now most recent)
      await factory.getClientForOrg('org-c'); // Should evict org-b (oldest)

      // org-a should still be cached
      (mockDb.organizations!.findById as ReturnType<typeof vi.fn>).mockClear();
      await factory.getClientForOrg('org-a');
      expect(mockDb.organizations!.findById).not.toHaveBeenCalled();
    });
  });

  describe('invalidateOrg', () => {
    it('removes cached client', async () => {
      mockDb = createMockDb({ intelligence_enabled: true, intelligence_api_key: 'encrypted:key' });
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption
      );

      await factory.getClientForOrg('org-1');
      factory.invalidateOrg('org-1');

      // Next call should hit DB again
      (mockDb.organizations!.findById as ReturnType<typeof vi.fn>).mockClear();
      await factory.getClientForOrg('org-1');
      expect(mockDb.organizations!.findById).toHaveBeenCalledTimes(1);
    });
  });

  describe('constructor validation', () => {
    it('clamps maxSize to at least 1', () => {
      mockDb = createMockDb();
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption,
        { maxSize: -5 }
      );
      // Factory should work with maxSize=1 (not crash)
      expect(factory.getGlobalClient()).not.toBeNull();
    });

    it('clamps ttlMs to at least 0', () => {
      mockDb = createMockDb();
      const factory = new IntelligenceClientFactory(
        mockDb as DatabaseClient,
        globalConfig,
        mockEncryption,
        { ttlMs: -100 }
      );
      expect(factory.getGlobalClient()).not.toBeNull();
    });
  });
});
