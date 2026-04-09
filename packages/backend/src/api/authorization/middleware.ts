/**
 * Authorization Guard Middleware
 *
 * Single middleware factory that replaces all existing auth middleware combinations.
 * Connects the policy-based authorization system to Fastify routes.
 *
 * Usage:
 *   preHandler: [guard(db, { auth: 'user', platformRole: 'admin' })]
 *   preHandler: [guard(db, { auth: 'any', resource: { type: 'project', paramName: 'projectId' } })]
 *   preHandler: [guard(db, { auth: 'user', resource: { type: 'organization', paramName: 'orgId' }, orgRole: 'admin' })]
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { OrgMemberRole, Organization } from '../../db/types.js';
import type { ProjectRole } from '../../types/project-roles.js';
import type { Subject, Action, Resource } from './types.js';
import { extractSubject } from './subject.js';
import { authorize } from './policies/index.js';
import { hasPermissionLevel, getEffectiveProjectRole } from '../../types/project-roles.js';
import { ROLE_LEVEL } from '../../db/types.js';
import { sendUnauthorized, sendForbidden } from '../middleware/auth/responses.js';
import { isPlatformAdmin } from '../middleware/auth/assertions.js';
import { AppError } from '../middleware/error.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// Options
// ============================================================================

export interface GuardOptions {
  /** Required authentication method */
  auth: 'user' | 'apiKey' | 'userOrApiKey' | 'any' | 'shareToken';

  /** Resource to resolve from route params */
  resource?: ResourceSpec;

  /** Override action (defaults to HTTP method mapping) */
  action?: Action;

  /** Minimum platform role (enforced before policy chain) */
  platformRole?: 'admin';

  /** Minimum org role (requires org resource or project with org) */
  orgRole?: OrgMemberRole;

  /** Minimum project role (requires project resource) */
  projectRole?: ProjectRole;
}

export type ResourceSpec =
  | { type: 'platform' }
  | { type: 'organization'; paramName?: string }
  | { type: 'project'; paramName?: string };

// ============================================================================
// Platform role hierarchy
// ============================================================================

// Platform role hierarchy removed — isPlatformAdmin() is the sole check now

// ============================================================================
// Guard factory
// ============================================================================

export function guard(db: DatabaseClient, options: GuardOptions) {
  // Fail-fast: validate option combinations at construction time
  if (options.projectRole && (!options.resource || options.resource.type !== 'project')) {
    throw new Error('guard: projectRole requires resource: { type: "project" }');
  }
  if (
    options.orgRole &&
    (!options.resource ||
      (options.resource.type !== 'organization' && options.resource.type !== 'project'))
  ) {
    throw new Error(
      'guard: orgRole requires resource: { type: "organization" } or { type: "project" }'
    );
  }

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Extract subject from authenticated request
    const subject = extractSubject(request);

    // 2. Validate auth method
    if (!isAuthMethodAllowed(subject, options.auth)) {
      return sendUnauthorized(reply, authMethodMessage(options.auth));
    }

    // 3. Enforce platform admin requirement (before any DB lookups)
    if (options.platformRole === 'admin' && subject.kind === 'user') {
      if (!isPlatformAdmin(subject.user)) {
        return sendForbidden(reply, 'Requires platform admin access');
      }
    }

    // 4. Determine action
    const action = options.action ?? httpMethodToAction(request.method);

    // 5. Resolve resource and enrich subject with roles
    const resource = await resolveResource(db, request, subject, options);

    // 6. Run policy chain
    const result = await authorize(subject, action, resource);

    if (result.decision === 'deny') {
      logger.debug('Authorization denied', {
        subject: subject.kind,
        action,
        resource: resource.type,
        reason: result.reason,
      });
      return sendForbidden(reply, result.reason ?? 'Access denied');
    }

    // 7. Enforce explicit role minimums from guard options
    //    These are hard requirements — non-user subjects (API keys, tokens)
    //    cannot satisfy role-based minimums.
    if (options.projectRole || options.orgRole) {
      if (subject.kind !== 'user') {
        return sendForbidden(reply, 'Requires authenticated user with appropriate role');
      }

      // Platform admins are exempt
      if (!isPlatformAdmin(subject.user)) {
        if (options.projectRole) {
          if (!isProjectRoleSufficient(subject, options.projectRole)) {
            return sendForbidden(reply, `Requires project role ${options.projectRole} or above`);
          }
        }
        if (options.orgRole) {
          if (!subject.orgRole || ROLE_LEVEL[subject.orgRole] < ROLE_LEVEL[options.orgRole]) {
            return sendForbidden(reply, `Requires organization role ${options.orgRole} or above`);
          }
        }
      }
    }
  };
}

/**
 * Check if subject has sufficient project role, considering org inheritance.
 */
function isProjectRoleSufficient(
  subject: Subject & { kind: 'user' },
  requiredRole: ProjectRole
): boolean {
  const effective = getEffectiveProjectRole(subject.projectRole, subject.orgRole);
  if (effective && hasPermissionLevel(effective, requiredRole)) {
    return true;
  }
  return false;
}

// ============================================================================
// Internal helpers
// ============================================================================

function isAuthMethodAllowed(subject: Subject, required: GuardOptions['auth']): boolean {
  if (required === 'any') {
    return subject.kind !== 'anonymous';
  }
  if (required === 'userOrApiKey') {
    return subject.kind === 'user' || subject.kind === 'apiKey';
  }
  if (required === 'user') {
    return subject.kind === 'user';
  }
  if (required === 'apiKey') {
    return subject.kind === 'apiKey';
  }
  if (required === 'shareToken') {
    return subject.kind === 'shareToken';
  }
  return false;
}

function httpMethodToAction(method: string): Action {
  switch (method) {
    case 'GET':
      return 'read';
    case 'POST':
      return 'create';
    case 'PUT':
    case 'PATCH':
      return 'update';
    case 'DELETE':
      return 'delete';
    default:
      return 'read';
  }
}

function authMethodMessage(required: GuardOptions['auth']): string {
  switch (required) {
    case 'user':
      return 'User authentication required (Authorization Bearer token)';
    case 'apiKey':
      return 'API key required (X-API-Key header)';
    case 'any':
      return 'Authentication required';
    case 'shareToken':
      return 'Share token required';
    default:
      return 'Authentication required';
  }
}

/**
 * Resolve the resource from route params and enrich the subject with roles.
 */
async function resolveResource(
  db: DatabaseClient,
  request: FastifyRequest,
  subject: Subject,
  options: GuardOptions
): Promise<Resource> {
  if (!options.resource || options.resource.type === 'platform') {
    return { type: 'platform' };
  }

  const params = request.params as Record<string, string>;

  // --- Organization resource ---
  if (options.resource.type === 'organization') {
    const orgId = params[options.resource.paramName ?? 'id'];
    if (!orgId) {
      throw new AppError('Organization ID is required', 400, 'BadRequest');
    }

    if (subject.kind === 'user') {
      const org = await resolveOrgRole(db, subject, orgId);
      request.organizationId = orgId;
      request.organization = org;
    }

    return { type: 'organization', organizationId: orgId };
  }

  // --- Project resource ---
  if (options.resource.type === 'project') {
    const projectId = params[options.resource.paramName ?? 'id'];
    if (!projectId) {
      throw new AppError('Project ID is required', 400, 'BadRequest');
    }

    const project = await db.projects.findById(projectId);
    if (!project) {
      throw new AppError('Project not found', 404, 'NotFound');
    }

    request.project = project;
    request.projectId = projectId;

    if (subject.kind === 'user') {
      // Resolve explicit project role
      const projectRole = await db.projects.getUserRole(projectId, subject.user.id);
      if (projectRole) {
        subject.projectRole = projectRole as ProjectRole;
        request.projectRole = projectRole as ProjectRole;
      }

      // Resolve org role for inheritance (if project belongs to an org)
      if (project.organization_id) {
        const org = await resolveOrgRole(db, subject, project.organization_id);
        request.organizationId = project.organization_id;
        request.organization = org;

        // Set effective project role: max(explicit, inherited from org)
        if (subject.orgRole) {
          const effective = getEffectiveProjectRole(subject.projectRole, subject.orgRole);
          if (effective) {
            subject.projectRole = effective;
            request.projectRole = effective;
          }
        }
      }
    }

    return {
      type: 'project',
      projectId,
      organizationId: project.organization_id ?? undefined,
    };
  }

  return { type: 'platform' };
}

/**
 * Look up org membership and set orgRole on the subject.
 * Throws AppError(404) if org not found. DB errors propagate as-is.
 * Returns the organization object for attaching to request.
 */
async function resolveOrgRole(
  db: DatabaseClient,
  subject: Subject & { kind: 'user' },
  orgId: string
): Promise<Organization> {
  const { organization, membership } = await db.organizationMembers.checkOrganizationAccess(
    orgId,
    subject.user.id
  );

  if (!organization) {
    throw new AppError('Organization not found', 404, 'NotFound');
  }

  if (membership) {
    subject.orgRole = membership.role as OrgMemberRole;
  }

  return organization;
}
