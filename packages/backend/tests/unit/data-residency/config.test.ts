/**
 * Data Residency Configuration Tests
 *
 * Tests for regional storage configuration:
 * - Storage region validation
 * - Region availability checks
 * - Default region resolution
 * - Country code mapping
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_STORAGE_REGIONS,
  DEFAULT_STORAGE_REGION,
  DATA_RESIDENCY_PRESETS,
  getDataResidencyRegionFromCountry,
} from '../../../src/data-residency/index.js';

describe('Data Residency Configuration', () => {
  describe('ALLOWED_STORAGE_REGIONS validation', () => {
    it('should allow KZ storage regions for KZ policy', () => {
      const allowed = ALLOWED_STORAGE_REGIONS.kz;
      expect(allowed).toContain('kz-almaty');
      expect(allowed).toContain('kz-astana');
    });

    it('should not allow non-KZ storage regions for KZ policy', () => {
      const allowed = ALLOWED_STORAGE_REGIONS.kz;
      expect(allowed).not.toContain('us-east-1');
      expect(allowed).not.toContain('eu-central-1');
    });

    it('should allow RF storage regions for RF policy', () => {
      const allowed = ALLOWED_STORAGE_REGIONS.rf;
      expect(allowed).toContain('rf-moscow');
      expect(allowed).toContain('rf-spb');
    });

    it('should not allow non-RF storage regions for RF policy', () => {
      const allowed = ALLOWED_STORAGE_REGIONS.rf;
      expect(allowed).not.toContain('eu-central-1');
      expect(allowed).not.toContain('us-east-1');
    });

    it('should allow EU storage regions for EU policy', () => {
      const allowed = ALLOWED_STORAGE_REGIONS.eu;
      expect(allowed).toContain('eu-west-1');
      expect(allowed).toContain('eu-central-1');
      expect(allowed).toContain('eu-north-1');
    });

    it('should not allow US regions for EU policy', () => {
      const allowed = ALLOWED_STORAGE_REGIONS.eu;
      expect(allowed).not.toContain('us-east-1');
      expect(allowed).not.toContain('us-west-2');
    });

    it('should allow any region for global policy', () => {
      const allowed = ALLOWED_STORAGE_REGIONS.global;
      expect(allowed).toContain('auto');
      expect(allowed).toContain('kz-almaty');
      expect(allowed).toContain('rf-moscow');
      expect(allowed).toContain('eu-central-1');
      expect(allowed).toContain('us-east-1');
    });
  });

  describe('DEFAULT_STORAGE_REGION', () => {
    it('should return kz-almaty for Kazakhstan', () => {
      expect(DEFAULT_STORAGE_REGION.kz).toBe('kz-almaty');
    });

    it('should return rf-moscow for Russia', () => {
      expect(DEFAULT_STORAGE_REGION.rf).toBe('rf-moscow');
    });

    it('should return eu-central-1 for EU', () => {
      expect(DEFAULT_STORAGE_REGION.eu).toBe('eu-central-1');
    });

    it('should return us-east-1 for US', () => {
      expect(DEFAULT_STORAGE_REGION.us).toBe('us-east-1');
    });

    it('should return auto for global', () => {
      expect(DEFAULT_STORAGE_REGION.global).toBe('auto');
    });
  });

  describe('getDataResidencyRegionFromCountry', () => {
    it('should return kz for Kazakhstan', () => {
      expect(getDataResidencyRegionFromCountry('KZ')).toBe('kz');
      expect(getDataResidencyRegionFromCountry('kz')).toBe('kz');
    });

    it('should return rf for Russia', () => {
      expect(getDataResidencyRegionFromCountry('RU')).toBe('rf');
      expect(getDataResidencyRegionFromCountry('ru')).toBe('rf');
    });

    it('should return eu for EU member states', () => {
      const euCountries = ['DE', 'FR', 'IT', 'ES', 'PL', 'NL', 'BE', 'AT', 'SE', 'FI'];
      for (const country of euCountries) {
        expect(getDataResidencyRegionFromCountry(country)).toBe('eu');
      }
    });

    it('should return us for United States', () => {
      expect(getDataResidencyRegionFromCountry('US')).toBe('us');
    });

    it('should return global for other countries', () => {
      expect(getDataResidencyRegionFromCountry('AU')).toBe('global');
      expect(getDataResidencyRegionFromCountry('JP')).toBe('global');
      expect(getDataResidencyRegionFromCountry('BR')).toBe('global');
    });
  });

  describe('DATA_RESIDENCY_PRESETS', () => {
    it('should have strict settings for Kazakhstan', () => {
      const kz = DATA_RESIDENCY_PRESETS.kz;
      expect(kz.region).toBe('kz');
      expect(kz.allowCrossRegionBackup).toBe(false);
      expect(kz.allowCrossRegionProcessing).toBe(false);
      expect(kz.encryptionRequired).toBe(true);
      expect(kz.auditDataAccess).toBe(true);
    });

    it('should have strict settings for Russia', () => {
      const rf = DATA_RESIDENCY_PRESETS.rf;
      expect(rf.region).toBe('rf');
      expect(rf.allowCrossRegionBackup).toBe(false);
      expect(rf.allowCrossRegionProcessing).toBe(false);
      expect(rf.encryptionRequired).toBe(true);
    });

    it('should have GDPR-compliant settings for EU', () => {
      const eu = DATA_RESIDENCY_PRESETS.eu;
      expect(eu.region).toBe('eu');
      expect(eu.allowCrossRegionBackup).toBe(true); // Within EU
      expect(eu.allowCrossRegionProcessing).toBe(false); // No processing outside EU
      expect(eu.encryptionRequired).toBe(true);
    });

    it('should have relaxed settings for global', () => {
      const global = DATA_RESIDENCY_PRESETS.global;
      expect(global.region).toBe('global');
      expect(global.allowCrossRegionBackup).toBe(true);
      expect(global.allowCrossRegionProcessing).toBe(true);
      expect(global.encryptionRequired).toBe(false);
    });
  });

  describe('ALLOWED_STORAGE_REGIONS', () => {
    it('should not overlap strictly regulated regions', () => {
      const kzRegions = new Set(ALLOWED_STORAGE_REGIONS.kz);
      const rfRegions = new Set(ALLOWED_STORAGE_REGIONS.rf);
      const euRegions = new Set(ALLOWED_STORAGE_REGIONS.eu);
      const usRegions = new Set(ALLOWED_STORAGE_REGIONS.us);

      // KZ and RF should not overlap
      for (const region of kzRegions) {
        expect(rfRegions.has(region)).toBe(false);
      }

      // EU and US should not overlap (except for 'auto' in global)
      for (const region of euRegions) {
        expect(usRegions.has(region)).toBe(false);
      }
    });

    it('should include all defined regions in global', () => {
      const globalRegions = new Set(ALLOWED_STORAGE_REGIONS.global);
      const allRegions = [
        ...ALLOWED_STORAGE_REGIONS.kz,
        ...ALLOWED_STORAGE_REGIONS.rf,
        ...ALLOWED_STORAGE_REGIONS.eu,
        ...ALLOWED_STORAGE_REGIONS.us,
      ];

      for (const region of allRegions) {
        expect(globalRegions.has(region)).toBe(true);
      }
    });
  });
});
