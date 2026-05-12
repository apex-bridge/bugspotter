/**
 * Linear Integration Plugin
 *
 * Plugin wrapper for the Linear integration service. Registered via
 * `plugin-loader.ts` alongside the Jira plugin.
 */

import type { IntegrationPlugin } from '../plugin.types.js';
import { LinearIntegrationService } from './service.js';
import { LINEAR_DEFAULT_DESCRIPTION_TEMPLATE } from './default-template.js';

export const linearPlugin: IntegrationPlugin = {
  metadata: {
    name: 'Linear Integration',
    platform: 'linear',
    version: '1.0.0',
    description: 'Create and sync issues with Linear',
    author: 'BugSpotter Team',
    // ENCRYPTION_KEY is shared infrastructure — already declared by the
    // Jira plugin; listed here too so the registry warns if a deployment
    // somehow lands without it before Jira is loaded.
    requiredEnvVars: ['ENCRYPTION_KEY'],
    isBuiltIn: true,
    defaultDescriptionTemplate: LINEAR_DEFAULT_DESCRIPTION_TEMPLATE,
  },

  factory: (context) => {
    return new LinearIntegrationService(
      context.db.bugReports,
      context.db.projectIntegrations,
      context.db,
      context.storage
    );
  },
};
