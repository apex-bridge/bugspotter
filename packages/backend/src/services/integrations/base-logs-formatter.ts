/**
 * Base Logs Formatter
 * Shared formatting utilities for console and network log formatters
 *
 * Applies SOLID principles:
 * - Single Responsibility: Each method has one clear purpose
 * - Open/Closed: Extensible via inheritance without modification
 * - DRY: Eliminates code duplication across formatters
 */

import { ALL_REDACTION_PATTERNS } from '@bugspotter/utils';

/**
 * Base interface for log entries (common properties)
 */
export interface BaseLogEntry {
  timestamp: number;
}

/**
 * Abstract base class for log formatters
 * Provides shared utilities for redaction, formatting, and limiting entries
 */
export abstract class BaseLogsFormatter<TEntry extends BaseLogEntry> {
  // ============================================================================
  // SHARED REDACTION
  // ============================================================================

  /**
   * Redact sensitive data from string using shared patterns
   * @param text - Text to redact
   * @returns Redacted text with patterns replaced
   */
  protected redactString(text: string): string {
    let redacted = text;

    for (const { pattern, replacement } of ALL_REDACTION_PATTERNS) {
      redacted = redacted.replace(pattern, replacement);
    }

    return redacted;
  }

  // ============================================================================
  // SHARED LIMITING
  // ============================================================================

  /**
   * Limit log entries to maximum count, taking most recent entries first
   * @param logs - Log entries to limit
   * @param maxEntries - Maximum number of entries to return
   * @returns Limited log entries
   */
  protected limitEntries(logs: TEntry[], maxEntries: number): TEntry[] {
    if (logs.length <= maxEntries) {
      return logs;
    }

    // Sort by timestamp descending (most recent first) and take max entries
    const sorted = [...logs].sort((a, b) => b.timestamp - a.timestamp);
    return sorted.slice(0, maxEntries);
  }

  /**
   * Sort log entries chronologically (oldest first)
   * Standard for log files and debugging workflows
   * @param logs - Log entries to sort
   * @returns Sorted log entries in chronological order
   */
  protected sortChronologically(logs: TEntry[]): TEntry[] {
    return [...logs].sort((a, b) => a.timestamp - b.timestamp);
  }

  // ============================================================================
  // SHARED FORMATTING
  // ============================================================================

  /**
   * Format timestamp as ISO-like string without milliseconds
   * @param timestamp - Unix timestamp in milliseconds
   * @returns Formatted timestamp (YYYY-MM-DD HH:MM:SS)
   */
  protected formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toISOString().replace('T', ' ').substring(0, 19);
  }

  /**
   * Indent multi-line text with spaces
   * @param text - Text to indent
   * @param spaces - Number of spaces to indent
   * @returns Indented text
   */
  protected indentText(text: string, spaces: number): string {
    const indent = ' '.repeat(spaces);
    return text
      .split('\n')
      .map((line) => indent + line)
      .join('\n');
  }

  /**
   * Format byte size in human-readable format
   * @param bytes - Number of bytes
   * @returns Formatted size (e.g., "1.5KB", "2.3MB")
   */
  protected formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes}B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)}KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
}
