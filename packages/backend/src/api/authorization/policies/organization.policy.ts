/**
 * Organization Policy
 *
 * Handles:
 * 1. Direct org resource access (owner > admin > member)
 * 2. Org-to-project inheritance: org owners/admins get project admin,
 *    org members get project viewer access.
 */

import type { Policy, PolicyResult, Subject, Action, Resource } from '../types.js';
import { ROLE_LEVEL, type OrgMemberRole } from '../../../db/types.js';
import {
  hasPermissionLevel,
  getInheritedProjectRole,
  type ProjectRole,
} from '../../../types/project-roles.js';

/** Minimum org role required for each action on org resources */
const ORG_ACTION_MIN_ROLE: Record<string, OrgMemberRole> = {
  delete: 'owner',
  transfer: 'owner',
  manage: 'admin',
  create: 'admin',
  update: 'admin',
  read: 'member',
  list: 'member',
};

/** Minimum project role for each action (reuses ProjectRole type) */
const PROJECT_ACTION_MIN_ROLE: Record<string, ProjectRole> = {
  delete: 'owner',
  transfer: 'owner',
  manage: 'admin',
  create: 'member',
  update: 'member',
  read: 'viewer',
  list: 'viewer',
};

export const organizationPolicy: Policy = {
  name: 'organization',

  evaluate(subject: Subject, action: Action, resource: Resource): PolicyResult {
    // Only applies to user subjects with org roles
    if (subject.kind !== 'user' || !subject.orgRole) {
      if (resource.type === 'organization') {
        return { decision: 'deny', reason: 'Organization membership required' };
      }
      return { decision: 'abstain' };
    }

    const orgRole = subject.orgRole;

    // Direct org resource access
    if (resource.type === 'organization') {
      const minRole = ORG_ACTION_MIN_ROLE[action] ?? 'admin';
      if (ROLE_LEVEL[orgRole] >= ROLE_LEVEL[minRole]) {
        return { decision: 'allow', reason: `Org role ${orgRole} >= ${minRole}` };
      }
      return { decision: 'deny', reason: `Requires org role ${minRole}, have ${orgRole}` };
    }

    // Org-to-project inheritance (only when resource has organizationId)
    if (
      (resource.type === 'project' || resource.type === 'bugReport') &&
      'organizationId' in resource &&
      resource.organizationId
    ) {
      const inheritedRole = getInheritedProjectRole(orgRole);
      const minRole = PROJECT_ACTION_MIN_ROLE[action] ?? 'admin';

      if (hasPermissionLevel(inheritedRole, minRole)) {
        return {
          decision: 'allow',
          reason: `Org ${orgRole} inherits project ${inheritedRole}`,
        };
      }
      // Inheritance insufficient — abstain so projectPolicy can check explicit project role.
      // This enables the "inherited floor, explicit can elevate" behavior.
      return { decision: 'abstain' };
    }

    return { decision: 'abstain' };
  },
};
