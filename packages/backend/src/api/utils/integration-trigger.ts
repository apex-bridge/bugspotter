import type { QueueManager } from '../../queue/queue-manager.js';
import type { DatabaseClient } from '../../db/client.js';
import type { BugReport } from '../../db/types.js';
import { getLogger } from '../../logger.js';
import { getEncryptionService } from '../../utils/encryption.js';
import { QUEUE_NAMES } from '../../queue/types.js';
import { INTEGRATION_JOB_NAME } from '../../queue/jobs/integration-job.js';
import { RuleMatcher } from '../../services/rule-matcher.js';
import { AutoTicketService } from '../../services/integrations/auto-ticket-service.js';
import type { PluginRegistry } from '../../integrations/plugin-registry.js';

const logger = getLogger();

// ============================================================================
// TYPES
// ============================================================================

type IntegrationPlatform = 'jira' | 'github' | 'linear' | 'slack';

interface IntegrationContext {
  bugReportId: string;
  projectId: string;
  platform: string;
  integrationId: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SUPPORTED_PLATFORMS: ReadonlySet<string> = new Set<IntegrationPlatform>([
  'jira',
  'github',
  'linear',
  'slack',
]);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if bug report should trigger integration based on rules
 * Returns true if no rules exist (backward compatibility) or if any rule matches
 *
 * @param excludeAutoCreate - If true, only checks manual (non-auto-create) rules
 *                            Prevents duplicate processing when auto-create already attempted
 */
async function shouldTriggerIntegration(
  bugReport: BugReport,
  projectId: string,
  integrationId: string,
  db: DatabaseClient,
  excludeAutoCreate: boolean = false
): Promise<boolean> {
  const rules = await db.integrationRules.findEnabledByProjectAndPlatform(projectId, integrationId);

  // Filter out auto-create rules if requested
  const filteredRules = excludeAutoCreate ? rules.filter((rule) => !rule.auto_create) : rules;

  // No rules = trigger all (backward compatibility)
  if (filteredRules.length === 0) {
    return true;
  }

  // Check if any rule matches (OR logic)
  for (const rule of filteredRules) {
    logger.debug('Checking if bug report matches rule', {
      bugReportId: bugReport.id,
      projectId,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.auto_create ? 'auto-create' : 'manual',
      filterCount: rule.filters.length,
    });

    if (
      RuleMatcher.matchesFilters(bugReport, rule.filters, { ruleId: rule.id, ruleName: rule.name })
    ) {
      logger.info('Bug report matches integration rule', {
        bugReportId: bugReport.id,
        projectId,
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.auto_create ? 'auto-create' : 'manual',
        result: 'TRIGGER_INTEGRATION',
      });
      return true;
    }
  }

  logger.debug('Bug report does not match any rules', {
    bugReportId: bugReport.id,
    projectId,
    integrationId,
    rulesChecked: filteredRules.length,
    result: 'SKIP_INTEGRATION',
  });

  return false;
}

/**
 * Check if integration has auto-create rules enabled
 * Returns true if any enabled rule has auto_create=true
 */
async function hasAutoCreateRules(
  projectId: string,
  integrationId: string,
  db: DatabaseClient
): Promise<boolean> {
  const rules = await db.integrationRules.findAutoCreateRules(projectId, integrationId);
  return rules.length > 0;
}

/**
 * Decrypt integration credentials safely
 * Returns empty object if decryption fails
 */
function decryptCredentials(
  encryptedCredentials: string | null,
  context: IntegrationContext
): Record<string, unknown> {
  if (!encryptedCredentials) {
    return {};
  }

  try {
    const encryptionService = getEncryptionService();
    const decryptedString = encryptionService.decrypt(encryptedCredentials);
    return JSON.parse(decryptedString);
  } catch (error) {
    logger.error('Failed to decrypt integration credentials', {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Validate platform is supported
 */
function isValidPlatform(platform: string): platform is IntegrationPlatform {
  return SUPPORTED_PLATFORMS.has(platform);
}

/**
 * Queue a single integration job
 */
async function queueIntegrationJob(
  queueManager: QueueManager,
  bugReport: BugReport,
  projectId: string,
  platform: IntegrationPlatform,
  integrationId: string,
  credentials: Record<string, unknown>,
  config: Record<string, unknown>
): Promise<void> {
  const jobId = `${platform}-${bugReport.id}-${Date.now()}`;

  await queueManager.addJob(
    QUEUE_NAMES.INTEGRATIONS,
    INTEGRATION_JOB_NAME,
    {
      bugReportId: bugReport.id,
      projectId,
      platform,
      integrationId,
      credentials,
      config,
    },
    {
      jobId,
      priority: 5,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    }
  );

  logger.info('Integration job queued', {
    bugReportId: bugReport.id,
    projectId,
    platform,
    jobId,
  });
}

/**
 * Process a single integration
 * Logs and returns early if integration should be skipped
 */
async function processIntegration(
  integration: {
    id: string;
    integration_type: string;
    config: Record<string, unknown> | null;
    encrypted_credentials: string | null;
  },
  bugReport: BugReport,
  projectId: string,
  queueManager: QueueManager,
  db: DatabaseClient,
  pluginRegistry?: PluginRegistry
): Promise<void> {
  const context: IntegrationContext = {
    bugReportId: bugReport.id,
    projectId,
    platform: integration.integration_type,
    integrationId: integration.id,
  };

  // Check if integration has auto-create rules
  const hasAutoCreate = await hasAutoCreateRules(projectId, integration.id, db);

  if (hasAutoCreate) {
    // Try automatic ticket creation first
    if (pluginRegistry) {
      logger.debug('Attempting automatic ticket creation', {
        bugReportId: context.bugReportId,
        projectId: context.projectId,
        integrationId: context.integrationId,
        platform: context.platform,
      });

      const autoTicketService = new AutoTicketService(db);
      const result = await autoTicketService.tryCreateTicket(
        bugReport,
        projectId,
        integration.id,
        integration.integration_type
      );

      if (result.success) {
        // Ticket queued successfully (AutoTicketService already logged details)
        return; // Skip manual integration job - ticket creation in progress
      }

      if (result.throttled) {
        logger.warn('Automatic ticket creation throttled', {
          bugReportId: context.bugReportId,
          platform: context.platform,
          reason: result.throttleReason,
          ruleId: result.ruleId,
        });
        return; // Skip manual integration job - throttled
      }

      // Auto-create failed, log but continue to check manual rules
      logger.debug('Automatic ticket creation failed, checking manual rules', {
        bugReportId: context.bugReportId,
        error: result.error,
      });
    } else {
      logger.warn('Auto-create rules exist but plugin registry not available', {
        bugReportId: context.bugReportId,
        integrationId: context.integrationId,
      });
    }
  }

  // Check manual integration rules (non-auto-create)
  // If hasAutoCreate=true, we already processed auto-create rules above,
  // so exclude them here to prevent duplicate processing
  const shouldTrigger = await shouldTriggerIntegration(
    bugReport,
    projectId,
    integration.id,
    db,
    hasAutoCreate // Exclude auto-create rules if they exist
  );

  if (!shouldTrigger) {
    logger.debug('Bug report does not match any integration rules, skipping', {
      bugReportId: context.bugReportId,
      projectId: context.projectId,
      platform: context.platform,
      integrationId: context.integrationId,
    });
    return;
  }

  // Validate platform
  if (!isValidPlatform(integration.integration_type)) {
    logger.error('Unsupported integration platform', {
      ...context,
      supportedPlatforms: Array.from(SUPPORTED_PLATFORMS),
    });
    return;
  }

  // Decrypt credentials
  const credentials = decryptCredentials(integration.encrypted_credentials, context);
  if (integration.encrypted_credentials && Object.keys(credentials).length === 0) {
    return; // Decryption failed (already logged)
  }

  // Queue job (platform is now validated as IntegrationPlatform)
  await queueIntegrationJob(
    queueManager,
    bugReport,
    projectId,
    integration.integration_type,
    integration.id,
    credentials,
    integration.config || {}
  );
}

/**
 * Trigger integration jobs for a bug report
 *
 * Handles optional queueManager gracefully - logs but doesn't throw
 * if queue system is not configured.
 *
 * Queries all enabled integrations for the project and processes each one:
 * 1. Checks if integration has auto-create rules and attempts automatic ticket creation
 * 2. If auto-create succeeds or is throttled, skips manual integration
 * 3. Otherwise, checks if bug report matches manual integration rules
 * 4. Decrypts credentials and queues integration job for manual processing
 *
 * Errors are logged but don't throw to ensure bug report creation succeeds
 * even if integration queueing fails.
 */
export async function triggerBugReportIntegrations(
  bugReport: BugReport,
  projectId: string,
  queueManager: QueueManager | undefined,
  db: DatabaseClient,
  pluginRegistry?: PluginRegistry
): Promise<void> {
  if (!queueManager) {
    logger.debug('Queue manager not available, skipping integration triggers', {
      bugReportId: bugReport.id,
      projectId,
    });
    return;
  }

  try {
    const integrations = await db.projectIntegrations.findEnabledByProjectWithType(projectId);

    if (integrations.length === 0) {
      logger.debug('No enabled integrations for project', {
        bugReportId: bugReport.id,
        projectId,
      });
      return;
    }

    logger.info('Triggering integrations for bug report', {
      bugReportId: bugReport.id,
      projectId,
      integrationCount: integrations.length,
      platforms: integrations.map((i) => i.integration_type),
    });

    // Process each integration independently
    for (const integration of integrations) {
      try {
        await processIntegration(
          integration,
          bugReport,
          projectId,
          queueManager,
          db,
          pluginRegistry
        );
      } catch (error) {
        logger.error('Failed to process integration', {
          bugReportId: bugReport.id,
          projectId,
          platform: integration.integration_type,
          integrationId: integration.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other integrations
      }
    }
  } catch (error) {
    logger.error('Failed to trigger integrations', {
      bugReportId: bugReport.id,
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
