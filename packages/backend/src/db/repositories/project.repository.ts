/**
 * Project Repository
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import { SINGLE_ROW_LIMIT } from '../constants.js';
import type { Project, ProjectInsert, ProjectUpdate } from '../types.js';

export class ProjectRepository extends BaseRepository<Project, ProjectInsert, ProjectUpdate> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'projects', ['settings']);
  }

  /**
   * Check if user has access to project
   * Returns true if user is the owner, an admin, or member of the project
   */
  async hasAccess(projectId: string, userId: string): Promise<boolean> {
    const query = `
      SELECT 1 FROM ${this.schema}.${this.tableName} p
      WHERE p.id = $1
        AND (
          p.created_by = $2
          OR EXISTS (
            SELECT 1 FROM ${this.schema}.project_members pm
            WHERE pm.project_id = p.id
              AND pm.user_id = $2
          )
        )
      LIMIT ${SINGLE_ROW_LIMIT}
    `;

    const result = await this.getClient().query(query, [projectId, userId]);
    return result.rows.length > 0;
  }

  /**
   * Get user's role in project
   * Returns 'owner', 'admin', 'member', 'viewer', or null if no access
   * OPTIMIZED: Single query instead of two sequential queries
   */
  async getUserRole(projectId: string, userId: string): Promise<string | null> {
    // Single query that checks both ownership and membership
    const query = `
      SELECT
        CASE
          WHEN p.created_by = $2 THEN 'owner'
          ELSE pm.role
        END as role
      FROM ${this.schema}.${this.tableName} p
      LEFT JOIN ${this.schema}.project_members pm ON p.id = pm.project_id AND pm.user_id = $2
      WHERE p.id = $1
      LIMIT ${SINGLE_ROW_LIMIT}
    `;

    const result = await this.getClient().query(query, [projectId, userId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].role;
  }

  /**
   * Get user roles for multiple projects in a single query
   * Returns a map of projectId -> role ('owner', 'admin', 'member', 'viewer', or null)
   */
  async getUserRolesForProjects(
    projectIds: string[],
    userId: string
  ): Promise<Map<string, string | null>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const query = `
      SELECT 
        p.id as project_id,
        CASE 
          WHEN p.created_by = $1 THEN 'owner'
          ELSE pm.role
        END as role
      FROM ${this.schema}.${this.tableName} p
      LEFT JOIN ${this.schema}.project_members pm ON p.id = pm.project_id AND pm.user_id = $1
      WHERE p.id = ANY($2)
    `;

    const result = await this.getClient().query(query, [userId, projectIds]);

    const roleMap = new Map<string, string | null>();

    // Initialize all projects with null
    for (const projectId of projectIds) {
      roleMap.set(projectId, null);
    }

    // Fill in roles from query results
    for (const row of result.rows) {
      roleMap.set(row.project_id, row.role);
    }

    return roleMap;
  }

  /**
   * Find all projects, optionally scoped to an organization.
   */
  async findAll(organizationId?: string): Promise<Project[]> {
    if (organizationId) {
      return this.findByOrganizationId(organizationId);
    }
    const query = `SELECT * FROM ${this.schema}.${this.tableName} ORDER BY created_at DESC`;
    const result = await this.getClient().query(query);
    return this.deserializeMany(result.rows);
  }

  /**
   * Get all projects a user has access to (created or member of),
   * optionally scoped to an organization.
   */
  async getUserAccessibleProjects(userId: string, organizationId?: string): Promise<Project[]> {
    const params: unknown[] = [userId];
    // Hide projects whose owning organization has been soft-deleted —
    // otherwise a user who deleted their org keeps seeing its projects
    // in the dashboard. LEFT JOIN (not INNER) because in self-hosted
    // mode `application.projects.organization_id` is NULL and the
    // `saas.organizations` table is empty; an INNER JOIN would filter
    // every self-hosted project out. Admin / system queries
    // (`findByOrganizationId`, `findAll`) intentionally don't apply
    // this filter — platform admins need visibility into soft-deleted
    // orgs for retention cleanup.
    const conditions: string[] = [
      '(p.created_by = $1 OR pm.user_id = $1)',
      '(o.id IS NULL OR o.deleted_at IS NULL)',
    ];

    if (organizationId) {
      conditions.push(`p.organization_id = $${params.length + 1}`);
      params.push(organizationId);
    }

    const query = `
      SELECT DISTINCT p.* FROM ${this.schema}.${this.tableName} p
      LEFT JOIN saas.organizations o ON o.id = p.organization_id
      LEFT JOIN ${this.schema}.project_members pm ON p.id = pm.project_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY p.created_at DESC
    `;
    const result = await this.getClient().query(query, params);
    return this.deserializeMany(result.rows);
  }

  /**
   * Count projects belonging to an organization.
   */
  async countByOrganizationId(organizationId: string): Promise<number> {
    const query = `SELECT COUNT(*)::int AS count FROM ${this.schema}.${this.tableName} WHERE organization_id = $1`;
    const result = await this.getClient().query(query, [organizationId]);
    return result.rows[0]?.count ?? 0;
  }

  /**
   * Find all projects belonging to an organization.
   */
  async findByOrganizationId(organizationId: string): Promise<Project[]> {
    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE organization_id = $1 ORDER BY created_at DESC`;
    const result = await this.getClient().query(query, [organizationId]);
    return this.deserializeMany(result.rows);
  }

  /**
   * Get all members of a project (including owner)
   * Uses project_roles table for proper role hierarchy ordering
   */
  async getProjectMembers(projectId: string): Promise<
    Array<{
      id: string | null;
      project_id: string;
      user_id: string;
      role: string;
      created_at: Date;
      user_email: string;
      user_name: string | null;
    }>
  > {
    const query = `
      SELECT 
        pm.id,
        pm.project_id,
        pm.user_id,
        pm.role,
        pm.created_at,
        u.email as user_email,
        u.name as user_name,
        pr.rank as role_rank
      FROM ${this.schema}.project_members pm
      JOIN ${this.schema}.users u ON pm.user_id = u.id
      JOIN ${this.schema}.project_roles pr ON pm.role = pr.name
      WHERE pm.project_id = $1
      
      UNION ALL
      
      SELECT 
        NULL as id,
        p.id as project_id,
        p.created_by as user_id,
        'owner'::text as role,
        p.created_at,
        u.email as user_email,
        u.name as user_name,
        pr.rank as role_rank
      FROM ${this.schema}.${this.tableName} p
      JOIN ${this.schema}.users u ON p.created_by = u.id
      JOIN ${this.schema}.project_roles pr ON pr.name = 'owner'
      WHERE p.id = $1
      AND NOT EXISTS (
        SELECT 1 FROM ${this.schema}.project_members pm2 
        WHERE pm2.project_id = p.id 
        AND pm2.user_id = p.created_by
      )
      
      ORDER BY role_rank ASC, created_at ASC
    `;

    const result = await this.getClient().query(query, [projectId]);
    // Remove role_rank from returned data (internal use only)
    return result.rows.map((row) => {
      const { role_rank: _role_rank, ...member } = row;
      return member;
    });
  }
}
