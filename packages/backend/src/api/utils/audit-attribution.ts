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
 *   - **Single-project api-key** (`allowed_projects.length === 1`):
 *     the api-key targets exactly one project, so the cross-check has
 *     an unambiguous scope. Attribute only if the JWT user has any
 *     effective role (explicit `project_members` row OR org-inherited
 *     via the project's `organization_id`) on that project.
 *     "Effective role" mirrors what `requireProjectAccess` enforces
 *     on the JWT-only path; without this, dual-header would bypass
 *     the org-membership boundary JWT-only requests are bound by.
 *   - **Multi-project api-key** (`allowed_projects.length > 1`):
 *     the request could target any of the listed projects, and at
 *     auth-middleware time we don't know which. A user who is a
 *     member of project A on a `[A, B, C]` api-key could otherwise
 *     be falsely attributed for requests against B or C. Skip
 *     attribution; audit row records `user_id: null`. Pre-PR-107
 *     also recorded null for these, so this isn't a regression.
 *   - **Full-scope api-key** (`allowed_projects` null or empty):
 *     no verifiable project relationship at all. Skip attribution;
 *     same shape as pre-PR-107.
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
  apiKey: ApiKey,
  /**
   * The api-key's target project's `organization_id`, if the caller
   * already loaded the project. `handleNewApiKeyAuth` always loads
   * the project for single-project keys ([handlers.ts:95-100]) and
   * stores it in `request.authProject`, and that's the only api-key
   * shape this helper attributes for, so the call site in the auth
   * middleware can pass `request.authProject?.organization_id`
   * directly to skip the redundant `db.projects.findById` that
   * `lookupInheritedProjectRole` would otherwise run internally.
   * Same optimization the standard `requireProjectAccess` uses on
   * the JWT-only path. `undefined` is the safe default — the helper
   * just falls back to its own lookup.
   */
  organizationId?: string | null
): Promise<boolean> {
  // Singleton-only: only attribute when the api-key's scope is
  // unambiguous. Anything else (multi-project or full-scope) leaves
  // the request-target ambiguous at this point in the lifecycle.
  if (!apiKey.allowed_projects || apiKey.allowed_projects.length !== 1) {
    return false;
  }

  const projectId = apiKey.allowed_projects[0];

  try {
    // Parallel — same pattern `requireProjectAccess` uses (auth.md §3).
    // Slightly more DB load on the hit-explicit case (one extra query
    // that wasn't needed) but lower worst-case latency on the
    // org-inheritance case, which dominates SaaS where org membership
    // is the typical access path. Fail-closed via the outer try/catch.
    const [explicit, inherited] = await Promise.all([
      db.projects.getUserRole(projectId, userId),
      lookupInheritedProjectRole(projectId, userId, db, organizationId),
    ]);
    return explicit !== null || inherited !== null;
  } catch {
    return false;
  }
}
