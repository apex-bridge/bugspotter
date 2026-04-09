/**
 * Retention Policy Types
 * Types for data retention and lifecycle management
 */

import { z } from 'zod';

export type ProjectTier = 'free' | 'professional' | 'enterprise';
export type DataClassification =
  | 'general'
  | 'financial'
  | 'government'
  | 'healthcare'
  | 'pii'
  | 'sensitive';
export type DeletionReason =
  | 'retention_policy'
  | 'manual'
  | 'gdpr_request'
  | 'ccpa_request'
  | 'user_request'
  | 'legal_hold_released';
export type ComplianceRegion = 'none' | 'eu' | 'us' | 'kz' | 'uk' | 'ca' | 'rf';

/**
 * Zod schema for runtime validation of ProjectRetentionSettings
 */
export const ProjectRetentionSettingsSchema = z
  .object({
    tier: z.enum(['free', 'professional', 'enterprise']).optional(),
    retention: z
      .object({
        bugReportRetentionDays: z.number().int().min(0),
        screenshotRetentionDays: z.number().int().min(0).optional(),
        replayRetentionDays: z.number().int().min(0).optional(),
        attachmentRetentionDays: z.number().int().min(0).optional(),
        archivedRetentionDays: z.number().int().min(0).optional(),
        archiveBeforeDelete: z.boolean().optional(),
        dataClassification: z
          .enum(['general', 'financial', 'government', 'healthcare', 'pii', 'sensitive'])
          .optional(),
        complianceRegion: z.enum(['none', 'eu', 'us', 'kz', 'uk', 'ca', 'rf']).optional(),
      })
      .optional(),
    minimumRetentionDays: z.number().int().min(0).optional(),
  })
  .passthrough(); // Allow additional fields for forward compatibility

/**
 * Retention policy configuration for a project
 */
export interface RetentionPolicy {
  /** Days to retain bug reports (default: 90) */
  bugReportRetentionDays: number;
  /** Days to retain screenshots (default: 60) */
  screenshotRetentionDays: number;
  /** Days to retain session replays (default: 30) */
  replayRetentionDays: number;
  /** Days to retain attachments (default: 90) */
  attachmentRetentionDays: number;
  /** Days to retain archived records (default: 365) */
  archivedRetentionDays: number;
  /** Whether to archive before permanent deletion */
  archiveBeforeDelete: boolean;
  /** Data classification (affects minimum retention based on compliance) */
  dataClassification: DataClassification;
  /** Compliance region (determines regulatory requirements) */
  complianceRegion: ComplianceRegion;
}

/**
 * Project settings for retention (stored in projects.settings JSONB)
 */
export interface ProjectRetentionSettings {
  tier: ProjectTier;
  retention: RetentionPolicy;
  /** Minimum retention days enforced by compliance (Kazakhstan: 5 years for financial) */
  minimumRetentionDays?: number;
}

/**
 * Result of retention policy application
 */
export interface RetentionResult {
  /** Total bug reports soft-deleted */
  totalDeleted: number;
  /** Total bug reports archived */
  totalArchived: number;
  /** Total storage bytes freed */
  storageFreed: number;
  /** Total screenshots deleted */
  screenshotsDeleted: number;
  /** Total replays deleted */
  replaysDeleted: number;
  /** Number of projects processed */
  projectsProcessed: number;
  /** Errors encountered during processing */
  errors: RetentionError[];
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Timestamp when operation started */
  startedAt: Date;
  /** Timestamp when operation completed */
  completedAt: Date;
}

/**
 * Error details during retention processing
 */
export interface RetentionError {
  projectId: string;
  bugReportId?: string;
  error: string;
  timestamp: Date;
}

/**
 * Preview of what would be deleted (dry-run mode)
 */
export interface RetentionPreview {
  /** Projects that would be affected */
  affectedProjects: Array<{
    projectId: string;
    projectName: string;
    reportsToDelete: number;
    estimatedStorageFreed: number;
    oldestReportDate: Date;
  }>;
  /** Total reports that would be deleted */
  totalReports: number;
  /** Total storage that would be freed */
  totalStorageBytes: number;
  /** Reports on legal hold (won't be deleted) */
  legalHoldCount: number;
}

/**
 * Deletion certificate for compliance and audit purposes
 * Generated when required by regulatory frameworks (GDPR, Kazakhstan law, etc.)
 */
export interface DeletionCertificate {
  certificateId: string;
  projectId: string;
  reportIds: string[];
  deletedAt: Date;
  deletedBy: string;
  reason: DeletionReason;
  dataClassification: DataClassification;
  complianceRegion: ComplianceRegion;
  verificationHash: string;
  /** Certificate valid for audit purposes */
  issuedAt: Date;
}

/**
 * Audit log entry for retention operations
 */
export interface RetentionAuditLog {
  id: string;
  action:
    | 'soft_delete'
    | 'hard_delete'
    | 'archive'
    | 'restore'
    | 'legal_hold_applied'
    | 'legal_hold_released';
  projectId: string;
  bugReportIds: string[];
  reason: DeletionReason;
  userId: string | null;
  metadata: {
    retentionDays?: number;
    storageFreed?: number;
    certificateId?: string;
    allProjectIds?: string[];
    projectCount?: number;
  };
  timestamp: Date;
}

/**
 * Batch operation options
 */
export interface BatchOperationOptions {
  /** Maximum batch size (default: 100) */
  batchSize?: number;
  /** Stop if error rate exceeds this percentage (default: 5) */
  maxErrorRate?: number;
  /** Delay between batches in milliseconds (default: 0) */
  delayMs?: number;
  /** Run in dry-run mode (preview only, no changes) */
  dryRun?: boolean;
}

/**
 * Storage cleanup result
 */
export interface StorageCleanupResult {
  filesDeleted: number;
  bytesFreed: number;
  errors: Array<{ key: string; error: string }>;
}

/**
 * Orphaned file (exists in storage but not in database)
 */
export interface OrphanedFile {
  key: string;
  size: number;
  lastModified: Date;
}
