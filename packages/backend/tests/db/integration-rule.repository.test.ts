/**
 * IntegrationRuleRepository Tests
 * Tests for CRUD operations and validation of integration filtering rules
 * Including auto-ticket creation functionality
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { FilterCondition, ThrottleConfig } from '../../src/types/notifications.js';
import type { FieldMappings, AttachmentConfig } from '@bugspotter/types';
import { createProjectIntegrationSQL } from '../test-helpers.js';

describe('IntegrationRuleRepository', () => {
  let db: DatabaseClient;
  let testProjectId: string;
  let testIntegrationId: string;

  beforeAll(async () => {
    db = await createDatabaseClient();

    // Create test integrations (required for FK relationship)
    await db.query(
      `INSERT INTO integrations (type, name, status) VALUES 
      ('jira', 'Jira', 'not_configured'),
      ('slack', 'Slack', 'not_configured')
      ON CONFLICT (type) DO NOTHING`
    );

    // Create test project
    const project = await db.projects.create({
      name: 'Test Project',
      settings: {},
    });
    testProjectId = project.id;

    // Create test integration
    const integration = await db.query(createProjectIntegrationSQL(), [
      testProjectId,
      'jira',
      true,
      '{"api_token":"test","server_url":"https://test.atlassian.net"}',
      null,
    ]);
    testIntegrationId = integration.rows[0].id;
  });

  afterAll(async () => {
    if (db) {
      await db.query('DELETE FROM project_integrations WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
      await db.close();
    }
  });

  beforeEach(async () => {
    // Clean up rules before each test
    await db.query('DELETE FROM integration_rules WHERE project_id = $1', [testProjectId]);
  });

  describe('createWithValidation', () => {
    it('should create rule with valid filters', async () => {
      const filters: FilterCondition[] = [
        { field: 'priority', operator: 'equals', value: 'high' },
        { field: 'browser', operator: 'contains', value: 'Chrome' },
      ];

      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'High Priority Chrome Bugs',
        enabled: true,
        priority: 100,
        filters,
      });

      expect(rule).toBeDefined();
      expect(rule.id).toBeDefined();
      expect(rule.name).toBe('High Priority Chrome Bugs');
      expect(rule.enabled).toBe(true);
      expect(rule.priority).toBe(100);
      expect(rule.filters).toEqual(filters);
    });

    it('should reject invalid filters', async () => {
      const invalidFilters: FilterCondition[] = [
        { field: 'unknown_field' as any, operator: 'equals', value: 'test' },
      ];

      await expect(
        db.integrationRules.createWithValidation({
          project_id: testProjectId,
          integration_id: testIntegrationId,
          name: 'Invalid Rule',
          enabled: true,
          priority: 100,
          filters: invalidFilters,
        })
      ).rejects.toThrow('Invalid filters');
    });

    it('should reject invalid operator', async () => {
      const invalidFilters: FilterCondition[] = [
        { field: 'priority', operator: 'invalid_op' as any, value: 'high' },
      ];

      await expect(
        db.integrationRules.createWithValidation({
          project_id: testProjectId,
          integration_id: testIntegrationId,
          name: 'Invalid Operator',
          enabled: true,
          priority: 100,
          filters: invalidFilters,
        })
      ).rejects.toThrow('Invalid filters');
    });

    it('should reject invalid regex pattern', async () => {
      const invalidFilters: FilterCondition[] = [
        { field: 'url_pattern', operator: 'regex', value: '[invalid(' },
      ];

      await expect(
        db.integrationRules.createWithValidation({
          project_id: testProjectId,
          integration_id: testIntegrationId,
          name: 'Invalid Regex',
          enabled: true,
          priority: 100,
          filters: invalidFilters,
        })
      ).rejects.toThrow('Invalid filters');
    });

    it('should create rule with empty filters', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Match All Rule',
        enabled: true,
        priority: 50,
        filters: [],
      });

      expect(rule).toBeDefined();
      expect(rule.filters).toEqual([]);
    });

    it('should default enabled to true', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Default Enabled',
        priority: 100,
        filters: [],
      });

      expect(rule.enabled).toBe(true);
    });

    it('should default priority to 0', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Default Priority',
        filters: [],
      });

      expect(rule.priority).toBe(0);
    });
  });

  describe('updateWithValidation', () => {
    it('should update rule with valid filters', async () => {
      // Create initial rule
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Original Rule',
        filters: [{ field: 'priority', operator: 'equals', value: 'low' }],
      });

      // Update with new filters
      const newFilters: FilterCondition[] = [
        { field: 'priority', operator: 'equals', value: 'critical' },
        { field: 'status', operator: 'equals', value: 'open' },
      ];

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        name: 'Updated Rule',
        filters: newFilters,
      });

      expect(updated).toBeDefined();
      expect(updated?.id).toBe(rule.id);
      expect(updated?.name).toBe('Updated Rule');
      expect(updated?.filters).toEqual(newFilters);
    });

    it('should reject invalid filters on update', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Valid Rule',
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
      });

      const invalidFilters: FilterCondition[] = [
        { field: 'unknown' as any, operator: 'equals', value: 'test' },
      ];

      await expect(
        db.integrationRules.updateWithValidation(rule.id, {
          filters: invalidFilters,
        })
      ).rejects.toThrow('Invalid filters');
    });

    it('should allow partial updates', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Original',
        enabled: true,
        priority: 100,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
      });

      // Update only enabled status
      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        enabled: false,
      });

      expect(updated?.enabled).toBe(false);
      expect(updated?.name).toBe('Original');
      expect(updated?.priority).toBe(100);
    });

    it('should throw on non-existent rule', async () => {
      await expect(
        db.integrationRules.updateWithValidation('non-existent-id', {
          name: 'Updated',
        })
      ).rejects.toThrow();
    });
  });

  describe('findEnabledByProjectAndPlatform', () => {
    it('should find enabled rules for project and integration', async () => {
      // Create multiple rules
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Rule 1',
        enabled: true,
        priority: 200,
        filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Rule 2',
        enabled: true,
        priority: 100,
        filters: [{ field: 'priority', operator: 'equals', value: 'high' }],
      });

      const rules = await db.integrationRules.findEnabledByProjectAndPlatform(
        testProjectId,
        testIntegrationId
      );

      expect(rules).toHaveLength(2);
      // Should be sorted by priority DESC
      expect(rules[0].priority).toBe(200);
      expect(rules[1].priority).toBe(100);
    });

    it('should exclude disabled rules', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Enabled Rule',
        enabled: true,
        priority: 100,
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Disabled Rule',
        enabled: false,
        priority: 100,
        filters: [],
      });

      const rules = await db.integrationRules.findEnabledByProjectAndPlatform(
        testProjectId,
        testIntegrationId
      );

      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Enabled Rule');
    });

    it('should return empty array when no enabled rules exist', async () => {
      const rules = await db.integrationRules.findEnabledByProjectAndPlatform(
        testProjectId,
        testIntegrationId
      );

      expect(rules).toEqual([]);
    });

    it('should only return rules for specific integration', async () => {
      // Create another integration
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        testProjectId,
        'slack',
        true,
        '{"webhook_url":"test"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      // Create rules for both integrations
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Jira Rule',
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: integration2Id,
        name: 'Slack Rule',
        filters: [],
      });

      const jiraRules = await db.integrationRules.findEnabledByProjectAndPlatform(
        testProjectId,
        testIntegrationId
      );

      expect(jiraRules).toHaveLength(1);
      expect(jiraRules[0].name).toBe('Jira Rule');

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [integration2Id]);
    });

    it('should sort rules by priority descending', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Low Priority',
        priority: 50,
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'High Priority',
        priority: 200,
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Medium Priority',
        priority: 100,
        filters: [],
      });

      const rules = await db.integrationRules.findEnabledByProjectAndPlatform(
        testProjectId,
        testIntegrationId
      );

      expect(rules).toHaveLength(3);
      expect(rules[0].priority).toBe(200);
      expect(rules[1].priority).toBe(100);
      expect(rules[2].priority).toBe(50);
    });
  });

  describe('findByProject', () => {
    it('should find all rules for project (enabled and disabled)', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Enabled Rule',
        enabled: true,
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Disabled Rule',
        enabled: false,
        filters: [],
      });

      const rules = await db.integrationRules.findByProject(testProjectId);

      expect(rules).toHaveLength(2);
      expect(rules.some((r) => r.enabled)).toBe(true);
      expect(rules.some((r) => !r.enabled)).toBe(true);
    });

    it('should return empty array when no rules exist', async () => {
      const rules = await db.integrationRules.findByProject(testProjectId);
      expect(rules).toEqual([]);
    });

    it('should include all integrations for project', async () => {
      // Create another integration
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        testProjectId,
        'slack',
        true,
        '{"webhook_url":"test"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Jira Rule',
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: integration2Id,
        name: 'Slack Rule',
        filters: [],
      });

      const rules = await db.integrationRules.findByProject(testProjectId);

      expect(rules).toHaveLength(2);
      expect(rules.some((r) => r.integration_id === testIntegrationId)).toBe(true);
      expect(rules.some((r) => r.integration_id === integration2Id)).toBe(true);

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [integration2Id]);
    });
  });

  describe('existsByName', () => {
    it('should return true when rule name exists', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Existing Rule',
        filters: [],
      });

      const exists = await db.integrationRules.existsByName(
        testProjectId,
        testIntegrationId,
        'Existing Rule'
      );

      expect(exists).toBe(true);
    });

    it('should return false when rule name does not exist', async () => {
      const exists = await db.integrationRules.existsByName(
        testProjectId,
        testIntegrationId,
        'Non-existent Rule'
      );

      expect(exists).toBe(false);
    });

    it('should be case-sensitive', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'My Rule',
        filters: [],
      });

      const exists = await db.integrationRules.existsByName(
        testProjectId,
        testIntegrationId,
        'my rule'
      );

      expect(exists).toBe(false);
    });

    it('should exclude specified rule ID (for updates)', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Unique Rule',
        filters: [],
      });

      // Should return false when excluding the rule itself
      const exists = await db.integrationRules.existsByName(
        testProjectId,
        testIntegrationId,
        'Unique Rule',
        rule.id
      );

      expect(exists).toBe(false);
    });

    it('should return true when another rule has same name', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Duplicate Name',
        filters: [],
      });

      const rule2 = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Another Rule',
        filters: [],
      });

      // Try to use first rule's name, excluding rule2 (should find first rule)
      const exists = await db.integrationRules.existsByName(
        testProjectId,
        testIntegrationId,
        'Duplicate Name',
        rule2.id
      );

      expect(exists).toBe(true);
    });

    it('should scope check to project and integration', async () => {
      // Create another integration
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        testProjectId,
        'slack',
        true,
        '{"webhook_url":"test"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      // Create rule with same name but different integration
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Same Name',
        filters: [],
      });

      // Should not exist for different integration
      const exists = await db.integrationRules.existsByName(
        testProjectId,
        integration2Id,
        'Same Name'
      );

      expect(exists).toBe(false);

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [integration2Id]);
    });
  });

  describe('database constraints', () => {
    it('should enforce unique rule name per integration', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Unique Name',
        filters: [],
      });

      // Try to create another rule with same name
      await expect(
        db.integrationRules.createWithValidation({
          project_id: testProjectId,
          integration_id: testIntegrationId,
          name: 'Unique Name',
          filters: [],
        })
      ).rejects.toThrow();
    });

    it('should allow same rule name for different integrations', async () => {
      // Create another integration
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        testProjectId,
        'slack',
        true,
        '{"webhook_url":"test"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Same Name',
        filters: [],
      });

      // Should succeed for different integration
      const rule2 = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: integration2Id,
        name: 'Same Name',
        filters: [],
      });

      expect(rule2).toBeDefined();

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [integration2Id]);
    });
  });

  describe('findAutoCreateRules', () => {
    it('should return empty array when no rules exist', async () => {
      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toEqual([]);
    });

    it('should return only auto_create enabled rules', async () => {
      // Create rule with auto_create false
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Manual Rule',
        enabled: true,
        auto_create: false,
        filters: [],
      });

      // Create rule with auto_create true
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Auto Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Auto Rule');
      expect(rules[0].auto_create).toBe(true);
    });

    it('should return only enabled rules', async () => {
      // Create disabled rule with auto_create true
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Disabled Auto Rule',
        enabled: false,
        auto_create: true,
        filters: [],
      });

      // Create enabled rule with auto_create true
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Enabled Auto Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Enabled Auto Rule');
      expect(rules[0].enabled).toBe(true);
    });

    it('should filter by project_id', async () => {
      // Create another project
      const project2 = await db.projects.create({
        name: 'Test Project 2',
        settings: {},
      });

      // Create integration for project2
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        project2.id,
        'jira',
        true,
        '{"api_token":"test2","server_url":"https://test2.atlassian.net"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      // Create rule for project2
      await db.integrationRules.createWithValidation({
        project_id: project2.id,
        integration_id: integration2Id,
        name: 'Project 2 Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      // Create rule for testProject
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Project 1 Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Project 1 Rule');
      expect(rules[0].project_id).toBe(testProjectId);

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [integration2Id]);
      await db.query('DELETE FROM projects WHERE id = $1', [project2.id]);
    });

    it('should filter by integration_id', async () => {
      // Create another integration for same project
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        testProjectId,
        'slack',
        true,
        '{"webhook_url":"test"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      // Create rule for Jira
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Jira Auto Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      // Create rule for Slack
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: integration2Id,
        name: 'Slack Auto Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe('Jira Auto Rule');
      expect(rules[0].integration_id).toBe(testIntegrationId);

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [integration2Id]);
    });

    it('should order by priority descending', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Low Priority',
        enabled: true,
        auto_create: true,
        priority: 50,
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'High Priority',
        enabled: true,
        auto_create: true,
        priority: 200,
        filters: [],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Medium Priority',
        enabled: true,
        auto_create: true,
        priority: 100,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(3);
      expect(rules[0].priority).toBe(200);
      expect(rules[0].name).toBe('High Priority');
      expect(rules[1].priority).toBe(100);
      expect(rules[1].name).toBe('Medium Priority');
      expect(rules[2].priority).toBe(50);
      expect(rules[2].name).toBe('Low Priority');
    });

    it('should return all new JSONB fields', async () => {
      const fieldMappings: FieldMappings = {
        customfield_10001: 'error.message',
        customfield_10002: 'device.os',
      };

      const attachmentConfig: AttachmentConfig = {
        screenshot: { enabled: true },
        console: { enabled: true, levels: ['error', 'warn'], maxEntries: 100 },
        network: { enabled: false },
        replay: { enabled: true, mode: 'link', expiryHours: 168 },
      };

      const throttle: ThrottleConfig = {
        max_per_hour: 10,
        max_per_day: 50,
        group_by: 'error_signature',
      };

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Full Auto Rule',
        enabled: true,
        auto_create: true,
        field_mappings: fieldMappings,
        description_template: 'Error: {{error.message}}\nURL: {{url}}',
        attachment_config: attachmentConfig,
        throttle,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      expect(rules[0].field_mappings).toEqual(fieldMappings);
      expect(rules[0].description_template).toBe('Error: {{error.message}}\nURL: {{url}}');
      expect(rules[0].attachment_config).toEqual(attachmentConfig);
      expect(rules[0].throttle).toEqual(throttle);
    });

    it('should handle null JSONB fields', async () => {
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Minimal Auto Rule',
        enabled: true,
        auto_create: true,
        field_mappings: null,
        description_template: null,
        attachment_config: null,
        throttle: null,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      // null JSONB columns should be returned as null (not {})
      expect(rules[0].field_mappings).toBeNull();
      expect(rules[0].description_template).toBeNull();
      expect(rules[0].attachment_config).toBeNull();
      expect(rules[0].throttle).toBeNull();
    });

    it('should return rules with throttle config', async () => {
      const throttle: ThrottleConfig = {
        max_per_hour: 5,
        max_per_day: 20,
        group_by: 'user',
        digest_mode: true,
        digest_interval_minutes: 30,
      };

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Throttled Rule',
        enabled: true,
        auto_create: true,
        throttle,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      expect(rules[0].throttle).toEqual(throttle);
    });

    it('should return rules with field_mappings', async () => {
      const fieldMappings: FieldMappings = {
        customfield_10001: 'bug.priority',
        customfield_10002: 'bug.status',
        customfield_10003: 'user.email',
        summary: 'bug.title',
        description: 'bug.description',
      };

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Mapped Fields Rule',
        enabled: true,
        auto_create: true,
        field_mappings: fieldMappings,
        filters: [],
      });

      const rules = await db.integrationRules.findAutoCreateRules(testProjectId, testIntegrationId);

      expect(rules).toHaveLength(1);
      expect(rules[0].field_mappings).toEqual(fieldMappings);
    });
  });

  describe('create with auto-ticket fields', () => {
    it('should create rule with auto_create true', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Auto Create Rule',
        enabled: true,
        auto_create: true,
        filters: [],
      });

      expect(rule).toBeDefined();
      expect(rule.auto_create).toBe(true);
      expect(rule.enabled).toBe(true);
    });

    it('should create rule with throttle config', async () => {
      const throttle: ThrottleConfig = {
        max_per_hour: 15,
        max_per_day: 100,
        group_by: 'url',
      };

      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Throttled Auto Rule',
        enabled: true,
        auto_create: true,
        throttle,
        filters: [],
      });

      expect(rule.throttle).toEqual(throttle);
    });

    it('should create rule with field_mappings', async () => {
      const fieldMappings: FieldMappings = {
        customfield_10010: 'browser.name',
        customfield_10011: 'browser.version',
        customfield_10012: 'device.type',
      };

      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Field Mapping Rule',
        enabled: true,
        auto_create: true,
        field_mappings: fieldMappings,
        filters: [],
      });

      expect(rule.field_mappings).toEqual(fieldMappings);
    });

    it('should create rule with description_template', async () => {
      const template = `
# Bug Report

**Error**: {{error.message}}
**URL**: {{url}}
**Browser**: {{browser.name}} {{browser.version}}
**User**: {{user.email}}

## Stack Trace
{{error.stack}}
`;

      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Template Rule',
        enabled: true,
        auto_create: true,
        description_template: template,
        filters: [],
      });

      expect(rule.description_template).toBe(template);
    });

    it('should create rule with attachment_config', async () => {
      const attachmentConfig: AttachmentConfig = {
        screenshot: { enabled: true },
        console: { enabled: false },
        network: { enabled: true, failedOnly: true, maxEntries: 50 },
        replay: { enabled: false },
      };

      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Attachment Rule',
        enabled: true,
        auto_create: true,
        attachment_config: attachmentConfig,
        filters: [],
      });

      expect(rule.attachment_config).toEqual(attachmentConfig);
    });

    it('should create rule with all auto-ticket fields', async () => {
      const fieldMappings: FieldMappings = {
        customfield_10001: 'error.type',
        customfield_10002: 'priority',
      };

      const attachmentConfig: AttachmentConfig = {
        screenshot: { enabled: true },
        console: { enabled: false },
        network: { enabled: false },
        replay: { enabled: true },
      };

      const throttle: ThrottleConfig = {
        max_per_hour: 20,
        max_per_day: 200,
        group_by: 'error_signature',
        digest_mode: false,
      };

      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Complete Auto Rule',
        enabled: true,
        auto_create: true,
        priority: 150,
        field_mappings: fieldMappings,
        description_template: 'Error: {{error.message}}',
        attachment_config: attachmentConfig,
        throttle,
        filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
      });

      expect(rule.auto_create).toBe(true);
      expect(rule.field_mappings).toEqual(fieldMappings);
      expect(rule.description_template).toBe('Error: {{error.message}}');
      expect(rule.attachment_config).toEqual(attachmentConfig);
      expect(rule.throttle).toEqual(throttle);
      expect(rule.filters).toHaveLength(1);
    });

    it('should default auto_create to false when not specified', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Default Auto Create',
        filters: [],
      });

      expect(rule.auto_create).toBe(false);
    });
  });

  describe('update auto-ticket fields', () => {
    it('should update auto_create flag', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Update Auto Create',
        auto_create: false,
        filters: [],
      });

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        auto_create: true,
      });

      expect(updated?.auto_create).toBe(true);
    });

    it('should update throttle config', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Update Throttle',
        auto_create: true,
        throttle: null,
        filters: [],
      });

      const newThrottle: ThrottleConfig = {
        max_per_hour: 25,
        max_per_day: 150,
        group_by: 'user',
      };

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        throttle: newThrottle,
      });

      expect(updated?.throttle).toEqual(newThrottle);
    });

    it('should update field_mappings', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Update Field Mappings',
        auto_create: true,
        field_mappings: { customfield_10001: 'old.field' },
        filters: [],
      });

      const newMappings: FieldMappings = {
        customfield_10001: 'new.field',
        customfield_10002: 'another.field',
      };

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        field_mappings: newMappings,
      });

      expect(updated?.field_mappings).toEqual(newMappings);
    });

    it('should update description_template', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Update Template',
        auto_create: true,
        description_template: 'Old template',
        filters: [],
      });

      const newTemplate = 'New template: {{error.message}}';

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        description_template: newTemplate,
      });

      expect(updated?.description_template).toBe(newTemplate);
    });

    it('should update attachment_config', async () => {
      const oldConfig: AttachmentConfig = {
        screenshot: { enabled: true },
        console: { enabled: false },
        network: { enabled: true, failedOnly: true },
        replay: { enabled: false },
      };

      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Update Attachments',
        auto_create: true,
        attachment_config: oldConfig,
        filters: [],
      });

      const newConfig: AttachmentConfig = {
        screenshot: { enabled: false },
        console: { enabled: true, levels: ['error'], maxEntries: 100 },
        network: { enabled: false },
        replay: { enabled: true, mode: 'attach', expiryHours: 48 },
      };

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        attachment_config: newConfig,
      });

      expect(updated?.attachment_config).toEqual(newConfig);
    });

    it('should set JSONB fields to null', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Clear JSONB Fields',
        auto_create: true,
        field_mappings: { customfield_10001: 'test' },
        throttle: { max_per_hour: 10 },
        attachment_config: {
          screenshot: { enabled: true },
          replay: { enabled: false },
        },
        description_template: 'Template',
        filters: [],
      });

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        field_mappings: null,
        throttle: null,
        attachment_config: null,
        description_template: null,
      });

      // null JSONB columns should be returned as null (not {})
      expect(updated?.field_mappings).toBeNull();
      expect(updated?.throttle).toBeNull();
      expect(updated?.attachment_config).toBeNull();
      expect(updated?.description_template).toBeNull();
    });

    it('should update multiple auto-ticket fields at once', async () => {
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Update Multiple',
        auto_create: false,
        filters: [],
      });

      const fieldMappings: FieldMappings = {
        customfield_10001: 'error.message',
      };

      const attachmentConfig: AttachmentConfig = {
        screenshot: { enabled: true },
        console: { enabled: true, levels: ['error'], maxEntries: 50 },
        network: { enabled: true, failedOnly: false, includeBodies: true, maxEntries: 100 },
        replay: { enabled: true, mode: 'attach', expiryHours: 24 },
      };

      const updated = await db.integrationRules.updateWithValidation(rule.id, {
        auto_create: true,
        field_mappings: fieldMappings,
        description_template: 'Updated: {{error.message}}',
        attachment_config: attachmentConfig,
      });

      expect(updated?.auto_create).toBe(true);
      expect(updated?.field_mappings).toEqual(fieldMappings);
      expect(updated?.description_template).toBe('Updated: {{error.message}}');
      expect(updated?.attachment_config).toEqual(attachmentConfig);
    });
  });

  describe('copyToProject', () => {
    let sourceProjectId: string;
    let targetProjectId: string;
    let sourceIntegrationId: string;
    let targetIntegrationId: string;
    let sourceRuleId: string;

    beforeEach(async () => {
      // Create source project
      const sourceProject = await db.projects.create({
        name: 'Source Project for Copy',
        settings: {},
      });
      sourceProjectId = sourceProject.id;

      // Create target project
      const targetProject = await db.projects.create({
        name: 'Target Project for Copy',
        settings: {},
      });
      targetProjectId = targetProject.id;

      // Create source integration
      const sourceIntegration = await db.query(createProjectIntegrationSQL(), [
        sourceProjectId,
        'jira',
        true,
        '{"api_token":"test","server_url":"https://source.atlassian.net"}',
        null,
      ]);
      sourceIntegrationId = sourceIntegration.rows[0].id;

      // Create target integration
      const targetIntegration = await db.query(createProjectIntegrationSQL(), [
        targetProjectId,
        'jira',
        true,
        '{"api_token":"test","server_url":"https://target.atlassian.net"}',
        null,
      ]);
      targetIntegrationId = targetIntegration.rows[0].id;

      // Create source rule
      const sourceRule = await db.integrationRules.createWithValidation({
        project_id: sourceProjectId,
        integration_id: sourceIntegrationId,
        name: 'Original Rule',
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'high',
          } as FilterCondition,
        ],
        field_mappings: {
          summary: '{{title}}',
          description: '{{description}}',
        },
        description_template: 'Bug: {{title}}',
        auto_create: true,
        enabled: true,
        priority: 5,
      });
      sourceRuleId = sourceRule.id;
    });

    afterEach(async () => {
      await db.query('DELETE FROM integration_rules WHERE project_id IN ($1, $2)', [
        sourceProjectId,
        targetProjectId,
      ]);
      await db.query('DELETE FROM project_integrations WHERE project_id IN ($1, $2)', [
        sourceProjectId,
        targetProjectId,
      ]);
      await db.query('DELETE FROM projects WHERE id IN ($1, $2)', [
        sourceProjectId,
        targetProjectId,
      ]);
    });

    it('should copy rule with basic name suffix', async () => {
      const copiedRule = await db.integrationRules.copyToProject(
        sourceRuleId,
        targetProjectId,
        targetIntegrationId
      );

      expect(copiedRule).toBeDefined();
      expect(copiedRule.id).not.toBe(sourceRuleId);
      expect(copiedRule.name).toBe('Original Rule (Copy)');
      expect(copiedRule.project_id).toBe(targetProjectId);
      expect(copiedRule.integration_id).toBe(targetIntegrationId);
      expect(copiedRule.auto_create).toBe(true); // Preserved from source
      expect(copiedRule.enabled).toBe(true);
      expect(copiedRule.priority).toBe(5);
      expect(copiedRule.filters).toEqual([
        {
          field: 'priority',
          operator: 'equals',
          value: 'high',
        },
      ]);
      expect(copiedRule.field_mappings).toEqual({
        summary: '{{title}}',
        description: '{{description}}',
      });
      expect(copiedRule.description_template).toBe('Bug: {{title}}');
    });

    it('should handle name conflicts with incremental numbering', async () => {
      // First copy
      const firstCopy = await db.integrationRules.copyToProject(
        sourceRuleId,
        targetProjectId,
        targetIntegrationId
      );
      expect(firstCopy.name).toBe('Original Rule (Copy)');

      // Second copy - should increment
      const secondCopy = await db.integrationRules.copyToProject(
        sourceRuleId,
        targetProjectId,
        targetIntegrationId
      );
      expect(secondCopy.name).toBe('Original Rule (Copy 2)');

      // Third copy - should increment further
      const thirdCopy = await db.integrationRules.copyToProject(
        sourceRuleId,
        targetProjectId,
        targetIntegrationId
      );
      expect(thirdCopy.name).toBe('Original Rule (Copy 3)');
    });

    it('should find next available name sequentially', async () => {
      // Create "Original Rule (Copy)" manually
      await db.integrationRules.createWithValidation({
        project_id: targetProjectId,
        integration_id: targetIntegrationId,
        name: 'Original Rule (Copy)',
        filters: [],
      });

      // Algorithm will try (Copy 2) next and succeed
      const copiedRule = await db.integrationRules.copyToProject(
        sourceRuleId,
        targetProjectId,
        targetIntegrationId
      );
      expect(copiedRule.name).toBe('Original Rule (Copy 2)');

      // Create another copy with gap in numbering
      await db.integrationRules.createWithValidation({
        project_id: targetProjectId,
        integration_id: targetIntegrationId,
        name: 'Original Rule (Copy 5)', // Gap: no Copy 3, 4
        filters: [],
      });

      // Next copy should be (Copy 3) - fills first available gap
      const thirdCopy = await db.integrationRules.copyToProject(
        sourceRuleId,
        targetProjectId,
        targetIntegrationId
      );
      expect(thirdCopy.name).toBe('Original Rule (Copy 3)');
    });

    it('should throw error when source rule not found', async () => {
      const fakeRuleId = '00000000-0000-0000-0000-000000000000';
      await expect(
        db.integrationRules.copyToProject(fakeRuleId, targetProjectId, targetIntegrationId)
      ).rejects.toThrow('Source rule not found');
    });

    it('should throw error when max copy limit exceeded', async () => {
      // Create 100 copies to hit the limit
      for (let i = 1; i <= 100; i++) {
        await db.integrationRules.createWithValidation({
          project_id: targetProjectId,
          integration_id: targetIntegrationId,
          name: i === 1 ? 'Original Rule (Copy)' : `Original Rule (Copy ${i})`,
          filters: [],
        });
      }

      await expect(
        db.integrationRules.copyToProject(sourceRuleId, targetProjectId, targetIntegrationId)
      ).rejects.toThrow('Too many copies of this rule exist in target project');
    });

    it('should preserve all rule configuration including auto_create', async () => {
      // Create rule with complex config
      const complexRule = await db.integrationRules.createWithValidation({
        project_id: sourceProjectId,
        integration_id: sourceIntegrationId,
        name: 'Complex Rule',
        filters: [
          { field: 'priority', operator: 'equals', value: 'critical' } as FilterCondition,
          { field: 'browser', operator: 'contains', value: 'Chrome' } as FilterCondition,
        ],
        throttle: {
          max_per_hour: 10,
          max_per_day: 50,
          group_by: 'url',
        } as ThrottleConfig,
        field_mappings: {
          summary: '{{title}}',
          description: '{{description}}',
          priority: { name: 'High' },
        },
        description_template: 'Priority: {{priority}}\nError: {{error.message}}',
        attachment_config: {
          screenshot: { enabled: true },
          console: { enabled: true, levels: ['error'], maxEntries: 100 },
          network: { enabled: false },
          replay: { enabled: true, mode: 'attach', expiryHours: 48 },
        } as AttachmentConfig,
        auto_create: true,
        enabled: false,
        priority: 10,
      });

      const copiedRule = await db.integrationRules.copyToProject(
        complexRule.id,
        targetProjectId,
        targetIntegrationId
      );

      // Verify all fields preserved except auto_create
      expect(copiedRule.filters).toEqual(complexRule.filters);
      expect(copiedRule.throttle).toEqual(complexRule.throttle);
      expect(copiedRule.field_mappings).toEqual(complexRule.field_mappings);
      expect(copiedRule.description_template).toBe(complexRule.description_template);
      expect(copiedRule.attachment_config).toEqual(complexRule.attachment_config);
      expect(copiedRule.enabled).toBe(false); // Preserved
      expect(copiedRule.priority).toBe(10); // Preserved
      expect(copiedRule.auto_create).toBe(true); // Preserved from source
    });
  });
});
