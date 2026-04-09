/**
 * Shared capture types used by both SDK and API
 * These types represent the data captured by the SDK in the browser
 */

/**
 * Console log entry captured from browser console
 */
export interface ConsoleLog {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  message: string;
  timestamp: number;
  stack?: string;
}

/**
 * Network request captured from browser
 */
export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  duration: number;
  timestamp: number;
  error?: string;
}

/**
 * Browser metadata captured at the time of bug report
 */
export interface BrowserMetadata {
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
  browser: string;
  os: string;
  url: string;
  timestamp: number;
}

/**
 * rrweb event structure
 * Used for session replay - type is a numeric enum according to rrweb specification
 */
export interface RRWebEvent {
  type: number;
  data?: unknown;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Complete captured report from the browser
 * This is the core data structure that flows from SDK to API
 */
export interface CapturedReport {
  screenshot: string;
  console: ConsoleLog[];
  network: NetworkRequest[];
  metadata: BrowserMetadata;
}
