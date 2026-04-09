/**
 * Retention API Schemas
 * Zod validation schemas for retention endpoints
 */

import { z } from 'zod';

// ============================================================================
// TIER AND CLASSIFICATION SCHEMAS
// ============================================================================

export const projectTierSchema = z.enum(['free', 'professional', 'enterprise']);

export const dataClassificationSchema = z.enum([
  'general',
  'financial',
  'government',
  'healthcare',
  'pii',
  'sensitive',
]);

export const deletionReasonSchema = z.enum([
  'retention_policy',
  'manual',
  'gdpr_request',
  'ccpa_request',
  'user_request',
  'legal_hold_released',
]);

export const complianceRegionSchema = z.enum(['none', 'eu', 'us', 'kz', 'uk', 'ca']);

// ============================================================================
// RETENTION POLICY SCHEMA
// ============================================================================

export const retentionPolicySchema = z.object({
  bugReportRetentionDays: z.number().int().min(7).max(3650),
  screenshotRetentionDays: z.number().int().min(7).max(3650),
  replayRetentionDays: z.number().int().min(7).max(3650),
  attachmentRetentionDays: z.number().int().min(7).max(3650),
  archivedRetentionDays: z.number().int().min(30).max(7300),
  archiveBeforeDelete: z.boolean(),
  dataClassification: dataClassificationSchema,
});

export const projectRetentionSettingsSchema = z.object({
  tier: projectTierSchema,
  retention: retentionPolicySchema,
  minimumRetentionDays: z.number().int().min(0).optional(),
});

// ============================================================================
// API REQUEST SCHEMAS
// ============================================================================

export const getRetentionPolicyRequestSchema = z.object({
  params: z.object({
    projectId: z.string().uuid().optional(),
  }),
});

export const updateRetentionPolicyRequestSchema = z.object({
  body: retentionPolicySchema.partial(),
  params: z.object({
    projectId: z.string().uuid().optional(),
  }),
});

export const previewRetentionRequestSchema = z.object({
  query: z.object({
    projectId: z.string().uuid().optional(),
  }),
});

export const applyRetentionRequestSchema = z.object({
  body: z.object({
    projectId: z.string().uuid().optional(),
    dryRun: z.boolean().optional().default(false),
    batchSize: z.number().int().min(1).max(1000).optional().default(100),
    maxErrorRate: z.number().min(0).max(100).optional().default(5),
    confirm: z.boolean().optional(),
  }),
});

export const legalHoldRequestSchema = z.object({
  body: z.object({
    reportIds: z.array(z.string().uuid()).min(1).max(100),
    hold: z.boolean(),
  }),
});

export const restoreReportsRequestSchema = z.object({
  body: z.object({
    reportIds: z.array(z.string().uuid()).min(1).max(100),
  }),
});

export const hardDeleteRequestSchema = z.object({
  body: z.object({
    reportIds: z.array(z.string().uuid()).min(1).max(100),
    confirm: z.boolean(),
    generateCertificate: z.boolean().optional().default(true),
  }),
});

// ============================================================================
// API RESPONSE SCHEMAS
// ============================================================================

export const retentionResultSchema = z.object({
  totalDeleted: z.number().int().min(0),
  totalArchived: z.number().int().min(0),
  storageFreed: z.number().min(0),
  screenshotsDeleted: z.number().int().min(0),
  replaysDeleted: z.number().int().min(0),
  projectsProcessed: z.number().int().min(0),
  errors: z.array(
    z.object({
      projectId: z.string().uuid(),
      bugReportId: z.string().uuid().optional(),
      error: z.string(),
      timestamp: z.date(),
    })
  ),
  durationMs: z.number().min(0),
  startedAt: z.date(),
  completedAt: z.date(),
});

export const retentionPreviewSchema = z.object({
  affectedProjects: z.array(
    z.object({
      projectId: z.string().uuid(),
      projectName: z.string(),
      reportsToDelete: z.number().int().min(0),
      estimatedStorageFreed: z.number().min(0),
      oldestReportDate: z.date(),
    })
  ),
  totalReports: z.number().int().min(0),
  totalStorageBytes: z.number().min(0),
  legalHoldCount: z.number().int().min(0),
});

export const deletionCertificateSchema = z.object({
  certificateId: z.string().uuid(),
  projectId: z.string().uuid(),
  reportIds: z.array(z.string().uuid()),
  deletedAt: z.date(),
  deletedBy: z.string(),
  reason: deletionReasonSchema,
  dataClassification: dataClassificationSchema,
  complianceRegion: complianceRegionSchema,
  verificationHash: z.string(),
  issuedAt: z.date(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type GetRetentionPolicyRequest = z.infer<typeof getRetentionPolicyRequestSchema>;
export type UpdateRetentionPolicyRequest = z.infer<typeof updateRetentionPolicyRequestSchema>;
export type PreviewRetentionRequest = z.infer<typeof previewRetentionRequestSchema>;
export type ApplyRetentionRequest = z.infer<typeof applyRetentionRequestSchema>;
export type LegalHoldRequest = z.infer<typeof legalHoldRequestSchema>;
export type RestoreReportsRequest = z.infer<typeof restoreReportsRequestSchema>;
export type HardDeleteRequest = z.infer<typeof hardDeleteRequestSchema>;
