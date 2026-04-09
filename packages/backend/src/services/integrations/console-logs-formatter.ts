/**
 * Console Logs Formatter Service
 * Formats console logs for Jira ticket attachments with redaction and filtering
 */

import { isSensitiveKey } from '@bugspotter/utils';
import { BaseLogsFormatter } from './base-logs-formatter.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ConsoleLogEntry {
  level: 'error' | 'warn' | 'info' | 'log' | 'debug';
  message: string;
  timestamp: number;
  stack?: string;
  args?: unknown[];
}

export interface ConsoleLogsOptions {
  levels?: ('error' | 'warn' | 'info' | 'log' | 'debug')[];
  maxEntries?: number;
  format?: 'text' | 'markdown' | 'json';
}

export interface FormattedLogs {
  content: string;
  filename: string;
  mimeType: string;
  entryCount: number;
  filteredCount: number;
}

type LogLevel = ConsoleLogEntry['level'];

interface LogSummary {
  error: number;
  warn: number;
  info: number;
  log: number;
  debug: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'log', 'debug'];
const DEFAULT_FORMAT = 'text';

// ============================================================================
// CONSOLE LOGS FORMATTER SERVICE
// ============================================================================

export class ConsoleLogsFormatter extends BaseLogsFormatter<ConsoleLogEntry> {
  /**
   * Format console logs for Jira attachments
   */
  format(logs: ConsoleLogEntry[], options: ConsoleLogsOptions = {}): FormattedLogs {
    const levels = options.levels ?? DEFAULT_LEVELS;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const format = options.format ?? DEFAULT_FORMAT;

    // Filter by levels
    const filteredLogs = this.filterByLevels(logs, levels);
    const filteredCount = logs.length - filteredLogs.length;

    // Take most recent entries (logs are sorted by timestamp desc)
    const limitedLogs = this.limitEntries(filteredLogs, maxEntries);
    const entryCount = limitedLogs.length;

    // Redact sensitive data
    const redactedLogs = this.redactSensitiveData(limitedLogs);

    // Format based on output type
    let content: string;
    let filename: string;
    let mimeType: string;

    switch (format) {
      case 'markdown':
        content = this.formatAsMarkdown(redactedLogs);
        filename = 'console-logs.md';
        mimeType = 'text/markdown';
        break;
      case 'json':
        content = this.formatAsJson(redactedLogs);
        filename = 'console-logs.json';
        mimeType = 'application/json';
        break;
      case 'text':
      default:
        content = this.formatAsText(redactedLogs);
        filename = 'console-logs.txt';
        mimeType = 'text/plain';
        break;
    }

    return {
      content,
      filename,
      mimeType,
      entryCount,
      filteredCount,
    };
  }

  // ============================================================================
  // FILTERING
  // ============================================================================

  private filterByLevels(logs: ConsoleLogEntry[], levels: LogLevel[]): ConsoleLogEntry[] {
    const levelSet = new Set(levels);
    return logs.filter((log) => levelSet.has(log.level));
  }

  // ============================================================================
  // REDACTION
  // ============================================================================

  private redactSensitiveData(logs: ConsoleLogEntry[]): ConsoleLogEntry[] {
    return logs.map((log) => ({
      ...log,
      message: this.redactString(log.message),
      stack: log.stack ? this.redactString(log.stack) : undefined,
      args: log.args ? this.redactArgs(log.args) : undefined,
    }));
  }

  private redactArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (typeof arg === 'string') {
        return this.redactString(arg);
      }
      if (typeof arg === 'object' && arg !== null) {
        return this.redactObject(arg);
      }
      return arg;
    });
  }

  private redactObject(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item));
    }

    if (typeof obj === 'object' && obj !== null) {
      const redacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        // Redact sensitive keys using shared utility
        if (isSensitiveKey(key)) {
          redacted[key] = '[REDACTED]';
        } else if (typeof value === 'string') {
          redacted[key] = this.redactString(value);
        } else if (typeof value === 'object' && value !== null) {
          redacted[key] = this.redactObject(value);
        } else {
          redacted[key] = value;
        }
      }
      return redacted;
    }

    return obj;
  }

  // ============================================================================
  // TEXT FORMATTING
  // ============================================================================

  private formatAsText(logs: ConsoleLogEntry[]): string {
    if (logs.length === 0) {
      return 'No console logs available.\n';
    }

    // Sort chronologically using base class helper
    const sorted = this.sortChronologically(logs);

    const lines: string[] = [];

    for (const log of sorted) {
      const timestamp = this.formatTimestamp(log.timestamp);
      const level = log.level.toUpperCase().padEnd(5);
      const message = log.message;

      lines.push(`[${timestamp}] ${level}: ${message}`);

      // Add stack trace if present
      if (log.stack) {
        const stackLines = log.stack.split('\n').map((line) => `    ${line}`);
        lines.push(...stackLines);
      }

      // Add extra arguments if present
      if (log.args && log.args.length > 0) {
        const argsStr = log.args.map((arg) => this.stringifyArg(arg)).join(', ');
        lines.push(`    Args: ${argsStr}`);
      }

      lines.push(''); // Empty line between entries
    }

    return lines.join('\n');
  }

  // ============================================================================
  // MARKDOWN FORMATTING
  // ============================================================================

  private formatAsMarkdown(logs: ConsoleLogEntry[]): string {
    if (logs.length === 0) {
      return '## Console Logs\n\nNo console logs available.\n';
    }

    const summary = this.calculateSummary(logs);
    const lines: string[] = [];

    // Header
    lines.push(`## Console Logs (${logs.length} entries)\n`);

    // Group by level (error, warn, info, log, debug)
    const grouped = this.groupByLevel(logs);

    for (const level of ['error', 'warn', 'info', 'log', 'debug'] as LogLevel[]) {
      const levelLogs = grouped[level];
      if (!levelLogs || levelLogs.length === 0) {
        continue;
      }

      const levelTitle = this.getLevelTitle(level);
      lines.push(`### ${levelTitle} (${levelLogs.length})\n`);

      // Sort chronologically using base class helper
      const sorted = this.sortChronologically(levelLogs);

      for (const log of sorted) {
        const time = this.formatTime(log.timestamp);
        lines.push(`**${time}** - ${log.message}\n`);

        if (log.stack) {
          lines.push('```');
          lines.push(log.stack);
          lines.push('```\n');
        }

        if (log.args && log.args.length > 0) {
          const argsStr = log.args.map((arg) => this.stringifyArg(arg)).join(', ');
          lines.push(`*Arguments:* ${argsStr}\n`);
        }
      }
    }

    // Summary at the end
    lines.push('---\n');
    lines.push('### Summary\n');
    lines.push(`- Errors: ${summary.error}`);
    lines.push(`- Warnings: ${summary.warn}`);
    lines.push(`- Info: ${summary.info}`);
    lines.push(`- Log: ${summary.log}`);
    lines.push(`- Debug: ${summary.debug}`);

    return lines.join('\n');
  }

  // ============================================================================
  // JSON FORMATTING
  // ============================================================================

  private formatAsJson(logs: ConsoleLogEntry[]): string {
    const summary = this.calculateSummary(logs);

    // Sort chronologically using base class helper
    const sorted = this.sortChronologically(logs);

    const output = {
      entries: sorted.map((log) => ({
        level: log.level,
        message: log.message,
        timestamp: log.timestamp,
        datetime: this.formatTimestamp(log.timestamp),
        stack: log.stack,
        args: log.args,
      })),
      summary,
      metadata: {
        totalEntries: logs.length,
        generatedAt: new Date().toISOString(),
      },
    };

    return JSON.stringify(output, null, 2);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private groupByLevel(logs: ConsoleLogEntry[]): Record<LogLevel, ConsoleLogEntry[]> {
    const grouped: Record<LogLevel, ConsoleLogEntry[]> = {
      error: [],
      warn: [],
      info: [],
      log: [],
      debug: [],
    };

    for (const log of logs) {
      grouped[log.level].push(log);
    }

    return grouped;
  }

  private calculateSummary(logs: ConsoleLogEntry[]): LogSummary {
    const summary: LogSummary = {
      error: 0,
      warn: 0,
      info: 0,
      log: 0,
      debug: 0,
    };

    for (const log of logs) {
      summary[log.level]++;
    }

    return summary;
  }

  private formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toTimeString().substring(0, 8);
  }

  private getLevelTitle(level: LogLevel): string {
    switch (level) {
      case 'error':
        return 'Errors';
      case 'warn':
        return 'Warnings';
      case 'info':
        return 'Info';
      case 'log':
        return 'Logs';
      case 'debug':
        return 'Debug';
    }
  }

  private stringifyArg(arg: unknown): string {
    if (arg === null) {
      return 'null';
    }
    if (arg === undefined) {
      return 'undefined';
    }
    if (typeof arg === 'string') {
      return arg;
    }
    if (typeof arg === 'number' || typeof arg === 'boolean') {
      return String(arg);
    }
    try {
      return JSON.stringify(arg);
    } catch {
      return '[Object]';
    }
  }
}
