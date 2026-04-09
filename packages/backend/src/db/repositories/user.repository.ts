/**
 * User Repository
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type { User, UserInsert, PaginatedResult } from '../types.js';
import { createFilter } from '../filter-builder.js';
import { createPagination } from '../pagination-builder.js';

export class UserRepository extends BaseRepository<User, UserInsert, Partial<User>> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'users', []);
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
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.findBy('email', email);
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
  }): Promise<PaginatedResult<Omit<User, 'password_hash'>>> {
    const { page = 1, limit = 20, role, email } = options;

    // Build WHERE clause using unified FilterBuilder
    const filter = createFilter().equals('role', role).ilike('email', email);

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

    // Get users (exclude password hash)
    const result = await this.pool.query<Omit<User, 'password_hash'>>(
      `SELECT id, email, name, role, security, oauth_provider, oauth_id, preferences, created_at
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
