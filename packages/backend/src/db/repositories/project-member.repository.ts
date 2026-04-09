/**
 * Project Member Repository
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type { ProjectMember, ProjectMemberInsert } from '../types.js';

export class ProjectMemberRepository extends BaseRepository<
  ProjectMember,
  ProjectMemberInsert,
  never
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'project_members', []);
  }

  /**
   * Add user to project
   */
  async addMember(
    projectId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' | 'viewer' = 'member'
  ): Promise<ProjectMember> {
    return this.create({
      project_id: projectId,
      user_id: userId,
      role,
    });
  }

  /**
   * Update member role
   * @returns Updated member record or null if not found
   */
  async updateMemberRole(
    projectId: string,
    userId: string,
    role: 'admin' | 'member' | 'viewer'
  ): Promise<ProjectMember | null> {
    const query = `
      UPDATE ${this.schema}.${this.tableName}
      SET role = $3
      WHERE project_id = $1 AND user_id = $2
      RETURNING *
    `;
    const result = await this.getClient().query(query, [projectId, userId, role]);
    return result.rows[0] ?? null;
  }

  /**
   * Remove user from project
   * @returns Number of rows affected (0 if not found, 1 if removed)
   */
  async removeMember(projectId: string, userId: string): Promise<number> {
    const query = `DELETE FROM ${this.schema}.${this.tableName} WHERE project_id = $1 AND user_id = $2`;
    const result = await this.getClient().query(query, [projectId, userId]);
    return result.rowCount ?? 0;
  }

  /**
   * Get all members of a project
   */
  async getProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return this.findManyBy('project_id', projectId);
  }

  /**
   * Get a specific member of a project
   * @returns Member record or null if not found
   */
  async getMemberByUserId(projectId: string, userId: string): Promise<ProjectMember | null> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE project_id = $1 AND user_id = $2
    `;
    const result = await this.getClient().query<ProjectMember>(query, [projectId, userId]);
    return result.rows[0] ?? null;
  }

  /**
   * Get all projects for a user
   */
  async getUserProjects(userId: string): Promise<ProjectMember[]> {
    return this.findManyBy('user_id', userId);
  }

  /**
   * Get all project IDs that a user has access to
   */
  async getUserProjectIds(userId: string): Promise<string[]> {
    const query = `SELECT project_id FROM ${this.schema}.${this.tableName} WHERE user_id = $1`;
    const result = await this.getClient().query<{ project_id: string }>(query, [userId]);
    return result.rows.map((row) => row.project_id);
  }
}
