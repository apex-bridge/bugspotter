/**
 * Network Logs Formatter Service
 * Formats network logs for Jira ticket attachments with filtering and redaction
 */

import { BaseLogsFormatter } from './base-logs-formatter.js';

// ============================================================================
// TYPES
// ============================================================================

export interface NetworkLogEntry {
  url: string;
  method: string;
  status: number;
  duration: number;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  error?: string;
}

export interface NetworkLogsOptions {
  failedOnly?: boolean; // Only include 4xx/5xx responses
  includeBodies?: boolean; // Include request/response bodies
  maxEntries?: number;
  redactHeaders?: string[]; // Headers to redact
  format?: 'text' | 'markdown' | 'json' | 'har';
}

export interface FormattedNetworkLogs {
  content: string;
  filename: string;
  mimeType: string;
  entryCount: number;
  filteredCount: number;
  failedCount: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_MAX_ENTRIES = 50;
const DEFAULT_FORMAT = 'text';
const MAX_BODY_SIZE = 10 * 1024; // 10KB

/**
 * Headers that contain sensitive data and should be redacted by default
 */
const DEFAULT_REDACTED_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
  'www-authenticate',
  'x-csrf-token',
  'x-xsrf-token',
];

// ============================================================================
// NETWORK LOGS FORMATTER SERVICE
// ============================================================================

export class NetworkLogsFormatter extends BaseLogsFormatter<NetworkLogEntry> {
  /**
   * Format network logs for Jira attachments
   */
  format(logs: NetworkLogEntry[], options: NetworkLogsOptions = {}): FormattedNetworkLogs {
    const failedOnly = options.failedOnly ?? false;
    const includeBodies = options.includeBodies ?? true;
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const redactHeaders = options.redactHeaders ?? DEFAULT_REDACTED_HEADERS;
    const format = options.format ?? DEFAULT_FORMAT;

    // Filter to failed requests if option set
    const filteredLogs = failedOnly ? logs.filter((log) => log.status >= 400) : logs;
    const filteredCount = logs.length - filteredLogs.length;

    // Take most recent entries (logs sorted by timestamp desc)
    const limitedLogs = this.limitEntries(filteredLogs, maxEntries);
    const entryCount = limitedLogs.length;

    // Calculate failed count
    const failedCount = limitedLogs.filter((log) => log.status >= 400).length;

    // Redact sensitive data
    const redactedLogs = this.redactSensitiveData(limitedLogs, redactHeaders, includeBodies);

    // Format based on output type
    let content: string;
    let filename: string;
    let mimeType: string;

    switch (format) {
      case 'markdown':
        content = this.formatAsMarkdown(redactedLogs, includeBodies);
        filename = 'network-logs.md';
        mimeType = 'text/markdown';
        break;
      case 'json':
        content = this.formatAsJson(redactedLogs, includeBodies);
        filename = 'network-logs.json';
        mimeType = 'application/json';
        break;
      case 'har':
        content = this.formatAsHar(redactedLogs);
        filename = 'network-logs.har';
        mimeType = 'application/json';
        break;
      case 'text':
      default:
        content = this.formatAsText(redactedLogs, includeBodies);
        filename = 'network-logs.txt';
        mimeType = 'text/plain';
        break;
    }

    return {
      content,
      filename,
      mimeType,
      entryCount,
      filteredCount,
      failedCount,
    };
  }

  // ============================================================================
  // REDACTION
  // ============================================================================

  private redactSensitiveData(
    logs: NetworkLogEntry[],
    redactHeaders: string[],
    includeBodies: boolean
  ): NetworkLogEntry[] {
    return logs.map((log) => ({
      ...log,
      url: this.redactUrl(log.url),
      requestHeaders: log.requestHeaders
        ? this.redactHeaders(log.requestHeaders, redactHeaders)
        : undefined,
      responseHeaders: log.responseHeaders
        ? this.redactHeaders(log.responseHeaders, redactHeaders)
        : undefined,
      requestBody:
        includeBodies && log.requestBody ? this.redactAndTruncateBody(log.requestBody) : undefined,
      responseBody:
        includeBodies && log.responseBody
          ? this.redactAndTruncateBody(log.responseBody)
          : undefined,
      error: log.error ? this.redactString(log.error) : undefined,
    }));
  }

  private redactUrl(url: string): string {
    // Redact sensitive patterns in URL (passwords, tokens, etc.)
    return this.redactString(url);
  }

  private redactHeaders(
    headers: Record<string, string>,
    redactList: string[]
  ): Record<string, string> {
    const redacted: Record<string, string> = {};
    const redactSet = new Set(redactList.map((h) => h.toLowerCase()));

    for (const [key, value] of Object.entries(headers)) {
      if (redactSet.has(key.toLowerCase())) {
        redacted[key] = '[REDACTED]';
      } else {
        // Still redact patterns in header values
        redacted[key] = this.redactString(value);
      }
    }

    return redacted;
  }

  private redactAndTruncateBody(body: string): string {
    // Truncate if too large
    let truncated = body;
    if (body.length > MAX_BODY_SIZE) {
      const totalSize = this.formatBytes(body.length);
      truncated = body.substring(0, MAX_BODY_SIZE);
      truncated += `\n\n[TRUNCATED - ${totalSize} total]`;
    }

    // Redact sensitive patterns
    return this.redactString(truncated);
  }

  // ============================================================================
  // TEXT FORMATTING
  // ============================================================================

  private formatAsText(logs: NetworkLogEntry[], includeBodies: boolean): string {
    if (logs.length === 0) {
      return 'No network requests logged.\n';
    }

    // Sort chronologically using base class helper
    const sorted = this.sortChronologically(logs);

    const lines: string[] = [];

    for (const log of sorted) {
      const timestamp = this.formatTimestamp(log.timestamp);
      const statusEmoji = this.getStatusEmoji(log.status);

      lines.push(
        `[${timestamp}] ${log.method} ${log.url} ${statusEmoji} ${log.status} (${log.duration}ms)`
      );

      // Request headers
      if (log.requestHeaders && Object.keys(log.requestHeaders).length > 0) {
        lines.push('  Request Headers:');
        for (const [key, value] of Object.entries(log.requestHeaders)) {
          lines.push(`    ${key}: ${value}`);
        }
      }

      // Request body
      if (includeBodies && log.requestBody) {
        lines.push('  Request Body:');
        lines.push(this.indentText(log.requestBody, 4));
      }

      // Response headers
      if (log.responseHeaders && Object.keys(log.responseHeaders).length > 0) {
        lines.push('  Response Headers:');
        for (const [key, value] of Object.entries(log.responseHeaders)) {
          lines.push(`    ${key}: ${value}`);
        }
      }

      // Response body
      if (includeBodies && log.responseBody) {
        lines.push('  Response Body:');
        lines.push(this.indentText(log.responseBody, 4));
      }

      // Error message
      if (log.error) {
        lines.push(`  Error: ${log.error}`);
      }

      lines.push(''); // Empty line between entries
    }

    return lines.join('\n');
  }

  // ============================================================================
  // MARKDOWN FORMATTING
  // ============================================================================

  private formatAsMarkdown(logs: NetworkLogEntry[], includeBodies: boolean): string {
    if (logs.length === 0) {
      return '## Network Logs\n\nNo network requests logged.\n';
    }

    const lines: string[] = [];

    // Header
    const failedCount = logs.filter((log) => log.status >= 400).length;
    lines.push(`## Network Logs (${logs.length} requests)\n`);

    if (failedCount > 0) {
      lines.push(`⚠️ **${failedCount} failed request${failedCount !== 1 ? 's' : ''}**\n`);
    }

    // Sort chronologically using base class helper
    const sorted = this.sortChronologically(logs);

    for (const log of sorted) {
      const timestamp = this.formatTimestamp(log.timestamp);
      const statusEmoji = this.getStatusEmoji(log.status);

      lines.push(`### ${statusEmoji} ${log.method} ${log.url}\n`);
      lines.push(
        `**Status:** ${log.status} | **Duration:** ${log.duration}ms | **Time:** ${timestamp}\n`
      );

      // Request headers
      if (log.requestHeaders && Object.keys(log.requestHeaders).length > 0) {
        lines.push('**Request Headers:**\n');
        lines.push('```');
        for (const [key, value] of Object.entries(log.requestHeaders)) {
          lines.push(`${key}: ${value}`);
        }
        lines.push('```\n');
      }

      // Request body
      if (includeBodies && log.requestBody) {
        lines.push('**Request Body:**\n');
        lines.push('```');
        lines.push(log.requestBody);
        lines.push('```\n');
      }

      // Response headers
      if (log.responseHeaders && Object.keys(log.responseHeaders).length > 0) {
        lines.push('**Response Headers:**\n');
        lines.push('```');
        for (const [key, value] of Object.entries(log.responseHeaders)) {
          lines.push(`${key}: ${value}`);
        }
        lines.push('```\n');
      }

      // Response body
      if (includeBodies && log.responseBody) {
        lines.push('**Response Body:**\n');
        lines.push('```');
        lines.push(log.responseBody);
        lines.push('```\n');
      }

      // Error message
      if (log.error) {
        lines.push(`**Error:** ${log.error}\n`);
      }

      lines.push('---\n');
    }

    return lines.join('\n');
  }

  // ============================================================================
  // JSON FORMATTING
  // ============================================================================

  private formatAsJson(logs: NetworkLogEntry[], includeBodies: boolean): string {
    // Sort chronologically using base class helper
    const sorted = this.sortChronologically(logs);

    const entries = sorted.map((log) => {
      const entry: Record<string, unknown> = {
        method: log.method,
        url: log.url,
        status: log.status,
        duration: log.duration,
        timestamp: log.timestamp,
        datetime: this.formatTimestamp(log.timestamp),
      };

      if (log.requestHeaders) {
        entry.requestHeaders = log.requestHeaders;
      }

      if (includeBodies && log.requestBody) {
        entry.requestBody = log.requestBody;
      }

      if (log.responseHeaders) {
        entry.responseHeaders = log.responseHeaders;
      }

      if (includeBodies && log.responseBody) {
        entry.responseBody = log.responseBody;
      }

      if (log.error) {
        entry.error = log.error;
      }

      return entry;
    });

    const failedCount = logs.filter((log) => log.status >= 400).length;
    const successCount = logs.length - failedCount;

    const output = {
      entries,
      summary: {
        total: logs.length,
        success: successCount,
        failed: failedCount,
      },
      metadata: {
        generatedAt: new Date().toISOString(),
      },
    };

    return JSON.stringify(output, null, 2);
  }

  // ============================================================================
  // HAR FORMATTING (HAR 1.2 Spec)
  // ============================================================================

  private formatAsHar(logs: NetworkLogEntry[]): string {
    // Sort chronologically using base class helper (HAR standard)
    const sorted = this.sortChronologically(logs);

    const entries = sorted.map((log) => {
      const startedDateTime = new Date(log.timestamp).toISOString();

      // Extract content types from headers
      const requestContentType = this.extractContentType(log.requestHeaders);
      const responseContentType = this.extractContentType(log.responseHeaders);

      return {
        startedDateTime,
        time: log.duration,
        request: {
          method: log.method,
          url: log.url,
          httpVersion: 'HTTP/1.1',
          headers: this.formatHarHeaders(log.requestHeaders),
          queryString: [],
          cookies: [],
          headersSize: -1,
          bodySize: log.requestBody ? log.requestBody.length : -1,
          ...(log.requestBody && {
            postData: {
              mimeType: requestContentType,
              text: log.requestBody,
            },
          }),
        },
        response: {
          status: log.status,
          statusText: this.getStatusText(log.status),
          httpVersion: 'HTTP/1.1',
          headers: this.formatHarHeaders(log.responseHeaders),
          cookies: [],
          content: {
            size: log.responseBody ? log.responseBody.length : 0,
            mimeType: responseContentType,
            ...(log.responseBody && { text: log.responseBody }),
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: log.responseBody ? log.responseBody.length : -1,
        },
        cache: {},
        timings: {
          send: 0,
          wait: log.duration,
          receive: 0,
        },
        ...(log.error && { _error: log.error }),
      };
    });

    const har = {
      log: {
        version: '1.2',
        creator: {
          name: 'BugSpotter',
          version: '1.0.0',
        },
        pages: [],
        entries,
      },
    };

    return JSON.stringify(har, null, 2);
  }

  private formatHarHeaders(
    headers?: Record<string, string>
  ): Array<{ name: string; value: string }> {
    if (!headers) {
      return [];
    }

    return Object.entries(headers).map(([name, value]) => ({ name, value }));
  }

  /**
   * Extract Content-Type from headers, stripping charset and parameters
   * Falls back to application/json if not found
   */
  private extractContentType(headers?: Record<string, string>): string {
    if (!headers) {
      return 'application/json';
    }

    // Look for content-type header (case-insensitive)
    const contentTypeKey = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type');

    if (!contentTypeKey) {
      return 'application/json';
    }

    const contentType = headers[contentTypeKey];

    // Strip charset and other parameters (e.g., "application/json; charset=utf-8" -> "application/json")
    const mimeType = contentType.split(';')[0].trim();

    return mimeType || 'application/json';
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private getStatusEmoji(status: number): string {
    if (status >= 200 && status < 300) {
      return '✓';
    }
    if (status >= 300 && status < 400) {
      return '↗';
    }
    if (status >= 400 && status < 500) {
      return '✗';
    }
    if (status >= 500) {
      return '⚠';
    }
    return '?';
  }

  private getStatusText(status: number): string {
    const statusTexts: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };

    return statusTexts[status] || 'Unknown';
  }
}
