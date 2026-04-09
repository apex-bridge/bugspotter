/**
 * Project Integration Repository
 * Handles database operations for external integrations (Jira, GitHub, etc.)
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './repositories/base-repository.js';

/**
 * Project integration entity
 */
export interface ProjectIntegration {
  id: string;
  project_id: string;
  integration_id: string; // Foreign key to integrations table
  enabled: boolean;
  config: Record<string, unknown>;
  encrypted_credentials: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Project integration with integration details (includes type from JOIN)
 */
export interface ProjectIntegrationWithType extends ProjectIntegration {
  integration_type: string; // From integrations.type
}

/**
 * Insert data for project integration
 */
export interface ProjectIntegrationInsert {
  id?: string;
  project_id: string;
  integration_id: string; // Required: FK to integrations table
  enabled?: boolean;
  config: Record<string, unknown>;
  encrypted_credentials?: string | null;
}

/**
 * Update data for project integration
 */
export interface ProjectIntegrationUpdate {
  enabled?: boolean;
  config?: Record<string, unknown>;
  encrypted_credentials?: string | null;
}

/**
 * Project Integration Repository
 */
export class ProjectIntegrationRepository extends BaseRepository<
  ProjectIntegration,
  ProjectIntegrationInsert,
  ProjectIntegrationUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'project_integrations', ['config']);
  }

  /**
   * Find integration by project ID and platform (looks up integration_id via JOIN)
   * @deprecated Use findByProjectAndIntegrationId when you have the integration_id
   */
  async findByProjectAndPlatform(
    projectId: string,
    platform: string
  ): Promise<ProjectIntegrationWithType | null> {
    const query = `
      SELECT pi.*, i.type as integration_type
      FROM ${this.schema}.${this.tableName} pi
      JOIN ${this.schema}.integrations i ON i.id = pi.integration_id
      WHERE pi.project_id = $1 AND i.type = $2
    `;
    const result = await this.getClient().query<ProjectIntegrationWithType>(query, [
      projectId,
      platform.toLowerCase(),
    ]);
    return result.rows.length > 0
      ? (this.deserialize(result.rows[0]) as ProjectIntegrationWithType)
      : null;
  }

  /**
   * Find integration by project ID and integration ID
   */
  async findByProjectAndIntegrationId(
    projectId: string,
    integrationId: string
  ): Promise<ProjectIntegration | null> {
    return this.findByMultiple({
      project_id: projectId,
      integration_id: integrationId,
    });
  }

  /**
   * Find enabled integration by project ID and platform (looks up integration_id via JOIN)
   * @deprecated Use findByProjectAndIntegrationId with enabled check
   */
  async findEnabledByProjectAndPlatform(
    projectId: string,
    platform: string
  ): Promise<ProjectIntegration | null> {
    const query = `
      SELECT pi.*
      FROM ${this.schema}.${this.tableName} pi
      JOIN ${this.schema}.integrations i ON i.id = pi.integration_id
      WHERE pi.project_id = $1 AND i.type = $2 AND pi.enabled = TRUE
    `;
    const result = await this.getClient().query<ProjectIntegration>(query, [
      projectId,
      platform.toLowerCase(),
    ]);
    return result.rows.length > 0 ? this.deserialize(result.rows[0]) : null;
  }

  /**
   * Upsert integration configuration
   * Creates or updates integration for a project
   */
  async upsert(
    projectId: string,
    platform: string,
    data: {
      enabled: boolean;
      config: Record<string, unknown>;
      encrypted_credentials: string;
    }
  ): Promise<ProjectIntegration> {
    // First, get the integration_id from the integrations table
    const integrationQuery = `
      SELECT id FROM ${this.schema}.integrations WHERE type = $1
    `;
    const integrationResult = await this.getClient().query<{ id: string }>(integrationQuery, [
      platform.toLowerCase(),
    ]);

    if (integrationResult.rows.length === 0) {
      // Enhanced error message with diagnostic information
      const allIntegrations = await this.getClient().query<{ type: string; name: string }>(
        `SELECT type, name FROM ${this.schema}.integrations ORDER BY type`
      );

      const availableTypes = allIntegrations.rows.map((r) => r.type).join(', ');
      const hint =
        allIntegrations.rows.length === 0
          ? 'No integrations found in database. Run migrations to seed built-in integration (jira).'
          : `Available integration types: ${availableTypes}`;

      throw new Error(`Integration with type '${platform}' not found. ${hint}`);
    }

    const integrationId = integrationResult.rows[0].id;

    const query = `
      INSERT INTO ${this.schema}.${this.tableName} 
        (project_id, integration_id, enabled, config, encrypted_credentials)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (project_id, integration_id)
      DO UPDATE SET
        enabled = EXCLUDED.enabled,
        config = EXCLUDED.config,
        encrypted_credentials = EXCLUDED.encrypted_credentials,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await this.getClient().query<ProjectIntegration>(query, [
      projectId,
      integrationId,
      data.enabled,
      JSON.stringify(data.config),
      data.encrypted_credentials,
    ]);

    return this.deserialize(result.rows[0]);
  }

  /**
   * Delete integration by project ID and platform
   */
  async deleteByProjectAndPlatform(projectId: string, platform: string): Promise<boolean> {
    const query = `
      DELETE FROM ${this.schema}.${this.tableName} pi
      USING ${this.schema}.integrations i
      WHERE pi.integration_id = i.id
        AND pi.project_id = $1 
        AND i.type = $2
    `;

    const result = await this.getClient().query(query, [projectId, platform.toLowerCase()]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Disconnect ALL projects from a specific integration type
   * Removes all project_integrations for the given platform across all projects,
   * while keeping the global integration record intact.
   * Useful for administrative actions like temporarily disabling an integration globally
   * or cleaning up all project connections before reconfiguring an integration.
   */
  async deleteByPlatform(platform: string): Promise<number> {
    const query = `
      DELETE FROM ${this.schema}.${this.tableName} pi
      USING ${this.schema}.integrations i
      WHERE pi.integration_id = i.id
        AND i.type = $1
    `;

    const result = await this.getClient().query(query, [platform.toLowerCase()]);
    return result.rowCount ?? 0;
  }

  /**
   * Set enabled status for integration
   */
  async setEnabled(projectId: string, platform: string, enabled: boolean): Promise<boolean> {
    const query = `
      UPDATE ${this.schema}.${this.tableName} pi
      SET enabled = $1, updated_at = CURRENT_TIMESTAMP
      FROM ${this.schema}.integrations i
      WHERE pi.integration_id = i.id
        AND pi.project_id = $2 
        AND i.type = $3
    `;

    const result = await this.getClient().query(query, [
      enabled,
      projectId,
      platform.toLowerCase(),
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get all integrations for a project
   */
  async findAllByProject(projectId: string): Promise<ProjectIntegration[]> {
    return this.findManyBy('project_id', projectId);
  }

  /**
   * Get all integrations for a project with integration type (JOIN)
   */
  async findAllByProjectWithType(projectId: string): Promise<ProjectIntegrationWithType[]> {
    const query = `
      SELECT 
        pi.*,
        i.type as integration_type
      FROM ${this.schema}.${this.tableName} pi
      INNER JOIN ${this.schema}.integrations i ON i.id = pi.integration_id
      WHERE pi.project_id = $1
      ORDER BY pi.created_at DESC
    `;

    const result = await this.getClient().query<ProjectIntegrationWithType>(query, [projectId]);
    return this.deserializeMany(result.rows) as ProjectIntegrationWithType[];
  }

  /**
   * Get project integration by ID with integration type (JOIN)
   */
  async findByIdWithType(id: string): Promise<ProjectIntegrationWithType | null> {
    const query = `
      SELECT 
        pi.*,
        i.type as integration_type
      FROM ${this.schema}.${this.tableName} pi
      INNER JOIN ${this.schema}.integrations i ON i.id = pi.integration_id
      WHERE pi.id = $1
    `;

    const result = await this.getClient().query<ProjectIntegrationWithType>(query, [id]);
    if (result.rows.length === 0) {
      return null;
    }
    return this.deserialize(result.rows[0]) as ProjectIntegrationWithType;
  }

  /**
   * Get all enabled integrations for a project
   */
  async findEnabledByProject(projectId: string): Promise<ProjectIntegration[]> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE project_id = $1 AND enabled = TRUE
      ORDER BY created_at DESC
    `;

    const result = await this.getClient().query<ProjectIntegration>(query, [projectId]);
    return this.deserializeMany(result.rows);
  }

  /**
   * Get all enabled integrations for a project with integration type (JOIN)
   */
  async findEnabledByProjectWithType(projectId: string): Promise<ProjectIntegrationWithType[]> {
    const query = `
      SELECT 
        pi.*,
        i.type as integration_type
      FROM ${this.schema}.${this.tableName} pi
      INNER JOIN ${this.schema}.integrations i ON i.id = pi.integration_id
      WHERE pi.project_id = $1 AND pi.enabled = TRUE
      ORDER BY pi.created_at DESC
    `;

    const result = await this.getClient().query<ProjectIntegrationWithType>(query, [projectId]);
    return this.deserializeMany(result.rows) as ProjectIntegrationWithType[];
  }
}
