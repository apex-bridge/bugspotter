/**
 * User Repository
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type { User, UserInsert, PaginatedResult } from '../types.js';
import { createFilter } from '../filter-builder.js';
import { createPagination } from '../pagination-builder.js';
import { getLogger } from '../../logger.js';
import { getDeploymentConfig, DEPLOYMENT_MODE } from '../../saas/config.js';

const logger = getLogger();

export class UserRepository extends BaseRepository<User, UserInsert, Partial<User>> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'users', []);
  }

  /**
   * Take a row-level lock on the user record, scoped to the current
   * transaction. Used by flows that need to serialize per-user
   * mutations (e.g. `resendVerification` — without serialization, two
   * concurrent resend requests can both invalidate prior tokens and
   * each insert a new one, leaving multiple "active" tokens for the
   * same user and breaking the "latest link is the only one that
   * works" guarantee).
   *
   * Must be called inside a `db.transaction(...)` callback — otherwise
   * the lock is released immediately on statement completion and the
   * call has no serializing effect.
   */
  async lockForUpdate(id: string): Promise<void> {
    await this.getClient().query('SELECT id FROM application.users WHERE id = $1 FOR UPDATE', [id]);
  }

  /**
   * Atomically mark a user's email as verified, using `NOW()` from the
   * database (so timestamps in `users` and `email_verification_tokens`
   * come from the same clock — the app server's clock can drift).
   *
   * Returns true on first verification, false when the user was
   * already verified by a concurrent transaction. Combined with the
   * `findByToken` + `consume` flow, this closes a race where two
   * verify-email requests for the same user could both pass the
   * upfront guard and re-stamp `email_verified_at`.
   */
  async markEmailVerified(id: string): Promise<boolean> {
    const result = await this.getClient().query(
      `UPDATE application.users
         SET email_verified_at = NOW()
       WHERE id = $1
         AND email_verified_at IS NULL`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Override serialization to handle defaults
   */
  protected serializeForInsert(data: UserInsert): Record<string, unknown> {
    // Apply defaults before serialization
    const withDefaults = {
      ...data,
      role: data.role ?? 'user',
    };

    // Use parent's serialize method to handle undefined filtering
    return super.serializeForInsert(withDefaults);
  }

  /**
   * Find user by email — case-insensitive.
   *
   * Existing rows in the `users` table may have mixed-case emails: the
   * base UNIQUE constraint is case-sensitive, and historical
   * `/auth/register` paths did not lowercase before insert. A case-
   * sensitive lookup of `foo@bar.com` would miss an existing row stored
   * as `Foo@bar.com`, so duplicate-email checks (in signup/login/invite)
   * would be unreliable and two accounts could end up sharing an
   * effective address.
   *
   * For callers that already normalize (signup service, invitation
   * service) this is redundant-but-safe. For callers that don't
   * (existing `/auth/register` — out of scope here), this at least makes
   * the lookup side correct.
   *
   * Determinism: multiple rows CAN match today if historical data has
   * case-insensitive duplicates. We `ORDER BY created_at ASC, id ASC`
   * and `LIMIT 2` so the caller always sees the oldest row, and we
   * `logger.warn` when more than one matches so ops can schedule a
   * cleanup. A follow-up migration should add a `UNIQUE` functional
   * index on `LOWER(email)` once the data is clean; the current
   * migration 018 adds a non-unique functional index for the perf side
   * only.
   */
  async findByEmail(email: string): Promise<User | null> {
    const query = `
      SELECT *
      FROM ${this.schema}.${this.tableName}
      WHERE LOWER(email) = LOWER($1)
      ORDER BY created_at ASC, id ASC
      LIMIT 2
    `;
    const result = await this.getClient().query<User>(query, [email]);

    if (result.rows.length > 1) {
      // `sampledCount` not `matchedCount`: the query uses `LIMIT 2` as a
      // cheap "more than one" sentinel, so the actual number of duplicate
      // rows may be higher than what we logged. Any non-zero value here
      // still warrants ops cleanup — the exact count requires a separate
      // COUNT(*) if triage needs it.
      logger.warn('Case-insensitive email lookup matched multiple rows', {
        normalizedEmail: email.toLowerCase(),
        sampledCount: result.rows.length,
        oldestId: result.rows[0]?.id,
      });
    }

    return result.rows[0] ?? null;
  }

  /**
   * Find user by OAuth credentials
   */
  async findByOAuth(provider: string, oauthId: string): Promise<User | null> {
    return this.findByMultiple({ oauth_provider: provider, oauth_id: oauthId });
  }

  /**
   * List users with pagination and optional filtering
   */
  async listWithFilters(options: {
    page?: number;
    limit?: number;
    role?: 'admin' | 'user' | 'viewer';
    email?: string;
    /**
     * Restrict to users who are members of the given organization
     * (SaaS only — falls through to no-op in self-hosted where the
     * `saas.organization_members` table is empty).
     */
    organization_id?: string;
  }): Promise<PaginatedResult<Omit<User, 'password_hash'>>> {
    const { page = 1, limit = 20, role, email, organization_id } = options;

    // Build WHERE clause using unified FilterBuilder
    const filter = createFilter().equals('role', role).ilike('email', email);

    // SaaS-only filter: `saas.organization_members` only exists in SaaS
    // deployments. In self-hosted, the schema may not be present at all —
    // applying this predicate would error with "schema saas does not exist"
    // even though the route is gated to platform admins. Skip silently in
    // self-hosted mode (no orgs to filter by anyway).
    if (organization_id && getDeploymentConfig().mode === DEPLOYMENT_MODE.SAAS) {
      // EXISTS keeps the JOIN out of the projection and avoids row-multiplication
      // for users with multiple memberships to the same org (shouldn't happen,
      // but the unique constraint isn't enforced in older deployments).
      const p = filter.getParamCount();
      filter.raw(
        `EXISTS (
          SELECT 1 FROM saas.organization_members om
          WHERE om.user_id = users.id AND om.organization_id = $${p}
        )`,
        [organization_id]
      );
    }

    const { whereClause, values, paramCount } = filter.build();

    // Get total count
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].total);

    // Build pagination using unified PaginationBuilder
    const pagination = createPagination().page(page, limit).orderBy('created_at', 'desc');

    const {
      orderByClause,
      limitClause,
      values: paginationValues,
      metadata,
    } = pagination.build(total, paramCount);

    // Get users (exclude password hash). `email_verified_at` is required
    // on the `User` type — omitting it from the SELECT would type-claim
    // a non-undefined Date|null while returning undefined from pg.
    const result = await this.pool.query<Omit<User, 'password_hash'>>(
      `SELECT id, email, name, role, security, oauth_provider, oauth_id, preferences,
              email_verified_at, created_at
       FROM users ${whereClause}
       ${orderByClause}
       ${limitClause}`,
      [...values, ...paginationValues]
    );

    return {
      data: result.rows,
      pagination: metadata,
    };
  }

  /**
   * Get all projects a user has access to (owned or member)
   * Owner role takes precedence over member roles
   */
  async getUserProjects(userId: string): Promise<
    Array<{
      id: string;
      name: string;
      role: string;
      created_at: Date;
    }>
  > {
    const query = `
      SELECT 
        p.id,
        p.name,
        CASE 
          WHEN p.created_by = $1 THEN 'owner'::text
          ELSE pm.role
        END as role,
        p.created_at
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = $1
      WHERE p.created_by = $1 OR pm.user_id IS NOT NULL
      ORDER BY p.created_at DESC
    `;

    const result = await this.pool.query(query, [userId]);
    return result.rows;
  }
}
