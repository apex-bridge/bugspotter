/**
 * System Configuration Repository
 * Manages global system settings and retention policies
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';

export interface SystemConfig {
  key: string;
  value: Record<string, unknown>;
  description?: string;
  updated_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface GlobalRetentionPolicy {
  bugReportRetentionDays: number;
  screenshotRetentionDays: number;
  replayRetentionDays: number;
  attachmentRetentionDays: number;
  archivedRetentionDays: number;
}

export class SystemConfigRepository extends BaseRepository<SystemConfig> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'system_config', ['value']);
  }

  /**
   * Get a configuration value by key
   */
  async get(key: string): Promise<SystemConfig | null> {
    const result = await this.pool.query(
      `SELECT key, value, description, updated_by, created_at, updated_at
       FROM system_config
       WHERE key = $1`,
      [key]
    );

    return result.rows[0] || null;
  }

  /**
   * Set or update a configuration value
   */
  async set(
    key: string,
    value: Record<string, unknown>,
    description?: string,
    updatedBy?: string
  ): Promise<SystemConfig> {
    const result = await this.pool.query(
      `INSERT INTO system_config (key, value, description, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           description = COALESCE(EXCLUDED.description, system_config.description),
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP
       RETURNING key, value, description, updated_by, created_at, updated_at`,
      [key, JSON.stringify(value), description, updatedBy]
    );

    return result.rows[0];
  }

  /**
   * Delete a configuration value
   */
  async delete(key: string): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM system_config WHERE key = $1`, [key]);

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Get all configuration values
   */
  async getAll(): Promise<SystemConfig[]> {
    const result = await this.pool.query(
      `SELECT key, value, description, updated_by, created_at, updated_at
       FROM system_config
       ORDER BY key`
    );

    return result.rows;
  }

  /**
   * Get global retention policy (or default)
   */
  async getGlobalRetentionPolicy(): Promise<GlobalRetentionPolicy> {
    const GLOBAL_RETENTION_POLICY_KEY = 'global_retention_policy';
    const config = await this.get(GLOBAL_RETENTION_POLICY_KEY);

    if (config && config.value) {
      return config.value as unknown as GlobalRetentionPolicy;
    }

    // Return defaults from environment variables
    return {
      bugReportRetentionDays: parseInt(process.env.DEFAULT_RETENTION_DAYS || '90', 10),
      screenshotRetentionDays: parseInt(process.env.SCREENSHOT_RETENTION_DAYS || '60', 10),
      replayRetentionDays: parseInt(process.env.REPLAY_RETENTION_DAYS || '30', 10),
      attachmentRetentionDays: parseInt(process.env.ATTACHMENT_RETENTION_DAYS || '90', 10),
      archivedRetentionDays: parseInt(process.env.ARCHIVED_RETENTION_DAYS || '365', 10),
    };
  }

  /**
   * Update global retention policy
   */
  async updateGlobalRetentionPolicy(
    policy: Partial<GlobalRetentionPolicy>,
    updatedBy?: string
  ): Promise<GlobalRetentionPolicy> {
    const GLOBAL_RETENTION_POLICY_KEY = 'global_retention_policy';
    const current = await this.getGlobalRetentionPolicy();
    const updated = { ...current, ...policy };

    await this.set(
      GLOBAL_RETENTION_POLICY_KEY,
      updated as unknown as Record<string, unknown>,
      'Global retention policy for all projects',
      updatedBy
    );

    return updated;
  }
}
