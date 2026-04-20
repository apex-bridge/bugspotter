/**
 * Subdomain Service
 * Generates and validates tenant subdomains for self-service signup.
 * Handles slugification, reserved-name blocking, uniqueness across
 * `organizations` and `organization_requests` (to avoid collision when
 * a pending enterprise request is later approved).
 */

import type { DatabaseClient } from '../../db/client.js';
import { AppError } from '../../api/middleware/error.js';
import { RESERVED_SUBDOMAINS as TENANT_RESERVED_SUBDOMAINS } from '../middleware/tenant.js';

const SUBDOMAIN_MIN_LENGTH = 3;
const SUBDOMAIN_MAX_LENGTH = 63;
const MAX_AUTO_SUFFIX_ATTEMPTS = 50;

/**
 * DNS-safe subdomain pattern: lowercase alphanumeric + single hyphens,
 * no leading/trailing hyphen, 3–63 chars (LDH rule minus TLD constraints).
 */
const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * Subdomains reserved for platform infrastructure. Blocking these at signup
 * prevents tenants from impersonating api/admin/support surfaces or
 * colliding with existing DNS records on *.kz.bugspotter.io.
 *
 * This set is a SUPERSET of the tenant resolution middleware's reserved
 * list — anything the middleware refuses to route to must also be blocked
 * at signup, otherwise a user could register an org whose admin UI the
 * router would never serve. Extras here cover environments, monitoring,
 * and platform-only names that the middleware doesn't need to know about.
 */
const SIGNUP_ONLY_RESERVED = new Set([
  // Platform infra
  'media',
  'uploads',
  'files',
  // Environments
  'staging',
  'dev',
  'test',
  'preview',
  'sandbox',
  'local',
  // Product surfaces the tenant middleware doesn't explicitly block
  'blog',
  'register',
  'onboarding',
  // Generic reserved
  'root',
  'system',
  'public',
  'private',
  'internal',
  // Monitoring/ops
  'grafana',
  'prometheus',
  'kibana',
  'logs',
  'metrics',
]);

const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  ...TENANT_RESERVED_SUBDOMAINS,
  ...SIGNUP_ONLY_RESERVED,
]);

export class SubdomainService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Convert an organization name into a DNS-safe subdomain candidate.
   * Strategy: lowercase → replace non-[a-z0-9] with hyphens → collapse
   * consecutive hyphens → trim leading/trailing hyphens → truncate to
   * SUBDOMAIN_MAX_LENGTH → trim edge hyphens again in case the truncation
   * landed on one.
   * Returns empty string if nothing usable remains (caller must handle).
   */
  slugify(input: string): string {
    const normalized = input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // Truncate first, then re-trim — truncation can land on a `-` and leave
    // a trailing hyphen that would fail LDH validation.
    return normalized.slice(0, SUBDOMAIN_MAX_LENGTH).replace(/^-|-$/g, '');
  }

  /**
   * Validate subdomain format and reserved-name policy.
   * Does NOT check uniqueness — use isAvailable() for that.
   */
  validateFormat(subdomain: string): void {
    if (subdomain.length < SUBDOMAIN_MIN_LENGTH) {
      throw new AppError(
        `Subdomain must be at least ${SUBDOMAIN_MIN_LENGTH} characters`,
        400,
        'ValidationError'
      );
    }
    if (subdomain.length > SUBDOMAIN_MAX_LENGTH) {
      throw new AppError(
        `Subdomain must be at most ${SUBDOMAIN_MAX_LENGTH} characters`,
        400,
        'ValidationError'
      );
    }
    if (!SUBDOMAIN_REGEX.test(subdomain)) {
      throw new AppError(
        'Subdomain must contain only lowercase letters, numbers, and hyphens (no leading/trailing hyphen)',
        400,
        'ValidationError'
      );
    }
    if (RESERVED_SUBDOMAINS.has(subdomain)) {
      throw new AppError('This subdomain is reserved', 400, 'ValidationError');
    }
  }

  /**
   * Check if a subdomain is available across both `organizations` and
   * `organization_requests`.
   *
   * The `organizations` side uses `isSubdomainAvailable`, which does NOT
   * filter `deleted_at IS NULL` — so a soft-deleted org still reserves
   * its subdomain until a hard delete. That's intentional: if a tenant
   * is restored or the name is revived by platform admins, the identity
   * is still unambiguous. (Note: the pre-existing `isSubdomainTaken` on
   * `organizationRequests` is misnamed and queries the organizations
   * table with `deleted_at IS NULL` — we don't use it here; we call
   * `isSubdomainReservedByRequest` which queries the request table
   * for non-terminal statuses only.)
   */
  async isAvailable(subdomain: string): Promise<boolean> {
    const normalized = subdomain.toLowerCase();

    // Parallelize the two independent reads — `generateUniqueFromName`
    // calls this up to 50 times in a collision loop, so halving per-iter
    // latency from 2 sequential round-trips to 1 cuts worst-case suffix
    // search time materially.
    const [orgAvailable, requestReserved] = await Promise.all([
      this.db.organizations.isSubdomainAvailable(normalized),
      this.db.organizationRequests.isSubdomainReservedByRequest(normalized),
    ]);

    return orgAvailable && !requestReserved;
  }

  /**
   * Generate a unique subdomain from a seed (e.g. company name).
   * If the slugified seed collides, appends numeric suffixes (-2, -3, ...).
   * Throws if the seed yields no usable slug or suffixes exhaust.
   *
   * Used for auto-suggesting a subdomain from company_name at signup.
   * The caller may still let the user override before commit.
   */
  async generateUniqueFromName(name: string): Promise<string> {
    const base = this.slugify(name);
    if (base.length < SUBDOMAIN_MIN_LENGTH) {
      throw new AppError(
        'Could not derive a valid subdomain from the organization name',
        400,
        'ValidationError',
        { hint: 'Try a name with at least 3 alphanumeric characters' }
      );
    }

    // Reserved base → fall through to suffixed attempts, which are not reserved.
    const baseUsable = !RESERVED_SUBDOMAINS.has(base);

    if (baseUsable && (await this.isAvailable(base))) {
      return base;
    }

    for (let i = 2; i <= MAX_AUTO_SUFFIX_ATTEMPTS; i++) {
      // Leave room for the suffix so total length stays within limit.
      // Re-trim the sliced base so we don't end up with "foo--2" when the
      // cut-off character is a hyphen.
      const suffix = `-${i}`;
      const maxBase = SUBDOMAIN_MAX_LENGTH - suffix.length;
      const trimmedBase = base.slice(0, maxBase).replace(/-+$/, '');
      if (trimmedBase.length < SUBDOMAIN_MIN_LENGTH) {
        continue;
      }
      const candidate = `${trimmedBase}${suffix}`;
      // Defense against future reserved-list growth: if someone later adds
      // a suffixed name like `api-2` to RESERVED_SUBDOMAINS, this loop
      // must not mint it. Today's list has no such entries so this is a
      // guard, not a reachable branch — but zero-cost to check.
      if (RESERVED_SUBDOMAINS.has(candidate)) {
        continue;
      }
      if (await this.isAvailable(candidate)) {
        return candidate;
      }
    }

    throw new AppError(
      'Could not generate a unique subdomain — please choose one manually',
      409,
      'Conflict'
    );
  }

  /**
   * Full validation pipeline for a user-provided subdomain at signup:
   * normalize → format check → reserved check → uniqueness.
   * Throws AppError with a specific code on any failure.
   */
  async assertValidAndAvailable(subdomain: string): Promise<string> {
    const normalized = subdomain.toLowerCase().trim();
    this.validateFormat(normalized);
    if (!(await this.isAvailable(normalized))) {
      throw new AppError('This subdomain is already taken', 409, 'Conflict');
    }
    return normalized;
  }
}
