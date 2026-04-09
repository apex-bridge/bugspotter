/**
 * Session Service
 * Handles fetching and processing session data (replay events, metadata)
 * Single Responsibility: Session data aggregation and transformation
 */

import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import type { IStorageService } from '../storage/types.js';
import type { BugReport } from '../db/types.js';
import { bugReportMetadataSchema } from '../api/schemas/metadata-schema.js';
import type { BugReportMetadata } from '../api/types/bug-report-types.js';
import type { RRWebEvent } from '@bugspotter/types';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * Session response structure matching frontend expectations
 */
export interface Session {
  id: string;
  bug_report_id: string;
  events: {
    type: 'rrweb' | 'metadata';
    recordedEvents?: RRWebEvent[];
    console?: unknown[];
    network?: unknown[];
    metadata?: unknown;
  };
  duration: number | null;
  created_at: string | Date;
}

export class SessionService {
  constructor(private readonly storage: IStorageService) {}

  /**
   * Fetch and decompress replay data from R2 storage using streaming decompression
   * Memory-efficient: streams decompression without buffering entire compressed file
   * @param replayKey - Storage key for the replay file (e.g., "replays/.../replay.gz")
   * @returns Array of rrweb events, or null if fetch/decompress fails
   */
  private async fetchReplayData(replayKey: string): Promise<RRWebEvent[] | null> {
    try {
      // Fetch the .gz file from R2 storage
      const stream = await this.storage.getObject(replayKey);

      // Create gunzip transform stream for streaming decompression
      const gunzip = createGunzip();

      // Collect decompressed chunks (still more efficient than buffering compressed data)
      const chunks: Buffer[] = [];

      gunzip.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      // Stream through decompression pipeline
      await pipeline(stream, gunzip);

      // Concatenate decompressed data
      const decompressed = Buffer.concat(chunks);

      // Parse JSON to get rrweb events
      const replayData = JSON.parse(decompressed.toString('utf-8'));

      // Validate it's an array
      if (!Array.isArray(replayData)) {
        logger.warn('Replay data is not an array', { replayKey });
        return null;
      }

      if (replayData.length === 0) {
        logger.warn('Replay data is empty', { replayKey });
      }

      return replayData;
    } catch (error) {
      logger.error('Failed to fetch or decompress replay data', {
        replayKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a replay session from rrweb events
   * @param bugReport - Bug report containing replay metadata
   * @returns Session with rrweb events, or null if replay unavailable
   */
  private async buildReplaySession(bugReport: BugReport): Promise<Session | null> {
    if (!bugReport.replay_key || bugReport.replay_upload_status !== 'completed') {
      return null;
    }

    const recordedEvents = await this.fetchReplayData(bugReport.replay_key);

    if (!recordedEvents || recordedEvents.length === 0) {
      return null;
    }

    return {
      id: `${bugReport.id}-replay`,
      bug_report_id: bugReport.id,
      events: {
        type: 'rrweb',
        recordedEvents,
      },
      duration: null, // Could calculate from events if needed
      created_at: bugReport.created_at,
    };
  }

  /**
   * Create a metadata session from console/network logs
   * @param bugReport - Bug report containing metadata
   * @returns Session with metadata, or null if no metadata available
   */
  private buildMetadataSession(bugReport: BugReport): Session | null {
    const metadata = bugReport.metadata as BugReportMetadata;

    // Check if there's any useful metadata (console, network, or nested metadata)
    if (!metadata) {
      return null;
    }

    const hasConsole = metadata.console && metadata.console.length > 0;
    const hasNetwork = metadata.network && metadata.network.length > 0;
    const hasNestedMetadata = metadata.metadata && Object.keys(metadata.metadata).length > 0;

    // Return null if there's no useful data at all
    if (!hasConsole && !hasNetwork && !hasNestedMetadata) {
      return null;
    }

    // Validate metadata structure using Zod schema
    const validationResult = bugReportMetadataSchema.safeParse(metadata);
    if (!validationResult.success) {
      logger.warn('Invalid metadata structure', {
        bugReportId: bugReport.id,
        errors: validationResult.error.errors,
      });

      // Continue with partial data for validation errors (graceful degradation)
      // This allows sessions with only console or network data
    }

    return {
      id: `${bugReport.id}-metadata`,
      bug_report_id: bugReport.id,
      events: {
        type: 'metadata',
        console: metadata.console || [],
        network: metadata.network || [],
        metadata: metadata.metadata || {},
      },
      duration: null,
      created_at: bugReport.created_at,
    };
  }

  /**
   * Check if bug report has shareable content (replay or metadata)
   * Lightweight check without fetching actual replay data
   * @param bugReport - Bug report to check
   * @returns True if bug report has a replay file or valid metadata
   */
  hasShareableContent(bugReport: BugReport): boolean {
    // Check for replay file (even if upload not marked complete - for test scenarios)
    if (bugReport.replay_key) {
      return true;
    }

    // Check for valid metadata - use type-safe checks without strict Zod validation
    if (!bugReport.metadata || typeof bugReport.metadata !== 'object') {
      return false;
    }

    const metadata = bugReport.metadata as Record<string, unknown>;

    // Check for any useful data
    const hasConsole = Array.isArray(metadata.console) && metadata.console.length > 0;
    const hasNetwork = Array.isArray(metadata.network) && metadata.network.length > 0;
    const hasNestedMetadata = Boolean(
      metadata.metadata &&
        typeof metadata.metadata === 'object' &&
        Object.keys(metadata.metadata).length > 0
    );

    return hasConsole || hasNetwork || hasNestedMetadata;
  }

  /**
   * Get all sessions for a bug report (replay + metadata)
   * @param bugReport - Bug report to extract sessions from
   * @returns Array of sessions (may be empty)
   */
  async getSessions(bugReport: BugReport): Promise<Session[]> {
    const sessions: Session[] = [];

    // 1. Add replay session if available
    const replaySession = await this.buildReplaySession(bugReport);
    if (replaySession) {
      sessions.push(replaySession);
    }

    // 2. Add metadata session if available
    const metadataSession = this.buildMetadataSession(bugReport);
    if (metadataSession) {
      sessions.push(metadataSession);
    }

    return sessions;
  }
}
