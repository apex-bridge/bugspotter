/**
 * Base Integration Helpers
 * Abstract base class providing shared helper implementations for both native and sandboxed plugins
 * Eliminates code duplication between plugin-context-helpers.ts and rpc-bridge.ts
 */

import type { DatabaseClient } from '../db/client.js';
import type { IStorageService } from '../storage/types.js';
import type { BugReport, Ticket } from '../db/types.js';
import type { IntegrationConfig } from './plugin.types.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * Base class for integration helper methods
 * Used by both native TypeScript plugins and sandboxed RPC bridge
 *
 * Design Pattern: Template Method Pattern
 * - Defines common helper logic in base class
 * - Subclasses (RpcBridge, IntegrationHelpers) extend and reuse implementations
 *
 * Benefits:
 * - Single source of truth for helper logic
 * - Eliminates ~310 lines of code duplication
 * - Ensures consistent behavior across native and sandboxed plugins
 * - Simplifies testing (test once in base, not in multiple locations)
 */
export abstract class BaseIntegrationHelpers {
  protected readonly db: DatabaseClient;
  protected readonly storage: IStorageService;
  protected readonly projectId: string;
  protected readonly platform: string;

  constructor(db: DatabaseClient, storage: IStorageService, projectId: string, platform: string) {
    this.db = db;
    this.storage = storage;
    this.projectId = projectId;
    this.platform = platform;
  }

  /**
   * Get integration configuration for current project and platform
   * Automatically scoped to current project
   *
   * @throws {Error} If integration not configured or config missing
   * @returns Integration configuration object with custom fields
   */
  protected async getIntegrationConfig(): Promise<IntegrationConfig> {
    if (!this.projectId) {
      throw new Error('Cannot get integration config: projectId not set in context');
    }

    const integration = await this.db.projectIntegrations.findByProjectAndPlatform(
      this.projectId,
      this.platform
    );

    if (!integration) {
      throw new Error(
        `Integration ${this.platform} not configured for project ${this.projectId}. ` +
          `Configure it via POST /api/v1/project-integrations`
      );
    }

    if (!integration.config) {
      throw new Error(`Integration ${this.platform} has no configuration`);
    }

    // Return config as-is (can contain any custom fields)
    return integration.config as IntegrationConfig;
  }

  /**
   * Get bug report by ID
   * Validates bug belongs to current project for security
   *
   * @param bugReportId - UUID of bug report to fetch
   * @throws {Error} If bug not found or belongs to different project
   * @returns Bug report object
   */
  protected async getBugReport(bugReportId: string): Promise<BugReport> {
    const bugReport = await this.db.bugReports.findById(bugReportId);

    if (!bugReport) {
      throw new Error(`Bug report ${bugReportId} not found`);
    }

    // Security check: Ensure bug belongs to current project
    if (this.projectId && bugReport.project_id !== this.projectId) {
      logger.warn('Attempted cross-project bug report access', {
        bugReportId,
        bugReportProject: bugReport.project_id,
        contextProject: this.projectId,
        platform: this.platform,
      });
      throw new Error('Access denied: Bug report belongs to different project');
    }

    return bugReport;
  }

  /**
   * Create a ticket record linking bug report to external ticket
   *
   * @param data - Ticket creation data (bug_report_id, external_id, external_url, metadata)
   * @throws {Error} If bug not found or belongs to different project
   * @returns Created ticket object
   */
  protected async createTicket(data: {
    bug_report_id: string;
    external_id: string;
    external_url: string;
    metadata?: Record<string, unknown>;
  }): Promise<Ticket> {
    // Security check: Ensure bug belongs to current project
    if (this.projectId) {
      const bugReport = await this.db.bugReports.findById(data.bug_report_id);
      if (!bugReport) {
        throw new Error(`Bug report ${data.bug_report_id} not found`);
      }
      if (bugReport.project_id !== this.projectId) {
        throw new Error('Access denied: Bug report belongs to different project');
      }
    }

    // Create ticket record
    const ticket = await this.db.tickets.create({
      bug_report_id: data.bug_report_id,
      platform: this.platform,
      external_id: data.external_id,
      external_url: data.external_url,
      status: 'open',
    });

    logger.info('Ticket created via plugin context', {
      ticketId: ticket.id,
      externalId: data.external_id,
      platform: this.platform,
      projectId: this.projectId,
    });

    return ticket;
  }

  /**
   * Log integration sync event
   * Automatically associates with current platform
   * Does not throw errors - logs failures but continues execution
   *
   * @param action - Sync action type (test, create, update, sync)
   * @param status - Result status (success, failed)
   * @param metadata - Optional metadata (duration_ms, error message)
   */
  protected async logSyncEvent(
    action: 'test' | 'create' | 'update' | 'sync',
    status: 'success' | 'failed',
    metadata?: { duration_ms?: number; error?: string }
  ): Promise<void> {
    try {
      await this.db.integrationSyncLogs.create({
        integration_type: this.platform,
        action,
        status,
        duration_ms: metadata?.duration_ms,
        error: metadata?.error,
      });

      logger.debug('Sync event logged', {
        platform: this.platform,
        action,
        status,
        projectId: this.projectId,
      });
    } catch (error) {
      // Don't fail the operation if logging fails
      logger.error('Failed to log sync event', {
        platform: this.platform,
        action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
