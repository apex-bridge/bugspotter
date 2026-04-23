/**
 * Jira Integration Service
 * Orchestrates bug report to Jira ticket creation
 */

import type { BugReportRepository } from '../../db/repositories.js';
import type { ProjectIntegrationRepository } from '../../db/project-integration.repository.js';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import { TICKET_STATUS, type BugReport, type TicketStatus } from '../../db/types.js';
import type { IntegrationService, TicketCreationMetadata } from '../base-integration.service.js';
import type { IntegrationResult } from '../base-integration.service.js';
import { getLogger } from '../../logger.js';
import { config as appConfig } from '../../config.js';
import { AppError, ValidationError } from '../../api/middleware/error.js';
import { generateShareToken } from '../../utils/token-generator.js';
import { JiraConfigManager } from './config.js';
import { JiraClient } from './client.js';
import { JiraBugReportMapper } from './mapper.js';
import type { JiraIntegrationResult, JiraConfig, JiraAttachment } from './types.js';
import { SHARE_TOKEN_EXPIRATION_HOURS } from './types.js';

const logger = getLogger();

// ============================================================================
// TYPES
// ============================================================================

/**
 * Raw Jira config from database
 */
type RawJiraConfig = Partial<JiraConfig> & {
  instanceUrl?: string;
  email?: string;
  apiToken?: string;
  projectKey?: string;
  issueType?: string;
  enabled?: boolean;
};

// ============================================================================
// CONSTANTS
// ============================================================================

const PLATFORM_NAME = 'jira';
const DEFAULT_TICKET_STATUS: TicketStatus = TICKET_STATUS.OPEN;
const DEFAULT_SCREENSHOT_FILENAME = 'screenshot.png';

/**
 * Trusted domains for Jira avatar URLs
 * These domains are allowed for avatar proxy requests in addition to the configured instanceUrl
 */
export const JIRA_TRUSTED_AVATAR_DOMAINS = [
  'secure.gravatar.com', // Gravatar service
  '*.atlassian.net', // Atlassian domains (wildcard)
  '*.atl-paas.net', // Atlassian PaaS avatar service (wildcard)
] as const;

/**
 * Helper function to build allowed avatar domains for Jira integration
 * Exported for reuse in tests to avoid duplication
 * @param config - Jira configuration object
 * @returns Array of allowed hostnames
 */
export function buildJiraAllowedAvatarDomains(config: Record<string, unknown>): string[] {
  const allowedDomains: string[] = [];

  // Add the configured Jira instance URL hostname
  if (config.instanceUrl && typeof config.instanceUrl === 'string') {
    try {
      const instanceHostname = new URL(config.instanceUrl).hostname;
      allowedDomains.push(instanceHostname);
    } catch {
      // Invalid instanceUrl, skip it
    }
  }

  // Add Atlassian trusted domains
  allowedDomains.push(...JIRA_TRUSTED_AVATAR_DOMAINS);

  return allowedDomains;
}

/**
 * Maximum length of Jira host URL to log (truncated for readability)
 */
const MAX_HOST_LOG_LENGTH = 30;

/**
 * Time constants for expiration calculations
 */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Jira Integration Service
 * Handles creating Jira issues from bug reports
 */
export class JiraIntegrationService implements IntegrationService {
  readonly platform = PLATFORM_NAME;

  private bugReportRepo: BugReportRepository;
  private integrationRepo: ProjectIntegrationRepository;
  private db: DatabaseClient;
  private storage: IStorageService;
  private configManager: JiraConfigManager;

  constructor(
    bugReportRepo: BugReportRepository,
    integrationRepo: ProjectIntegrationRepository,
    db: DatabaseClient,
    storage: IStorageService
  ) {
    this.bugReportRepo = bugReportRepo;
    this.integrationRepo = integrationRepo;
    this.db = db;
    this.storage = storage;
    this.configManager = new JiraConfigManager(integrationRepo);
  }

  /**
   * Create Jira issue from bug report (implements IntegrationService interface)
   * @param bugReport - Bug report to create issue from
   * @param projectId - Project ID for loading integration config
   * @param integrationId - Specific integration ID to use (for projects with multiple Jira integrations)
   * @param metadata - Optional metadata for ticket creation (rule_id, created_automatically)
   * @returns Integration result with external ID and URL
   */
  async createFromBugReport(
    bugReport: BugReport,
    projectId: string,
    integrationId: string,
    metadata?: TicketCreationMetadata
  ): Promise<IntegrationResult> {
    const result = await this.createTicketFromBugReportInternal(
      bugReport,
      projectId,
      integrationId,
      metadata
    );
    return {
      externalId: result.issueKey,
      externalUrl: result.issueUrl,
      platform: PLATFORM_NAME,
      metadata: {
        issueId: result.issueId,
        attachments: result.attachments,
      },
    };
  }

  /**
   * Create Jira ticket from bug report (legacy method for backward compatibility)
   * @param bugReportId - Bug report ID
   * @returns Jira integration result with issue key and URL
   * @deprecated Use createFromBugReport with explicit integrationId instead
   */
  async createTicketFromBugReport(bugReportId: string): Promise<JiraIntegrationResult> {
    logger.info('Creating Jira ticket from bug report (legacy method)', { bugReportId });

    // Fetch bug report
    const bugReport = await this.fetchBugReport(bugReportId);

    // For legacy compatibility: get first enabled Jira integration for project
    // This will fail if project has multiple Jira integrations (by design - forces migration to new API)
    const integration = await this.integrationRepo.findEnabledByProjectAndPlatform(
      bugReport.project_id,
      'jira'
    );

    if (!integration) {
      throw new Error(`No enabled Jira integration found for project ${bugReport.project_id}`);
    }

    return this.createTicketFromBugReportInternal(bugReport, bugReport.project_id, integration.id);
  }

  /**
   * Internal method to create Jira ticket from bug report
   * @param integrationId - Specific integration ID to load config for (prevents ambiguity with multiple Jira integrations)
   * @param metadata - Optional metadata for ticket creation (rule_id, created_automatically, field_mappings)
   */
  private async createTicketFromBugReportInternal(
    bugReport: BugReport,
    projectId: string,
    integrationId: string,
    metadata?: TicketCreationMetadata
  ): Promise<JiraIntegrationResult> {
    logger.info('Creating Jira ticket from bug report', {
      bugReportId: bugReport.id,
      projectId,
      integrationId,
      ruleId: metadata?.ruleId,
      createdAutomatically: metadata?.createdAutomatically,
      hasFieldMappings: !!metadata?.fieldMappings,
    });

    // Validate and load configuration for specific integration
    const config = await this.validateAndLoadConfig(integrationId);

    // Generate share token for replay if applicable
    const shareReplayUrl = await this.generateShareTokenIfNeeded(bugReport, config);

    // Create Jira issue (pass field mappings and description template for customization)
    const { issue, issueUrl } = await this.createJiraIssue(
      bugReport,
      config,
      shareReplayUrl,
      metadata?.fieldMappings,
      metadata?.descriptionTemplate
    );

    // Upload screenshot attachment if present
    const attachments = await this.uploadScreenshotIfPresent(bugReport, issue.key, config);

    // Save ticket reference to database (with metadata)
    await this.saveTicketReference(
      bugReport.id,
      issue.key,
      issueUrl,
      integrationId,
      metadata?.ruleId,
      metadata?.createdAutomatically
    );

    return {
      issueKey: issue.key,
      issueUrl,
      issueId: issue.id,
      attachments,
    };
  }

  /**
   * Validate project has Jira configured and enabled
   */
  private async validateAndLoadConfig(integrationId: string): Promise<JiraConfig> {
    const config = await this.configManager.getConfigByIntegrationId(integrationId);

    if (!config) {
      throw new AppError(`Jira not configured for integration: ${integrationId}`, 404, 'NotFound');
    }

    if (!config.enabled) {
      throw new AppError(`Jira integration disabled: ${integrationId}`, 403, 'IntegrationDisabled');
    }

    return config;
  }

  /**
   * Generate share token for replay if replay exists and sharing is enabled
   * Reuses existing active token if available to prevent duplicates
   */
  private async generateShareTokenIfNeeded(
    bugReport: BugReport,
    config: JiraConfig
  ): Promise<string | undefined> {
    const includeShareReplay = config.templateConfig?.includeShareReplay ?? true;

    if (!bugReport.replay_key || !includeShareReplay) {
      return undefined;
    }

    try {
      // Validate frontend URL is configured
      if (!appConfig.frontend.url) {
        throw new AppError(
          'FRONTEND_URL environment variable is required for generating share replay links',
          500,
          'ConfigurationError'
        );
      }

      // Check for existing active share token to avoid duplicates
      const existingTokens = await this.db.shareTokens.findByBugReportId(bugReport.id, true);

      if (existingTokens.length > 0) {
        // Select token with latest expiration (most robust against race conditions)
        const existingToken = existingTokens.reduce((latest, current) =>
          current.expires_at > latest.expires_at ? current : latest
        );
        const shareReplayUrl = `${appConfig.frontend.url}/shared/${existingToken.token}`;

        logger.debug('Reusing existing share token for replay', {
          bugReportId: bugReport.id,
          tokenId: existingToken.id,
          token: existingToken.token,
          expiresAt: existingToken.expires_at,
        });

        return shareReplayUrl;
      }

      // Generate cryptographically secure token
      const token = generateShareToken();

      // Calculate expiration
      const expirationHours =
        config.templateConfig?.shareReplayExpiration ?? SHARE_TOKEN_EXPIRATION_HOURS;
      const expiresAt = new Date(Date.now() + expirationHours * MS_PER_HOUR);

      // Create share token in database
      const shareToken = await this.db.shareTokens.create({
        bug_report_id: bugReport.id,
        token,
        created_by: null, // Anonymous share token for Jira integration
        expires_at: expiresAt,
        password_hash: null,
      });

      const shareReplayUrl = `${appConfig.frontend.url}/shared/${shareToken.token}`;

      logger.debug('Generated share token for replay', {
        bugReportId: bugReport.id,
        token: shareToken.token,
        expiresAt,
      });

      return shareReplayUrl;
    } catch (error) {
      logger.warn('Failed to generate share token for replay', {
        bugReportId: bugReport.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined; // Continue without share URL
    }
  }

  /**
   * Create Jira issue from bug report
   */
  private async createJiraIssue(
    bugReport: BugReport,
    config: JiraConfig,
    shareReplayUrl?: string,
    fieldMappings?: Record<string, unknown> | null,
    descriptionTemplate?: string | null
  ): Promise<{ issue: { key: string; id: string }; issueUrl: string }> {
    const client = new JiraClient(config);
    const mapper = new JiraBugReportMapper(config, true, config.templateConfig);

    const issueFields = mapper.toJiraIssue(
      bugReport,
      shareReplayUrl,
      fieldMappings,
      descriptionTemplate
    );
    const issue = await client.createIssue(issueFields);
    const issueUrl = client.getIssueUrl(issue.key);

    logger.info('Jira issue created', {
      bugReportId: bugReport.id,
      issueKey: issue.key,
      issueUrl,
      shareReplayUrl,
      hasFieldMappings: !!fieldMappings,
      hasCustomDescriptionTemplate: !!descriptionTemplate,
    });

    return { issue, issueUrl };
  }

  /**
   * Upload screenshot to Jira as attachment if present
   */
  private async uploadScreenshotIfPresent(
    bugReport: BugReport,
    issueKey: string,
    config: JiraConfig
  ): Promise<JiraAttachment[]> {
    const attachments: JiraAttachment[] = [];

    // Check screenshot_key instead of screenshot_url (screenshot_key is the source of truth)
    if (!bugReport.screenshot_key) {
      logger.debug('No screenshot key found for bug report', {
        bugReportId: bugReport.id,
        hasScreenshotUrl: !!bugReport.screenshot_url,
      });
      return attachments;
    }

    try {
      const client = new JiraClient(config);
      const attachment = await this.uploadScreenshotToJira(
        client,
        issueKey,
        bugReport.screenshot_key
      );
      attachments.push(attachment);
      logger.info('Screenshot uploaded to Jira', {
        bugReportId: bugReport.id,
        issueKey,
        filename: attachment.filename,
      });
    } catch (error) {
      logger.warn('Failed to upload screenshot to Jira', {
        bugReportId: bugReport.id,
        issueKey,
        screenshot_key: bugReport.screenshot_key,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return attachments;
  }

  /**
   * Fetch bug report from database
   */
  private async fetchBugReport(bugReportId: string): Promise<BugReport> {
    const bugReport = await this.bugReportRepo.findById(bugReportId);

    if (!bugReport) {
      throw new AppError(`Bug report not found: ${bugReportId}`, 404, 'NotFound');
    }

    return bugReport;
  }

  /**
   * Upload screenshot to Jira as attachment
   * Uses streaming to prevent memory issues with large files
   */
  private async uploadScreenshotToJira(
    client: JiraClient,
    issueKey: string,
    screenshotKey: string
  ) {
    logger.debug('Uploading screenshot to Jira', { issueKey, screenshot_key: screenshotKey });

    // Stream screenshot directly from storage (memory-efficient)
    const stream = await this.storage.getObject(screenshotKey);

    // Extract filename from key
    const filename = screenshotKey.split('/').pop() || DEFAULT_SCREENSHOT_FILENAME;

    // Upload to Jira using streaming (prevents buffering entire file in memory)
    return await client.uploadAttachment(issueKey, stream, filename);
  }

  /**
   * Save ticket reference to database
   * Atomically saves to both tickets table (for queries) and bug_reports metadata (for fast access)
   * Uses transaction to ensure both writes succeed or fail together
   * @param metadata - Optional metadata for automatic ticket creation
   */
  private async saveTicketReference(
    bugReportId: string,
    externalId: string,
    externalUrl: string,
    integrationId?: string,
    ruleId?: string,
    createdAutomatically?: boolean
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Save to tickets table (queryable, relational) with metadata
      await tx.tickets.createTicket(bugReportId, externalId, PLATFORM_NAME, DEFAULT_TICKET_STATUS, {
        integrationId,
        ruleId,
        createdAutomatically,
        externalUrl,
      });

      // Save to bug_reports metadata (denormalized, fast access)
      await tx.bugReports.updateExternalIntegration(bugReportId, externalId, externalUrl);

      logger.debug('Saved Jira ticket reference to both tables', {
        bugReportId,
        externalId,
        externalUrl,
        integrationId,
        ruleId,
        createdAutomatically,
      });
    });
  }
  /**
   * Test Jira connection for project (implements IntegrationService interface)
   */
  async testConnection(projectId: string): Promise<boolean> {
    const config = await this.configManager.getConfig(projectId);
    if (!config) {
      return false;
    }
    const result = await JiraConfigManager.validate(config);
    return result.valid;
  }

  /**
   * Normalize raw config from frontend clients into JiraConfig shape.
   * Maps `instanceUrl` → `host` when host is missing or non-string.
   */
  private static normalizeConfig(config: Record<string, unknown>): Record<string, unknown> {
    const mapped: Record<string, unknown> = { ...config };

    const host = mapped.host;
    const instanceUrl = mapped.instanceUrl;

    // Use instanceUrl as host fallback when host is missing or non-string
    const hasValidHost = typeof host === 'string' && host.trim() !== '';
    const hasValidInstanceUrl = typeof instanceUrl === 'string' && instanceUrl.trim() !== '';

    if (!hasValidHost && hasValidInstanceUrl) {
      mapped.host = (instanceUrl as string).trim();
    } else if (hasValidHost) {
      mapped.host = (host as string).trim();
    }

    return mapped;
  }

  /**
   * Validate configuration object (implements IntegrationService interface)
   */
  async validateConfig(
    config: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string; details?: Record<string, unknown> }> {
    return JiraConfigManager.validate(
      JiraIntegrationService.normalizeConfig(config) as unknown as JiraConfig
    );
  }

  /**
   * Test Jira connection with provided configuration (legacy method)
   */
  async testConnectionWithConfig(config: JiraConfig): Promise<{ valid: boolean; error?: string }> {
    return JiraConfigManager.validate(config);
  }

  /**
   * Save Jira configuration for project
   */
  async saveConfiguration(projectId: string, config: JiraConfig): Promise<void> {
    await this.configManager.saveToDatabase(projectId, config);
  }

  /**
   * Get Jira configuration for project
   */
  async getConfiguration(projectId: string): Promise<JiraConfig | null> {
    return await this.configManager.getConfig(projectId);
  }

  /**
   * Delete Jira configuration for project
   */
  async deleteConfiguration(projectId: string): Promise<void> {
    await this.configManager.deleteFromDatabase(projectId);
  }

  /**
   * Enable/disable Jira integration for project
   */
  async setEnabled(projectId: string, enabled: boolean): Promise<void> {
    await this.configManager.setEnabled(projectId, enabled);
  }

  /**
   * Search for Jira users by query (email, name, etc.)
   * Used for user autocomplete in admin UI
   */
  /**
   * Validate caller-supplied Jira credentials and build a trimmed
   * `JiraConfig` ready for `JiraClient`.
   *
   * Shared by `searchUsers` and `listProjects` (and future wizard-flow
   * endpoints) so the missing/invalid/whitespace handling stays
   * consistent. Trims the three string fields so that leading/trailing
   * whitespace can't sneak past validation and surface as a 500 from
   * `new URL()` inside `JiraClient`.
   *
   * @throws {ValidationError} with a field-by-field diagnostic on the
   *   first validation failure.
   */
  private validateAndNormalizeWizardConfig(config: Record<string, unknown>): JiraConfig {
    const rawConfig = config as RawJiraConfig;

    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    const trimString = (value: unknown): string | undefined => {
      if (typeof value !== 'string') {
        return undefined;
      }
      const t = value.trim();
      return t.length > 0 ? t : undefined;
    };

    const host = rawConfig.instanceUrl;
    const email = rawConfig.email;
    const apiToken = rawConfig.apiToken;

    const trimmedHost = trimString(host);
    const trimmedEmail = trimString(email);
    const trimmedToken = trimString(apiToken);

    if (host === undefined || host === null || host === '') {
      missingFields.push('instanceUrl');
    } else if (!trimmedHost) {
      invalidFields.push('instanceUrl (must be non-empty string)');
    }

    if (email === undefined || email === null || email === '') {
      missingFields.push('email');
    } else if (!trimmedEmail) {
      invalidFields.push('email (must be non-empty string)');
    }

    if (apiToken === undefined || apiToken === null || apiToken === '') {
      missingFields.push('apiToken');
    } else if (!trimmedToken) {
      invalidFields.push('apiToken (must be non-empty string)');
    }

    if (missingFields.length > 0 || invalidFields.length > 0) {
      const errors = [
        ...(missingFields.length > 0 ? [`missing: ${missingFields.join(', ')}`] : []),
        ...(invalidFields.length > 0 ? [`invalid: ${invalidFields.join(', ')}`] : []),
      ];
      throw new ValidationError(`Jira configuration incomplete: ${errors.join('; ')}.`);
    }

    return {
      host: trimmedHost!,
      email: trimmedEmail!,
      apiToken: trimmedToken!,
      // `searchUsers` / `listProjects` don't need a real project key,
      // but `JiraClient` won't construct without one.
      projectKey: rawConfig.projectKey || 'TEMP',
      issueType: rawConfig.issueType,
      enabled: rawConfig.enabled ?? true,
    };
  }

  async searchUsers(
    config: Record<string, unknown>,
    query: string,
    maxResults?: number
  ): Promise<
    {
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrls?: Record<string, string>;
    }[]
  > {
    logger.debug('Starting Jira user search', {
      query,
      maxResults,
      configKeys: Object.keys(config),
    });

    const normalizedConfig: JiraConfig = this.validateAndNormalizeWizardConfig(config);

    logger.debug('Creating Jira client for user search', {
      host: normalizedConfig.host.substring(0, MAX_HOST_LOG_LENGTH) + '...',
      email: normalizedConfig.email,
      hasProjectKey: !!(config as RawJiraConfig).projectKey,
    });

    const client = new JiraClient(normalizedConfig);
    const users = await client.searchUsers(query, maxResults);

    logger.info('Jira user search completed successfully', {
      query,
      resultCount: users.length,
      maxResults,
    });

    // Return simplified user objects for frontend
    return users.map((user) => ({
      accountId: user.accountId,
      displayName: user.displayName,
      emailAddress: user.emailAddress,
      avatarUrls: user.avatarUrls,
    }));
  }

  /**
   * List Jira projects visible to the authenticated user.
   *
   * Called by `POST /api/v1/integrations/jira/projects` to populate
   * the signup wizard's project picker once "Test Connection" has
   * validated the creds. No projectId is needed — the integration
   * has not been saved yet.
   */
  async listProjects(
    config: Record<string, unknown>,
    query?: string,
    maxResults?: number
  ): Promise<{ id: string; key: string; name: string }[]> {
    const normalizedConfig: JiraConfig = this.validateAndNormalizeWizardConfig(config);

    const client = new JiraClient(normalizedConfig);
    const projects = await client.listProjects(query, maxResults);

    logger.info('Jira project list fetched', {
      host: normalizedConfig.host.substring(0, MAX_HOST_LOG_LENGTH) + '...',
      count: projects.length,
      hasQuery: !!query,
    });

    return projects.map((p) => ({ id: p.id, key: p.key, name: p.name }));
  }

  /**
   * Get allowed avatar domains for Jira integration
   * Jira can return avatars from multiple trusted sources
   */
  getAllowedAvatarDomains(config: Record<string, unknown>): string[] {
    return buildJiraAllowedAvatarDomains(config);
  }
}
