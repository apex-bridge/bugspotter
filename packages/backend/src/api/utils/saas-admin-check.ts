/**
 * Helpers for "is this user effectively a SaaS-tenant admin somewhere?"
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
 * The check is async (one query) and the result depends only on the
 * user id, so callers should call it at most once per request and
 * cache locally if they need to use it twice.
 */

import { ORG_MEMBER_ROLE, type OrgMemberRole } from '../../db/types.js';
import type { DatabaseClient } from '../../db/client.js';

const ADMIN_LEVEL_ROLES: ReadonlySet<OrgMemberRole> = new Set([
  ORG_MEMBER_ROLE.OWNER,
  ORG_MEMBER_ROLE.ADMIN,
]);

/**
 * Returns true if the user holds owner or admin membership in at
 * least one organization. Used by admin routes that should let SaaS
 * org owners through even though their system role is `'viewer'`.
 *
 * Returns false for:
 *  - users with no organization memberships (selfhosted single-tenant
 *    where the table is empty, or SaaS users who haven't joined an
 *    org yet),
 *  - users whose only org-memberships are role `'member'`.
 *
 * Callers should compose this with the platform-admin / system-role
 * checks they already do, not replace them — selfhosted users still
 * pass the legacy non-viewer system-role gate.
 */
export async function userIsOrgAdminAnywhere(db: DatabaseClient, userId: string): Promise<boolean> {
  const memberships = await db.organizationMembers.findByUserId(userId);
  return memberships.some((m) => ADMIN_LEVEL_ROLES.has(m.role));
}
