/**
 * Tenant Resolution Middleware
 * Extracts organization from request subdomain in SaaS mode.
 * No-op in self-hosted mode.
 */

import { isIP } from 'net';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import { SUBSCRIPTION_STATUS } from '../../db/types.js';
import type { SubscriptionStatus } from '../../db/types.js';
import { getDeploymentConfig, DEPLOYMENT_MODE } from '../config.js';
import { sendError } from '../../api/utils/response.js';

// Statuses that allow access to the tenant
const ACTIVE_STATUSES: Set<SubscriptionStatus> = new Set([
  SUBSCRIPTION_STATUS.TRIAL,
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAST_DUE,
]);

// Reserved subdomains that cannot be used for organizations
export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'admin',
  'api',
  'app',
  'mail',
  'ftp',
  'status',
  'docs',
  'help',
  'support',
  'billing',
  'dashboard',
  'static',
  'cdn',
  'assets',
  'auth',
  'login',
  'signup',
  'demo',
  'payment',
]);

// Route prefixes exempt from tenant resolution — these operate at
// instance or user level and are independently access-controlled.
export const TENANT_EXEMPT_PREFIXES = [
  '/api/v1/admin/', // global admin (requireRole('admin'))
  '/api/v1/users/me/', // current user profile & preferences
  '/api/v1/audit-logs', // instance-wide audit (requireRole('admin'))
] as const;

// Minimum parts required for a valid subdomain (e.g., sub.domain.tld)
const MIN_PARTS_FOR_SUBDOMAIN = 3;

// Minimum subdomain length (e.g., "abc" is valid, "ab" is not)
const MIN_SUBDOMAIN_LENGTH = 3;

/**
 * Extract subdomain from hostname.
 * e.g. "acme.bugspotter.io" → "acme"
 *      "bugspotter.io" → null
 *      "localhost" → null
 */
export function extractSubdomain(hostname: string): string | null {
  // Strip port if present, normalize case, and trim
  let host = hostname.split(':')[0].toLowerCase().trim();

  // Strip trailing dots (FQDN format)
  while (host.endsWith('.')) {
    host = host.slice(0, -1);
  }

  // Reject IP addresses (IPv4 and IPv6)
  if (isIP(host) !== 0) {
    return null;
  }

  const parts = host.split('.');

  // Need at least 3 parts for a subdomain (sub.domain.tld)
  if (parts.length < MIN_PARTS_FOR_SUBDOMAIN) {
    return null;
  }

  const subdomain = parts[0];

  // Reject too short subdomains
  if (subdomain.length < MIN_SUBDOMAIN_LENGTH) {
    return null;
  }

  // Reject reserved subdomains
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return null;
  }

  return subdomain;
}

export function createTenantMiddleware(db: DatabaseClient) {
  return async function tenantMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const config = getDeploymentConfig();

    if (config.mode !== DEPLOYMENT_MODE.SAAS) {
      return;
    }

    // Skip public routes
    if (request.routeOptions?.config?.public) {
      return;
    }

    // Skip unmatched routes (404s) - avoid unnecessary DB queries
    if (!request.routeOptions?.url) {
      return;
    }

    // Routes that operate at instance or user level, not tenant level.
    // These are either protected by requireRole('admin') or scoped to the
    // authenticated user — they never need organization context.
    const url = request.routeOptions.url;
    if (TENANT_EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      return;
    }

    const subdomain = extractSubdomain(request.hostname);
    if (!subdomain) {
      // Hub domain (e.g. app.bugspotter.io) or bare domain — no org context.
      // Don't reject: let routes handle the absence of organizationId themselves.
      // Routes that need org context use their own guards (requireOrgRole, etc.)
      return;
    }

    const organization = await db.organizations.findBySubdomain(subdomain);
    if (!organization) {
      sendError(
        reply,
        404,
        'OrganizationNotFound',
        `No organization found for subdomain: ${subdomain}`,
        request.id
      );
      return;
    }

    if (!ACTIVE_STATUSES.has(organization.subscription_status)) {
      sendError(reply, 403, 'SubscriptionInactive', 'Your subscription is not active', request.id, {
        status: organization.subscription_status,
      });
      return;
    }

    request.organization = organization;
    request.organizationId = organization.id;
  };
}
