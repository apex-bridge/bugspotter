/**
 * Integration Plugin System
 * Defines interfaces for creating pluggable integrations
 */

import type { DatabaseClient } from '../db/client.js';
import type { IStorageService } from '../storage/types.js';
import type { IntegrationService } from './base-integration.service.js';

/**
 * Integration configuration returned by getIntegrationConfig
 */
export interface IntegrationConfig {
  host?: string;
  email?: string;
  apiToken?: string;
  projectKey?: string;
  issueType?: string;
  [key: string]: unknown; // Allow custom fields
}

/**
 * Plugin context - dependencies injected into each plugin
 *
 * SECURITY NOTE: projectId must be set per-request for proper access control.
 * - Built-in plugins: Ignore context.projectId, use projectId parameter from createFromBugReport()
 * - Custom plugins: Per-project context created in PluginRegistry.loadFromDatabase()
 *
 * WARNING: Never use context.projectId from the shared registry context - it's empty!
 */
export interface PluginContext {
  // Project scope (auto-set for custom plugins)
  projectId: string; // Empty in shared context, set per-project for custom plugins
  platform: string; // Current platform identifier

  // High-level helpers (recommended for custom plugins)
  getIntegrationConfig(): Promise<IntegrationConfig>;
  getBugReport(bugReportId: string): Promise<import('../db/types.js').BugReport>;
  createTicket(data: {
    bug_report_id: string;
    external_id: string;
    external_url: string;
    metadata?: Record<string, unknown>;
  }): Promise<import('../db/types.js').Ticket>;
  logSyncEvent(
    action: 'test' | 'create' | 'update' | 'sync',
    status: 'success' | 'failed',
    metadata?: { duration_ms?: number; error?: string }
  ): Promise<void>;

  // Raw access for advanced cases (escape hatch)
  db: DatabaseClient;
  storage: IStorageService;
}

/**
 * Restricted plugin context for untrusted custom plugins
 * Provides limited, audited access without direct database/storage access
 */
export interface RestrictedPluginContext {
  // Metadata only - no direct database access
  platform: string;
  // HTTP client with logging and rate limiting
  http: {
    fetch(url: string, options?: RequestInit): Promise<Response>;
  };
  // Logging (all logs are audited)
  log: {
    info(message: string, data?: Record<string, unknown>): void;
    warn(message: string, data?: Record<string, unknown>): void;
    error(message: string, data?: Record<string, unknown>): void;
  };
}

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  name: string; // Plugin name (e.g., 'Jira Integration')
  platform: string; // Platform identifier (e.g., 'jira')
  version: string; // Semver version (e.g., '1.0.0')
  description?: string; // Optional description
  author?: string; // Plugin author
  requiredEnvVars?: string[]; // Required environment variables
  isBuiltIn?: boolean; // Whether this is a built-in plugin (vs custom from database)
}

/**
 * Plugin factory function
 * Takes context and returns an integration service instance
 */
export type PluginFactory = (context: PluginContext) => IntegrationService;

/**
 * Complete plugin definition
 */
export interface IntegrationPlugin {
  metadata: PluginMetadata;
  factory: PluginFactory;
}

/**
 * Plugin lifecycle hooks (optional for advanced plugins)
 */
export interface PluginLifecycle {
  /**
   * Called when plugin is loaded
   */
  onLoad?(): Promise<void> | void;

  /**
   * Called when plugin is unloaded
   */
  onUnload?(): Promise<void> | void;

  /**
   * Called to validate plugin configuration
   */
  validate?(): Promise<boolean> | boolean;
}

/**
 * Extended plugin with lifecycle hooks
 */
export interface AdvancedIntegrationPlugin extends IntegrationPlugin {
  lifecycle?: PluginLifecycle;
}
