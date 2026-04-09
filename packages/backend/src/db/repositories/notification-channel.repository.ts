/**
 * Notification Channel Repository
 * Handles CRUD operations for notification delivery channels
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type {
  NotificationChannel,
  CreateChannelInput,
  UpdateChannelInput,
  ChannelType,
  ChannelHealthStatus,
} from '../../types/notifications.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';

export class NotificationChannelRepository extends BaseRepository<
  NotificationChannel,
  CreateChannelInput,
  UpdateChannelInput
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'notification_channels', ['config']);
  }

  /**
   * Find channel by ID
   */
  async findById(id: string): Promise<NotificationChannel | null> {
    return super.findById(id);
  }

  /**
   * Find multiple channels by IDs (batch loading to avoid N+1 queries)
   * @param ids - Array of channel IDs to fetch
   * @returns Map of channel ID to channel (missing IDs not included)
   */
  async findByIds(ids: string[]): Promise<Map<string, NotificationChannel>> {
    if (ids.length === 0) {
      return new Map();
    }

    const query = `SELECT * FROM ${this.schema}.${this.tableName} WHERE id = ANY($1)`;
    const result = await this.getClient().query(query, [ids]);

    const channelMap = new Map<string, NotificationChannel>();
    for (const row of result.rows) {
      const channel = this.deserialize(row);
      channelMap.set(channel.id, channel);
    }

    return channelMap;
  }

  /**
   * Find all channels, optionally filtered by project, type, or active status
   */
  async findAll(filters?: {
    project_id?: string;
    type?: ChannelType;
    active?: boolean;
  }): Promise<NotificationChannel[]> {
    let query = `SELECT * FROM ${this.schema}.${this.tableName}`;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (filters?.project_id) {
      conditions.push(`project_id = $${paramCount}`);
      values.push(filters.project_id);
      paramCount++;
    }

    if (filters?.type) {
      conditions.push(`type = $${paramCount}`);
      values.push(filters.type);
      paramCount++;
    }

    if (filters?.active !== undefined) {
      conditions.push(`active = $${paramCount}`);
      values.push(filters.active);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY name ASC`;

    const result = await this.getClient().query(query, values);
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * List channels with pagination support
   */
  async list(
    filters?: {
      project_id?: string;
      type?: ChannelType;
      active?: boolean;
    },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<NotificationChannel>> {
    return this.listWithPagination(filters || {}, 'name ASC', pagination);
  }

  /**
   * Find active channels by type
   */
  async findActiveByType(type: ChannelType): Promise<NotificationChannel[]> {
    return this.findAll({ type, active: true });
  }

  /**
   * Create a new notification channel
   */
  async create(data: CreateChannelInput): Promise<NotificationChannel> {
    return super.create(data);
  }

  /**
   * Update a notification channel
   */
  async update(id: string, data: UpdateChannelInput): Promise<NotificationChannel | null> {
    return super.update(id, data);
  }

  /**
   * Delete a notification channel
   */
  async delete(id: string): Promise<boolean> {
    return super.delete(id);
  }

  /**
   * Update channel health after delivery attempt
   * @returns Number of rows affected (0 if ID not found, 1 if updated)
   */
  async updateHealth(id: string, success: boolean): Promise<number> {
    if (success) {
      const result = await this.getClient().query(
        `UPDATE ${this.schema}.${this.tableName} 
         SET last_success_at = NOW(), 
             failure_count = 0 
         WHERE id = $1`,
        [id]
      );
      return result.rowCount ?? 0;
    } else {
      const result = await this.getClient().query(
        `UPDATE ${this.schema}.${this.tableName} 
         SET last_failure_at = NOW(), 
             failure_count = failure_count + 1 
         WHERE id = $1`,
        [id]
      );
      return result.rowCount ?? 0;
    }
  }

  /**
   * Get channel health status with recent delivery stats
   */
  async getHealthStatus(id: string): Promise<ChannelHealthStatus | null> {
    const query = `
      SELECT 
        c.id as channel_id,
        c.name as channel_name,
        c.type as channel_type,
        c.last_success_at,
        c.last_failure_at,
        c.failure_count,
        COUNT(h.id) FILTER (WHERE h.created_at > NOW() - INTERVAL '1 hour') as recent_attempts,
        COUNT(h.id) FILTER (WHERE h.status = 'failed' AND h.created_at > NOW() - INTERVAL '1 hour') as recent_failures
      FROM ${this.schema}.notification_channels c
      LEFT JOIN ${this.schema}.notification_history h ON h.channel_id = c.id
      WHERE c.id = $1
      GROUP BY c.id, c.name, c.type, c.last_success_at, c.last_failure_at, c.failure_count
    `;

    const result = await this.getClient().query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const recentAttempts = parseInt(row.recent_attempts, 10);
    const recentFailures = parseInt(row.recent_failures, 10);
    const successRate = recentAttempts > 0 ? (recentAttempts - recentFailures) / recentAttempts : 1;

    let status: 'healthy' | 'degraded' | 'failing';
    if (successRate >= 0.95 && row.failure_count === 0) {
      status = 'healthy';
    } else if (successRate >= 0.8 || row.failure_count < 3) {
      status = 'degraded';
    } else {
      status = 'failing';
    }

    return {
      channel_id: row.channel_id,
      channel_name: row.channel_name,
      channel_type: row.channel_type,
      status,
      last_success_at: row.last_success_at,
      last_failure_at: row.last_failure_at,
      recent_attempts: recentAttempts,
      recent_failures: recentFailures,
      success_rate: successRate,
    };
  }

  /**
   * Get health status for all channels
   */
  async getAllHealthStatus(): Promise<ChannelHealthStatus[]> {
    const query = `
      SELECT 
        c.id as channel_id,
        c.name as channel_name,
        c.type as channel_type,
        c.last_success_at,
        c.last_failure_at,
        c.failure_count,
        COUNT(h.id) FILTER (WHERE h.created_at > NOW() - INTERVAL '1 hour') as recent_attempts,
        COUNT(h.id) FILTER (WHERE h.status = 'failed' AND h.created_at > NOW() - INTERVAL '1 hour') as recent_failures
      FROM ${this.schema}.notification_channels c
      LEFT JOIN ${this.schema}.notification_history h ON h.channel_id = c.id
      GROUP BY c.id, c.name, c.type, c.last_success_at, c.last_failure_at, c.failure_count
      ORDER BY c.name ASC
    `;

    const result = await this.getClient().query(query);

    return result.rows.map((row) => {
      const recentAttempts = parseInt(row.recent_attempts, 10);
      const recentFailures = parseInt(row.recent_failures, 10);
      const successRate =
        recentAttempts > 0 ? (recentAttempts - recentFailures) / recentAttempts : 1;

      let status: 'healthy' | 'degraded' | 'failing';
      if (successRate >= 0.95 && row.failure_count === 0) {
        status = 'healthy';
      } else if (successRate >= 0.8 || row.failure_count < 3) {
        status = 'degraded';
      } else {
        status = 'failing';
      }

      return {
        channel_id: row.channel_id,
        channel_name: row.channel_name,
        channel_type: row.channel_type,
        status,
        last_success_at: row.last_success_at,
        last_failure_at: row.last_failure_at,
        recent_attempts: recentAttempts,
        recent_failures: recentFailures,
        success_rate: successRate,
      };
    });
  }

  /**
   * Serialize data before insert
   */
  protected serializeForInsert(data: CreateChannelInput): Record<string, string | boolean> {
    return {
      project_id: data.project_id,
      name: data.name,
      type: data.type,
      config: JSON.stringify(data.config),
      active: data.active ?? true,
    };
  }

  /**
   * Serialize data before update
   */
  protected serializeForUpdate(data: UpdateChannelInput): Record<string, string | boolean> {
    const serialized: Record<string, string | boolean> = {};

    if (data.name !== undefined) {
      serialized.name = data.name;
    }
    if (data.active !== undefined) {
      serialized.active = data.active;
    }
    if (data.config !== undefined) {
      serialized.config = JSON.stringify(data.config);
    }

    return serialized;
  }

  /**
   * Deserialize row from database
   */
  protected deserialize(row: Record<string, unknown>): NotificationChannel {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      name: row.name as string,
      type: row.type as ChannelType,
      config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
      active: row.active as boolean,
      last_success_at: row.last_success_at as Date | null,
      last_failure_at: row.last_failure_at as Date | null,
      failure_count: row.failure_count as number,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}
