/**
 * Integration Field Mapping Repository
 * Manages field mappings between BugSpotter and external systems
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';

export interface FieldMapping {
  id: string;
  integration_type: string;
  source_field: string;
  target_field: string;
  transform_type: 'direct' | 'template' | 'function' | 'lookup' | null;
  transform_config: Record<string, unknown> | null;
  required: boolean;
  created_at: Date;
}

export interface CreateFieldMappingInput {
  integration_type: string;
  source_field: string;
  target_field: string;
  transform_type?: 'direct' | 'template' | 'function' | 'lookup';
  transform_config?: Record<string, unknown>;
  required?: boolean;
}

export interface UpdateFieldMappingInput {
  source_field?: string;
  target_field?: string;
  transform_type?: 'direct' | 'template' | 'function' | 'lookup' | null;
  transform_config?: Record<string, unknown>;
  required?: boolean;
}

export class FieldMappingRepository extends BaseRepository<
  FieldMapping,
  CreateFieldMappingInput,
  UpdateFieldMappingInput
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'integration_field_mappings', ['transform_config']);
  }

  /**
   * Get all mappings for an integration type
   */
  async getByIntegrationType(type: string): Promise<FieldMapping[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE integration_type = $1 ORDER BY source_field ASC`,
      [type]
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Get required mappings for an integration type
   */
  async getRequiredByType(type: string): Promise<FieldMapping[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} 
       WHERE integration_type = $1 AND required = true 
       ORDER BY source_field ASC`,
      [type]
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Delete all mappings for an integration type
   */
  async deleteByIntegrationType(type: string): Promise<number> {
    const result = await this.getClient().query(
      `DELETE FROM ${this.schema}.${this.tableName} WHERE integration_type = $1`,
      [type]
    );
    return result.rowCount || 0;
  }

  /**
   * Batch create mappings for an integration
   * Uses UPSERT to handle conflicts on unique constraint
   * @param mappings - Array of field mappings to create
   * @returns Created/updated field mappings
   */
  async batchCreate(mappings: CreateFieldMappingInput[]): Promise<FieldMapping[]> {
    if (mappings.length === 0) {
      return [];
    }

    // Validate batch size to prevent DoS
    const MAX_BATCH_SIZE = 1000;
    if (mappings.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${mappings.length} exceeds maximum allowed (${MAX_BATCH_SIZE})`);
    }

    const values: unknown[] = [];
    const valuePlaceholders: string[] = [];
    let paramCount = 1;

    mappings.forEach((mapping) => {
      valuePlaceholders.push(
        `($${paramCount}, $${paramCount + 1}, $${paramCount + 2}, $${paramCount + 3}, $${
          paramCount + 4
        }, $${paramCount + 5})`
      );
      values.push(
        mapping.integration_type,
        mapping.source_field,
        mapping.target_field,
        mapping.transform_type || null,
        mapping.transform_config ? JSON.stringify(mapping.transform_config) : null,
        mapping.required ?? false
      );
      paramCount += 6;
    });

    const query = `
      INSERT INTO ${this.schema}.${this.tableName} 
        (integration_type, source_field, target_field, transform_type, transform_config, required)
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (integration_type, source_field, target_field) 
      DO UPDATE SET
        transform_type = EXCLUDED.transform_type,
        transform_config = EXCLUDED.transform_config,
        required = EXCLUDED.required
      RETURNING *
    `;

    const result = await this.getClient().query(query, values);
    return result.rows.map((row) => this.deserialize(row));
  }
}
