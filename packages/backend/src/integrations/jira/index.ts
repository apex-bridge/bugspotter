/**
 * Jira Integration Module
 * Complete Jira integration for BugSpotter
 */

export { JiraClient } from './client.js';
export { JiraBugReportMapper } from './mapper.js';
export { JiraConfigManager } from './config.js';
export { JiraIntegrationService } from './service.js';

export type {
  JiraConfig,
  JiraCredentials,
  JiraProjectConfig,
  JiraPriority,
  JiraIssueType,
  JiraIssueFields,
  JiraDescription,
  JiraDescriptionNode,
  JiraIssue,
  JiraAttachment,
  JiraError,
  JiraConnectionTestResult,
  JiraIntegrationResult,
} from './types.js';
