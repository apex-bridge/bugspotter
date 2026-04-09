/**
 * Domain Access Patterns - Examples of using DatabaseClient domain getters
 *
 * This demonstrates the hybrid approach:
 * - Flat access (db.projects) still works for backward compatibility
 * - Domain getters (db.core.projects) show clear dependencies in new code
 * - Easy to extract to separate clients later if needed
 */

import type { DatabaseClient, IntegrationRepositories } from '../src/db/client.js';

// ============================================================================
// PATTERN 1: Flat Access (Existing Code - Still Works)
// ============================================================================

/**
 * Traditional approach - still supported
 * Works fine for small services or cross-domain operations
 */
async function flatAccessExample(db: DatabaseClient) {
  // Direct access to any repository
  const project = await db.projects.findById('proj-123');
  const integration = await db.integrations.findById('int-456');
  const channel = await db.notificationChannels.findById('ch-789');

  return { project, integration, channel };
}

// ============================================================================
// PATTERN 2: Domain Getters (Recommended for New Services)
// ============================================================================

/**
 * Integration service - clearly shows it only uses integration domain
 */
class IntegrationSyncService {
  constructor(private db: DatabaseClient) {}

  async syncWithExternal(integrationId: string) {
    // Clear scope: only uses integration domain
    const integration = await this.db.integration.integrations.findById(integrationId);

    if (!integration) {
      throw new Error('Integration not found');
    }

    // Log sync attempt
    await this.db.integration.syncLogs.create({
      integration_id: integrationId,
      action: 'sync_started',
      status: 'in_progress',
      message: 'Starting external sync',
    });

    // ... sync logic ...

    return integration;
  }
}

/**
 * Notification service - clearly shows it only uses notification domain
 */
class NotificationDispatcher {
  constructor(private db: DatabaseClient) {}

  async sendNotification(projectId: string, message: string) {
    // Clear scope: only uses notification domain
    const channels = await this.db.notification.channels.list({ project_id: projectId });

    for (const channel of channels.data) {
      await this.db.notification.history.create({
        channel_id: channel.id,
        notification_type: 'bug_report_created',
        recipient: channel.config.email || channel.config.webhook_url,
        status: 'pending',
        metadata: { message },
      });
    }
  }
}

// ============================================================================
// PATTERN 3: Type-Safe Domain Injection (Best for Testing)
// ============================================================================

/**
 * Service that only needs integration repositories
 * Type signature makes dependencies explicit
 */
class IntegrationConfigService {
  constructor(private integrationRepos: IntegrationRepositories) {}

  async updateConfig(type: string, config: Record<string, unknown>) {
    const integration = await this.integrationRepos.integrations.findBy({ type });

    if (!integration) {
      throw new Error(`Integration ${type} not found`);
    }

    return await this.integrationRepos.integrations.updateConfig(type, config);
  }
}

// Usage with full DatabaseClient
function _withFullClient(db: DatabaseClient) {
  const _service = new IntegrationConfigService(db.integration);
  return _service.updateConfig('jira', { baseUrl: 'https://example.atlassian.net' });
}

// Testing with mock (only need to mock integration domain)
function _testExample() {
  const mockIntegrationRepos: IntegrationRepositories = {
    integrations: {
      findBy: async () => ({ id: 'int-1', type: 'jira', status: 'active' }),
      updateConfig: async () => ({ id: 'int-1', type: 'jira', status: 'active' }),
    } as any,
    syncLogs: {} as any,
    fieldMappings: {} as any,
    webhooks: {} as any,
    oauthTokens: {} as any,
    projectIntegrations: {} as any,
  };

  const _service = new IntegrationConfigService(mockIntegrationRepos);
  // Test with only the domain mocked, not the entire DatabaseClient
}

// ============================================================================
// PATTERN 4: Cross-Domain Operations (Use Flat Access or Transactions)
// ============================================================================

/**
 * When you need multiple domains, use flat access or explicit domains
 */
class BugReportWithNotifications {
  constructor(private db: DatabaseClient) {}

  async createBugAndNotify(data: { title: string; project_id: string }) {
    // Cross-domain: need both core and notification
    return await this.db.transaction(async (tx) => {
      // Create bug report (core domain)
      const bugReport = await tx.bugReports.create({
        project_id: data.project_id,
        title: data.title,
        status: 'open',
        severity: 'medium',
      });

      // Get notification channels (notification domain)
      // Note: In transactions, use flat access since domain getters aren't available on tx
      const channels = await tx.notificationChannels.findManyBy({
        project_id: data.project_id,
      });

      // Queue notifications
      for (const channel of channels) {
        await tx.notificationHistory.create({
          channel_id: channel.id,
          notification_type: 'bug_report_created',
          recipient: channel.config.email,
          status: 'pending',
          metadata: { bug_report_id: bugReport.id },
        });
      }

      return bugReport;
    });
  }
}

// ============================================================================
// MIGRATION STRATEGY
// ============================================================================

/**
 * When to use each pattern:
 *
 * 1. FLAT ACCESS (db.projects)
 *    - Existing code (no need to change)
 *    - Quick scripts and examples
 *    - Cross-domain operations
 *    - Transactions (tx doesn't have domain getters)
 *
 * 2. DOMAIN GETTERS (db.integration.integrations)
 *    - New services focused on one domain
 *    - Shows clear dependency boundaries
 *    - Easier to extract to microservices later
 *    - Better autocomplete grouping in IDEs
 *
 * 3. TYPED DOMAIN INJECTION (constructor(repos: IntegrationRepositories))
 *    - Services that only need one domain
 *    - Maximum testability (mock only what you need)
 *    - Explicit dependencies in type signatures
 *    - Preparation for future domain client split
 */

export {
  flatAccessExample,
  IntegrationSyncService,
  NotificationDispatcher,
  IntegrationConfigService,
  BugReportWithNotifications,
};
