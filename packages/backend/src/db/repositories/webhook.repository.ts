/**
 * Integration Webhook Repository
 * Manages incoming webhook configurations for integrations
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';

export interface IntegrationWebhook {
  id: string;
  integration_type: string;
  endpoint_url: string;
  secret: string;
  events: string[];
  active: boolean;
  last_received_at: Date | null;
  failure_count: number;
  created_at: Date;
}

export interface CreateWebhookInput {
  integration_type: string;
  endpoint_url: string;
  secret: string;
  events?: string[];
  active?: boolean;
}

export interface UpdateWebhookInput {
  endpoint_url?: string;
  secret?: string;
  events?: string[];
  active?: boolean;
  last_received_at?: Date;
  failure_count?: number;
}

export class WebhookRepository extends BaseRepository<
  IntegrationWebhook,
  CreateWebhookInput,
  UpdateWebhookInput
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'integration_webhooks', []);
  }

  /**
   * Find webhook by endpoint URL
   * @param endpointUrl - The webhook endpoint URL to search for
   * @returns Webhook if found, null otherwise
   */
  async findByEndpoint(endpointUrl: string): Promise<IntegrationWebhook | null> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE endpoint_url = $1`,
      [endpointUrl]
    );
    return result.rows.length > 0 ? this.deserialize(result.rows[0]) : null;
  }

  /**
   * Get all webhooks for an integration type
   */
  async getByIntegrationType(type: string): Promise<IntegrationWebhook[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE integration_type = $1 ORDER BY created_at DESC`,
      [type]
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Get active webhooks for an integration type
   */
  async getActiveByType(type: string): Promise<IntegrationWebhook[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} 
       WHERE integration_type = $1 AND active = true 
       ORDER BY created_at DESC`,
      [type]
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Update last received timestamp
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async updateLastReceived(id: string): Promise<number> {
    const result = await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} SET last_received_at = NOW(), failure_count = 0 WHERE id = $1`,
      [id]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Increment failure count
   */
  async incrementFailureCount(id: string): Promise<number> {
    const result = await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} 
       SET failure_count = failure_count + 1 
       WHERE id = $1 
       RETURNING failure_count`,
      [id]
    );
    return result.rows[0]?.failure_count || 0;
  }

  /**
   * Reset failure count
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async resetFailureCount(id: string): Promise<number> {
    const result = await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} SET failure_count = 0 WHERE id = $1`,
      [id]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Disable webhook
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async disable(id: string): Promise<number> {
    const result = await this.update(id, { active: false });
    return result ? 1 : 0;
  }

  /**
   * Enable webhook
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async enable(id: string): Promise<number> {
    const result = await this.update(id, { active: true });
    return result ? 1 : 0;
  }
}
