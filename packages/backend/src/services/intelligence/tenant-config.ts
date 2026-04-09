/**
 * Intelligence Tenant Configuration
 *
 * Resolves per-org intelligence settings from organization JSONB.
 * Provides an LRU-cached client factory that creates per-org IntelligenceClient
 * instances, each with their own circuit breaker and API key.
 */

import { getLogger } from '../../logger.js';
import type { OrganizationSettings } from '../../db/types.js';
import type { DatabaseClient } from '../../db/client.js';
import type { IntelligenceConfig } from '../../config/intelligence.config.js';
import type { CredentialEncryption } from '../../utils/encryption.js';
import { IntelligenceClient } from './intelligence-client.js';

const logger = getLogger();

// ============================================================================
// Per-Org Intelligence Settings
// ============================================================================

export interface OrgIntelligenceSettings {
  intelligence_enabled: boolean;
  intelligence_api_key: string | null;
  intelligence_provider: string | null;
  intelligence_auto_analyze: boolean;
  intelligence_similarity_threshold: number;
  intelligence_dedup_enabled: boolean;
  intelligence_dedup_action: 'flag' | 'auto_close';
  intelligence_self_service_enabled: boolean;
  intelligence_api_key_provisioned_at: string | null;
  intelligence_api_key_provisioned_by: string | null;
  intelligence_auto_enrich: boolean;
}

export const INTELLIGENCE_SETTINGS_DEFAULTS: OrgIntelligenceSettings = {
  intelligence_enabled: false,
  intelligence_api_key: null,
  intelligence_provider: null,
  intelligence_auto_analyze: true,
  intelligence_similarity_threshold: 0.75,
  intelligence_dedup_enabled: true,
  intelligence_dedup_action: 'flag',
  intelligence_self_service_enabled: true,
  intelligence_api_key_provisioned_at: null,
  intelligence_api_key_provisioned_by: null,
  intelligence_auto_enrich: true,
};

/**
 * Resolve intelligence settings from org JSONB, filling in defaults for missing keys.
 */
export function resolveOrgIntelligenceSettings(
  settings: OrganizationSettings | undefined | null
): OrgIntelligenceSettings {
  if (!settings) {
    return { ...INTELLIGENCE_SETTINGS_DEFAULTS };
  }
  return {
    intelligence_enabled:
      settings.intelligence_enabled ?? INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_enabled,
    intelligence_api_key:
      settings.intelligence_api_key ?? INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_api_key,
    intelligence_provider:
      settings.intelligence_provider ?? INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_provider,
    intelligence_auto_analyze:
      settings.intelligence_auto_analyze ??
      INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_auto_analyze,
    intelligence_similarity_threshold:
      settings.intelligence_similarity_threshold ??
      INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_similarity_threshold,
    intelligence_dedup_enabled:
      settings.intelligence_dedup_enabled ??
      INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_dedup_enabled,
    intelligence_dedup_action:
      settings.intelligence_dedup_action ??
      INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_dedup_action,
    intelligence_self_service_enabled:
      settings.intelligence_self_service_enabled ??
      INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_self_service_enabled,
    intelligence_api_key_provisioned_at:
      settings.intelligence_api_key_provisioned_at ??
      INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_api_key_provisioned_at,
    intelligence_api_key_provisioned_by:
      settings.intelligence_api_key_provisioned_by ??
      INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_api_key_provisioned_by,
    intelligence_auto_enrich:
      settings.intelligence_auto_enrich ?? INTELLIGENCE_SETTINGS_DEFAULTS.intelligence_auto_enrich,
  };
}

/**
 * Load intelligence settings for an organization from the database.
 */
export async function getOrgIntelligenceSettings(
  db: DatabaseClient,
  orgId: string
): Promise<OrgIntelligenceSettings> {
  const org = await db.organizations.findById(orgId);
  if (!org) {
    return { ...INTELLIGENCE_SETTINGS_DEFAULTS };
  }
  return resolveOrgIntelligenceSettings(org.settings);
}

// ============================================================================
// Per-Org Client Factory with LRU Cache
// ============================================================================

interface CachedClient {
  client: IntelligenceClient;
  createdAt: number;
}

export interface IntelligenceClientFactoryOptions {
  /** Maximum number of cached clients (default: 100) */
  maxSize?: number;
  /** Cache TTL in milliseconds (default: 300000 = 5 minutes) */
  ttlMs?: number;
}

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class IntelligenceClientFactory {
  private readonly cache = new Map<string, CachedClient>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly globalClient: IntelligenceClient | null;

  constructor(
    private readonly db: DatabaseClient,
    private readonly globalConfig: IntelligenceConfig,
    private readonly encryption: CredentialEncryption,
    options?: IntelligenceClientFactoryOptions
  ) {
    this.maxSize = Math.max(1, options?.maxSize ?? DEFAULT_MAX_SIZE);
    this.ttlMs = Math.max(0, options?.ttlMs ?? DEFAULT_TTL_MS);

    // Create global client from env var config (used as fallback for self-hosted mode)
    this.globalClient =
      globalConfig.enabled && globalConfig.client.apiKey
        ? new IntelligenceClient(globalConfig.client)
        : null;
  }

  /**
   * Get an IntelligenceClient configured for a specific organization.
   * Returns null if the org doesn't have intelligence enabled or no API key provisioned.
   */
  async getClientForOrg(orgId: string): Promise<IntelligenceClient | null> {
    // Check cache first
    const cached = this.cache.get(orgId);
    if (cached && Date.now() - cached.createdAt < this.ttlMs) {
      // Re-insert to mark as recently used (Map preserves insertion order for LRU)
      this.cache.delete(orgId);
      this.cache.set(orgId, cached);
      return cached.client;
    }

    // Load org settings from DB
    const settings = await getOrgIntelligenceSettings(this.db, orgId);

    if (!settings.intelligence_enabled || !settings.intelligence_api_key) {
      // Org doesn't have intelligence configured — remove stale cache entry
      this.cache.delete(orgId);
      return null;
    }

    // Decrypt the API key
    let apiKey: string;
    try {
      apiKey = this.encryption.decrypt(settings.intelligence_api_key);
    } catch (error) {
      logger.debug('Failed to decrypt intelligence API key for organization', {
        orgId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.cache.delete(orgId);
      return null;
    }

    // Build client config: global infra settings + org-specific API key
    const client = new IntelligenceClient({
      baseUrl: this.globalConfig.client.baseUrl,
      apiKey,
      timeout: this.globalConfig.client.timeout,
      maxRetries: this.globalConfig.client.maxRetries,
      backoffDelay: this.globalConfig.client.backoffDelay,
      circuitBreaker: this.globalConfig.client.circuitBreaker,
    });

    // Remove stale entry for this orgId (if refreshing after TTL expiry)
    // before the size check to avoid unnecessary eviction of another entry.
    this.cache.delete(orgId);

    // Evict oldest entry if cache is full (only when inserting a new key)
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(orgId, { client, createdAt: Date.now() });

    logger.debug('Intelligence client created for organization', { orgId });

    return client;
  }

  /**
   * Get the global IntelligenceClient (for self-hosted mode or health checks).
   */
  getGlobalClient(): IntelligenceClient | null {
    return this.globalClient;
  }

  /**
   * Invalidate cached client for an organization (after key provisioning/revocation).
   */
  invalidateOrg(orgId: string): void {
    this.cache.delete(orgId);
    logger.debug('Intelligence client cache invalidated', { orgId });
  }
}
