/**
 * Archive Storage Service - Deletion Strategy
 * Implements immediate deletion archival strategy for S3 objects
 *
 * This is the default implementation that deletes files immediately to free space.
 * Alternative implementations can provide different strategies (Glacier, archive prefix, etc.)
 */

import { getLogger } from '../logger.js';
import type { BaseStorageService } from './base-storage-service.js';
import type { IStorageArchiver, ArchiveResult } from './archive-storage.interface.js';
import type { ReportFiles } from './archive-storage.interface.js';

const logger = getLogger();

/**
 * DeletionArchiveStrategy - Immediate deletion implementation
 *
 * Strategy: Delete files immediately to free up storage space
 * Best for: Cost optimization, when data retention is not required
 */
export class DeletionArchiveStrategy implements IStorageArchiver {
  constructor(private storage: BaseStorageService) {}
  /**
   * Archive storage files for a bug report
   * Currently deletes files to free up space immediately
   *
   * @param screenshotUrl - Screenshot URL to archive
   * @param replayUrl - Replay URL to archive
   * @returns Archive result with counts and errors
   */
  async archiveReportFiles(
    screenshotUrl: string | null,
    replayUrl: string | null
  ): Promise<ArchiveResult> {
    const result: ArchiveResult = {
      filesArchived: 0,
      bytesArchived: 0,
      errors: [],
    };

    const filesToArchive: string[] = [];

    if (screenshotUrl) {
      filesToArchive.push(screenshotUrl);
    }
    if (replayUrl) {
      filesToArchive.push(replayUrl);
    }

    for (const url of filesToArchive) {
      try {
        const key = this.extractStorageKey(url);

        // Get file size before archival
        const size = await this.getFileSize(key);

        // Current strategy: Delete file
        await this.storage.deleteObject(key);

        result.filesArchived++;
        result.bytesArchived += size;

        logger.debug('Archived storage file', { key, size });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.errors.push({ key: url, error: errorMessage });

        logger.error('Error archiving storage file', {
          url,
          error: errorMessage,
        });
      }
    }

    return result;
  }

  /**
   * Batch archive multiple bug reports' files
   *
   * @param reports - Array of report file URLs
   * @returns Aggregate archive result
   */
  async archiveBatch(reports: ReportFiles[]): Promise<ArchiveResult> {
    const aggregateResult: ArchiveResult = {
      filesArchived: 0,
      bytesArchived: 0,
      errors: [],
    };

    for (const report of reports) {
      const result = await this.archiveReportFiles(report.screenshotUrl, report.replayUrl);

      aggregateResult.filesArchived += result.filesArchived;
      aggregateResult.bytesArchived += result.bytesArchived;
      aggregateResult.errors.push(...result.errors);
    }

    logger.info('Batch archive completed', {
      strategy: this.getStrategyName(),
      reports: reports.length,
      filesArchived: aggregateResult.filesArchived,
      bytesArchived: aggregateResult.bytesArchived,
      errors: aggregateResult.errors.length,
    });

    return aggregateResult;
  }

  /**
   * Get the archival strategy name
   */
  getStrategyName(): string {
    return 'deletion';
  }

  /**
   * Extract storage key from URL
   * @private
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
   * @private
   */
  private async getFileSize(key: string): Promise<number> {
    const object = await this.storage.headObject(key);
    return object?.size ?? 0;
  }
}
