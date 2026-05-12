/**
 * Linear Integration Module
 *
 * Public surface of the Linear plugin. The `default` export is what
 * `PluginRegistry.loadFromFilesystem` looks for when a route asks for the
 * platform by name without a pre-registered plugin.
 */

import { linearPlugin } from './plugin.js';

export { LinearClient } from './client.js';
export { LinearBugReportMapper, mapPriorityToLinear } from './mapper.js';
export { LinearConfigManager } from './config.js';
export {
  LinearIntegrationService,
  buildLinearAllowedAvatarDomains,
  LINEAR_TRUSTED_AVATAR_DOMAINS,
} from './service.js';
export { LINEAR_DEFAULT_DESCRIPTION_TEMPLATE } from './default-template.js';
export { linearPlugin } from './plugin.js';

export type {
  LinearConfig,
  LinearCredentials,
  LinearProjectConfig,
  LinearPriority,
  LinearTemplateConfig,
  LinearIssueInput,
  LinearIssue,
  LinearTeam,
  LinearProject,
  LinearUser,
  LinearViewer,
  LinearAttachment,
  LinearFileUpload,
  LinearConnectionTestResult,
  LinearIntegrationResult,
  LinearGraphQLError,
} from './types.js';

export default linearPlugin;
