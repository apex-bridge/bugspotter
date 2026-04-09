import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getBooleanSetting,
  getBooleanSettingWithEnv,
} from '../../../src/api/utils/settings-helpers.js';

describe('Settings Helpers', () => {
  describe('getBooleanSetting', () => {
    it('should return boolean value from settings when present', () => {
      const settings = { enabled: true };
      expect(getBooleanSetting(settings, 'enabled', false)).toBe(true);
    });

    it('should return boolean false from settings when present', () => {
      const settings = { enabled: false };
      expect(getBooleanSetting(settings, 'enabled', true)).toBe(false);
    });

    it('should return default value when key not found', () => {
      const settings = {};
      expect(getBooleanSetting(settings, 'missing', true)).toBe(true);
      expect(getBooleanSetting(settings, 'missing', false)).toBe(false);
    });

    it('should return default value when value is not boolean', () => {
      const settings = { key: 'string' };
      expect(getBooleanSetting(settings, 'key', true)).toBe(true);
    });

    it('should return default value when value is null', () => {
      const settings = { key: null };
      expect(getBooleanSetting(settings, 'key', false)).toBe(false);
    });

    it('should return default value when value is undefined', () => {
      const settings = { key: undefined };
      expect(getBooleanSetting(settings, 'key', true)).toBe(true);
    });

    it('should return default value when value is number', () => {
      const settings = { key: 1 };
      expect(getBooleanSetting(settings, 'key', false)).toBe(false);
    });
  });

  describe('getBooleanSettingWithEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Create a fresh copy of process.env for each test
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      // Restore original process.env
      process.env = originalEnv;
    });

    describe('Priority 1: Database setting', () => {
      it('should return database value when boolean true', () => {
        const settings = { feature: true };
        process.env.FEATURE_ENABLED = 'false';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });

      it('should return database value when boolean false', () => {
        const settings = { feature: false };
        process.env.FEATURE_ENABLED = 'true';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should prioritize database over environment variable', () => {
        const settings = { feature: true };
        process.env.FEATURE_ENABLED = 'false';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });

      it('should prioritize database over default value', () => {
        const settings = { feature: false };
        expect(getBooleanSettingWithEnv(settings, 'feature', null, true)).toBe(false);
      });
    });

    describe('Priority 2: Environment variable', () => {
      it('should return true when env var is "true"', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'true';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });

      it('should return true when env var is "TRUE" (case-insensitive)', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'TRUE';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });

      it('should return true when env var is "True" (mixed case)', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'True';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });

      it('should return false when env var is "false"', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'false';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should return false when env var is empty string', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = '';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should return false when env var is "0"', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = '0';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should return false when env var is "disabled"', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'disabled';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should return false when env var is any non-"true" value', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'yes';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should allow disabling feature via env var when default is true', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'false';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should allow enabling feature via env var when default is false', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = 'true';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });
    });

    describe('Priority 3: Default value', () => {
      it('should return default value when envKey is null', () => {
        const settings = {};
        process.env.SOME_VAR = 'true';
        expect(getBooleanSettingWithEnv(settings, 'feature', null, true)).toBe(true);
        expect(getBooleanSettingWithEnv(settings, 'feature', null, false)).toBe(false);
      });

      it('should return default value when env var is not set', () => {
        const settings = {};
        delete process.env.FEATURE_ENABLED;
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(true);
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(false);
      });

      it('should return default value when env var is undefined', () => {
        const settings = {};
        process.env.FEATURE_ENABLED = undefined;
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(true);
      });
    });

    describe('Edge cases', () => {
      it('should handle non-boolean database values', () => {
        const settings = { feature: 'true' };
        process.env.FEATURE_ENABLED = 'false';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should handle null database values', () => {
        const settings = { feature: null };
        process.env.FEATURE_ENABLED = 'true';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });

      it('should handle undefined database values', () => {
        const settings = { feature: undefined };
        process.env.FEATURE_ENABLED = 'true';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', false)).toBe(true);
      });

      it('should handle numeric database values', () => {
        const settings = { feature: 1 };
        process.env.FEATURE_ENABLED = 'false';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });

      it('should distinguish between env var not set vs set to empty', () => {
        const settings = {};

        // Not set - should use default
        delete process.env.FEATURE_ENABLED;
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(true);

        // Set to empty - should return false
        process.env.FEATURE_ENABLED = '';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE_ENABLED', true)).toBe(false);
      });
    });

    describe('Real-world scenarios', () => {
      it('should handle session_replay_enabled with env var', () => {
        const settings = {};
        process.env.SESSION_REPLAY_ENABLED = 'true';
        expect(
          getBooleanSettingWithEnv(
            settings,
            'session_replay_enabled',
            'SESSION_REPLAY_ENABLED',
            true
          )
        ).toBe(true);
      });

      it('should handle replay_inline_stylesheets without env var', () => {
        const settings = {};
        expect(getBooleanSettingWithEnv(settings, 'replay_inline_stylesheets', null, true)).toBe(
          true
        );
      });

      it('should handle database override of default', () => {
        const settings = { replay_inline_images: true };
        expect(getBooleanSettingWithEnv(settings, 'replay_inline_images', null, false)).toBe(true);
      });

      it('should handle all three priorities in correct order', () => {
        // Scenario 1: Database wins
        let settings: Record<string, unknown> = { feature: false };
        process.env.FEATURE = 'true';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE', true)).toBe(false);

        // Scenario 2: Env var wins over default
        settings = {};
        process.env.FEATURE = 'false';
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE', true)).toBe(false);

        // Scenario 3: Default used when nothing else available
        settings = {};
        delete process.env.FEATURE;
        expect(getBooleanSettingWithEnv(settings, 'feature', 'FEATURE', true)).toBe(true);
      });
    });
  });
});
