/**
 * SettingsService Tests
 * Comprehensive unit tests for settings management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsService, WRITABLE_SETTINGS } from '../../../src/api/services/settings-service.js';
import type { DatabaseClient } from '../../../src/db/client.js';

// Mock getCacheService before importing SettingsService
const mockCache = {
  invalidateSystemConfig: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../../src/cache/index.js', () => ({
  getCacheService: () => mockCache,
}));

describe('SettingsService', () => {
  let service: SettingsService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      systemConfig: {
        get: vi.fn(),
        set: vi.fn(),
      },
    };

    service = new SettingsService(mockDb as unknown as DatabaseClient);

    // Reset mock call counts
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getInstanceSettings', () => {
    it('should return settings from database', async () => {
      const mockSettings = {
        instance_name: 'My BugSpotter',
        retention_days: 60,
      };

      mockDb.systemConfig.get.mockResolvedValue({
        value: mockSettings,
      });

      const settings = await service.getInstanceSettings();

      expect(settings).toEqual(mockSettings);
      expect(mockDb.systemConfig.get).toHaveBeenCalledWith('instance_settings');
    });

    it('should return empty object when no settings found', async () => {
      mockDb.systemConfig.get.mockResolvedValue(null);

      const settings = await service.getInstanceSettings();

      expect(settings).toEqual({});
    });

    it('should return empty object on database error', async () => {
      mockDb.systemConfig.get.mockRejectedValue(new Error('Database error'));

      const settings = await service.getInstanceSettings();

      expect(settings).toEqual({});
    });
  });

  describe('updateInstanceSettings', () => {
    beforeEach(() => {
      mockDb.systemConfig.get.mockResolvedValue({
        value: { instance_name: 'BugSpotter' },
      });
    });

    it('should update writable settings', async () => {
      const updates = {
        instance_name: 'New Name',
        retention_days: 120,
      };

      await service.updateInstanceSettings(updates, 'user-123');

      expect(mockDb.systemConfig.set).toHaveBeenCalledWith(
        'instance_settings',
        { instance_name: 'New Name', retention_days: 120 },
        'Instance-wide configuration settings (admin panel)',
        'user-123'
      );
      expect(mockCache.invalidateSystemConfig).toHaveBeenCalledWith('instance_settings');
    });

    it('should filter out non-writable settings', async () => {
      const updates = {
        instance_name: 'New Name',
        storage_bucket: 'hacker-bucket', // Not writable
        jwt_access_expiry: 9999, // Not writable
      };

      await service.updateInstanceSettings(updates as any, 'user-123');

      expect(mockDb.systemConfig.set).toHaveBeenCalledWith(
        'instance_settings',
        { instance_name: 'New Name' }, // Only writable field
        expect.any(String),
        'user-123'
      );
    });

    it('should merge with existing settings', async () => {
      mockDb.systemConfig.get.mockResolvedValue({
        value: {
          instance_name: 'Old Name',
          retention_days: 90,
          support_email: 'old@example.com',
        },
      });

      await service.updateInstanceSettings(
        { instance_name: 'New Name', retention_days: 120 },
        'user-123'
      );

      expect(mockDb.systemConfig.set).toHaveBeenCalledWith(
        'instance_settings',
        {
          instance_name: 'New Name',
          retention_days: 120,
          support_email: 'old@example.com', // Preserved
        },
        expect.any(String),
        'user-123'
      );
    });

    it('should do nothing when no writable settings provided', async () => {
      await service.updateInstanceSettings({ storage_bucket: 'test' } as any, 'user-123');

      expect(mockDb.systemConfig.set).not.toHaveBeenCalled();
      expect(mockCache.invalidateSystemConfig).not.toHaveBeenCalled();
    });

    it('should do nothing when empty updates provided', async () => {
      await service.updateInstanceSettings({}, 'user-123');

      expect(mockDb.systemConfig.set).not.toHaveBeenCalled();
    });

    it('should handle all writable settings', async () => {
      const allWritableUpdates = {
        instance_name: 'Test',
        instance_url: 'https://test.com',
        support_email: 'support@test.com',
        retention_days: 60,
        max_reports_per_project: 5000,
        session_replay_enabled: false,
        replay_duration: 30,
        replay_inline_stylesheets: false,
        replay_inline_images: true,
        replay_collect_fonts: false,
        replay_record_canvas: true,
        replay_record_cross_origin_iframes: true,
        replay_sampling_mousemove: 100,
        replay_sampling_scroll: 200,
      };

      await service.updateInstanceSettings(allWritableUpdates, 'user-123');

      expect(mockDb.systemConfig.set).toHaveBeenCalledWith(
        'instance_settings',
        allWritableUpdates,
        expect.any(String),
        'user-123'
      );
    });
  });

  describe('buildInstanceSettings', () => {
    it('should build complete settings from database settings', () => {
      const dbSettings = {
        instance_name: 'My Instance',
        retention_days: 60,
        session_replay_enabled: false,
      };

      const settings = service.buildInstanceSettings(dbSettings);

      expect(settings.instance_name).toBe('My Instance');
      expect(settings.retention_days).toBe(60);
      expect(settings.session_replay_enabled).toBe(false);
      expect(settings.storage_type).toBeDefined();
      expect(settings.jwt_access_expiry).toBeGreaterThan(0);
    });

    it('should use environment variables for missing database settings', () => {
      process.env.INSTANCE_NAME = 'Env Instance';
      process.env.INSTANCE_URL = 'https://env.example.com';
      process.env.SUPPORT_EMAIL = 'env@example.com';

      const settings = service.buildInstanceSettings({});

      expect(settings.instance_name).toBe('Env Instance');
      expect(settings.instance_url).toBe('https://env.example.com');
      expect(settings.support_email).toBe('env@example.com');

      delete process.env.INSTANCE_NAME;
      delete process.env.INSTANCE_URL;
      delete process.env.SUPPORT_EMAIL;
    });

    it('should use defaults when no database or env settings', () => {
      const settings = service.buildInstanceSettings({});

      expect(settings.instance_name).toBe('BugSpotter');
      expect(settings.instance_url).toBe('http://localhost:3000');
      expect(settings.support_email).toBe('support@bugspotter.dev');
      expect(settings.retention_days).toBe(90);
      expect(settings.max_reports_per_project).toBe(10000);
      expect(settings.session_replay_enabled).toBe(true);
      expect(settings.replay_duration).toBe(15);
    });

    it('should read storage config from config module', () => {
      const settings = service.buildInstanceSettings({});

      expect(settings.storage_type).toMatch(/^(s3|minio)$/);
      expect(settings.storage_bucket).toBeDefined();
    });

    it('should read JWT expiry from config', () => {
      const settings = service.buildInstanceSettings({});

      expect(settings.jwt_access_expiry).toBeGreaterThan(0);
      expect(settings.jwt_refresh_expiry).toBeGreaterThan(0);
      expect(settings.jwt_refresh_expiry).toBeGreaterThan(settings.jwt_access_expiry);
    });

    it('should read rate limiting from config', () => {
      const settings = service.buildInstanceSettings({});

      expect(settings.rate_limit_max).toBeGreaterThan(0);
      expect(settings.rate_limit_window).toBeGreaterThan(0);
    });

    it('should read CORS origins from config', () => {
      const settings = service.buildInstanceSettings({});

      expect(Array.isArray(settings.cors_origins)).toBe(true);
    });

    it('should handle boolean replay settings from database', () => {
      const dbSettings = {
        replay_inline_stylesheets: false,
        replay_inline_images: true,
        replay_collect_fonts: false,
        replay_record_canvas: true,
        replay_record_cross_origin_iframes: true,
      };

      const settings = service.buildInstanceSettings(dbSettings);

      expect(settings.replay_inline_stylesheets).toBe(false);
      expect(settings.replay_inline_images).toBe(true);
      expect(settings.replay_collect_fonts).toBe(false);
      expect(settings.replay_record_canvas).toBe(true);
      expect(settings.replay_record_cross_origin_iframes).toBe(true);
    });

    it('should handle numeric replay settings from database', () => {
      const dbSettings = {
        replay_duration: 30,
        replay_sampling_mousemove: 100,
        replay_sampling_scroll: 200,
      };

      const settings = service.buildInstanceSettings(dbSettings);

      expect(settings.replay_duration).toBe(30);
      expect(settings.replay_sampling_mousemove).toBe(100);
      expect(settings.replay_sampling_scroll).toBe(200);
    });
  });

  describe('getCompleteSettings', () => {
    it('should fetch and build complete settings', async () => {
      const dbSettings = {
        instance_name: 'Test Instance',
        retention_days: 45,
      };

      mockDb.systemConfig.get.mockResolvedValue({
        value: dbSettings,
      });

      const settings = await service.getCompleteSettings();

      expect(settings.instance_name).toBe('Test Instance');
      expect(settings.retention_days).toBe(45);
      expect(settings.storage_type).toBeDefined();
      expect(mockDb.systemConfig.get).toHaveBeenCalledWith('instance_settings');
    });

    it('should build with defaults when database is empty', async () => {
      mockDb.systemConfig.get.mockResolvedValue(null);

      const settings = await service.getCompleteSettings();

      expect(settings.instance_name).toBe('BugSpotter');
      expect(settings.retention_days).toBe(90);
    });
  });

  describe('WRITABLE_SETTINGS constant', () => {
    it('should include all expected writable settings', () => {
      const expectedSettings = [
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
      ];

      expectedSettings.forEach((setting) => {
        expect(WRITABLE_SETTINGS.has(setting)).toBe(true);
      });
    });

    it('should have exactly 14 writable settings', () => {
      expect(WRITABLE_SETTINGS.size).toBe(14);
    });

    it('should not include read-only settings', () => {
      const readOnlySettings = [
        'storage_type',
        'storage_endpoint',
        'storage_bucket',
        'storage_region',
        'jwt_access_expiry',
        'jwt_refresh_expiry',
        'rate_limit_max',
        'rate_limit_window',
        'cors_origins',
      ];

      readOnlySettings.forEach((setting) => {
        expect(WRITABLE_SETTINGS.has(setting)).toBe(false);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined values in database settings', () => {
      const dbSettings = {
        instance_name: undefined,
        retention_days: undefined,
      };

      const settings = service.buildInstanceSettings(dbSettings);

      expect(settings.instance_name).toBe('BugSpotter'); // Falls back to default
      expect(settings.retention_days).toBe(90); // Falls back to default
    });

    it('should handle null values in database settings', () => {
      const dbSettings = {
        instance_name: null,
        retention_days: null,
      };

      const settings = service.buildInstanceSettings(dbSettings as any);

      expect(settings.instance_name).toBe('BugSpotter');
      expect(settings.retention_days).toBe(90);
    });

    it('should handle non-string values for string settings', () => {
      const dbSettings = {
        instance_name: 12345,
        instance_url: true,
      };

      const settings = service.buildInstanceSettings(dbSettings as any);

      expect(typeof settings.instance_name).toBe('string');
      expect(typeof settings.instance_url).toBe('string');
    });

    it('should preserve type safety for numeric settings', () => {
      const dbSettings = {
        retention_days: '60', // String instead of number
      };

      const settings = service.buildInstanceSettings(dbSettings as any);

      expect(typeof settings.retention_days).toBe('number');
      // getNumberSettingWithEnv only accepts actual numbers from DB, strings fall back to default (90)
      expect(settings.retention_days).toBe(90);
    });

    it('should preserve type safety for boolean settings', () => {
      const dbSettings = {
        session_replay_enabled: 'false', // String instead of boolean
      };

      const settings = service.buildInstanceSettings(dbSettings as any);

      expect(typeof settings.session_replay_enabled).toBe('boolean');
      // getBooleanSettingWithEnv returns default (true) when value is not boolean type
      expect(settings.session_replay_enabled).toBe(true); // Falls back to default
    });
  });
});
