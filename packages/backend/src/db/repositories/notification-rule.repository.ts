/**
 * Notification Rule Repository
 * Handles CRUD operations for notification rules and their channel associations
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type {
  NotificationRule,
  NotificationRuleWithChannels,
  CreateRuleInput,
  UpdateRuleInput,
} from '../../types/notifications.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';

export class NotificationRuleRepository extends BaseRepository<
  NotificationRule,
  Omit<CreateRuleInput, 'channel_ids'>,
  Omit<UpdateRuleInput, 'channel_ids'>
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'notification_rules', [
      'triggers',
      'filters',
      'throttle',
      'schedule',
    ]);
  }

  /**
   * Find rule by ID with associated channels
   */
  async findByIdWithChannels(id: string): Promise<NotificationRuleWithChannels | null> {
    const rule = await super.findById(id);
    if (!rule) {
      return null;
    }

    const channelIds = await this.getRuleChannels(id);
    return {
      ...rule,
      channels: channelIds,
    };
  }

  /**
   * Find all rules with optional filters
   */
  async findAll(filters?: { project_id?: string; enabled?: boolean }): Promise<NotificationRule[]> {
    let query = `SELECT * FROM ${this.schema}.${this.tableName}`;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (filters?.project_id) {
      conditions.push(`project_id = $${paramCount}`);
      values.push(filters.project_id);
      paramCount++;
    }

    if (filters?.enabled !== undefined) {
      conditions.push(`enabled = $${paramCount}`);
      values.push(filters.enabled);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY priority DESC, name ASC`;

    const result = await this.getClient().query(query, values);
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Find all rules with their associated channels
   * Uses optimized JOIN query to avoid N+1 problem
   */
  async findAllWithChannels(filters?: {
    project_id?: string;
    enabled?: boolean;
  }): Promise<NotificationRuleWithChannels[]> {
    const rules = await this.findAll(filters);

    if (rules.length === 0) {
      return [];
    }

    // Fetch all channel associations in a single query (avoids N+1)
    const ruleIds = rules.map((r) => r.id);
    const channelAssociations = await this.getBatchRuleChannels(ruleIds);

    // Map channels to rules
    return rules.map((rule) => ({
      ...rule,
      channels: channelAssociations.get(rule.id) || [],
    }));
  }

  /**
   * List rules with pagination support
   * Uses optimized batch fetching to avoid N+1 problem
   */
  async list(
    filters?: { project_id?: string; enabled?: boolean },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<NotificationRuleWithChannels>> {
    // Use base pagination method
    const result = await this.listWithPagination(
      filters || {},
      'priority DESC, name ASC',
      pagination
    );

    if (result.data.length === 0) {
      return {
        data: [],
        pagination: result.pagination,
      };
    }

    // Fetch all channel associations in a single query (avoids N+1)
    const ruleIds = result.data.map((r) => r.id);
    const channelAssociations = await this.getBatchRuleChannels(ruleIds);

    // Map channels to rules
    const rulesWithChannels = result.data.map((rule) => ({
      ...rule,
      channels: channelAssociations.get(rule.id) || [],
    }));

    return {
      data: rulesWithChannels,
      pagination: result.pagination,
    };
  }

  /**
   * Create a new notification rule with channel associations
   */
  async createWithChannels(data: CreateRuleInput): Promise<NotificationRuleWithChannels> {
    const { channel_ids, ...ruleData } = data;
    const rule = await super.create(ruleData);

    if (channel_ids && channel_ids.length > 0) {
      await this.setRuleChannels(rule.id, channel_ids);
    }

    return {
      ...rule,
      channels: channel_ids || [],
    };
  }

  /**
   * Update a notification rule and optionally update channel associations
   */
  async updateWithChannels(
    id: string,
    data: UpdateRuleInput
  ): Promise<NotificationRuleWithChannels | null> {
    const { channel_ids, ...ruleData } = data;
    const rule = await super.update(id, ruleData);

    if (!rule) {
      return null;
    }

    if (channel_ids !== undefined) {
      await this.setRuleChannels(id, channel_ids);
    }

    const channelIds = await this.getRuleChannels(id);
    return {
      ...rule,
      channels: channelIds,
    };
  }

  /**
   * Delete a notification rule (cascades to channel associations)
   */
  async delete(id: string): Promise<boolean> {
    return super.delete(id);
  }

  /**
   * Reorder rules by updating priorities
   */
  async reorder(ruleIdsInOrder: string[]): Promise<void> {
    const client = this.getClient();

    for (let i = 0; i < ruleIdsInOrder.length; i++) {
      const priority = ruleIdsInOrder.length - i; // Higher index = higher priority
      await client.query(
        `UPDATE ${this.schema}.${this.tableName} SET priority = $1 WHERE id = $2`,
        [priority, ruleIdsInOrder[i]]
      );
    }
  }

  /**
   * Get channel IDs associated with a rule
   */
  private async getRuleChannels(ruleId: string): Promise<string[]> {
    const result = await this.getClient().query(
      `SELECT channel_id FROM ${this.schema}.notification_rule_channels WHERE rule_id = $1 ORDER BY created_at ASC`,
      [ruleId]
    );
    return result.rows.map((row) => row.channel_id);
  }

  /**
   * Get channel IDs for multiple rules in a single query (batch optimization)
   * Returns a Map of rule_id -> channel_id[]
   *
   * Performance: Reduces N+1 queries to just 1 query
   * Example: 100 rules = 1 query instead of 100 queries
   */
  private async getBatchRuleChannels(ruleIds: string[]): Promise<Map<string, string[]>> {
    if (ruleIds.length === 0) {
      return new Map();
    }

    // Fetch all channel associations for all rules in a single query
    const result = await this.getClient().query(
      `SELECT rule_id, channel_id 
       FROM ${this.schema}.notification_rule_channels 
       WHERE rule_id = ANY($1)
       ORDER BY rule_id, created_at ASC`,
      [ruleIds]
    );

    // Group channels by rule_id
    const channelsByRule = new Map<string, string[]>();

    for (const row of result.rows) {
      const ruleId = row.rule_id as string;
      const channelId = row.channel_id as string;

      if (!channelsByRule.has(ruleId)) {
        channelsByRule.set(ruleId, []);
      }
      channelsByRule.get(ruleId)!.push(channelId);
    }

    return channelsByRule;
  }

  /**
   * Set channel associations for a rule (replaces existing)
   */
  private async setRuleChannels(ruleId: string, channelIds: string[]): Promise<void> {
    const client = this.getClient();

    // Delete existing associations
    await client.query(`DELETE FROM ${this.schema}.notification_rule_channels WHERE rule_id = $1`, [
      ruleId,
    ]);

    // Insert new associations
    if (channelIds.length > 0) {
      const values = channelIds.map((_channelId, index) => {
        return `($1, $${index + 2})`;
      });
      const query = `INSERT INTO ${this.schema}.notification_rule_channels (rule_id, channel_id) VALUES ${values.join(', ')}`;
      await client.query(query, [ruleId, ...channelIds]);
    }
  }

  /**
   * Serialize data before insert
   */
  protected serializeForInsert(
    data: Omit<CreateRuleInput, 'channel_ids'>
  ): Record<string, unknown> {
    return {
      project_id: data.project_id,
      name: data.name,
      enabled: data.enabled ?? true,
      triggers: JSON.stringify(data.triggers),
      filters: data.filters ? JSON.stringify(data.filters) : null,
      throttle: data.throttle ? JSON.stringify(data.throttle) : null,
      schedule: data.schedule ? JSON.stringify(data.schedule) : null,
      priority: data.priority ?? 0,
    };
  }

  /**
   * Serialize data before update
   */
  protected serializeForUpdate(
    data: Omit<UpdateRuleInput, 'channel_ids'>
  ): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    if (data.name !== undefined) {
      serialized.name = data.name;
    }
    if (data.enabled !== undefined) {
      serialized.enabled = data.enabled;
    }
    if (data.triggers !== undefined) {
      serialized.triggers = JSON.stringify(data.triggers);
    }
    if (data.filters !== undefined) {
      serialized.filters = data.filters ? JSON.stringify(data.filters) : null;
    }
    if (data.throttle !== undefined) {
      serialized.throttle = data.throttle ? JSON.stringify(data.throttle) : null;
    }
    if (data.schedule !== undefined) {
      serialized.schedule = data.schedule ? JSON.stringify(data.schedule) : null;
    }
    if (data.priority !== undefined) {
      serialized.priority = data.priority;
    }

    return serialized;
  }

  /**
   * Deserialize row from database
   */
  protected deserialize(row: Record<string, unknown>): NotificationRule {
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      name: row.name as string,
      enabled: row.enabled as boolean,
      triggers: typeof row.triggers === 'string' ? JSON.parse(row.triggers) : row.triggers,
      filters: row.filters
        ? typeof row.filters === 'string'
          ? JSON.parse(row.filters)
          : row.filters
        : null,
      throttle: row.throttle
        ? typeof row.throttle === 'string'
          ? JSON.parse(row.throttle)
          : row.throttle
        : null,
      schedule: row.schedule
        ? typeof row.schedule === 'string'
          ? JSON.parse(row.schedule)
          : row.schedule
        : null,
      priority: row.priority as number,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}
