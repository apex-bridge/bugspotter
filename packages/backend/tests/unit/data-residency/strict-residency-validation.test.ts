import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateStrictResidencyStorage,
  initializeDataResidency,
} from '../../../src/data-residency/config.js';

describe('Strict Residency Storage Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment to clean state
    process.env = { ...originalEnv };
    // Clear all storage-related env vars
    Object.keys(process.env).forEach((key) => {
      if (key.startsWith('STORAGE_')) {
        delete process.env[key];
      }
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateStrictResidencyStorage', () => {
    it('should pass when all strict residency regions have configured storage', () => {
      // Configure KZ storage
      process.env.STORAGE_KZ_ALMATY_ENDPOINT = 'https://storage.kz-almaty.example.com';
      process.env.STORAGE_KZ_ALMATY_BUCKET = 'test-bucket';

      // Configure RF storage
      process.env.STORAGE_RF_MOSCOW_ENDPOINT = 'https://storage.rf-moscow.example.com';
      process.env.STORAGE_RF_MOSCOW_BUCKET = 'test-bucket';

      // Reinitialize to pick up env vars
      initializeDataResidency();

      const result = validateStrictResidencyStorage();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when KZ region has no storage configured', () => {
      // Only configure RF storage
      process.env.STORAGE_RF_MOSCOW_ENDPOINT = 'https://storage.rf-moscow.example.com';
      process.env.STORAGE_RF_MOSCOW_BUCKET = 'test-bucket';

      initializeDataResidency();

      const result = validateStrictResidencyStorage();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((err) => err.includes('KZ'))).toBe(true);
    });

    it('should fail when RF region has no storage configured', () => {
      // Only configure KZ storage
      process.env.STORAGE_KZ_ALMATY_ENDPOINT = 'https://storage.kz-almaty.example.com';
      process.env.STORAGE_KZ_ALMATY_BUCKET = 'test-bucket';

      initializeDataResidency();

      const result = validateStrictResidencyStorage();

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((err) => err.includes('RF'))).toBe(true);
    });

    it('should warn when some but not all storage regions are configured for KZ', () => {
      // Configure only kz-almaty (not kz-astana)
      process.env.STORAGE_KZ_ALMATY_ENDPOINT = 'https://storage.kz-almaty.example.com';
      process.env.STORAGE_KZ_ALMATY_BUCKET = 'test-bucket';

      // Configure RF storage to make validation pass
      process.env.STORAGE_RF_MOSCOW_ENDPOINT = 'https://storage.rf-moscow.example.com';
      process.env.STORAGE_RF_MOSCOW_BUCKET = 'test-bucket';

      initializeDataResidency();

      const result = validateStrictResidencyStorage();

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(
        result.warnings.some((warn) => warn.includes('KZ') && warn.includes('kz-astana'))
      ).toBe(true);
    });

    it('should include helpful error messages with configuration instructions', () => {
      // No storage configured
      initializeDataResidency();

      const result = validateStrictResidencyStorage();

      expect(result.valid).toBe(false);

      // Check that errors include region names
      const kzError = result.errors.find((err) => err.includes('KZ'));
      expect(kzError).toBeDefined();
      expect(kzError).toContain('Configure one of:');
      expect(kzError).toMatch(/kz-almaty|kz-astana/);

      const rfError = result.errors.find((err) => err.includes('RF'));
      expect(rfError).toBeDefined();
      expect(rfError).toContain('Configure one of:');
      expect(rfError).toMatch(/rf-moscow/);
    });

    it('should pass when at least one storage region is configured for each strict region', () => {
      // Configure one storage region for each strict region
      process.env.STORAGE_KZ_ALMATY_ENDPOINT = 'https://storage.kz-almaty.example.com';
      process.env.STORAGE_KZ_ALMATY_BUCKET = 'test-bucket';

      process.env.STORAGE_RF_MOSCOW_ENDPOINT = 'https://storage.rf-moscow.example.com';
      process.env.STORAGE_RF_MOSCOW_BUCKET = 'test-bucket';

      initializeDataResidency();

      const result = validateStrictResidencyStorage();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
