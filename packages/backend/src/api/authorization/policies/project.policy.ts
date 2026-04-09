/**
 * Project Policy
 *
 * Handles project-level access for users (via project role) and API keys
 * (via allowed_projects list).
 */

import type { Policy, PolicyResult, Subject, Action, Resource } from '../types.js';
import type { ProjectRole } from '../../../types/project-roles.js';
import { hasPermissionLevel } from '../../../types/project-roles.js';

/** Minimum project role required for each action */
const PROJECT_ACTION_MIN_ROLE: Record<string, ProjectRole> = {
  delete: 'owner',
  transfer: 'owner',
  manage: 'admin',
  create: 'member',
  update: 'member',
  read: 'viewer',
  list: 'viewer',
};

export const projectPolicy: Policy = {
  name: 'project',

  evaluate(subject: Subject, action: Action, resource: Resource): PolicyResult {
    if (resource.type !== 'project' && resource.type !== 'bugReport') {
      return { decision: 'abstain' };
    }

    const projectId = resource.projectId;

    // API key: check allowed_projects list
    if (subject.kind === 'apiKey') {
      const allowed = subject.apiKey.allowed_projects;
      if (!allowed || allowed.length === 0) {
        // null or empty = unrestricted access (matches existing checkProjectPermission behavior)
        return { decision: 'allow', reason: 'API key has unrestricted project access' };
      }
      if (allowed.includes(projectId)) {
        return { decision: 'allow', reason: 'API key has access to this project' };
      }
      return { decision: 'deny', reason: 'API key does not have access to this project' };
    }

    // User: check project role hierarchy
    if (subject.kind === 'user') {
      if (!subject.projectRole) {
        return { decision: 'deny', reason: 'Not a member of this project' };
      }

      const minRole = PROJECT_ACTION_MIN_ROLE[action] ?? 'admin';
      if (hasPermissionLevel(subject.projectRole, minRole)) {
        return {
          decision: 'allow',
          reason: `Project role ${subject.projectRole} >= ${minRole}`,
        };
      }
      return {
        decision: 'deny',
        reason: `Requires project role ${minRole}, have ${subject.projectRole}`,
      };
    }

    return { decision: 'abstain' };
  },
};
