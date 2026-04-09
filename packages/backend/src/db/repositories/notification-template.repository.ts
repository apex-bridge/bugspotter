/**
 * Notification Template Repository
 * Handles CRUD operations for notification message templates
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import type {
  NotificationTemplate,
  CreateTemplateInput,
  UpdateTemplateInput,
  ChannelType,
  TriggerType,
} from '../../types/notifications.js';
import type { PaginationOptions, PaginatedResult } from '../types.js';

export class NotificationTemplateRepository extends BaseRepository<
  NotificationTemplate,
  CreateTemplateInput,
  UpdateTemplateInput
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'notification_templates', ['variables']);
  }

  /**
   * Find template by ID
   */
  async findById(id: string): Promise<NotificationTemplate | null> {
    return super.findById(id);
  }

  /**
   * Find all templates with optional filters
   */
  async findAll(filters?: {
    channel_type?: ChannelType;
    trigger_type?: TriggerType;
    is_active?: boolean;
  }): Promise<NotificationTemplate[]> {
    let query = `SELECT * FROM ${this.schema}.${this.tableName}`;
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    if (filters?.channel_type) {
      conditions.push(`channel_type = $${paramCount}`);
      values.push(filters.channel_type);
      paramCount++;
    }

    if (filters?.trigger_type) {
      conditions.push(`trigger_type = $${paramCount}`);
      values.push(filters.trigger_type);
      paramCount++;
    }

    if (filters?.is_active !== undefined) {
      conditions.push(`is_active = $${paramCount}`);
      values.push(filters.is_active);
      paramCount++;
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY channel_type, trigger_type, version DESC`;

    const result = await this.getClient().query(query, values);
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * List templates with pagination support
   */
  async list(
    filters?: {
      channel_type?: ChannelType;
      trigger_type?: TriggerType;
      is_active?: boolean;
    },
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<NotificationTemplate>> {
    return this.listWithPagination(
      filters || {},
      'channel_type, trigger_type, version DESC',
      pagination
    );
  }

  /**
   * Find active template for a specific channel and trigger type
   */
  async findActiveTemplate(
    channelType: ChannelType,
    triggerType: TriggerType
  ): Promise<NotificationTemplate | null> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE channel_type = $1 AND trigger_type = $2 AND is_active = true
      LIMIT 1
    `;
    const result = await this.getClient().query(query, [channelType, triggerType]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.deserialize(result.rows[0]);
  }

  /**
   * Find active templates for multiple channel types and a trigger type (batch loading)
   * @param channelTypes - Array of channel types to fetch templates for
   * @param triggerType - The trigger type to find templates for
   * @returns Map of channel type to active template (missing types not included)
   */
  async findActiveTemplatesByChannelTypes(
    channelTypes: ChannelType[],
    triggerType: TriggerType
  ): Promise<Map<ChannelType, NotificationTemplate>> {
    if (channelTypes.length === 0) {
      return new Map();
    }

    // Use DISTINCT ON to get one active template per channel type
    const query = `
      SELECT DISTINCT ON (channel_type) *
      FROM ${this.schema}.${this.tableName}
      WHERE channel_type = ANY($1) AND trigger_type = $2 AND is_active = true
      ORDER BY channel_type, version DESC
    `;
    const result = await this.getClient().query(query, [channelTypes, triggerType]);

    const templateMap = new Map<ChannelType, NotificationTemplate>();
    for (const row of result.rows) {
      const template = this.deserialize(row);
      templateMap.set(template.channel_type, template);
    }

    return templateMap;
  }

  /**
   * Get template versions
   */
  async getVersions(
    channelType: ChannelType,
    triggerType: TriggerType
  ): Promise<NotificationTemplate[]> {
    const query = `
      SELECT * FROM ${this.schema}.${this.tableName}
      WHERE channel_type = $1 AND trigger_type = $2
      ORDER BY version DESC
      LIMIT 10
    `;
    const result = await this.getClient().query(query, [channelType, triggerType]);
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Create a new template (deactivates previous active template)
   */
  async create(data: CreateTemplateInput): Promise<NotificationTemplate> {
    // Deactivate previous active template for this channel+trigger
    await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} SET is_active = false 
       WHERE channel_type = $1 AND trigger_type = $2 AND is_active = true`,
      [data.channel_type, data.trigger_type]
    );

    // Get next version number
    const versionResult = await this.getClient().query(
      `SELECT COALESCE(MAX(version), 0) + 1 as next_version 
       FROM ${this.schema}.${this.tableName} 
       WHERE channel_type = $1 AND trigger_type = $2`,
      [data.channel_type, data.trigger_type]
    );
    const version = versionResult.rows[0].next_version;

    const templateData = {
      ...data,
      version,
      is_active: true,
    };

    return super.create(templateData);
  }

  /**
   * Update a template
   */
  async update(id: string, data: UpdateTemplateInput): Promise<NotificationTemplate | null> {
    const template = await this.findById(id);
    if (!template) {
      return null;
    }

    // If activating this template, deactivate others
    if (data.is_active === true) {
      await this.getClient().query(
        `UPDATE ${this.schema}.${this.tableName} SET is_active = false 
         WHERE channel_type = $1 AND trigger_type = $2 AND id != $3`,
        [template.channel_type, template.trigger_type, id]
      );
    }

    // Merge existing data to prevent data loss on partial updates
    // Only merge variables/recipients if at least one is being updated
    const mergedData = { ...data };
    if (data.variables !== undefined || data.recipients !== undefined) {
      mergedData.variables =
        data.variables !== undefined ? data.variables : template.variables || undefined;
      mergedData.recipients = data.recipients !== undefined ? data.recipients : template.recipients;
    }

    return super.update(id, mergedData);
  }

  /**
   * Delete a template
   */
  async delete(id: string): Promise<boolean> {
    return super.delete(id);
  }

  /**
   * Activate a specific template version
   */
  async activateVersion(id: string): Promise<NotificationTemplate | null> {
    const template = await this.findById(id);
    if (!template) {
      return null;
    }

    // Deactivate all templates for this channel+trigger
    await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} SET is_active = false 
       WHERE channel_type = $1 AND trigger_type = $2`,
      [template.channel_type, template.trigger_type]
    );

    // Activate this template
    await this.getClient().query(
      `UPDATE ${this.schema}.${this.tableName} SET is_active = true WHERE id = $1`,
      [id]
    );

    return this.findById(id);
  }

  /**
   * Serialize data before insert
   */
  protected serializeForInsert(
    data: CreateTemplateInput & { version?: number; is_active?: boolean }
  ): Record<string, unknown> {
    // Store both variables (docs) and recipients in the variables JSONB column
    let variablesJson = null;
    if (data.variables || data.recipients) {
      variablesJson = JSON.stringify({
        docs: data.variables || [],
        recipients: data.recipients || [],
      });
    }

    return {
      name: data.name,
      channel_type: data.channel_type,
      trigger_type: data.trigger_type,
      subject: data.subject || null,
      body: data.body,
      variables: variablesJson,
      version: data.version || 1,
      is_active: data.is_active ?? true,
    };
  }

  /**
   * Serialize data before update
   */
  protected serializeForUpdate(data: UpdateTemplateInput): Record<string, unknown> {
    const serialized: Record<string, unknown> = {};

    if (data.name !== undefined) {
      serialized.name = data.name;
    }
    if (data.subject !== undefined) {
      serialized.subject = data.subject || null;
    }
    if (data.body !== undefined) {
      serialized.body = data.body;
    }
    if (data.variables !== undefined || data.recipients !== undefined) {
      // At this point, the update() method has already merged existing data
      // So we can safely use the provided values (which are already merged)
      serialized.variables = JSON.stringify({
        docs: data.variables ?? [],
        recipients: data.recipients ?? [],
      });
    }
    if (data.is_active !== undefined) {
      serialized.is_active = data.is_active;
    }

    return serialized;
  }

  /**
   * Deserialize row from database
   */
  protected deserialize(row: Record<string, unknown>): NotificationTemplate {
    let variables = null;
    let recipients: string[] | undefined;

    // Parse variables JSONB column
    if (row.variables) {
      const parsed = typeof row.variables === 'string' ? JSON.parse(row.variables) : row.variables;

      // Support both old format (array of docs) and new format (object with docs/recipients)
      if (Array.isArray(parsed)) {
        // Old format: just documentation
        variables = parsed;
        recipients = undefined;
      } else if (parsed && typeof parsed === 'object') {
        // New format: { docs: [...], recipients: [...] }
        variables = parsed.docs || null;
        recipients = parsed.recipients || undefined;
      }
    }

    return {
      id: row.id as string,
      name: row.name as string,
      channel_type: row.channel_type as ChannelType,
      trigger_type: row.trigger_type as TriggerType,
      subject: row.subject as string | null,
      body: row.body as string,
      variables,
      recipients,
      version: row.version as number,
      is_active: row.is_active as boolean,
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
    };
  }
}
