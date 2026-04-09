/**
 * Plugin Context Helpers
 * Provides high-level helper functions for plugin context
 * Simplifies common operations and enforces security boundaries
 *
 * Now uses BaseIntegrationHelpers for implementation to avoid code duplication
 */

import type { DatabaseClient } from '../db/client.js';
import type { IStorageService } from '../storage/types.js';
import type { BugReport, Ticket } from '../db/types.js';
import type { IntegrationConfig } from './plugin.types.js';
import { BaseIntegrationHelpers } from './base-integration-helpers.js';

/**
 * Integration helpers wrapper that exposes base class methods as context helpers
 * Uses inheritance to reuse logic from BaseIntegrationHelpers
 */
class IntegrationHelpers extends BaseIntegrationHelpers {
  // All methods inherited from BaseIntegrationHelpers
  // Publicly expose protected methods
  public async getIntegrationConfig(): Promise<IntegrationConfig> {
    return super.getIntegrationConfig();
  }

  public async getBugReport(bugReportId: string): Promise<BugReport> {
    return super.getBugReport(bugReportId);
  }

  public async createTicket(data: {
    bug_report_id: string;
    external_id: string;
    external_url: string;
    metadata?: Record<string, unknown>;
  }): Promise<Ticket> {
    return super.createTicket(data);
  }

  public async logSyncEvent(
    action: 'test' | 'create' | 'update' | 'sync',
    status: 'success' | 'failed',
    metadata?: { duration_ms?: number; error?: string }
  ): Promise<void> {
    return super.logSyncEvent(action, status, metadata);
  }
}

/**
 * Create plugin context helpers for a specific project and platform
 * These helpers wrap repository calls and enforce project-scoped access
 *
 * Returns an object with helper methods that delegate to BaseIntegrationHelpers
 */
export function createPluginContextHelpers(
  db: DatabaseClient,
  storage: IStorageService,
  projectId: string,
  platform: string
) {
  const helpers = new IntegrationHelpers(db, storage, projectId, platform);

  return {
    getIntegrationConfig: () => helpers.getIntegrationConfig(),
    getBugReport: (bugReportId: string) => helpers.getBugReport(bugReportId),
    createTicket: (data: {
      bug_report_id: string;
      external_id: string;
      external_url: string;
      metadata?: Record<string, unknown>;
    }) => helpers.createTicket(data),
    logSyncEvent: (
      action: 'test' | 'create' | 'update' | 'sync',
      status: 'success' | 'failed',
      metadata?: { duration_ms?: number; error?: string }
    ) => helpers.logSyncEvent(action, status, metadata),
  };
}
