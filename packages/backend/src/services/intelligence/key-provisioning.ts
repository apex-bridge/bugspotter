/**
 * Intelligence Key Provisioning
 *
 * Manages per-org intelligence API keys: provision, revoke, and retrieve status.
 * Keys are encrypted at rest via CredentialEncryption (AES-256-GCM).
 */

import axios from 'axios';
import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { OrganizationSettings } from '../../db/types.js';
import type { CredentialEncryption } from '../../utils/encryption.js';
import { AppError, ValidationError } from '../../api/middleware/error.js';
import type { IntelligenceClientFactory } from './tenant-config.js';
import { resolveOrgIntelligenceSettings, type OrgIntelligenceSettings } from './tenant-config.js';

const logger = getLogger();

// Rate limit assigned to per-org tenant keys generated via the master key.
// 120 RPM is intentionally higher than the default (60) to handle burst traffic
// from active engineering teams without throttling bug ingestion.
const TENANT_KEY_RATE_LIMIT_RPM = 120;

// Timeout for the key-generation call to the intelligence service.
// Kept separate from the query timeout — provisioning is a one-time admin op
// and the intelligence service may need a moment to hash + store the new key.
const KEY_GENERATION_TIMEOUT_MS = 10_000;

// ============================================================================
// Types
// ============================================================================

export interface ProvisionKeyResult {
  provisioned: boolean;
  provisioned_at: string;
  provisioned_by: string;
  key_hint: string;
}

export interface KeyStatus {
  provisioned: boolean;
  /** Whether the stored key can be successfully decrypted (false after master key rotation/corruption) */
  decryptable: boolean;
  provisioned_at: string | null;
  provisioned_by: string | null;
  key_hint: string | null;
}

// Fields that can be updated via the settings endpoint (not the key itself).
// Picks from OrganizationSettings (optional fields) to stay compatible with updateSettings().
export type IntelligenceSettingsUpdate = Pick<
  OrganizationSettings,
  | 'intelligence_enabled'
  | 'intelligence_provider'
  | 'intelligence_auto_analyze'
  | 'intelligence_auto_enrich'
  | 'intelligence_similarity_threshold'
  | 'intelligence_dedup_enabled'
  | 'intelligence_dedup_action'
  | 'intelligence_self_service_enabled'
>;

// ============================================================================
// Service
// ============================================================================

export class IntelligenceKeyProvisioning {
  constructor(
    private readonly db: DatabaseClient,
    private readonly encryption: CredentialEncryption,
    private readonly clientFactory: IntelligenceClientFactory,
    private readonly intelligenceBaseUrl: string = '',
    private readonly masterApiKey: string = ''
  ) {}

  /**
   * Generate a new per-org tenant key from the intelligence service and auto-provision it.
   * Uses the master API key to call POST /api/v1/admin/tenants/{orgId}/api-keys on the
   * intelligence service, creating an isolated tenant scope for this org.
   */
  async generateAndProvisionKey(orgId: string, provisionedBy: string): Promise<ProvisionKeyResult> {
    if (!this.masterApiKey) {
      throw new AppError(
        'INTELLIGENCE_MASTER_API_KEY is not configured — cannot generate per-org keys',
        503,
        'NotConfigured'
      );
    }
    if (!this.intelligenceBaseUrl) {
      throw new AppError('INTELLIGENCE_API_URL is not configured', 503, 'NotConfigured');
    }

    let plainKey: string;
    try {
      const baseUrl = this.intelligenceBaseUrl.replace(/\/+$/, '');
      const response = await axios.post<{ plain_key: string }>(
        `${baseUrl}/api/v1/admin/tenants/${encodeURIComponent(orgId)}/api-keys`,
        { name: orgId, rate_limit_per_minute: TENANT_KEY_RATE_LIMIT_RPM },
        {
          headers: {
            Authorization: `Bearer ${this.masterApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: KEY_GENERATION_TIMEOUT_MS,
        }
      );
      plainKey = response.data.plain_key;
    } catch (err) {
      let detail: string;
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const raw = (err.response?.data as Record<string, unknown>)?.detail;
        const body =
          raw === undefined ? err.message : typeof raw === 'string' ? raw : JSON.stringify(raw);
        detail = status ? `HTTP ${status}: ${body}` : body;
      } else {
        detail = String(err);
      }
      throw new AppError(
        `Intelligence service key generation failed: ${detail}`,
        502,
        'BadGateway'
      );
    }

    if (typeof plainKey !== 'string' || plainKey.trim().length === 0) {
      throw new AppError('Intelligence service returned invalid key payload', 502, 'BadGateway');
    }

    return this.provisionKey(orgId, plainKey, provisionedBy);
  }

  /**
   * Provision (or replace) an intelligence API key for an organization.
   * The key is encrypted before storage. The plaintext is never stored.
   */
  async provisionKey(
    orgId: string,
    apiKey: string,
    provisionedBy: string
  ): Promise<ProvisionKeyResult> {
    const encryptedKey = this.encryption.encrypt(apiKey);
    const provisionedAt = new Date().toISOString();

    const updated = await this.db.organizations.updateSettings(orgId, {
      intelligence_api_key: encryptedKey,
      intelligence_api_key_provisioned_at: provisionedAt,
      intelligence_api_key_provisioned_by: provisionedBy,
    });
    if (!updated) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }

    this.clientFactory.invalidateOrg(orgId);

    logger.info('Intelligence API key provisioned', {
      orgId,
      provisionedBy,
    });

    return {
      provisioned: true,
      provisioned_at: provisionedAt,
      provisioned_by: provisionedBy,
      key_hint: extractKeyHint(apiKey),
    };
  }

  /**
   * Revoke the intelligence API key for an organization.
   * Also disables intelligence to prevent inconsistent state.
   */
  async revokeKey(orgId: string): Promise<void> {
    // Use null (not undefined) so JSON.stringify includes these keys
    // and the JSONB merge actually clears the stored values.
    const updated = await this.db.organizations.updateSettings(orgId, {
      intelligence_api_key: null,
      intelligence_api_key_provisioned_at: null,
      intelligence_api_key_provisioned_by: null,
      intelligence_enabled: false,
    });
    if (!updated) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }

    this.clientFactory.invalidateOrg(orgId);

    logger.info('Intelligence API key revoked', { orgId });
  }

  /**
   * Get the current key provisioning status for an organization.
   * Never returns the full key — only a hint (last 4 chars).
   *
   * When `preloadedSettings` is provided, skips the DB lookup (avoids duplicate queries
   * when the caller already has the org settings).
   */
  async getKeyStatus(
    orgId: string,
    preloadedSettings?: OrgIntelligenceSettings
  ): Promise<KeyStatus> {
    const notProvisioned: KeyStatus = {
      provisioned: false,
      decryptable: false,
      provisioned_at: null,
      provisioned_by: null,
      key_hint: null,
    };

    let settings: OrgIntelligenceSettings;
    if (preloadedSettings) {
      settings = preloadedSettings;
    } else {
      const org = await this.db.organizations.findById(orgId);
      if (!org) {
        return notProvisioned;
      }
      settings = resolveOrgIntelligenceSettings(org.settings);
    }

    if (!settings.intelligence_api_key) {
      return notProvisioned;
    }

    let keyHint: string | null = null;
    let decryptable = false;
    try {
      const decrypted = this.encryption.decrypt(settings.intelligence_api_key);
      keyHint = extractKeyHint(decrypted);
      decryptable = true;
    } catch {
      // Key is corrupted or master key changed — report as provisioned but not decryptable
      keyHint = '****';
    }

    return {
      provisioned: true,
      decryptable,
      provisioned_at: settings.intelligence_api_key_provisioned_at,
      provisioned_by: settings.intelligence_api_key_provisioned_by,
      key_hint: keyHint,
    };
  }

  /**
   * Update intelligence settings for an organization (not the key itself).
   * Validates that intelligence cannot be enabled without a provisioned key.
   */
  async updateSettings(
    orgId: string,
    updates: IntelligenceSettingsUpdate
  ): Promise<OrgIntelligenceSettings> {
    // If enabling intelligence, verify org exists and key is provisioned and decryptable
    if (updates.intelligence_enabled === true) {
      const org = await this.db.organizations.findById(orgId);
      if (!org) {
        throw new AppError('Organization not found', 404, 'NotFound');
      }
      const keyStatus = await this.getKeyStatus(
        orgId,
        resolveOrgIntelligenceSettings(org.settings)
      );
      if (!keyStatus.provisioned) {
        throw new ValidationError('Cannot enable intelligence without a provisioned API key');
      }
      if (!keyStatus.decryptable) {
        throw new ValidationError(
          'Cannot enable intelligence: stored API key cannot be decrypted (re-provision the key)'
        );
      }
    }

    const updated = await this.db.organizations.updateSettings(orgId, updates);
    if (!updated) {
      throw new AppError('Organization not found', 404, 'NotFound');
    }

    // Invalidate cache if settings that affect client behavior changed
    if (updates.intelligence_enabled !== undefined) {
      this.clientFactory.invalidateOrg(orgId);
    }

    return resolveOrgIntelligenceSettings(updated.settings);
  }
}

/**
 * Extract last 4 characters of a key for display (e.g., "****abcd").
 */
function extractKeyHint(key: string): string {
  if (key.length <= 4) {
    return '****';
  }
  return `****${key.slice(-4)}`;
}
