/**
 * Jira Integration Types
 * Type definitions for Jira REST API v3
 */

/**
 * Default share token expiration in hours (30 days)
 */
export const SHARE_TOKEN_EXPIRATION_HOURS = 720;

/**
 * Template configuration for Jira ticket formatting
 */
export interface JiraTemplateConfig {
  // Console logs
  includeConsoleLogs?: boolean; // Default: true
  consoleLogLimit?: number; // Default: 50, max entries to include

  // Network logs
  includeNetworkLogs?: boolean; // Default: true
  networkLogFilter?: 'all' | 'failures'; // Default: 'failures' (only 4xx/5xx)
  networkLogLimit?: number; // Default: 20

  // Share replay
  includeShareReplay?: boolean; // Default: true if replay exists
  shareReplayExpiration?: number; // Hours, default: 720 (30 days)
  shareReplayPassword?: string | null; // Optional password protection
}

/**
 * Jira configuration for a project
 */
export interface JiraConfig {
  host: string; // https://company.atlassian.net
  email: string; // user@company.com
  apiToken: string; // Jira API token (never password)
  projectKey: string; // Default project (e.g., "BUG")
  issueType?: string; // Default: "Bug"
  enabled: boolean;
  templateConfig?: Partial<JiraTemplateConfig>; // Template configuration for ticket formatting
}

/**
 * Jira credentials (sensitive data that gets encrypted)
 */
export interface JiraCredentials {
  email: string;
  apiToken: string;
}

/**
 * Jira configuration (non-sensitive data)
 */
export interface JiraProjectConfig {
  host?: string; // Legacy field name
  instanceUrl?: string; // New field name from admin panel
  projectKey: string;
  issueType: string;
  autoCreate: boolean;
  syncStatus: boolean;
  syncComments: boolean;
  customFields?: Record<string, unknown>;
  templateConfig?: Partial<JiraTemplateConfig>;
}

/**
 * Jira issue priority mapping
 */
export type JiraPriority = 'Highest' | 'High' | 'Medium' | 'Low' | 'Lowest';

/**
 * Jira issue type
 */
export type JiraIssueType = 'Bug' | 'Task' | 'Story' | 'Epic' | 'Subtask';

/**
 * Jira issue fields for creation
 * Matches Jira REST API v3 format
 */
export interface JiraIssueFields {
  project: {
    key: string; // Project key (e.g., "BUG")
  };
  issuetype: {
    name: string; // Issue type (e.g., "Bug")
  };
  summary: string; // Issue title (max 255 characters)
  description: JiraDescription | string; // Issue description (ADF or text)
  priority?: {
    name: JiraPriority | string; // Priority name (typed or custom)
  };
  labels?: string[]; // Issue labels
  components?: Array<{ id?: string; name?: string }>; // Issue components
  assignee?: {
    accountId?: string; // Assignee account ID
    emailAddress?: string; // Assignee email (deprecated)
  };
  reporter?: {
    accountId?: string; // Reporter account ID
    emailAddress?: string; // Reporter email (deprecated)
  };
  // Support custom fields via index signature
  [key: string]: unknown;
}

/**
 * Jira Atlassian Document Format (ADF) for rich text
 * Used in newer Jira Cloud instances
 */
export interface JiraDescription {
  type: 'doc';
  version: 1;
  content: JiraDescriptionNode[];
}

export interface JiraDescriptionNode {
  type: string;
  content?: JiraDescriptionNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/**
 * Jira issue response from API
 */
export interface JiraIssue {
  id: string;
  key: string; // Issue key (e.g., "BUG-123")
  self: string; // API URL to issue
  fields: {
    summary: string;
    description: JiraDescription | string;
    status: {
      name: string;
    };
    priority?: {
      name: string;
    };
    created: string;
    updated: string;
  };
}

/**
 * Jira attachment upload response
 */
export interface JiraAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  content: string; // URL to attachment
  thumbnail?: string; // URL to thumbnail
}

/**
 * Jira API error response
 */
export interface JiraError {
  errorMessages?: string[];
  errors?: Record<string, string>;
  statusCode?: number;
}

/**
 * Jira connection test result
 */
export interface JiraConnectionTestResult {
  valid: boolean;
  error?: string;
  details?: {
    host: string;
    projectExists: boolean;
    userHasAccess: boolean;
  };
}

/**
 * Jira integration result
 */
export interface JiraIntegrationResult {
  issueKey: string; // Jira issue key (e.g., "BUG-123")
  issueUrl: string; // URL to issue
  issueId: string; // Jira internal ID
  attachments: JiraAttachment[];
}

/**
 * Jira user (from user search API)
 */
export interface JiraUser {
  accountId: string; // Unique account ID
  accountType: string; // "atlassian" or "app"
  emailAddress?: string; // Email (may not be exposed due to privacy)
  displayName: string; // Full name
  active: boolean; // Whether user is active
  avatarUrls?: {
    '48x48'?: string;
    '24x24'?: string;
    '16x16'?: string;
    '32x32'?: string;
  };
}
