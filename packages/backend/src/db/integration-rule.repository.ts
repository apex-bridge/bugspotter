/**
 * Integration Rule Repository
 * Manages rules for filtering which bug reports trigger integrations
 * Uses shared RuleMatcher service for consistent filtering logic with notifications
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './repositories/base-repository.js';
import { RuleMatcher } from '../services/rule-matcher.js';
import type { FilterCondition, ThrottleConfig } from '../types/notifications.js';
import type { FieldMappings, AttachmentConfig } from '@bugspotter/types';

export interface IntegrationRule {
  id: string;
  project_id: string;
  integration_id: string;
  name: string;
  enabled: boolean;
  priority: number;
  filters: FilterCondition[];
  throttle: ThrottleConfig | null;
  auto_create: boolean;
  field_mappings: FieldMappings | null;
  description_template: string | null;
  attachment_config: AttachmentConfig | null;
  created_at: Date;
  updated_at: Date;
}

export interface IntegrationRuleInsert {
  id?: string;
  project_id: string;
  integration_id: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  filters: FilterCondition[];
  throttle?: ThrottleConfig | null;
  auto_create?: boolean;
  field_mappings?: FieldMappings | null;
  description_template?: string | null;
  attachment_config?: AttachmentConfig | null;
}

export interface IntegrationRuleUpdate {
  name?: string;
  enabled?: boolean;
  priority?: number;
  filters?: FilterCondition[];
  throttle?: ThrottleConfig | null;
  auto_create?: boolean;
  field_mappings?: FieldMappings | null;
  description_template?: string | null;
  attachment_config?: AttachmentConfig | null;
}

export class IntegrationRuleRepository extends BaseRepository<
  IntegrationRule,
  IntegrationRuleInsert,
  IntegrationRuleUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'integration_rules', [
      'filters',
      'throttle',
      'field_mappings',
      'attachment_config',
    ]);
  }

  /**
   * Find all rules for a specific project and integration platform
   * Ordered by priority DESC (higher priority rules first)
   * @param includeDisabled - If true, includes disabled rules (default: false for backward compatibility)
   */
  async findByProjectAndPlatform(
    projectId: string,
    integrationId: string,
    includeDisabled = false
  ): Promise<IntegrationRule[]> {
    const query = `
      SELECT 
        id, project_id, integration_id, name, enabled, priority,
        filters, throttle, auto_create, field_mappings, 
        description_template, attachment_config, 
        created_at, updated_at
      FROM integration_rules
      WHERE project_id = $1
        AND integration_id = $2
        ${includeDisabled ? '' : 'AND enabled = true'}
      ORDER BY priority DESC, created_at ASC
    `;

    const result = await this.pool.query<IntegrationRule>(query, [projectId, integrationId]);
    return result.rows;
  }

  /**
   * @deprecated Use findByProjectAndPlatform() with includeDisabled parameter instead
   * Find all enabled rules for a specific project and integration platform
   * Ordered by priority DESC (higher priority rules first)
   */
  async findEnabledByProjectAndPlatform(
    projectId: string,
    integrationId: string
  ): Promise<IntegrationRule[]> {
    return this.findByProjectAndPlatform(projectId, integrationId, false);
  }

  /**
   * Find all rules for a project (including disabled)
   */
  async findByProject(projectId: string): Promise<IntegrationRule[]> {
    const query = `
      SELECT 
        id, project_id, integration_id, name, enabled, priority,
        filters, throttle, auto_create, field_mappings, 
        description_template, attachment_config,
        created_at, updated_at
      FROM integration_rules
      WHERE project_id = $1
      ORDER BY priority DESC, name ASC
    `;

    const result = await this.pool.query<IntegrationRule>(query, [projectId]);
    return result.rows;
  }

  /**
   * Create a new integration rule with filter validation
   */
  async createWithValidation(data: IntegrationRuleInsert): Promise<IntegrationRule> {
    // Validate filters using RuleMatcher
    const validation = RuleMatcher.validateFilters(data.filters);
    if (!validation.valid) {
      throw new Error(`Invalid filters: ${validation.errors.join(', ')}`);
    }

    return this.create(data);
  }

  /**
   * Update an integration rule with filter validation
   */
  async updateWithValidation(
    id: string,
    data: IntegrationRuleUpdate
  ): Promise<IntegrationRule | null> {
    // Validate filters if provided
    if (data.filters) {
      const validation = RuleMatcher.validateFilters(data.filters);
      if (!validation.valid) {
        throw new Error(`Invalid filters: ${validation.errors.join(', ')}`);
      }
    }

    return this.update(id, data);
  }

  /**
   * Check if a rule name already exists for this integration
   */
  async existsByName(
    projectId: string,
    integrationId: string,
    name: string,
    excludeId?: string
  ): Promise<boolean> {
    let query = `
      SELECT EXISTS(
        SELECT 1 FROM integration_rules 
        WHERE project_id = $1 AND integration_id = $2 AND name = $3
    `;

    const values: unknown[] = [projectId, integrationId, name];

    if (excludeId) {
      query += ` AND id != $4`;
      values.push(excludeId);
    }

    query += ') as exists';

    const result = await this.pool.query<{ exists: boolean }>(query, values);
    return result.rows[0].exists;
  }

  /**
   * Find all auto-create rules for a specific project and integration
   * Returns only enabled rules with auto_create=true
   * Ordered by priority DESC (higher priority rules first)
   */
  async findAutoCreateRules(projectId: string, integrationId: string): Promise<IntegrationRule[]> {
    const query = `
      SELECT 
        id, project_id, integration_id, name, enabled, priority,
        filters, throttle, auto_create, field_mappings, 
        description_template, attachment_config,
        created_at, updated_at
      FROM integration_rules
      WHERE project_id = $1
        AND integration_id = $2
        AND enabled = true
        AND auto_create = true
      ORDER BY priority DESC, created_at ASC
    `;

    const result = await this.pool.query<IntegrationRule>(query, [projectId, integrationId]);
    return result.rows;
  }

  /**
   * Copy an integration rule to another project
   * Automatically handles name conflicts by appending " (Copy)" or incrementing
   * Defaults auto_create to false for safety
   * @param ruleId - Source rule ID to copy
   * @param targetProjectId - Target project ID
   * @param targetIntegrationId - Target integration ID (same platform)
   * @returns Newly created rule in target project
   */
  async copyToProject(
    ruleId: string,
    targetProjectId: string,
    targetIntegrationId: string
  ): Promise<IntegrationRule> {
    // Get source rule
    const sourceRule = await this.findById(ruleId);
    if (!sourceRule) {
      throw new Error(`Source rule not found: ${ruleId}`);
    }

    // Generate unique name in target project
    let targetName = `${sourceRule.name} (Copy)`;
    let nameExists = await this.existsByName(targetProjectId, targetIntegrationId, targetName);

    // If name with " (Copy)" exists, try incrementing numbers
    let copyNumber = 2;
    while (nameExists) {
      targetName = `${sourceRule.name} (Copy ${copyNumber})`;
      nameExists = await this.existsByName(targetProjectId, targetIntegrationId, targetName);
      copyNumber++;

      // Safety limit to prevent infinite loops
      if (copyNumber > 100) {
        throw new Error(
          'Too many copies of this rule exist in target project. Please rename manually.'
        );
      }
    }

    // Create copy with new name and target IDs
    const copiedRule = await this.createWithValidation({
      project_id: targetProjectId,
      integration_id: targetIntegrationId,
      name: targetName,
      enabled: sourceRule.enabled,
      priority: sourceRule.priority,
      filters: sourceRule.filters,
      throttle: sourceRule.throttle,
      auto_create: sourceRule.auto_create,
      field_mappings: sourceRule.field_mappings,
      description_template: sourceRule.description_template,
      attachment_config: sourceRule.attachment_config,
    });

    return copiedRule;
  }
}
