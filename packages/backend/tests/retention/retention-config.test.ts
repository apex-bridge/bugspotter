/**
 * Unit tests for retention configuration helpers
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RETENTION_DAYS,
  SCREENSHOT_RETENTION_DAYS,
  REPLAY_RETENTION_DAYS,
  ATTACHMENT_RETENTION_DAYS,
  ARCHIVED_RETENTION_DAYS,
  TIER_MAX_RETENTION,
  TIER_MIN_RETENTION,
  COMPLIANCE_MIN_RETENTION,
  TRUE_DELETION_REQUIRED,
  DELETION_CERTIFICATE_REQUIRED,
  DEFAULT_RETENTION_POLICY,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  getComplianceMinRetention,
  requiresTrueDeletion,
  requiresDeletionCertificate,
  getRetentionPolicyForTier,
  validateRetentionDays,
  calculateCutoffDate,
} from '../../src/retention/retention-config.js';
import type { ComplianceRegion } from '../../src/retention/types.js';

describe('Retention Configuration', () => {
  describe('Default Constants', () => {
    it('should have valid default retention periods', () => {
      expect(DEFAULT_RETENTION_DAYS).toBeGreaterThan(0);
      expect(SCREENSHOT_RETENTION_DAYS).toBeGreaterThan(0);
      expect(REPLAY_RETENTION_DAYS).toBeGreaterThan(0);
      expect(ATTACHMENT_RETENTION_DAYS).toBeGreaterThan(0);
      expect(ARCHIVED_RETENTION_DAYS).toBeGreaterThan(0);
    });

    it('should have valid batch size limits', () => {
      expect(DEFAULT_BATCH_SIZE).toBeGreaterThan(0);
      expect(MAX_BATCH_SIZE).toBeGreaterThanOrEqual(DEFAULT_BATCH_SIZE);
    });

    it('should have default retention policy with all required fields', () => {
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('bugReportRetentionDays');
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('screenshotRetentionDays');
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('replayRetentionDays');
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('attachmentRetentionDays');
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('archivedRetentionDays');
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('archiveBeforeDelete');
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('dataClassification');
      expect(DEFAULT_RETENTION_POLICY).toHaveProperty('complianceRegion');
    });
  });

  describe('Tier-Based Retention Limits', () => {
    it('should have retention limits for all tiers', () => {
      expect(TIER_MAX_RETENTION).toHaveProperty('free');
      expect(TIER_MAX_RETENTION).toHaveProperty('professional');
      expect(TIER_MAX_RETENTION).toHaveProperty('enterprise');
      expect(TIER_MIN_RETENTION).toHaveProperty('free');
      expect(TIER_MIN_RETENTION).toHaveProperty('professional');
      expect(TIER_MIN_RETENTION).toHaveProperty('enterprise');
    });

    it('should enforce tier hierarchy (free < professional <= enterprise)', () => {
      expect(TIER_MAX_RETENTION.free).toBeLessThan(TIER_MAX_RETENTION.professional);
      expect(TIER_MIN_RETENTION.free).toBeLessThanOrEqual(TIER_MIN_RETENTION.professional);
    });

    it('should have enterprise tier with unlimited retention', () => {
      expect(TIER_MAX_RETENTION.enterprise).toBe(-1);
    });
  });

  describe('Compliance Requirements', () => {
    it('should have compliance rules for all supported regions', () => {
      const regions: ComplianceRegion[] = ['none', 'eu', 'us', 'kz', 'uk', 'ca'];
      regions.forEach((region) => {
        expect(COMPLIANCE_MIN_RETENTION).toHaveProperty(region);
      });
    });

    it('should have "none" region with zero retention requirements', () => {
      const noneRegion = COMPLIANCE_MIN_RETENTION.none;
      expect(noneRegion.general).toBe(0);
      expect(noneRegion.financial).toBe(0);
      expect(noneRegion.healthcare).toBe(0);
    });

    it('should have EU region with GDPR requirements', () => {
      const euRegion = COMPLIANCE_MIN_RETENTION.eu;
      expect(euRegion.general).toBe(0); // No minimum for general
      expect(euRegion.financial).toBeGreaterThan(0); // Financial records need retention
      expect(euRegion.pii).toBe(0); // PII should be deleted ASAP
    });

    it('should have US region with SOX/HIPAA requirements', () => {
      const usRegion = COMPLIANCE_MIN_RETENTION.us;
      expect(usRegion.financial).toBeGreaterThanOrEqual(2555); // 7 years
      expect(usRegion.healthcare).toBeGreaterThanOrEqual(2555); // 7 years
    });

    it('should have Kazakhstan region with local law requirements', () => {
      const kzRegion = COMPLIANCE_MIN_RETENTION.kz;
      expect(kzRegion.financial).toBeGreaterThanOrEqual(1825); // 5 years
      expect(kzRegion.healthcare).toBeGreaterThanOrEqual(3650); // 10 years
    });

    it('should correctly identify regions requiring true deletion', () => {
      expect(TRUE_DELETION_REQUIRED.has('kz')).toBe(true);
      expect(TRUE_DELETION_REQUIRED.has('eu')).toBe(true);
      expect(TRUE_DELETION_REQUIRED.has('us')).toBe(false);
      expect(TRUE_DELETION_REQUIRED.has('none')).toBe(false);
    });

    it('should correctly identify regions requiring deletion certificates', () => {
      expect(DELETION_CERTIFICATE_REQUIRED.has('kz')).toBe(true);
      expect(DELETION_CERTIFICATE_REQUIRED.has('eu')).toBe(true);
      expect(DELETION_CERTIFICATE_REQUIRED.has('us')).toBe(true);
      expect(DELETION_CERTIFICATE_REQUIRED.has('none')).toBe(false);
    });
  });

  describe('getComplianceMinRetention()', () => {
    it('should return 0 for "none" region', () => {
      expect(getComplianceMinRetention('none', 'general')).toBe(0);
      expect(getComplianceMinRetention('none', 'financial')).toBe(0);
    });

    it('should return correct minimum for EU financial data', () => {
      const minDays = getComplianceMinRetention('eu', 'financial');
      expect(minDays).toBe(365);
    });

    it('should return correct minimum for US financial data', () => {
      const minDays = getComplianceMinRetention('us', 'financial');
      expect(minDays).toBe(2555); // 7 years
    });

    it('should return correct minimum for Kazakhstan healthcare data', () => {
      const minDays = getComplianceMinRetention('kz', 'healthcare');
      expect(minDays).toBe(3650); // 10 years
    });

    it('should return 0 for undefined classification in region', () => {
      const minDays = getComplianceMinRetention('eu', 'government');
      expect(minDays).toBe(0);
    });
  });

  describe('requiresTrueDeletion()', () => {
    it('should return true for regions requiring true deletion', () => {
      expect(requiresTrueDeletion('kz')).toBe(true);
      expect(requiresTrueDeletion('eu')).toBe(true);
    });

    it('should return false for regions not requiring true deletion', () => {
      expect(requiresTrueDeletion('none')).toBe(false);
      expect(requiresTrueDeletion('us')).toBe(false);
      expect(requiresTrueDeletion('ca')).toBe(false);
    });
  });

  describe('requiresDeletionCertificate()', () => {
    it('should return true for regions requiring deletion certificates', () => {
      expect(requiresDeletionCertificate('kz')).toBe(true);
      expect(requiresDeletionCertificate('eu')).toBe(true);
      expect(requiresDeletionCertificate('us')).toBe(true);
    });

    it('should return false for regions not requiring certificates', () => {
      expect(requiresDeletionCertificate('none')).toBe(false);
      expect(requiresDeletionCertificate('ca')).toBe(false);
    });
  });

  describe('getRetentionPolicyForTier()', () => {
    it('should return default policy for free tier with no compliance', () => {
      const policy = getRetentionPolicyForTier('free', 'general', 'none');
      expect(policy.dataClassification).toBe('general');
      expect(policy.complianceRegion).toBe('none');
      expect(policy.bugReportRetentionDays).toBeLessThanOrEqual(TIER_MAX_RETENTION.free);
    });

    it('should cap free tier at maximum retention', () => {
      const policy = getRetentionPolicyForTier('free', 'general', 'none');
      expect(policy.bugReportRetentionDays).toBeLessThanOrEqual(TIER_MAX_RETENTION.free);
      expect(policy.screenshotRetentionDays).toBeLessThanOrEqual(TIER_MAX_RETENTION.free);
    });

    it('should enforce compliance minimum over tier minimum', () => {
      const policy = getRetentionPolicyForTier('free', 'financial', 'us');
      const complianceMin = getComplianceMinRetention('us', 'financial');
      expect(policy.bugReportRetentionDays).toBeGreaterThanOrEqual(complianceMin);
    });

    it('should allow enterprise tier to exceed standard limits', () => {
      const policy = getRetentionPolicyForTier('enterprise', 'general', 'none');
      expect(policy.bugReportRetentionDays).toBeGreaterThan(TIER_MAX_RETENTION.free);
    });

    it('should apply Kazakhstan compliance for financial data', () => {
      const policy = getRetentionPolicyForTier('professional', 'financial', 'kz');
      const kzMinimum = getComplianceMinRetention('kz', 'financial');
      expect(policy.bugReportRetentionDays).toBeGreaterThanOrEqual(kzMinimum);
      expect(policy.complianceRegion).toBe('kz');
    });

    it('should apply EU GDPR compliance', () => {
      const policy = getRetentionPolicyForTier('professional', 'financial', 'eu');
      const euMinimum = getComplianceMinRetention('eu', 'financial');
      expect(policy.bugReportRetentionDays).toBeGreaterThanOrEqual(euMinimum);
      expect(policy.complianceRegion).toBe('eu');
    });
  });

  describe('validateRetentionDays()', () => {
    it('should accept valid retention for free tier', () => {
      const result = validateRetentionDays(30, 'free', 'general', 'none');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject retention below tier minimum', () => {
      const result = validateRetentionDays(5, 'free', 'general', 'none');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least');
    });

    it('should reject retention above tier maximum for free tier', () => {
      const result = validateRetentionDays(100, 'free', 'general', 'none');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('cannot exceed');
      expect(result.error).toContain('free');
    });

    it('should reject retention below compliance minimum', () => {
      const result = validateRetentionDays(365, 'enterprise', 'financial', 'us');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('compliance');
    });

    it('should accept retention meeting both tier and compliance requirements', () => {
      const result = validateRetentionDays(2555, 'enterprise', 'financial', 'us');
      expect(result.valid).toBe(true);
    });

    it('should enforce Kazakhstan compliance minimum', () => {
      const kzMinimum = getComplianceMinRetention('kz', 'financial');
      const result = validateRetentionDays(kzMinimum - 1, 'enterprise', 'financial', 'kz');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('KZ compliance');
    });

    it('should accept Kazakhstan compliant retention', () => {
      const kzMinimum = getComplianceMinRetention('kz', 'financial');
      const result = validateRetentionDays(kzMinimum, 'enterprise', 'financial', 'kz');
      expect(result.valid).toBe(true);
    });

    it('should allow enterprise tier with unlimited retention', () => {
      const result = validateRetentionDays(10000, 'enterprise', 'general', 'none');
      expect(result.valid).toBe(true);
    });
  });

  describe('calculateCutoffDate()', () => {
    it('should calculate correct cutoff date', () => {
      const retentionDays = 90;
      const cutoff = calculateCutoffDate(retentionDays);
      const today = new Date();
      const expectedCutoff = new Date(today);
      expectedCutoff.setDate(today.getDate() - retentionDays);

      // Compare dates (ignore time)
      expect(cutoff.toDateString()).toBe(expectedCutoff.toDateString());
    });

    it('should handle zero retention days', () => {
      const cutoff = calculateCutoffDate(0);
      const today = new Date();
      expect(cutoff.toDateString()).toBe(today.toDateString());
    });

    it('should handle large retention periods', () => {
      const retentionDays = 3650; // 10 years
      const cutoff = calculateCutoffDate(retentionDays);
      const today = new Date();
      const expectedCutoff = new Date(today);
      expectedCutoff.setDate(today.getDate() - retentionDays);

      expect(cutoff.getTime()).toBeLessThan(today.getTime());
      expect(cutoff.getFullYear()).toBeLessThanOrEqual(today.getFullYear() - 9);
    });
  });

  describe('Multi-Region Compliance Scenarios', () => {
    it('should handle professional tier with EU GDPR', () => {
      const policy = getRetentionPolicyForTier('professional', 'pii', 'eu');
      expect(policy.complianceRegion).toBe('eu');
      expect(requiresTrueDeletion('eu')).toBe(true);
      expect(requiresDeletionCertificate('eu')).toBe(true);
    });

    it('should handle enterprise tier with US SOX compliance', () => {
      const validation = validateRetentionDays(2555, 'enterprise', 'financial', 'us');
      expect(validation.valid).toBe(true);
      expect(requiresDeletionCertificate('us')).toBe(true);
      expect(requiresTrueDeletion('us')).toBe(false);
    });

    it('should handle UK data with tax record retention', () => {
      const policy = getRetentionPolicyForTier('professional', 'financial', 'uk');
      const ukMinimum = getComplianceMinRetention('uk', 'financial');
      expect(policy.bugReportRetentionDays).toBeGreaterThanOrEqual(ukMinimum);
      expect(requiresTrueDeletion('uk')).toBe(false); // UK doesn't require true deletion in current config
      expect(requiresDeletionCertificate('uk')).toBe(false); // UK not in cert list
    });

    it('should handle Canadian healthcare data', () => {
      const policy = getRetentionPolicyForTier('professional', 'healthcare', 'ca');
      const caMinimum = getComplianceMinRetention('ca', 'healthcare');
      expect(policy.bugReportRetentionDays).toBeGreaterThanOrEqual(caMinimum);
      expect(requiresDeletionCertificate('ca')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined classification gracefully', () => {
      const minDays = getComplianceMinRetention('us', 'general');
      expect(minDays).toBeGreaterThanOrEqual(0);
    });

    it('should handle unknown region gracefully', () => {
      // @ts-expect-error Testing with invalid region
      const minDays = getComplianceMinRetention('unknown', 'general');
      expect(minDays).toBe(0);
    });

    it('should validate negative retention days', () => {
      const result = validateRetentionDays(-10, 'free', 'general', 'none');
      expect(result.valid).toBe(false);
    });

    it('should handle very large retention periods for enterprise', () => {
      const result = validateRetentionDays(100000, 'enterprise', 'general', 'none');
      expect(result.valid).toBe(true);
    });
  });
});
