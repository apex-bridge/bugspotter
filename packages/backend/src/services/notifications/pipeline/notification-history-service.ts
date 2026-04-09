/**
 * Notification History Service
 * Handles recording and querying notification delivery history
 */

import { DeliveryResult } from '../models/delivery-result.js';
import type { Pool } from 'pg';
import { getLogger } from '../../../logger.js';

const logger = getLogger();

export interface NotificationHistoryRecord {
  id: string;
  project_id: string;
  bug_id: string;
  channel_id: string;
  trigger_id: string;
  status: string;
  message: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  delivered_at: Date;
  created_at: Date;
}

export interface HistoryQueryOptions {
  projectId?: string;
  bugId?: string;
  channelId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Notification History Service
 * Single responsibility: persist and query delivery history
 */
export class NotificationHistoryService {
  constructor(private readonly db: Pool) {}

  /**
   * Records a delivery result in the history
   */
  async recordDelivery(result: DeliveryResult): Promise<void> {
    try {
      const record = result.toHistoryRecord();

      await this.db.query(
        `INSERT INTO notification_history 
         (project_id, bug_id, channel_id, trigger_id, status, message, error_message, metadata, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.project_id,
          record.bug_id,
          record.channel_id,
          record.trigger_id,
          record.status,
          record.message,
          record.error_message,
          JSON.stringify(record.metadata),
          record.delivered_at,
        ]
      );

      logger.debug('Delivery result recorded in history', {
        projectId: record.project_id,
        bugId: record.bug_id,
        channelId: record.channel_id,
        status: record.status,
      });
    } catch (error) {
      // Log error but don't throw - history recording should not break delivery
      logger.error('Failed to record delivery in history', {
        projectId: result.projectId,
        bugId: result.bugId,
        channelId: result.channelId,
        error,
      });
    }
  }

  /**
   * Records multiple delivery results in a transaction
   */
  async recordBatch(results: DeliveryResult[]): Promise<void> {
    if (results.length === 0) {
      return;
    }

    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      for (const result of results) {
        const record = result.toHistoryRecord();

        await client.query(
          `INSERT INTO notification_history 
           (project_id, bug_id, channel_id, trigger_id, status, message, error_message, metadata, delivered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            record.project_id,
            record.bug_id,
            record.channel_id,
            record.trigger_id,
            record.status,
            record.message,
            record.error_message,
            JSON.stringify(record.metadata),
            record.delivered_at,
          ]
        );
      }

      await client.query('COMMIT');

      logger.debug('Batch delivery results recorded in history', {
        count: results.length,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to record batch delivery in history', {
        count: results.length,
        error,
      });
    } finally {
      client.release();
    }
  }

  /**
   * Queries notification history with filters
   */
  async query(options: HistoryQueryOptions = {}): Promise<NotificationHistoryRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (options.projectId) {
      conditions.push(`project_id = $${paramCount++}`);
      values.push(options.projectId);
    }

    if (options.bugId) {
      conditions.push(`bug_id = $${paramCount++}`);
      values.push(options.bugId);
    }

    if (options.channelId) {
      conditions.push(`channel_id = $${paramCount++}`);
      values.push(options.channelId);
    }

    if (options.status) {
      conditions.push(`status = $${paramCount++}`);
      values.push(options.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const query = `
      SELECT * FROM notification_history
      ${whereClause}
      ORDER BY delivered_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    values.push(limit, offset);

    try {
      const result = await this.db.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Failed to query notification history', { options, error });
      throw error;
    }
  }

  /**
   * Gets the total count of history records matching filters
   */
  async count(options: Omit<HistoryQueryOptions, 'limit' | 'offset'> = {}): Promise<number> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (options.projectId) {
      conditions.push(`project_id = $${paramCount++}`);
      values.push(options.projectId);
    }

    if (options.bugId) {
      conditions.push(`bug_id = $${paramCount++}`);
      values.push(options.bugId);
    }

    if (options.channelId) {
      conditions.push(`channel_id = $${paramCount++}`);
      values.push(options.channelId);
    }

    if (options.status) {
      conditions.push(`status = $${paramCount++}`);
      values.push(options.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `SELECT COUNT(*) FROM notification_history ${whereClause}`;

    try {
      const result = await this.db.query(query, values);
      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error('Failed to count notification history', { options, error });
      throw error;
    }
  }

  /**
   * Gets the most recent delivery for a specific bug/channel combination
   */
  async getLatestDelivery(
    projectId: string,
    bugId: string,
    channelId: string
  ): Promise<NotificationHistoryRecord | null> {
    try {
      const result = await this.db.query(
        `SELECT * FROM notification_history
         WHERE project_id = $1 AND bug_id = $2 AND channel_id = $3
         ORDER BY delivered_at DESC
         LIMIT 1`,
        [projectId, bugId, channelId]
      );

      return result.rows[0] || null;
    } catch (error) {
      logger.error('Failed to get latest delivery', { projectId, bugId, channelId, error });
      throw error;
    }
  }

  /**
   * Deletes old history records (for cleanup/retention)
   */
  async deleteOlderThan(days: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const result = await this.db.query(
        'DELETE FROM notification_history WHERE delivered_at < $1',
        [cutoffDate]
      );

      const deletedCount = result.rowCount || 0;

      logger.info('Deleted old notification history records', {
        days,
        deletedCount,
        cutoffDate: cutoffDate.toISOString(),
      });

      return deletedCount;
    } catch (error) {
      logger.error('Failed to delete old notification history', { days, error });
      throw error;
    }
  }
}
