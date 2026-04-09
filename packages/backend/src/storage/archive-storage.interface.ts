/**
 * Storage Archive Interface
 * Defines contract for archiving storage objects (screenshots, replays, attachments)
 *
 * Implementations can choose different strategies:
 * - Immediate deletion (free space now)
 * - Move to archive/ prefix with lifecycle policy
 * - Transition to Glacier/Deep Archive
 * - Copy to separate archive bucket
 * - Keep in place with metadata tagging
 */

export interface ArchiveResult {
  filesArchived: number;
  bytesArchived: number;
  errors: Array<{ key: string; error: string }>;
}

export interface ReportFiles {
  screenshotUrl: string | null;
  replayUrl: string | null;
}

/**
 * IStorageArchiver - Interface for storage archival strategies
 */
export interface IStorageArchiver {
  /**
   * Archive storage files for a single bug report
   *
   * @param screenshotUrl - Screenshot URL to archive
   * @param replayUrl - Replay URL to archive
   * @returns Archive result with counts and errors
   */
  archiveReportFiles(
    screenshotUrl: string | null,
    replayUrl: string | null
  ): Promise<ArchiveResult>;

  /**
   * Archive storage files for multiple bug reports in batch
   *
   * @param reports - Array of report file URLs
   * @returns Aggregate archive result
   */
  archiveBatch(reports: ReportFiles[]): Promise<ArchiveResult>;

  /**
   * Get the archival strategy name (for logging/monitoring)
   */
  getStrategyName(): string;
}
