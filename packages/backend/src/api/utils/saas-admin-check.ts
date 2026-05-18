/**
 * Helpers for "is this user effectively a SaaS-tenant admin?"
 *
 * Several admin routes (creating API keys, creating projects) had a
 * naïve gate that blocked system role `'viewer'`. That's correct for
 * the self-hosted single-tenant deployment — where customer users
 * are system role `'user'` or `'admin'` — but actively wrong for
 * SaaS, where customer-tenant org owners ALWAYS have system role
 * `'viewer'` by design (platform-admin is a BugSpotter-staff
 * concept, not a customer-tenant one). The fix is to consult
 * `saas.organization_members` instead of relying on the system role
 * alone.
 *
 * Two helpers, two intents:
 *
 * - `userIsOrgAdminAnywhere` is fine when a downstream gate already
 *   pins the user to a specific resource scope (api-keys POST relies
 *   on `assertCanGrantProjects`, DELETE on `authorizeApiKeyAccess`).
 *   The viewer check here is just "is this person allowed on this
 *   admin surface at all?"; the per-resource check is authoritative.
 *
 * - `userIsOrgAdminOfOrg` is required when there's no downstream gate
 *   on the target tenant. `projects.ts` is the canonical example: a
 *   user who's admin in Org A but only member in Org B could
 *   otherwise create a project in B, because the bare
 *   `userIsOrgAdminAnywhere` check sees their admin-in-A membership
 *   and waves them through. Resolve the target org first, then call
 *   this.
 */

import { ORG_MEMBER_ROLE } from '../../db/types.js';
import type { DatabaseClient } from '../../db/client.js';

/**
 * Returns true if the user is owner or admin of at least one
 * organization. Cheap `EXISTS` query — does not pull membership rows
 * into memory. Use only when a downstream gate enforces the actual
 * target-scope authorization.
 */
export async function userIsOrgAdminAnywhere(db: DatabaseClient, userId: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM saas.organization_members
       WHERE user_id = $1
         AND role IN ($2, $3)
     ) AS exists`,
    [userId, ORG_MEMBER_ROLE.OWNER, ORG_MEMBER_ROLE.ADMIN]
  );
  return result.rows[0]?.exists === true;
}

/**
 * Targeted check: is the user owner or admin of the SPECIFIC
 * organization? Required for routes that create / modify resources
 * scoped to a particular tenant. `userIsOrgAdminAnywhere` is unsafe
 * for those — see the file-header note on cross-tenant escalation.
 */
export async function userIsOrgAdminOfOrg(
  db: DatabaseClient,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM saas.organization_members
       WHERE user_id = $1
         AND organization_id = $2
         AND role IN ($3, $4)
     ) AS exists`,
    [userId, organizationId, ORG_MEMBER_ROLE.OWNER, ORG_MEMBER_ROLE.ADMIN]
  );
  return result.rows[0]?.exists === true;
}
