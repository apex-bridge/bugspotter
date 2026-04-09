/**
 * Type definitions for console and network log entries
 * shared across session replay components
 */

export interface ConsoleLogEntry {
  level: 'error' | 'warn' | 'info' | 'log';
  message: string;
  timestamp: number;
  args?: unknown[];
}

export interface NetworkLogEntry {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  duration?: number;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}
