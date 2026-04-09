/**
 * Bug Report API Types
 * Request/response type definitions for bug report routes
 */

import type { BugStatus, BugPriority } from '@bugspotter/types';

/**
 * Console log entry structure
 */
export interface ConsoleLogEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  args?: unknown[];
}

/**
 * Network request entry structure
 */
export interface NetworkRequestEntry {
  url: string;
  method: string;
  status: number;
  statusText?: string;
  duration?: number;
  timestamp: number;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Browser metadata structure
 */
export interface BrowserMetadata {
  userAgent: string;
  viewport: { width: number; height: number };
  url: string;
  timestamp: number;
  platform?: string;
  language?: string;
  screen?: { width: number; height: number };
  timezone?: string;
}

/**
 * Bug report metadata structure (stored in JSONB column)
 */
export interface BugReportMetadata {
  console?: ConsoleLogEntry[];
  network?: NetworkRequestEntry[];
  metadata?: BrowserMetadata;
  [key: string]: unknown; // Allow additional fields for extensibility
}

/**
 * Request body for creating a new bug report
 */
export interface CreateReportBody {
  project_id?: string;
  title: string;
  description?: string;
  priority?: BugPriority;
  source?: 'extension' | 'sdk' | 'api';
  report: {
    console?: ConsoleLogEntry[];
    network?: NetworkRequestEntry[];
    metadata?: BrowserMetadata;
    // Presigned URL flow - storage keys (legacy)
    screenshotKey?: string | null;
    replayKey?: string | null;
  };
  // Optimized flow - SDK tells us what files it has
  hasScreenshot?: boolean;
  hasReplay?: boolean;
}

/**
 * Request body for updating an existing bug report
 */
export interface UpdateReportBody {
  status?: BugStatus;
  priority?: BugPriority;
  description?: string;
  resolution_notes?: string;
}

/**
 * Query parameters for listing bug reports
 */
export interface ListReportsQuery {
  page?: number;
  limit?: number;
  status?: BugStatus;
  priority?: BugPriority;
  project_id?: string;
  created_after?: string;
  created_before?: string;
  sort_by?: 'created_at' | 'updated_at' | 'priority';
  order?: 'asc' | 'desc';
}
