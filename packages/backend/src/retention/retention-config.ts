/**
 * Retention Policy Configuration
 * Default retention policies and compliance rules
 */

import type {
  RetentionPolicy,
  ProjectTier,
  DataClassification,
  ComplianceRegion,
} from './types.js';
import { STRICT_DATA_RESIDENCY_REGIONS } from '../data-residency/types.js';

// ============================================================================
// DEFAULT RETENTION PERIODS (DAYS)
// ============================================================================

export const DEFAULT_RETENTION_DAYS = parseInt(process.env.DEFAULT_RETENTION_DAYS ?? '90', 10);
export const SCREENSHOT_RETENTION_DAYS = parseInt(
  process.env.SCREENSHOT_RETENTION_DAYS ?? '60',
  10
);
export const REPLAY_RETENTION_DAYS = parseInt(process.env.REPLAY_RETENTION_DAYS ?? '30', 10);
export const ATTACHMENT_RETENTION_DAYS = parseInt(
  process.env.ATTACHMENT_RETENTION_DAYS ?? '90',
  10
);
export const ARCHIVED_RETENTION_DAYS = parseInt(process.env.ARCHIVED_RETENTION_DAYS ?? '365', 10);

// ============================================================================
// TIER-BASED RETENTION LIMITS
// ============================================================================

/**
 * Maximum retention days allowed per tier
 */
export const TIER_MAX_RETENTION: Record<ProjectTier, number> = {
  free: 60, // Free tier: max 60 days
  professional: 365, // Professional: up to 1 year
  enterprise: -1, // Enterprise: unlimited (use -1 to indicate no limit)
};

/**
 * Minimum retention days enforced per tier
 */
export const TIER_MIN_RETENTION: Record<ProjectTier, number> = {
  free: 7, // Free tier: minimum 7 days
  professional: 30, // Professional: minimum 30 days
  enterprise: 30, // Enterprise: minimum 30 days
};

// ============================================================================
// COMPLIANCE REQUIREMENTS BY REGION
// ============================================================================

/**
 * Minimum retention periods by compliance region and data classification (in days)
 * Can be extended with additional regions and classifications
 */
export const COMPLIANCE_MIN_RETENTION: Record<
  string, // ComplianceRegion
  Partial<Record<DataClassification, number>>
> = {
  none: {
    general: 0,
    financial: 0,
    government: 0,
    healthcare: 0,
    pii: 0,
    sensitive: 0,
  },
  // European Union - GDPR
  eu: {
    general: 0, // No minimum unless specified
    financial: 365, // 1 year for financial records
    pii: 0, // Must be deleted when no longer needed
  },
  // United States - Various federal laws
  us: {
    general: 0,
    financial: 2555, // 7 years (SOX, IRS)
    healthcare: 2555, // 7 years (HIPAA)
    government: 1095, // 3 years minimum
  },
  // Kazakhstan - Local regulations
  kz: {
    general: 90, // 3 months minimum
    financial: 1825, // 5 years (Law "On Accounting and Financial Reporting")
    government: 1825, // 5 years
    healthcare: 3650, // 10 years
  },
  // United Kingdom - UK-GDPR + local laws
  uk: {
    general: 0,
    financial: 2190, // 6 years (tax records)
    healthcare: 2920, // 8 years (NHS guidelines)
  },
  // Canada - PIPEDA and provincial laws
  ca: {
    general: 0,
    financial: 2190, // 6 years (CRA requirements)
    healthcare: 3650, // 10 years (varies by province)
  },
  // Russian Federation - Federal Law 242-FZ and related regulations
  rf: {
    general: 90, // 3 months minimum for personal data
    financial: 1825, // 5 years (Federal Law "On Accounting")
    government: 1825, // 5 years
    healthcare: 3650, // 10 years (medical records)
    pii: 180, // 6 months after processing purpose is fulfilled
  },
};

/**
 * Regions that require true deletion (not just soft delete)
 */
export const TRUE_DELETION_REQUIRED: Set<string> = new Set(['kz', 'rf', 'eu']);

/**
 * Regions that require deletion certificates
 */
export const DELETION_CERTIFICATE_REQUIRED: Set<string> = new Set(['kz', 'rf', 'eu', 'us']);

/**
 * Regions with strict data residency requirements
 * Data must physically remain within the country
 * Re-exported from data-residency module for backward compatibility
 */
export const STRICT_DATA_RESIDENCY_REQUIRED = STRICT_DATA_RESIDENCY_REGIONS;

// ============================================================================
// DEFAULT RETENTION POLICY
// ============================================================================

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  bugReportRetentionDays: DEFAULT_RETENTION_DAYS,
  screenshotRetentionDays: SCREENSHOT_RETENTION_DAYS,
  replayRetentionDays: REPLAY_RETENTION_DAYS,
  attachmentRetentionDays: ATTACHMENT_RETENTION_DAYS,
  archivedRetentionDays: ARCHIVED_RETENTION_DAYS,
  archiveBeforeDelete: true,
  dataClassification: 'general',
  complianceRegion: (process.env.COMPLIANCE_REGION as ComplianceRegion) ?? 'none',
};

// ============================================================================
// BATCH OPERATION DEFAULTS
// ============================================================================

/** Default batch size for deletion operations */
export const DEFAULT_BATCH_SIZE = 100;

/** Maximum batch size allowed */
export const MAX_BATCH_SIZE = 1000;

/** Stop processing if error rate exceeds this percentage */
export const DEFAULT_MAX_ERROR_RATE = 5;

/** Delay between batches in milliseconds */
export const DEFAULT_BATCH_DELAY_MS = 0;

// ============================================================================
// SCHEDULER CONFIGURATION
// ============================================================================

/** Cron schedule for retention job (default: daily at 2 AM) */
export const RETENTION_CRON_SCHEDULE = process.env.RETENTION_CRON_SCHEDULE ?? '0 2 * * *';

/** Whether retention scheduler is enabled */
export const RETENTION_SCHEDULER_ENABLED = process.env.RETENTION_SCHEDULER_ENABLED !== 'false';

/** Time zone for cron schedule (default: UTC) */
export const RETENTION_CRON_TIMEZONE = process.env.RETENTION_CRON_TIMEZONE ?? 'UTC';

// ============================================================================
// STORAGE LIFECYCLE RULES
// ============================================================================

/**
 * S3 lifecycle rules configuration
 * These are applied at bucket level for automatic cleanup
 */
export const S3_LIFECYCLE_RULES = {
  /** Move screenshots to infrequent access after days */
  screenshotTransitionDays: 30,
  /** Move replays to infrequent access after days */
  replayTransitionDays: 7,
  /** Delete objects with delete markers after days */
  deleteMarkerExpirationDays: 1,
};

// ============================================================================
// CONFIRMATION THRESHOLDS
// ============================================================================

/** Require confirmation if manual deletion exceeds this many reports */
export const MANUAL_DELETION_CONFIRMATION_THRESHOLD = 100;

/** Require backup before deleting more than this many reports */
export const BACKUP_REQUIRED_THRESHOLD = 1000;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get minimum retention days for a specific region and classification
 */
export function getComplianceMinRetention(
  region: ComplianceRegion,
  classification: DataClassification
): number {
  const regionRules = COMPLIANCE_MIN_RETENTION[region];
  if (!regionRules) {
    return 0;
  }
  return regionRules[classification] ?? 0;
}

/**
 * Check if region requires true deletion (not just soft delete)
 */
export function requiresTrueDeletion(region: ComplianceRegion): boolean {
  return TRUE_DELETION_REQUIRED.has(region);
}

/**
 * Check if region requires deletion certificate
 */
export function requiresDeletionCertificate(region: ComplianceRegion): boolean {
  return DELETION_CERTIFICATE_REQUIRED.has(region);
}

/**
 * Get retention policy for a project based on tier, classification, and compliance region
 */
export function getRetentionPolicyForTier(
  tier: ProjectTier,
  dataClassification: DataClassification = 'general',
  complianceRegion: ComplianceRegion = 'none'
): RetentionPolicy {
  const basePolicy = { ...DEFAULT_RETENTION_POLICY };
  basePolicy.dataClassification = dataClassification;
  basePolicy.complianceRegion = complianceRegion;

  // Get compliance minimum retention for this region/classification
  const complianceMinDays = getComplianceMinRetention(complianceRegion, dataClassification);

  // Apply tier-based limits
  const maxDays = TIER_MAX_RETENTION[tier];
  const minDays = Math.max(TIER_MIN_RETENTION[tier], complianceMinDays);

  // For free tier, cap at maximum
  if (tier === 'free' && maxDays > 0) {
    basePolicy.bugReportRetentionDays = Math.min(maxDays, basePolicy.bugReportRetentionDays);
    basePolicy.screenshotRetentionDays = Math.min(maxDays, basePolicy.screenshotRetentionDays);
    basePolicy.replayRetentionDays = Math.min(maxDays, basePolicy.replayRetentionDays);
    basePolicy.attachmentRetentionDays = Math.min(maxDays, basePolicy.attachmentRetentionDays);
  }

  // Ensure minimum retention is met (tier minimum OR compliance minimum, whichever is higher)
  basePolicy.bugReportRetentionDays = Math.max(minDays, basePolicy.bugReportRetentionDays);
  basePolicy.screenshotRetentionDays = Math.max(minDays, basePolicy.screenshotRetentionDays);
  basePolicy.replayRetentionDays = Math.max(minDays, basePolicy.replayRetentionDays);
  basePolicy.attachmentRetentionDays = Math.max(minDays, basePolicy.attachmentRetentionDays);

  return basePolicy;
}

/**
 * Validate retention days against tier, classification, and compliance limits
 */
export function validateRetentionDays(
  days: number,
  tier: ProjectTier,
  dataClassification: DataClassification = 'general',
  complianceRegion: ComplianceRegion = 'none'
): { valid: boolean; error?: string } {
  const complianceMinDays = getComplianceMinRetention(complianceRegion, dataClassification);
  const minDays = Math.max(TIER_MIN_RETENTION[tier], complianceMinDays);
  const maxDays = TIER_MAX_RETENTION[tier];

  if (days < minDays) {
    const reasons: string[] = [];
    if (TIER_MIN_RETENTION[tier] === minDays) {
      reasons.push(`tier minimum: ${TIER_MIN_RETENTION[tier]} days`);
    }
    if (complianceMinDays === minDays && complianceMinDays > 0) {
      reasons.push(`${complianceRegion.toUpperCase()} compliance: ${complianceMinDays} days`);
    }

    return {
      valid: false,
      error: `Retention period must be at least ${minDays} days (${reasons.join(', ')})`,
    };
  }

  if (maxDays > 0 && days > maxDays) {
    return {
      valid: false,
      error: `Retention period cannot exceed ${maxDays} days for ${tier} tier. Upgrade to enterprise for longer retention.`,
    };
  }

  return { valid: true };
}

/**
 * Calculate cutoff date for retention (date before which data should be deleted)
 */
export function calculateCutoffDate(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}
