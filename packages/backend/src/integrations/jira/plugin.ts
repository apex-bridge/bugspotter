/**
 * Jira Integration Plugin
 * Plugin wrapper for Jira integration service
 */

import type { IntegrationPlugin } from '../plugin.types.js';
import { JiraIntegrationService } from './service.js';
import { JIRA_DEFAULT_DESCRIPTION_TEMPLATE } from './default-template.js';

/**
 * Jira integration plugin definition
 */
export const jiraPlugin: IntegrationPlugin = {
  metadata: {
    name: 'Jira Integration',
    platform: 'jira',
    version: '1.0.0',
    description: 'Create and sync issues with Atlassian Jira',
    author: 'BugSpotter Team',
    requiredEnvVars: ['ENCRYPTION_KEY'], // For credential encryption
    isBuiltIn: true, // Built-in plugin loaded from plugin-loader.ts
    defaultDescriptionTemplate: JIRA_DEFAULT_DESCRIPTION_TEMPLATE,
  },

  factory: (context) => {
    return new JiraIntegrationService(
      context.db.bugReports,
      context.db.projectIntegrations,
      context.db,
      context.storage
    );
  },
};
