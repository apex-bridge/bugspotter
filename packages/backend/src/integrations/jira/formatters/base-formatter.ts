/**
 * Base Jira Description Formatter
 * Abstract strategy for formatting Jira descriptions
 */

import type { BugReport } from '../../../db/types.js';
import type { JiraDescriptionNode } from '../types.js';

/**
 * Console log entry structure from metadata
 */
export interface ConsoleLogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  args?: unknown[];
}

/**
 * Network log entry structure from metadata
 */
export interface NetworkLogEntry {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  timestamp: number;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

/**
 * Type guard for ConsoleLogEntry
 */
export function isConsoleLogEntry(obj: unknown): obj is ConsoleLogEntry {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const entry = obj as Record<string, unknown>;
  return (
    typeof entry.level === 'string' &&
    ['log', 'info', 'warn', 'error', 'debug'].includes(entry.level) &&
    typeof entry.message === 'string' &&
    typeof entry.timestamp === 'number'
  );
}

/**
 * Type guard for NetworkLogEntry
 */
export function isNetworkLogEntry(obj: unknown): obj is NetworkLogEntry {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const entry = obj as Record<string, unknown>;
  return (
    typeof entry.method === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.timestamp === 'number' &&
    (entry.status === undefined || typeof entry.status === 'number') &&
    (entry.duration === undefined || typeof entry.duration === 'number')
  );
}

/**
 * Abstract strategy for formatting Jira descriptions
 */
export abstract class JiraDescriptionFormatter {
  /**
   * Format console logs section
   */
  public formatConsoleLogs(
    entries: ConsoleLogEntry[],
    errorCount: number,
    warningCount: number
  ): string | JiraDescriptionNode[] {
    if (!entries.length) {
      return this.emptyContent();
    }

    const logLines = entries.map((log) => {
      const timestamp = this.formatLogTimestamp(log.timestamp);
      const level = log.level.toUpperCase().padEnd(5);
      return `[${timestamp}] ${level} ${log.message}`;
    });

    const summary = `Last ${entries.length} console entries (${errorCount} errors, ${warningCount} warnings)`;
    return this.createSection('🖥️ Console Logs', summary, logLines);
  }

  /**
   * Format network logs section
   */
  public formatNetworkLogs(entries: NetworkLogEntry[]): string | JiraDescriptionNode[] {
    if (!entries.length) {
      return this.emptyContent();
    }

    const logLines = entries.map((log) => {
      const timestamp = this.formatLogTimestamp(log.timestamp);
      const status = log.status || '---';
      const duration = log.duration ? ` (${log.duration}ms)` : '';
      return `[${timestamp}] ${log.method} ${log.url} → ${status}${duration}`;
    });

    const summary = `Last ${entries.length} network requests`;
    return this.createSection('🌐 Network Logs', summary, logLines);
  }

  /**
   * Format bug report details section
   */
  public formatBugReportDetails(bugReport: BugReport): string | JiraDescriptionNode[] {
    const fields: Array<{ label: string; value: string }> = [
      { label: 'Bug Report ID', value: bugReport.id },
      { label: 'Status', value: bugReport.status.toUpperCase() },
      { label: 'Created', value: bugReport.created_at.toISOString() },
    ];

    // Extract common metadata fields
    if (bugReport.metadata && typeof bugReport.metadata === 'object') {
      const metadata = bugReport.metadata as Record<string, unknown>;

      // Browser (special case - object format)
      if (metadata.browser && this.isBrowserMetadata(metadata.browser)) {
        const browser = metadata.browser as { name?: string; version?: string };
        const browserText = `${browser.name || 'Unknown'} ${browser.version || ''}`.trim();
        fields.push({ label: 'Browser', value: browserText });
      }

      // Report source and API key
      if (typeof metadata.source === 'string' && metadata.source) {
        fields.push({ label: 'Source', value: metadata.source });
      }
      if (typeof metadata.apiKeyPrefix === 'string' && metadata.apiKeyPrefix) {
        fields.push({ label: 'API Key', value: `${metadata.apiKeyPrefix}...` });
      }

      // Common string metadata fields
      const metadataFieldMap: Array<{ key: string; label: string }> = [
        { key: 'os', label: 'OS' },
        { key: 'screen', label: 'Screen' },
        { key: 'userAgent', label: 'User Agent' },
        { key: 'url', label: 'URL' },
      ];

      for (const { key, label } of metadataFieldMap) {
        if (typeof metadata[key] === 'string' && metadata[key]) {
          fields.push({ label, value: metadata[key] as string });
        }
      }
    }

    return this.createDetailsSection('Bug Report Details', fields);
  }

  /**
   * Format attachments section
   */
  public formatAttachments(
    bugReport: BugReport,
    shareReplayUrl?: string
  ): string | JiraDescriptionNode[] {
    const links: Array<{ label: string; url: string }> = [];

    if (bugReport.screenshot_url) {
      links.push({ label: '📸 Screenshot', url: bugReport.screenshot_url });
    }

    const replayUrl = shareReplayUrl || bugReport.replay_url;
    if (replayUrl) {
      const label = shareReplayUrl ? '🎥 Session Replay (Shared)' : '🎥 Session Replay';
      links.push({ label, url: replayUrl });
    }

    if (links.length === 0) {
      return this.emptyContent();
    }

    return this.createAttachmentsSection('Attachments', links);
  }

  /**
   * Format log timestamp to ISO string
   */
  protected formatLogTimestamp(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  /**
   * Type guard for browser metadata
   */
  protected isBrowserMetadata(obj: unknown): obj is { name?: string; version?: string } {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }
    const browser = obj as Record<string, unknown>;
    return (
      (browser.name === undefined || typeof browser.name === 'string') &&
      (browser.version === undefined || typeof browser.version === 'string')
    );
  }

  // Abstract methods that subclasses must implement
  protected abstract emptyContent(): string | JiraDescriptionNode[];
  protected abstract createSection(
    heading: string,
    summary: string,
    logLines: string[]
  ): string | JiraDescriptionNode[];
  protected abstract createDetailsSection(
    heading: string,
    fields: Array<{ label: string; value: string }>
  ): string | JiraDescriptionNode[];
  protected abstract createAttachmentsSection(
    heading: string,
    links: Array<{ label: string; url: string }>
  ): string | JiraDescriptionNode[];
  public abstract addDescription(description: string): string | JiraDescriptionNode[];
  public abstract addFooter(): string | JiraDescriptionNode[];
}
