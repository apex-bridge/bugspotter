/**
 * Tenant-Match Guards
 *
 * Closes the cross-tenant access surface the tenant resolution
 * middleware alone leaves open: a JWT issued for a user in org A
 * is bearer-equivalent across every tenant subdomain because the
 * token only carries `userId` (no org binding). Without these
 * guards, presenting an org-A JWT at `orgB.kz.bugspotter.io` reaches
 * handlers with `request.organizationId = orgB` and `request.authUser`
 * = the org-A user, and any handler that doesn't independently
 * cross-check the two would serve org-B's data.
 *
 * Two layers of defence (defense-in-depth):
 *
 *   1. Login-time (`assertUserBelongsToTenant`) — auth routes
 *      (login, register, refresh, magic-login) call this before
 *      issuing tokens. Stops the wrong JWT from being issued in
 *      the first place. Returns same error shape as wrong-password
 *      to avoid user enumeration via differing error codes.
 *
 *   2. Request-time (`createTenantMatchMiddleware`) — runs after
 *      auth + tenant resolution on every authenticated request.
 *      Stops a stolen / replayed / hub-issued JWT from being used
 *      against a tenant subdomain whose org the user doesn't
 *      belong to.
 *
 * Both layers apply uniformly. No platform-admin exemption: per
 * product policy, SaaS admins authenticate only at the hub
 * (`app.kz.bugspotter.io`) — so a platform-admin JWT showing up
 * on a tenant subdomain is itself anomalous and worth blocking.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { User } from '../../db/types.js';
import { AppError } from '../../api/middleware/error.js';
import { sendError } from '../../api/utils/response.js';
import { getDeploymentConfig, DEPLOYMENT_MODE } from '../config.js';
import { TENANT_EXEMPT_PREFIXES } from './tenant.js';

/**
 * Assert that `user` belongs to the tenant identified by
 * `organizationId`. Used at auth-issuance time (login/register/refresh/
 * magic-login) when the request arrived on a tenant subdomain.
 *
 * The error shape deliberately matches wrong-credentials (401
 * `Invalid email or password`) on login/register/refresh paths to
 * avoid user enumeration via differing error codes. Magic-login
 * uses a more specific message because the caller already proved
 * possession of the magic token — no enumeration concern.
 *
 * Skips when:
 *   - Multi-tenancy isn't enabled (self-hosted mode)
 *   - `organizationId` is null/undefined (hub-domain login — kept
 *     working per product decision; users without an org context
 *     are validated via `assertUserHasActiveOrgAccess` separately)
 *
 * @throws AppError(401 'InvalidCredentials') if the user has no
 *         org membership matching `organizationId`. The 401 shape
 *         is intentional for login-style routes; callers that want
 *         a more specific error (e.g., magic-login) should catch
 *         and re-throw with their own status / code.
 */
export async function assertUserBelongsToTenant(
  db: DatabaseClient,
  user: User,
  organizationId: string | null | undefined,
  /**
   * Error message thrown on mismatch. Defaults to the login-shape
   * "Invalid email or password" so an attacker can't enumerate
   * "is this email registered to org X?" by comparing 401 codes
   * with the wrong-password failure path. Refresh-token routes
   * should pass their own shape (e.g., "Invalid or expired refresh
   * token") to match what the surrounding code emits on bad tokens.
   */
  errorMessage = 'Invalid email or password'
): Promise<void> {
  if (!getDeploymentConfig().features.multiTenancy) {
    return;
  }
  if (!organizationId) {
    return;
  }
  const membership = await db.organizationMembers.findMembership(organizationId, user.id);
  if (!membership) {
    throw new AppError(errorMessage, 401, 'Unauthorized');
  }
}

/**
 * Request-time tenant-match middleware. Runs after `requireAuth`
 * and `tenantMiddleware` (must be wired into `server.ts` in that
 * order). Rejects authenticated requests on a tenant subdomain
 * whose org the user doesn't belong to.
 *
 * Skips when:
 *   - Multi-tenancy isn't enabled (self-hosted mode)
 *   - The route is in `TENANT_EXEMPT_PREFIXES` (admin / users-me
 *     / audit-logs are global by design — they intentionally
 *     operate without a tenant context)
 *   - The route is marked `config.public` (unauthenticated routes
 *     have nothing to match)
 *   - There's no JWT user (api-key-only or share-token requests
 *     are bounded by their own scope mechanisms)
 *   - There's no `request.organizationId` (hub-domain — kept
 *     working per product decision)
 *
 * Note: `request.organizationId` is set by `tenantMiddleware` only
 * after the subdomain successfully resolves to an active org. If
 * the subdomain is unknown/inactive, `tenantMiddleware` already
 * 404'd or 403'd and this middleware never runs.
 */
export function createTenantMatchMiddleware(db: DatabaseClient) {
  return async function tenantMatchMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const config = getDeploymentConfig();
    if (config.mode !== DEPLOYMENT_MODE.SAAS) {
      return;
    }

    if (request.routeOptions?.config?.public) {
      return;
    }

    const url = request.routeOptions?.url;
    if (!url) {
      return;
    }
    if (TENANT_EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      return;
    }

    const authUser = request.authUser;
    const organizationId = request.organizationId;
    if (!authUser || !organizationId) {
      return;
    }

    const membership = await db.organizationMembers.findMembership(organizationId, authUser.id);
    if (membership) {
      return;
    }

    // 403 (not 401) because the user IS authenticated; they're just
    // authenticated for the wrong tenant. 401 would prompt clients
    // to retry auth, which wouldn't fix the mismatch.
    sendError(
      reply,
      403,
      'TenantMismatch',
      "Your account does not have access to this organization's workspace.",
      request.id
    );
  };
}
