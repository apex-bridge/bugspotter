/**
 * Retention Service
 * Manages data retention policies and lifecycle operations
 */

import crypto from 'crypto';
import { getLogger } from '../logger.js';
import type { DatabaseClient } from '../db/client.js';
import type { BaseStorageService } from '../storage/base-storage-service.js';
import type { IStorageArchiver } from '../storage/archive-storage.interface.js';
import { DeletionArchiveStrategy } from '../storage/archive-storage-service.js';
import type {
  RetentionResult,
  RetentionPreview,
  DeletionCertificate,
  RetentionAuditLog,
  BatchOperationOptions,
  StorageCleanupResult,
  DeletionReason,
  ProjectRetentionSettings,
  DataClassification,
  ComplianceRegion,
} from './types.js';
import type { BugReport, ArchivedBugReport, Project } from '../db/types.js';
import {
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  DEFAULT_MAX_ERROR_RATE,
  DEFAULT_BATCH_DELAY_MS,
  calculateCutoffDate,
} from './retention-config.js';

const logger = getLogger();

/**
 * RetentionService - Orchestrates data retention and lifecycle management
 */
export class RetentionService {
  private archiveStorage: IStorageArchiver;

  constructor(
    private db: DatabaseClient,
    private storage: BaseStorageService,
    archiveStrategy?: IStorageArchiver
  ) {
    // Allow dependency injection of archive strategy, default to deletion
    this.archiveStorage = archiveStrategy ?? new DeletionArchiveStrategy(storage);
  }

  /**
   * Apply retention policies across all projects
   * Main orchestrator method - runs daily via scheduler
   */
  async applyRetentionPolicies(options?: BatchOperationOptions): Promise<RetentionResult> {
    const startedAt = new Date();
    const result: RetentionResult = {
      totalDeleted: 0,
      totalArchived: 0,
      storageFreed: 0,
      screenshotsDeleted: 0,
      replaysDeleted: 0,
      projectsProcessed: 0,
      errors: [],
      durationMs: 0,
      startedAt,
      completedAt: new Date(),
    };

    const dryRun = options?.dryRun ?? false;
    const batchSize = Math.min(options?.batchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE);
    const maxErrorRate = options?.maxErrorRate ?? DEFAULT_MAX_ERROR_RATE;
    const delayMs = options?.delayMs ?? DEFAULT_BATCH_DELAY_MS;

    logger.info('Starting retention policy application', {
      dryRun,
      batchSize,
      maxErrorRate,
    });

    try {
      // Get all projects
      const projects = await this.db.projects.findAll();

      for (const project of projects) {
        try {
          const projectResult = await this.applyProjectRetentionPolicy(project, {
            ...options,
            batchSize,
            dryRun,
          });

          result.totalDeleted += projectResult.reportsDeleted;
          result.totalArchived += projectResult.reportsArchived;
          result.storageFreed += projectResult.storageFreed;
          result.screenshotsDeleted += projectResult.screenshotsDeleted;
          result.replaysDeleted += projectResult.replaysDeleted;
          result.projectsProcessed++;

          // Check error rate and stop if exceeded
          const totalAttempts = result.totalDeleted + result.errors.length;
          const errorRate = totalAttempts > 0 ? (result.errors.length / totalAttempts) * 100 : 0;
          if (errorRate > maxErrorRate && totalAttempts > 10) {
            logger.error('Error rate exceeded maximum threshold', {
              errorRate: Number(errorRate.toFixed(2)),
              maxErrorRate,
              errors: result.errors.length,
              totalAttempts,
            });
            break;
          }

          // Delay between projects if configured
          if (delayMs > 0) {
            await this.delay(delayMs);
          }
        } catch (error) {
          logger.error('Error processing project retention', {
            projectId: project.id,
            error: error instanceof Error ? error.message : String(error),
          });
          result.errors.push({
            projectId: project.id,
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date(),
          });
        }
      }

      result.completedAt = new Date();
      result.durationMs = result.completedAt.getTime() - startedAt.getTime();

      logger.info('Retention policy application completed', {
        ...result,
        dryRun,
      });

      return result;
    } catch (error) {
      logger.error('Fatal error during retention policy application', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Apply retention policy for a single project
   */
  private async applyProjectRetentionPolicy(
    project: Project,
    options?: BatchOperationOptions
  ): Promise<{
    reportsDeleted: number;
    reportsArchived: number;
    storageFreed: number;
    screenshotsDeleted: number;
    replaysDeleted: number;
  }> {
    const settings = project.settings as unknown as ProjectRetentionSettings;
    const retentionPolicy = settings?.retention;

    if (!retentionPolicy) {
      logger.debug('No retention policy configured for project', {
        projectId: project.id,
      });
      return {
        reportsDeleted: 0,
        reportsArchived: 0,
        storageFreed: 0,
        screenshotsDeleted: 0,
        replaysDeleted: 0,
      };
    }

    const cutoffDate = calculateCutoffDate(retentionPolicy.bugReportRetentionDays);
    const dryRun = options?.dryRun ?? false;

    logger.info('Applying retention policy for project', {
      projectId: project.id,
      retentionDays: retentionPolicy.bugReportRetentionDays,
      cutoffDate,
      dryRun,
    });

    // Find reports older than cutoff date (excluding those on legal hold)
    const oldReports = await this.findReportsForDeletion(project.id, cutoffDate);

    if (oldReports.length === 0) {
      return {
        reportsDeleted: 0,
        reportsArchived: 0,
        storageFreed: 0,
        screenshotsDeleted: 0,
        replaysDeleted: 0,
      };
    }

    let storageFreed = 0;
    let screenshotsDeleted = 0;
    let replaysDeleted = 0;
    let reportsArchived = 0;

    if (!dryRun) {
      // Archive reports if configured (includes S3 archival)
      if (retentionPolicy.archiveBeforeDelete) {
        await this.archiveReports(oldReports, 'retention_policy');
        reportsArchived = oldReports.length;

        // Count storage freed from archival
        for (const report of oldReports) {
          const size = await this.getFileSizeEstimate(report);
          storageFreed += size;
          if (report.screenshot_url) {
            screenshotsDeleted++;
          }
          if (report.replay_url) {
            replaysDeleted++;
          }
        }
      } else {
        // Delete storage files directly if not archiving
        for (const report of oldReports) {
          const cleanup = await this.deleteReportStorage(report);
          storageFreed += cleanup.bytesFreed;
          if (report.screenshot_url) {
            screenshotsDeleted++;
          }
          if (report.replay_url) {
            replaysDeleted++;
          }
        }
      }

      // Soft delete reports
      const reportIds = oldReports.map((r) => r.id);
      await this.softDeleteReports(reportIds, null, 'retention_policy');

      // Audit log
      await this.createAuditLog({
        action: 'soft_delete',
        projectId: project.id,
        bugReportIds: reportIds,
        reason: 'retention_policy',
        userId: null,
        metadata: {
          retentionDays: retentionPolicy.bugReportRetentionDays,
          storageFreed,
        },
        timestamp: new Date(),
      });
    }

    return {
      reportsDeleted: oldReports.length,
      reportsArchived,
      storageFreed,
      screenshotsDeleted,
      replaysDeleted,
    };
  }

  /**
   * Find bug reports eligible for deletion
   */
  private async findReportsForDeletion(projectId: string, cutoffDate: Date): Promise<BugReport[]> {
    return await this.db.bugReports.findEligibleForDeletion(projectId, cutoffDate);
  }

  /**
   * Soft delete bug reports
   */
  private async softDeleteReports(
    reportIds: string[],
    userId: string | null,
    _reason: DeletionReason
  ): Promise<void> {
    await this.db.bugReports.softDelete(reportIds, userId);
  }

  /**
   * Hard delete bug reports (permanent deletion)
   */
  async hardDeleteReports(
    reportIds: string[],
    userId: string | null,
    generateCertificate = true
  ): Promise<DeletionCertificate | null> {
    if (reportIds.length === 0) {
      return null;
    }

    try {
      // Use DatabaseClient transaction with repository access
      const result = await this.db.transaction(async (tx) => {
        // Hard delete within transaction
        const reports = await tx.bugReports.hardDeleteInTransaction(reportIds);

        if (reports.length === 0) {
          return null;
        }

        // Generate deletion certificate if required
        const certificate =
          generateCertificate && reports.length > 0
            ? this.generateDeletionCertificate(
                reports[0].project_id,
                reports.map((r) => r.id),
                userId,
                'manual'
              )
            : null;

        logger.info('Hard deleted bug reports', {
          count: reports.length,
          userId,
          certificateGenerated: !!certificate,
        });

        return certificate;
      });

      return result;
    } catch (error) {
      logger.error('Error hard deleting bug reports', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Archive bug reports to long-term storage
   * Uses batch insert for database efficiency and ArchiveStorageService for S3
   */
  async archiveReports(reports: BugReport[], reason: DeletionReason): Promise<ArchivedBugReport[]> {
    if (reports.length === 0) {
      return [];
    }

    // Archive S3 files (currently deletes them)
    const files = reports.map((r) => ({
      screenshotUrl: r.screenshot_url,
      replayUrl: r.replay_url,
    }));
    const archiveResult = await this.archiveStorage.archiveBatch(files);

    // Batch insert to database using VALUES clause
    const FIELDS_PER_ROW = 14;
    const params: unknown[] = [];

    // Pre-allocate and build placeholders efficiently
    const valuesClauses = reports.map((report, idx) => {
      const baseIndex = idx * FIELDS_PER_ROW + 1;
      const placeholders = Array.from(
        { length: FIELDS_PER_ROW },
        (_, i) => `$${baseIndex + i}`
      ).join(', ');

      params.push(
        report.id,
        report.project_id,
        report.title,
        report.description,
        report.screenshot_url,
        report.replay_url,
        JSON.stringify(report.metadata),
        report.status,
        report.priority,
        report.created_at,
        report.updated_at,
        report.deleted_at ?? new Date(),
        report.deleted_by,
        reason
      );

      return `(${placeholders})`;
    });

    const query = `
      INSERT INTO archived_bug_reports (
        id, project_id, title, description, screenshot_url, replay_url,
        metadata, status, priority, original_created_at, original_updated_at,
        deleted_at, deleted_by, archived_reason
      ) VALUES ${valuesClauses.join(', ')}
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `;

    const result = await this.db.query<ArchivedBugReport>(query, params);

    logger.info('Archived bug reports', {
      count: result.rows.length,
      reason,
      filesArchived: archiveResult.filesArchived,
      bytesArchived: archiveResult.bytesArchived,
      storageErrors: archiveResult.errors.length,
    });

    return result.rows;
  }

  /**
   * Restore soft-deleted bug reports
   *
   * NOTE: Only restores soft-deleted reports that are still in the bug_reports table.
   * Reports that have been fully archived (moved to archived_bug_reports table) cannot
   * be restored through this method. Archived reports are considered permanently deleted
   * for compliance and audit purposes.
   *
   * @param reportIds - Array of bug report IDs to restore
   * @returns Number of reports successfully restored
   */
  async restoreReports(reportIds: string[]): Promise<number> {
    if (reportIds.length === 0) {
      return 0;
    }

    const query = `
      UPDATE bug_reports
      SET deleted_at = NULL,
          deleted_by = NULL
      WHERE id = ANY($1)
        AND deleted_at IS NOT NULL
    `;

    const result = await this.db.query(query, [reportIds]);
    const restoredCount = result.rowCount ?? 0;

    logger.info('Restored soft-deleted bug reports', {
      count: restoredCount,
      requested: reportIds.length,
      note: 'Archived reports cannot be restored',
    });

    return restoredCount;
  }

  /**
   * Delete storage files for a bug report
   */
  private async deleteReportStorage(report: BugReport): Promise<StorageCleanupResult> {
    const result: StorageCleanupResult = {
      filesDeleted: 0,
      bytesFreed: 0,
      errors: [],
    };

    const filesToDelete: string[] = [];

    if (report.screenshot_url) {
      filesToDelete.push(report.screenshot_url);
    }
    if (report.replay_url) {
      filesToDelete.push(report.replay_url);
    }

    for (const url of filesToDelete) {
      try {
        // Extract storage key from URL
        const key = this.extractStorageKey(url);

        // Get file size before deletion
        const size = await this.getFileSize(key);

        // Delete from storage
        await this.storage.deleteObject(key);

        result.filesDeleted++;
        result.bytesFreed += size;
      } catch (error) {
        result.errors.push({
          key: url,
          error: error instanceof Error ? error.message : String(error),
        });
        logger.error('Error deleting storage file', {
          url,
          reportId: report.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  /**
   * Extract storage key from URL
   */
  private extractStorageKey(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.substring(1); // Remove leading slash
    } catch {
      // If not a valid URL, assume it's already a key
      return url;
    }
  }

  /**
   * Get file size from storage
   * Uses storage backend's headObject method (S3 HeadObjectCommand or fs.stat for local)
   */
  private async getFileSize(key: string): Promise<number> {
    try {
      const object = await this.storage.headObject(key);
      return object?.size ?? 0;
    } catch (error) {
      logger.debug('Failed to get file size', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Estimate file size for a report (used when archiving)
   */
  private async getFileSizeEstimate(report: BugReport): Promise<number> {
    let size = 0;

    if (report.screenshot_url) {
      const key = this.extractStorageKey(report.screenshot_url);
      size += await this.getFileSize(key);
    }

    if (report.replay_url) {
      const key = this.extractStorageKey(report.replay_url);
      size += await this.getFileSize(key);
    }

    return size;
  }

  /**
   * Generate deletion certificate for compliance and audit purposes
   * Required by various regulatory frameworks (GDPR, Kazakhstan law, etc.)
   */
  private generateDeletionCertificate(
    projectId: string,
    reportIds: string[],
    userId: string | null,
    reason: DeletionReason,
    dataClassification: DataClassification = 'general',
    complianceRegion: ComplianceRegion = 'none'
  ): DeletionCertificate {
    const certificateId = crypto.randomUUID();
    const deletedAt = new Date();

    // Generate verification hash for integrity
    const hashData = JSON.stringify({
      certificateId,
      projectId,
      reportIds: reportIds.sort(),
      deletedAt: deletedAt.toISOString(),
      complianceRegion,
    });
    const verificationHash = crypto.createHash('sha256').update(hashData).digest('hex');

    return {
      certificateId,
      projectId,
      reportIds,
      deletedAt,
      deletedBy: userId ?? 'system',
      reason,
      dataClassification,
      complianceRegion,
      verificationHash,
      issuedAt: new Date(),
    };
  }

  /**
   * Create audit log entry
   */
  private async createAuditLog(log: Omit<RetentionAuditLog, 'id'>): Promise<void> {
    const query = `
      INSERT INTO audit_logs (action, resource, resource_id, user_id, details, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    const values = [
      log.action,
      'bug_report',
      log.projectId,
      log.userId,
      JSON.stringify({
        bugReportIds: log.bugReportIds,
        reason: log.reason,
        ...log.metadata,
      }),
      log.timestamp,
    ];

    await this.db.query(query, values);
  }

  /**
   * Preview retention policy (dry-run)
   */
  async previewRetentionPolicy(projectId?: string): Promise<RetentionPreview> {
    const preview: RetentionPreview = {
      affectedProjects: [],
      totalReports: 0,
      totalStorageBytes: 0,
      legalHoldCount: 0,
    };

    const projects = projectId
      ? [await this.db.projects.findById(projectId)]
      : await this.db.projects.findAll();

    for (const project of projects) {
      if (!project) {
        continue;
      }

      const settings = project.settings as unknown as ProjectRetentionSettings;
      const retentionPolicy = settings?.retention;

      if (!retentionPolicy) {
        continue;
      }

      const cutoffDate = calculateCutoffDate(retentionPolicy.bugReportRetentionDays);
      const reports = await this.findReportsForDeletion(project.id, cutoffDate);

      if (reports.length > 0) {
        // Calculate actual storage size by querying storage backend
        let estimatedStorage = 0;
        for (const report of reports) {
          estimatedStorage += await this.getFileSizeEstimate(report);
        }

        preview.affectedProjects.push({
          projectId: project.id,
          projectName: project.name,
          reportsToDelete: reports.length,
          estimatedStorageFreed: estimatedStorage,
          oldestReportDate: reports[0].created_at,
        });

        preview.totalReports += reports.length;
        preview.totalStorageBytes += estimatedStorage;
      }
    }

    // Count legal hold reports
    preview.legalHoldCount = await this.db.bugReports.countLegalHoldReports();

    return preview;
  }

  /**
   * Apply or remove legal hold on bug reports
   */
  async setLegalHold(reportIds: string[], hold: boolean, userId: string): Promise<number> {
    if (reportIds.length === 0) {
      return 0;
    }

    // Fetch project IDs for audit trail
    const projectQuery = `
      SELECT DISTINCT project_id FROM bug_reports WHERE id = ANY($1)
    `;
    const projectResult = await this.db.query<{ project_id: string }>(projectQuery, [reportIds]);
    const projectIds = projectResult.rows.map((row) => row.project_id);

    // Use repository method for the update
    const updatedCount = await this.db.bugReports.setLegalHold(reportIds, hold);

    // Create audit log entry (use first project ID, store all in metadata)
    await this.createAuditLog({
      action: hold ? 'legal_hold_applied' : 'legal_hold_released',
      projectId: projectIds[0] ?? '',
      bugReportIds: reportIds,
      reason: 'manual',
      userId,
      metadata: {
        allProjectIds: projectIds,
        projectCount: projectIds.length,
      },
      timestamp: new Date(),
    });

    logger.info(`Legal hold ${hold ? 'applied' : 'released'}`, {
      count: updatedCount,
      projectIds,
      userId,
    });

    return updatedCount;
  }

  /**
   * Utility method to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
