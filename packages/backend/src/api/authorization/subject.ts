/**
 * Subject Extraction
 *
 * Maps Fastify request properties (set by auth middleware) to a Subject union.
 * No database calls, no side effects — pure mapping.
 *
 * NOTE (Phase 1): orgRole is not populated here because the current org-access
 * middleware does not set it as a top-level request property. In Phase 2, the
 * guard() middleware will resolve org membership for the specific resource and
 * populate orgRole before calling authorize(). Until then, org policy tests
 * construct subjects manually with orgRole set.
 */

import type { FastifyRequest } from 'fastify';
import type { Subject } from './types.js';

export function extractSubject(request: FastifyRequest): Subject {
  if (request.authShareToken) {
    return { kind: 'shareToken', bugReportId: request.authShareToken.bug_report_id };
  }

  if (request.authUser) {
    return {
      kind: 'user',
      user: request.authUser,
      // projectRole is set by requireProjectAccess middleware
      projectRole: request.projectRole,
      // TODO (Phase 2): populate orgRole from guard() middleware
      // orgRole is not available on request yet — org-access middleware
      // sets request.organizationId but not the membership role directly.
    };
  }

  if (request.apiKey) {
    return {
      kind: 'apiKey',
      apiKey: request.apiKey,
      project: request.authProject,
    };
  }

  return { kind: 'anonymous' };
}
