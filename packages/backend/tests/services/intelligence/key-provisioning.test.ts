/**
 * Intelligence Key Provisioning Tests
 *
 * Unit tests for key lifecycle (provision, revoke, status)
 * and settings update validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { IntelligenceKeyProvisioning } from '../../../src/services/intelligence/key-provisioning.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { CredentialEncryption } from '../../../src/utils/encryption.js';
import type { IntelligenceClientFactory } from '../../../src/services/intelligence/tenant-config.js';

vi.mock('axios');

// ============================================================================
// Helpers
// ============================================================================

function createMockDb(orgSettings: Record<string, unknown> = {}): Partial<DatabaseClient> {
  return {
    organizations: {
      findById: vi.fn().mockResolvedValue({
        id: 'org-1',
        settings: orgSettings,
      }),
      updateSettings: vi.fn().mockResolvedValue({
        id: 'org-1',
        settings: orgSettings,
      }),
    } as unknown as DatabaseClient['organizations'],
  };
}

function createMockEncryption(): CredentialEncryption {
  return {
    encrypt: vi.fn((val: string) => `enc:${val}`),
    decrypt: vi.fn((val: string) => val.replace('enc:', '')),
  } as unknown as CredentialEncryption;
}

function createMockFactory(): IntelligenceClientFactory {
  return {
    invalidateOrg: vi.fn(),
    getClientForOrg: vi.fn(),
    getGlobalClient: vi.fn(),
  } as unknown as IntelligenceClientFactory;
}

// ============================================================================
// Tests
// ============================================================================

describe('IntelligenceKeyProvisioning', () => {
  let mockDb: Partial<DatabaseClient>;
  let mockEncryption: CredentialEncryption;
  let mockFactory: IntelligenceClientFactory;
  let provisioning: IntelligenceKeyProvisioning;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    mockEncryption = createMockEncryption();
    mockFactory = createMockFactory();
    provisioning = new IntelligenceKeyProvisioning(
      mockDb as DatabaseClient,
      mockEncryption,
      mockFactory
    );
  });

  // ==========================================================================
  // generateAndProvisionKey
  // ==========================================================================

  describe('generateAndProvisionKey', () => {
    const BASE_URL = 'https://intelligence.example.com';
    const MASTER_KEY = 'master-key-abc123';

    beforeEach(() => {
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory,
        BASE_URL,
        MASTER_KEY
      );
    });

    it('calls intelligence service with master key and auto-provisions the returned key', async () => {
      (axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { plain_key: 'sk-tenant-abcd1234' },
      });

      const result = await provisioning.generateAndProvisionKey('org-1', 'user-1');

      expect(axios.post).toHaveBeenCalledWith(
        `${BASE_URL}/api/v1/admin/tenants/org-1/api-keys`,
        { name: 'org-1', rate_limit_per_minute: 120 },
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${MASTER_KEY}` }),
        })
      );
      expect(mockEncryption.encrypt).toHaveBeenCalledWith('sk-tenant-abcd1234');
      expect(mockFactory.invalidateOrg).toHaveBeenCalledWith('org-1');
      expect(result.provisioned).toBe(true);
      expect(result.key_hint).toBe('****1234');
    });

    it('normalizes a trailing slash in the base URL', async () => {
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory,
        'https://intelligence.example.com/',
        MASTER_KEY
      );
      (axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { plain_key: 'sk-abcd1234' },
      });

      await provisioning.generateAndProvisionKey('org-1', 'user-1');

      const calledUrl = (axios.post as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain('//api/');
      expect(calledUrl).toMatch(/^https:\/\/intelligence\.example\.com\/api\//);
    });

    it('throws 503 when master key is not configured', async () => {
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory,
        BASE_URL,
        ''
      );

      await expect(provisioning.generateAndProvisionKey('org-1', 'user-1')).rejects.toThrow(
        'INTELLIGENCE_MASTER_API_KEY is not configured'
      );
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('throws 503 when base URL is not configured', async () => {
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory,
        '',
        MASTER_KEY
      );

      await expect(provisioning.generateAndProvisionKey('org-1', 'user-1')).rejects.toThrow(
        'INTELLIGENCE_API_URL is not configured'
      );
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('throws 502 when intelligence service returns a non-2xx response', async () => {
      const axiosErr = Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        response: { data: { detail: 'internal server error' } },
      });
      (axios.isAxiosError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (axios.post as ReturnType<typeof vi.fn>).mockRejectedValue(axiosErr);

      await expect(provisioning.generateAndProvisionKey('org-1', 'user-1')).rejects.toThrow(
        'Intelligence service key generation failed: internal server error'
      );
    });

    it('throws 502 when intelligence service returns an empty plain_key', async () => {
      (axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({
        data: { plain_key: '' },
      });

      await expect(provisioning.generateAndProvisionKey('org-1', 'user-1')).rejects.toThrow(
        'Intelligence service returned invalid key payload'
      );
      expect(mockEncryption.encrypt).not.toHaveBeenCalled();
    });

    it('throws 502 when intelligence service omits plain_key', async () => {
      (axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {} });

      await expect(provisioning.generateAndProvisionKey('org-1', 'user-1')).rejects.toThrow(
        'Intelligence service returned invalid key payload'
      );
    });
  });

  // ==========================================================================
  // provisionKey
  // ==========================================================================

  describe('provisionKey', () => {
    it('encrypts key, stores it, and invalidates cache', async () => {
      const result = await provisioning.provisionKey('org-1', 'sk-test-key-1234', 'user-1');

      expect(mockEncryption.encrypt).toHaveBeenCalledWith('sk-test-key-1234');
      expect(mockDb.organizations!.updateSettings).toHaveBeenCalledWith('org-1', {
        intelligence_api_key: 'enc:sk-test-key-1234',
        intelligence_api_key_provisioned_at: expect.any(String),
        intelligence_api_key_provisioned_by: 'user-1',
      });
      expect(mockFactory.invalidateOrg).toHaveBeenCalledWith('org-1');
      expect(result.provisioned).toBe(true);
      expect(result.key_hint).toBe('****1234');
    });

    it('throws 404 when org not found', async () => {
      (mockDb.organizations!.updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(provisioning.provisionKey('nonexistent', 'key', 'user-1')).rejects.toThrow(
        'Organization not found'
      );
    });
  });

  // ==========================================================================
  // revokeKey
  // ==========================================================================

  describe('revokeKey', () => {
    it('clears key fields with null and disables intelligence', async () => {
      await provisioning.revokeKey('org-1');

      expect(mockDb.organizations!.updateSettings).toHaveBeenCalledWith('org-1', {
        intelligence_api_key: null,
        intelligence_api_key_provisioned_at: null,
        intelligence_api_key_provisioned_by: null,
        intelligence_enabled: false,
      });
      expect(mockFactory.invalidateOrg).toHaveBeenCalledWith('org-1');
    });

    it('throws 404 when org not found', async () => {
      (mockDb.organizations!.updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(provisioning.revokeKey('nonexistent')).rejects.toThrow('Organization not found');
    });
  });

  // ==========================================================================
  // getKeyStatus
  // ==========================================================================

  describe('getKeyStatus', () => {
    it('returns not provisioned when org has no key', async () => {
      const status = await provisioning.getKeyStatus('org-1');
      expect(status.provisioned).toBe(false);
      expect(status.decryptable).toBe(false);
      expect(status.key_hint).toBeNull();
    });

    it('returns provisioned + decryptable when key is valid', async () => {
      mockDb = createMockDb({
        intelligence_api_key: 'enc:sk-test-abcd',
        intelligence_api_key_provisioned_at: '2026-01-01T00:00:00Z',
        intelligence_api_key_provisioned_by: 'user-1',
      });
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory
      );

      const status = await provisioning.getKeyStatus('org-1');
      expect(status.provisioned).toBe(true);
      expect(status.decryptable).toBe(true);
      expect(status.key_hint).toBe('****abcd');
    });

    it('returns provisioned but not decryptable when key is corrupted', async () => {
      mockDb = createMockDb({
        intelligence_api_key: 'corrupted-blob',
        intelligence_api_key_provisioned_at: '2026-01-01T00:00:00Z',
      });
      mockEncryption.decrypt = vi.fn().mockImplementation(() => {
        throw new Error('decryption failed');
      });
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory
      );

      const status = await provisioning.getKeyStatus('org-1');
      expect(status.provisioned).toBe(true);
      expect(status.decryptable).toBe(false);
      expect(status.key_hint).toBe('****');
    });

    it('uses preloaded settings when provided', async () => {
      const preloaded = {
        intelligence_enabled: true,
        intelligence_api_key: 'enc:sk-test-wxyz',
        intelligence_provider: null,
        intelligence_auto_analyze: true,
        intelligence_similarity_threshold: 0.75,
        intelligence_dedup_action: 'flag' as const,
        intelligence_api_key_provisioned_at: '2026-01-01T00:00:00Z',
        intelligence_api_key_provisioned_by: 'user-1',
      };

      const status = await provisioning.getKeyStatus('org-1', preloaded);
      expect(status.provisioned).toBe(true);
      // Should NOT call findById when preloaded
      expect(mockDb.organizations!.findById).not.toHaveBeenCalled();
    });

    it('returns not provisioned when org not found', async () => {
      (mockDb.organizations!.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const status = await provisioning.getKeyStatus('nonexistent');
      expect(status.provisioned).toBe(false);
    });
  });

  // ==========================================================================
  // updateSettings
  // ==========================================================================

  describe('updateSettings', () => {
    it('rejects enabling intelligence without a provisioned key', async () => {
      // No key provisioned (default mock has empty settings)
      await expect(
        provisioning.updateSettings('org-1', { intelligence_enabled: true })
      ).rejects.toThrow('Cannot enable intelligence without a provisioned API key');
    });

    it('throws 404 when enabling intelligence for nonexistent org', async () => {
      (mockDb.organizations!.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        provisioning.updateSettings('nonexistent', { intelligence_enabled: true })
      ).rejects.toThrow('Organization not found');
    });

    it('rejects enabling intelligence with undecryptable key', async () => {
      mockDb = createMockDb({
        intelligence_api_key: 'corrupted',
        intelligence_api_key_provisioned_at: '2026-01-01T00:00:00Z',
      });
      mockEncryption.decrypt = vi.fn().mockImplementation(() => {
        throw new Error('bad key');
      });
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory
      );

      await expect(
        provisioning.updateSettings('org-1', { intelligence_enabled: true })
      ).rejects.toThrow('stored API key cannot be decrypted');
    });

    it('allows updating non-enabling settings without key check', async () => {
      await provisioning.updateSettings('org-1', {
        intelligence_similarity_threshold: 0.8,
      });

      expect(mockDb.organizations!.updateSettings).toHaveBeenCalledWith('org-1', {
        intelligence_similarity_threshold: 0.8,
      });
    });

    it('throws 404 when org not found during update', async () => {
      (mockDb.organizations!.updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      await expect(
        provisioning.updateSettings('org-1', { intelligence_auto_analyze: false })
      ).rejects.toThrow('Organization not found');
    });

    it('invalidates cache when intelligence_enabled changes', async () => {
      // Set up org with valid key so enabling succeeds
      mockDb = createMockDb({
        intelligence_api_key: 'enc:sk-valid-key1',
        intelligence_api_key_provisioned_at: '2026-01-01T00:00:00Z',
      });
      (mockDb.organizations!.updateSettings as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'org-1',
        settings: { intelligence_enabled: true },
      });
      provisioning = new IntelligenceKeyProvisioning(
        mockDb as DatabaseClient,
        mockEncryption,
        mockFactory
      );

      await provisioning.updateSettings('org-1', { intelligence_enabled: true });
      expect(mockFactory.invalidateOrg).toHaveBeenCalledWith('org-1');
    });

    it('does not invalidate cache for non-enabled setting changes', async () => {
      await provisioning.updateSettings('org-1', {
        intelligence_auto_analyze: false,
      });
      expect(mockFactory.invalidateOrg).not.toHaveBeenCalled();
    });
  });
});
