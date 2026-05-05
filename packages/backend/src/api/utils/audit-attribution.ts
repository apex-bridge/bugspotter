/**
 * Audit attribution helper.
 *
 * Single source of truth for "who do we record as the human actor
 * when writing an audit row." Used by the global audit middleware and
 * every handler-level logger that writes audit rows directly.
 *
 * Resolution order:
 *   1. `request.authUser?.id` — JWT-only path (auth middleware ran
 *      handleJwtAuth, populated authUser with a DB-verified User).
 *   2. `request.jwtUserIdentity?.id` — dual-header path (auth
 *      middleware authenticated via api-key but also verified an
 *      accompanying JWT for *attribution* — see auth/middleware.ts
 *      and the docstring on `request.jwtUserIdentity` in api/types.ts).
 *      Only set when both signature verification AND a DB existence
 *      check succeed; an invalid / forged / deleted-user JWT yields
 *      undefined here so the audit row records `null`.
 *   3. `null` — api-key-only path, share-token path, or anonymous
 *      request. Machine attribution (api_key_id) is captured
 *      separately in `details.api_key_id`; the human-actor column is
 *      honestly null.
 *
 * The two upstream fields are mutually exclusive by construction
 * (authUser only set on the JWT-only path; jwtUserIdentity only set
 * on the dual-header path), so this fallback never double-counts.
 *
 * Centralising it here is what protects the GH-97 contract: if the
 * resolution rule changes again (e.g., when the audit_logs.api_key_id
 * column from #104 lands), it changes here and propagates to every
 * caller — the alternative (open-coding the chain at every site)
 * silently drifts the moment one site is updated and the others
 * aren't.
 */

import type { FastifyRequest } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { ApiKey } from '../../db/types.js';
import { lookupInheritedProjectRole } from './resource.js';

export function getAuditUserId(request: FastifyRequest): string | null {
  return request.authUser?.id ?? request.jwtUserIdentity?.id ?? null;
}

/**
 * Cross-check that a JWT user has a verifiable access relationship
 * with an api-key's scope before recording them as the audit actor on
 * a dual-header request.
 *
 * Why this exists. The attribution-only JWT branch in auth/middleware.ts
 * verifies the JWT signature and confirms the user exists, but
 * neither check restricts WHICH user can be attributed. Without the
 * cross-check, an actor with two unrelated credentials — a leaked
 * api-key for project P and a valid JWT for any user U with no
 * relationship to P — could plant U.id as the audit actor on every
 * request against P. The audit trail goes from the honest pre-PR-107
 * `user_id: null` to an attacker-controlled user_id, which is worse
 * than null.
 *
 * Resolution rules:
 *   - **Project-scoped api-key** (`allowed_projects` non-empty):
 *     attribute only if the JWT user has any effective role
 *     (explicit project_members row OR org-inherited via the
 *     project's organization) on at least one of the api-key's
 *     allowed projects. "Effective role" mirrors what
 *     `requireProjectAccess` enforces on the JWT-only path; without
 *     this, dual-header would bypass the org-membership boundary
 *     that JWT-only requests are bound by.
 *   - **Full-scope api-key** (`allowed_projects` null or empty):
 *     no verifiable project relationship to cross-check. Skip
 *     attribution; audit row records `user_id: null`. This is the
 *     same shape as pre-PR-107 for these requests, so it doesn't
 *     regress anything — full-scope api-keys are typically platform-
 *     level credentials where the operator-vs-key relationship
 *     can't be inferred from headers alone.
 *
 * Failure mode is fail-closed: any error during the lookup yields
 * `false` rather than throwing. The api-key already authenticated
 * the request; a transient DB hiccup during attribution must not
 * fail the request, but it also must not result in unverified
 * attribution.
 */
export async function jwtUserCanAttributeForApiKey(
  db: DatabaseClient,
  userId: string,
  apiKey: ApiKey
): Promise<boolean> {
  if (!apiKey.allowed_projects || apiKey.allowed_projects.length === 0) {
    return false;
  }

  try {
    const explicitRoles = await db.projects.getUserRolesForProjects(
      apiKey.allowed_projects,
      userId
    );
    for (const role of explicitRoles.values()) {
      if (role !== null) {
        return true;
      }
    }

    for (const projectId of apiKey.allowed_projects) {
      const inherited = await lookupInheritedProjectRole(projectId, userId, db);
      if (inherited) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}
