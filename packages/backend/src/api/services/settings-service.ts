/**
 * Settings Service
 * Centralized instance settings management
 */

import type { DatabaseClient } from '../../db/client.js';
import { config } from '../../config.js';
import { parseTimeString } from '../utils/constants.js';
import { getBooleanSettingWithEnv, getNumberSettingWithEnv } from '../utils/settings-helpers.js';
import { getCacheService } from '../../cache/index.js';

/**
 * Writable settings keys that can be stored in database
 */
export const WRITABLE_SETTINGS = new Set([
  'instance_name',
  'instance_url',
  'support_email',
  'retention_days',
  'max_reports_per_project',
  'session_replay_enabled',
  'replay_duration',
  'replay_inline_stylesheets',
  'replay_inline_images',
  'replay_collect_fonts',
  'replay_record_canvas',
  'replay_record_cross_origin_iframes',
  'replay_sampling_mousemove',
  'replay_sampling_scroll',
]);

export interface InstanceSettings {
  instance_name: string;
  instance_url: string;
  support_email: string;
  storage_type: 'minio' | 's3';
  storage_endpoint?: string;
  storage_bucket: string;
  storage_region?: string;
  jwt_access_expiry: number;
  jwt_refresh_expiry: number;
  rate_limit_max: number;
  rate_limit_window: number;
  cors_origins: string[];
  retention_days: number;
  max_reports_per_project: number;
  session_replay_enabled: boolean;
  replay_duration: number;
  replay_inline_stylesheets: boolean;
  replay_inline_images: boolean;
  replay_collect_fonts: boolean;
  replay_record_canvas: boolean;
  replay_record_cross_origin_iframes: boolean;
  replay_sampling_mousemove: number;
  replay_sampling_scroll: number;
}

export class SettingsService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Get instance settings from database
   */
  async getInstanceSettings(): Promise<Record<string, unknown>> {
    try {
      const configRecord = await this.db.systemConfig.get('instance_settings');
      return configRecord?.value || {};
    } catch {
      return {};
    }
  }

  /**
   * Update instance settings in database
   */
  async updateInstanceSettings(updates: Partial<InstanceSettings>, userId: string): Promise<void> {
    // Filter to only writable settings
    const filteredUpdates = Object.entries(updates).reduce(
      (acc, [key, value]) => {
        if (WRITABLE_SETTINGS.has(key)) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>
    );

    if (Object.keys(filteredUpdates).length === 0) {
      return;
    }

    // Get current settings
    const currentSettings = await this.getInstanceSettings();

    // Merge with updates
    const newSettings = { ...currentSettings, ...filteredUpdates };

    // Update in database using repository
    await this.db.systemConfig.set(
      'instance_settings',
      newSettings,
      'Instance-wide configuration settings (admin panel)',
      userId
    );

    // Invalidate system config cache
    const cache = getCacheService();
    await cache.invalidateSystemConfig('instance_settings');
  }

  /**
   * Type-safe helper to get string setting
   */
  private getStringSetting(
    settings: Record<string, unknown>,
    key: string,
    envKey: string,
    defaultValue: string
  ): string {
    const value = settings[key];
    if (typeof value === 'string') {
      return value;
    }
    return process.env[envKey] || defaultValue;
  }

  /**
   * Build complete InstanceSettings object from database settings
   * Combines writable settings from database with read-only settings from config
   */
  buildInstanceSettings(dbSettings: Record<string, unknown>): InstanceSettings {
    return {
      instance_name: this.getStringSetting(
        dbSettings,
        'instance_name',
        'INSTANCE_NAME',
        'BugSpotter'
      ),
      instance_url: this.getStringSetting(
        dbSettings,
        'instance_url',
        'INSTANCE_URL',
        'http://localhost:3000'
      ),
      support_email: this.getStringSetting(
        dbSettings,
        'support_email',
        'SUPPORT_EMAIL',
        'support@bugspotter.dev'
      ),
      storage_type: config.storage.backend === 's3' ? 's3' : 'minio',
      storage_endpoint: config.storage.s3.endpoint,
      storage_bucket: config.storage.s3.bucket || 'bugspotter',
      storage_region: config.storage.s3.region,
      jwt_access_expiry: parseTimeString(config.jwt.expiresIn),
      jwt_refresh_expiry: parseTimeString(config.jwt.refreshExpiresIn),
      rate_limit_max: config.rateLimit.maxRequests,
      rate_limit_window: Math.floor(config.rateLimit.windowMs / 1000),
      cors_origins: config.server.corsOrigins,
      retention_days: getNumberSettingWithEnv(dbSettings, 'retention_days', 'RETENTION_DAYS', 90),
      max_reports_per_project: getNumberSettingWithEnv(
        dbSettings,
        'max_reports_per_project',
        'MAX_REPORTS_PER_PROJECT',
        10000
      ),
      session_replay_enabled: getBooleanSettingWithEnv(
        dbSettings,
        'session_replay_enabled',
        'SESSION_REPLAY_ENABLED',
        true
      ),
      replay_duration: getNumberSettingWithEnv(
        dbSettings,
        'replay_duration',
        'REPLAY_DURATION',
        15
      ),
      replay_inline_stylesheets: getBooleanSettingWithEnv(
        dbSettings,
        'replay_inline_stylesheets',
        null,
        true
      ),
      replay_inline_images: getBooleanSettingWithEnv(
        dbSettings,
        'replay_inline_images',
        null,
        false
      ),
      replay_collect_fonts: getBooleanSettingWithEnv(
        dbSettings,
        'replay_collect_fonts',
        null,
        true
      ),
      replay_record_canvas: getBooleanSettingWithEnv(
        dbSettings,
        'replay_record_canvas',
        null,
        false
      ),
      replay_record_cross_origin_iframes: getBooleanSettingWithEnv(
        dbSettings,
        'replay_record_cross_origin_iframes',
        null,
        false
      ),
      replay_sampling_mousemove: getNumberSettingWithEnv(
        dbSettings,
        'replay_sampling_mousemove',
        null,
        50
      ),
      replay_sampling_scroll: getNumberSettingWithEnv(
        dbSettings,
        'replay_sampling_scroll',
        null,
        100
      ),
    };
  }

  /**
   * Get complete instance settings (combined from DB and config)
   */
  async getCompleteSettings(): Promise<InstanceSettings> {
    const dbSettings = await this.getInstanceSettings();
    return this.buildInstanceSettings(dbSettings);
  }
}
