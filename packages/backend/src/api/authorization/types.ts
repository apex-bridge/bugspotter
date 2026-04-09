/**
 * Authorization Types
 *
 * Defines the core authorization model: Subject, Action, Resource, Policy.
 * Every authorization decision flows through authorize(subject, action, resource).
 */

import type { User, ApiKey, Project, Organization } from '../../db/types.js';
import type { OrgMemberRole } from '../../db/types.js';
import type { ProjectRole } from '../../types/project-roles.js';

// ============================================================================
// SUBJECT: Who is making the request?
// ============================================================================

export type Subject = UserSubject | ApiKeySubject | ShareTokenSubject | AnonymousSubject;

export interface UserSubject {
  kind: 'user';
  user: User;
  orgRole?: OrgMemberRole;
  projectRole?: ProjectRole;
}

export interface ApiKeySubject {
  kind: 'apiKey';
  apiKey: ApiKey;
  project?: Project;
}

export interface ShareTokenSubject {
  kind: 'shareToken';
  bugReportId: string;
}

export interface AnonymousSubject {
  kind: 'anonymous';
}

// ============================================================================
// RESOURCE: What are they acting on?
// ============================================================================

export type Resource =
  | { type: 'platform' }
  | { type: 'organization'; organizationId: string }
  | { type: 'project'; projectId: string; organizationId?: string }
  | { type: 'bugReport'; bugReportId: string; projectId: string; organizationId?: string };

// ============================================================================
// ACTION: What do they want to do?
// ============================================================================

export type Action =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list'
  | 'manage'
  | 'transfer'
  | string;

// ============================================================================
// POLICY: The decision
// ============================================================================

export type Decision = 'allow' | 'deny' | 'abstain';

export interface PolicyResult {
  decision: Decision;
  reason?: string;
}

export interface Policy {
  name: string;
  evaluate(
    subject: Subject,
    action: Action,
    resource: Resource
  ): PolicyResult | Promise<PolicyResult>;
}

// ============================================================================
// AUTHORIZATION CONTEXT: Attached to request after authorization
// ============================================================================

export interface AuthorizationContext {
  subject: Subject;
  orgRole?: OrgMemberRole;
  projectRole?: ProjectRole;
  project?: Project;
  organization?: Organization;
}
