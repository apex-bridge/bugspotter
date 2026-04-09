/**
 * Metadata extraction utilities for custom plugins
 * Parse and structure bug report metadata for ticket creation
 */

export interface BugReportMetadata {
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  viewport?: string;
  url?: string;
  userAgent?: string;
  console?: Array<{
    level?: string;
    message?: string;
    timestamp?: string;
  }>;
  network?: Array<{
    method?: string;
    url?: string;
    status?: number;
    statusText?: string;
  }>;
  [key: string]: any;
}

export interface Environment {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  viewport: string;
  url: string;
  userAgent: string;
}

export interface ConsoleLog {
  level: string;
  message: string;
  timestamp: string;
}

export interface NetworkError {
  method: string;
  url: string;
  status: number;
  statusText: string;
}

/**
 * Extract structured environment data from bug report metadata
 * @param metadata - Bug report metadata
 * @returns Structured environment object with defaults for missing fields
 * @example
 * const env = extractEnvironment(bugReport.metadata);
 * // Returns: { browser: "Chrome", os: "Windows", ... }
 */
export function extractEnvironment(metadata?: BugReportMetadata | null): Environment {
  if (!metadata) {
    return {
      browser: 'Unknown',
      browserVersion: 'Unknown',
      os: 'Unknown',
      osVersion: 'Unknown',
      viewport: 'Unknown',
      url: 'Unknown',
      userAgent: 'Unknown',
    };
  }

  return {
    browser: metadata.browser || 'Unknown',
    browserVersion: metadata.browserVersion || 'Unknown',
    os: metadata.os || 'Unknown',
    osVersion: metadata.osVersion || 'Unknown',
    viewport: metadata.viewport || 'Unknown',
    url: metadata.url || 'Unknown',
    userAgent: metadata.userAgent || 'Unknown',
  };
}

/**
 * Extract and format console logs from bug report metadata
 * @param metadata - Bug report metadata
 * @param limit - Maximum number of logs to return (most recent)
 * @returns Array of structured console logs
 * @example
 * const logs = extractConsoleLogs(bugReport.metadata, 10);
 * // Returns last 10 console logs
 */
export function extractConsoleLogs(metadata?: BugReportMetadata | null, limit = 10): ConsoleLog[] {
  if (!metadata?.console || metadata.console.length === 0) {
    return [];
  }

  return metadata.console.slice(-limit).map((log) => ({
    level: log.level || 'log',
    message: log.message || '',
    timestamp: log.timestamp || '',
  }));
}

/**
 * Extract failed network requests from bug report metadata
 * @param metadata - Bug report metadata
 * @returns Array of network requests with status >= 400
 * @example
 * const errors = extractNetworkErrors(bugReport.metadata);
 * // Returns only failed requests (4xx, 5xx)
 */
export function extractNetworkErrors(metadata?: BugReportMetadata | null): NetworkError[] {
  if (!metadata?.network || metadata.network.length === 0) {
    return [];
  }

  return metadata.network
    .filter((req) => req.status && req.status >= 400)
    .map((req) => ({
      method: req.method || 'GET',
      url: req.url || '',
      status: req.status || 0,
      statusText: req.statusText || '',
    }));
}
