/**
 * Base Integration Service
 * Interface that all integration services must implement
 */

import type { BugReport } from '../db/types.js';

/**
 * Integration result returned by all integration services
 */
export interface IntegrationResult {
  externalId: string; // External platform ID (e.g., "BUG-123", "#456", "slack-msg-123")
  externalUrl: string; // URL to view the issue/message
  platform: string; // Platform name (jira, github, linear, slack)
  metadata?: Record<string, unknown>; // Additional platform-specific data
}

/**
 * Ticket creation metadata (for automatic ticket creation via outbox pattern)
 */
export interface TicketCreationMetadata {
  ruleId?: string; // Integration rule ID that triggered automatic creation
  createdAutomatically?: boolean; // Whether ticket was auto-created (vs manual)
  fieldMappings?: Record<string, unknown> | null; // Field mappings from rule (e.g., assignee)
  descriptionTemplate?: string | null; // Custom description template from rule
}

/**
 * Base interface for all integration services
 * Each platform (Jira, GitHub, Linear, Slack) implements this interface
 */
export interface IntegrationService {
  /**
   * Platform name (jira, github, linear, slack)
   */
  readonly platform: string;

  /**
   * Create issue/ticket/message on external platform from bug report
   * @param bugReport - Bug report to create issue from
   * @param projectId - Project ID for loading integration config
   * @param integrationId - Specific integration ID to use (for projects with multiple integrations)
   * @param metadata - Optional metadata for ticket creation (rule_id, created_automatically)
   * @returns Integration result with external ID and URL
   */
  createFromBugReport(
    bugReport: BugReport,
    projectId: string,
    integrationId: string,
    metadata?: TicketCreationMetadata
  ): Promise<IntegrationResult>;

  /**
   * Test connection to external platform
   * @param projectId - Project ID for loading integration config
   * @returns True if connection successful, false otherwise
   */
  testConnection(projectId: string): Promise<boolean>;

  /**
   * Validate configuration object
   * @param config - Configuration object to validate
   * @returns Validation result with error details if invalid
   */
  validateConfig(config: Record<string, unknown>): Promise<{
    valid: boolean;
    error?: string;
    details?: Record<string, unknown>;
  }>;

  /**
   * Search for users in the external platform (optional)
   * @param config - Integration configuration
   * @param query - Search query (email or name)
   * @param maxResults - Maximum number of results to return
   * @returns Array of users
   */
  searchUsers?(
    config: Record<string, unknown>,
    query: string,
    maxResults?: number
  ): Promise<
    Array<{
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrls?: Record<string, string>;
    }>
  >;

  /**
   * Get allowed avatar domains for this integration (optional)
   * Returns array of trusted domains that avatars can be proxied from
   * @param config - Integration configuration
   * @returns Array of allowed hostnames (e.g., ['secure.gravatar.com', '*.atlassian.net'])
   */
  getAllowedAvatarDomains?(config: Record<string, unknown>): string[];
}
