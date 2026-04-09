/**
 * Notification Template Repository Tests
 * Tests for template CRUD operations and data integrity
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseClient } from '../../src/db/client.js';
import type { NotificationTemplate } from '../../src/types/notifications.js';

const TEST_DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';

describe('NotificationTemplateRepository', () => {
  let db: DatabaseClient;

  beforeAll(async () => {
    db = DatabaseClient.create({
      connectionString: TEST_DATABASE_URL,
    });

    const isConnected = await db.testConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to test database');
    }

    // Clean up any existing templates from previous tests
    await db.query('TRUNCATE TABLE notification_templates CASCADE');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('update() - Partial updates preserve existing data', () => {
    let template: NotificationTemplate;

    beforeAll(async () => {
      // Create a template with both variables and recipients
      template = await db.notificationTemplates.create({
        name: 'Test Merge Template',
        channel_type: 'email',
        trigger_type: 'new_bug',
        subject: 'Bug Report: {{bug.title}}',
        body: 'A new bug was reported by {{user.email}}',
        recipients: ['admin@example.com', 'team@example.com'],
        variables: [
          { key: 'bug.title', description: 'Bug title' },
          { key: 'user.email', description: 'User email' },
        ],
      });
    });

    it('should preserve variables when updating only recipients', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        recipients: ['new-admin@example.com'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.recipients).toEqual(['new-admin@example.com']);
      expect(updated!.variables).toEqual([
        { key: 'bug.title', description: 'Bug title' },
        { key: 'user.email', description: 'User email' },
      ]);
    });

    it('should preserve recipients when updating only variables', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        variables: [
          { key: 'bug.id', description: 'Bug ID' },
          { key: 'bug.status', description: 'Bug status' },
        ],
      });

      expect(updated).not.toBeNull();
      expect(updated!.variables).toEqual([
        { key: 'bug.id', description: 'Bug ID' },
        { key: 'bug.status', description: 'Bug status' },
      ]);
      expect(updated!.recipients).toEqual(['new-admin@example.com']); // From previous test
    });

    it('should preserve recipients when updating name', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        name: 'Updated Template Name',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Template Name');
      expect(updated!.recipients).toEqual(['new-admin@example.com']);
      expect(updated!.variables).toEqual([
        { key: 'bug.id', description: 'Bug ID' },
        { key: 'bug.status', description: 'Bug status' },
      ]);
    });

    it('should update subject and recipients together', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        subject: 'New Subject',
        recipients: ['owner@example.com'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.subject).toBe('New Subject');
      expect(updated!.recipients).toEqual(['owner@example.com']);
      // Variables should still be preserved
      expect(updated!.variables).toEqual([
        { key: 'bug.id', description: 'Bug ID' },
        { key: 'bug.status', description: 'Bug status' },
      ]);
    });

    it('should preserve recipients when updating other fields', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        name: 'Updated Name Again',
        subject: 'Another Subject',
      });

      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Name Again');
      expect(updated!.subject).toBe('Another Subject');
      expect(updated!.recipients).toEqual(['owner@example.com']);
      expect(updated!.variables).toEqual([
        { key: 'bug.id', description: 'Bug ID' },
        { key: 'bug.status', description: 'Bug status' },
      ]);
    });

    it('should handle updating to empty array explicitly', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        recipients: [],
      });

      expect(updated).not.toBeNull();
      expect(updated!.recipients).toEqual([]);
      // Variables should still be preserved
      expect(updated!.variables).toEqual([
        { key: 'bug.id', description: 'Bug ID' },
        { key: 'bug.status', description: 'Bug status' },
      ]);
    });

    it('should handle updating variables to empty array explicitly', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        variables: [],
      });

      expect(updated).not.toBeNull();
      expect(updated!.variables).toEqual([]);
      // Recipients should still be preserved (empty from previous test)
      expect(updated!.recipients).toEqual([]);
    });

    it('should handle updating body while keeping recipients and variables', async () => {
      // First restore both recipients and variables
      await db.notificationTemplates.update(template.id, {
        recipients: ['test@example.com'],
        variables: [{ key: 'test.var', description: 'Test variable' }],
      });

      // Now update body only
      const updated = await db.notificationTemplates.update(template.id, {
        body: 'New body content',
      });

      expect(updated).not.toBeNull();
      expect(updated!.body).toBe('New body content');
      expect(updated!.recipients).toEqual(['test@example.com']);
      expect(updated!.variables).toEqual([{ key: 'test.var', description: 'Test variable' }]);
    });

    it('should handle updating both variables and recipients', async () => {
      const updated = await db.notificationTemplates.update(template.id, {
        variables: [
          { key: 'new.var1', description: 'New var 1' },
          { key: 'new.var2', description: 'New var 2' },
        ],
        recipients: ['new1@example.com', 'new2@example.com'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.variables).toEqual([
        { key: 'new.var1', description: 'New var 1' },
        { key: 'new.var2', description: 'New var 2' },
      ]);
      expect(updated!.recipients).toEqual(['new1@example.com', 'new2@example.com']);
    });

    it('should not lose data when updating unrelated fields multiple times', async () => {
      // Set initial state
      await db.notificationTemplates.update(template.id, {
        recipients: ['important@example.com'],
        variables: [{ key: 'important.data', description: 'Important data' }],
      });

      // Update name - should preserve both
      let updated = await db.notificationTemplates.update(template.id, {
        name: 'Name Update 1',
      });
      expect(updated!.recipients).toEqual(['important@example.com']);
      expect(updated!.variables).toEqual([
        { key: 'important.data', description: 'Important data' },
      ]);

      // Update subject - should preserve both
      updated = await db.notificationTemplates.update(template.id, {
        subject: 'Subject Update',
      });
      expect(updated!.recipients).toEqual(['important@example.com']);
      expect(updated!.variables).toEqual([
        { key: 'important.data', description: 'Important data' },
      ]);

      // Update body - should preserve both
      updated = await db.notificationTemplates.update(template.id, {
        body: 'Body Update',
      });
      expect(updated!.recipients).toEqual(['important@example.com']);
      expect(updated!.variables).toEqual([
        { key: 'important.data', description: 'Important data' },
      ]);

      // Update is_active - should preserve both
      updated = await db.notificationTemplates.update(template.id, {
        is_active: false,
      });
      expect(updated!.recipients).toEqual(['important@example.com']);
      expect(updated!.variables).toEqual([
        { key: 'important.data', description: 'Important data' },
      ]);
    });
  });

  describe('create() - Auto-versioning and activation', () => {
    let template1: NotificationTemplate;
    let template2: NotificationTemplate;

    it('should create first version as version 1', async () => {
      template1 = await db.notificationTemplates.create({
        name: 'Version Test 1',
        channel_type: 'slack',
        trigger_type: 'new_bug',
        body: 'Bug assigned',
      });

      expect(template1.version).toBe(1);
      expect(template1.is_active).toBe(true);
    });

    it('should auto-increment version and deactivate previous', async () => {
      template2 = await db.notificationTemplates.create({
        name: 'Version Test 2',
        channel_type: 'slack',
        trigger_type: 'new_bug',
        body: 'Bug assigned - updated',
      });

      expect(template2.version).toBe(2);
      expect(template2.is_active).toBe(true);

      // Check that version 1 was deactivated
      const versions = await db.notificationTemplates.getVersions('slack', 'new_bug');
      expect(versions[0].version).toBe(2);
      expect(versions[0].is_active).toBe(true);
      expect(versions[1].version).toBe(1);
      expect(versions[1].is_active).toBe(false);
    });
  });

  describe('findActiveTemplate()', () => {
    it('should return the active template for channel+trigger', async () => {
      const active = await db.notificationTemplates.findActiveTemplate('slack', 'new_bug');

      expect(active).not.toBeNull();
      expect(active!.id).toBeDefined();
      expect(active!.channel_type).toBe('slack');
      expect(active!.trigger_type).toBe('new_bug');
      expect(active!.is_active).toBe(true);
    });

    it('should return null when no active template exists', async () => {
      const active = await db.notificationTemplates.findActiveTemplate('discord', 'digest');

      expect(active).toBeNull();
    });
  });

  describe('activateVersion()', () => {
    it('should activate a specific version and deactivate others', async () => {
      // Get all versions for slack/new_bug
      const versions = await db.notificationTemplates.getVersions('slack', 'new_bug');
      expect(versions.length).toBeGreaterThanOrEqual(2);

      // Find version 1 (should be inactive after version 2 was created)
      const version1 = versions.find((v) => v.version === 1);
      expect(version1).not.toBeUndefined();
      expect(version1!.is_active).toBe(false);

      // Activate version 1
      const activated = await db.notificationTemplates.activateVersion(version1!.id);

      expect(activated).not.toBeNull();
      expect(activated!.id).toBe(version1!.id);
      expect(activated!.is_active).toBe(true);
      expect(activated!.version).toBe(1);

      // Verify only version 1 is active by checking all versions
      const allVersions = await db.notificationTemplates.getVersions('slack', 'new_bug');
      const activeVersions = allVersions.filter((v) => v.is_active);

      expect(activeVersions).toHaveLength(1);
      expect(activeVersions[0].id).toBe(version1!.id);
      expect(activeVersions[0].version).toBe(1);
    });
  });

  describe('findActiveTemplatesByChannelTypes() - Batch loading', () => {
    it('should fetch multiple active templates by channel types in single query', async () => {
      // Create active templates for different channel types with same trigger
      const emailTemplate = await db.notificationTemplates.create({
        name: 'Email Bug Alert',
        channel_type: 'email',
        trigger_type: 'new_bug',
        subject: 'New Bug Report',
        body: 'Bug: {{bug.title}}',
      });

      const slackTemplate = await db.notificationTemplates.create({
        name: 'Slack Bug Alert',
        channel_type: 'slack',
        trigger_type: 'new_bug',
        body: 'New bug reported: {{bug.title}}',
      });

      const webhookTemplate = await db.notificationTemplates.create({
        name: 'Webhook Bug Alert',
        channel_type: 'webhook',
        trigger_type: 'new_bug',
        body: JSON.stringify({ event: 'new_bug', title: '{{bug.title}}' }),
      });

      // Fetch all three by channel types
      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['email', 'slack', 'webhook'],
        'new_bug'
      );

      expect(templates.size).toBe(3);
      expect(templates.get('email')?.id).toBe(emailTemplate.id);
      expect(templates.get('slack')?.id).toBe(slackTemplate.id);
      expect(templates.get('webhook')?.id).toBe(webhookTemplate.id);

      // Verify all returned templates are active
      expect(templates.get('email')?.is_active).toBe(true);
      expect(templates.get('slack')?.is_active).toBe(true);
      expect(templates.get('webhook')?.is_active).toBe(true);
    });

    it('should return empty map when no channel types provided', async () => {
      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        [],
        'new_bug'
      );
      expect(templates.size).toBe(0);
      expect(templates).toBeInstanceOf(Map);
    });

    it('should return only found templates when some channel types have no active template', async () => {
      // Create template for email only
      const emailTemplate = await db.notificationTemplates.create({
        name: 'Email Bug Resolved',
        channel_type: 'email',
        trigger_type: 'bug_resolved',
        subject: 'Bug Resolved',
        body: 'The bug has been resolved',
      });

      // Request email (exists) and discord (does not exist)
      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['email', 'discord'],
        'bug_resolved'
      );

      expect(templates.size).toBe(1);
      expect(templates.get('email')?.id).toBe(emailTemplate.id);
      expect(templates.has('discord')).toBe(false);
    });

    it('should return empty map when all channel types have no active template', async () => {
      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['discord', 'teams', 'pagerduty'],
        'error_spike'
      );

      expect(templates.size).toBe(0);
    });

    it('should return only active templates when multiple versions exist', async () => {
      // Create version 1 (will be deactivated)
      await db.notificationTemplates.create({
        name: 'Email Digest v1',
        channel_type: 'email',
        trigger_type: 'digest',
        subject: 'Daily Digest v1',
        body: 'Old version',
      });

      // Create version 2 (active)
      const activeTemplate = await db.notificationTemplates.create({
        name: 'Email Digest v2',
        channel_type: 'email',
        trigger_type: 'digest',
        subject: 'Daily Digest v2',
        body: 'New version',
      });

      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['email'],
        'digest'
      );

      expect(templates.size).toBe(1);
      expect(templates.get('email')?.id).toBe(activeTemplate.id);
      expect(templates.get('email')?.version).toBe(2);
      expect(templates.get('email')?.is_active).toBe(true);
    });

    it('should preserve all template fields', async () => {
      const template = await db.notificationTemplates.create({
        name: 'Complete Template',
        channel_type: 'email',
        trigger_type: 'new_bug',
        subject: 'Bug Assigned: {{bug.title}}',
        body: 'Bug {{bug.id}} has been assigned to {{assignee.name}}',
        recipients: ['admin@example.com', 'team@example.com'],
        variables: [
          { key: 'bug.title', description: 'Bug title' },
          { key: 'bug.id', description: 'Bug ID' },
          { key: 'assignee.name', description: 'Assignee name' },
        ],
      });

      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['email'],
        'new_bug'
      );

      const retrieved = templates.get('email');
      expect(retrieved?.subject).toBe('Bug Assigned: {{bug.title}}');
      expect(retrieved?.body).toBe('Bug {{bug.id}} has been assigned to {{assignee.name}}');
      expect(retrieved?.recipients).toEqual(['admin@example.com', 'team@example.com']);
      expect(retrieved?.variables).toHaveLength(3);
      expect(retrieved?.version).toBe(template.version);
      expect(retrieved?.id).toBe(template.id);
    });

    it('should handle different trigger types independently', async () => {
      // Create templates for same channel but different triggers
      const newBugTemplate = await db.notificationTemplates.create({
        name: 'Slack New Bug',
        channel_type: 'slack',
        trigger_type: 'new_bug',
        body: 'New bug',
      });

      const resolvedTemplate = await db.notificationTemplates.create({
        name: 'Slack Bug Resolved',
        channel_type: 'slack',
        trigger_type: 'bug_resolved',
        body: 'Bug resolved',
      });

      // Should only return template for requested trigger type
      const newBugTemplates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['slack'],
        'new_bug'
      );

      const resolvedTemplates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['slack'],
        'bug_resolved'
      );

      expect(newBugTemplates.get('slack')?.id).toBe(newBugTemplate.id);
      expect(resolvedTemplates.get('slack')?.id).toBe(resolvedTemplate.id);
    });

    it('should handle large batch of channel types efficiently', async () => {
      // Create templates for multiple channel types
      const channelTypes: Array<'email' | 'slack' | 'webhook' | 'discord' | 'teams'> = [
        'email',
        'slack',
        'webhook',
        'discord',
        'teams',
      ];

      for (const channelType of channelTypes) {
        await db.notificationTemplates.create({
          name: `${channelType} Comment Template`,
          channel_type: channelType,
          trigger_type: 'priority_change',
          body: `Comment added via ${channelType}`,
        });
      }

      // Fetch all 5 in single query
      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        channelTypes,
        'priority_change'
      );

      expect(templates.size).toBe(5);
      channelTypes.forEach((channelType) => {
        expect(templates.has(channelType)).toBe(true);
        expect(templates.get(channelType)?.channel_type).toBe(channelType);
        expect(templates.get(channelType)?.trigger_type).toBe('priority_change');
      });
    });

    it('should handle duplicate channel types in input array', async () => {
      const template = await db.notificationTemplates.create({
        name: 'Email Status Change',
        channel_type: 'email',
        trigger_type: 'threshold_reached',
        subject: 'Status Changed',
        body: 'Bug status changed',
      });

      // Request same channel type multiple times
      const templates = await db.notificationTemplates.findActiveTemplatesByChannelTypes(
        ['email', 'email', 'email'],
        'threshold_reached'
      );

      // Should return unique result
      expect(templates.size).toBe(1);
      expect(templates.get('email')?.id).toBe(template.id);
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined recipients', async () => {
      const template = await db.notificationTemplates.create({
        name: 'Null Test',
        channel_type: 'webhook',
        trigger_type: 'bug_resolved',
        body: 'Bug resolved',
      });

      expect(template.recipients).toBeUndefined();
    });

    it('should handle updating when recipients were initially undefined', async () => {
      const template = await db.notificationTemplates.create({
        name: 'Initially Null',
        channel_type: 'teams',
        trigger_type: 'digest',
        body: 'Bug closed',
      });

      const updated = await db.notificationTemplates.update(template.id, {
        recipients: ['new@example.com'],
      });

      expect(updated).not.toBeNull();
      expect(updated!.recipients).toEqual(['new@example.com']);
    });

    it('should handle very long recipient arrays', async () => {
      const manyRecipients = Array.from({ length: 50 }, (_, i) => `user${i}@example.com`);

      const template = await db.notificationTemplates.create({
        name: 'Large Arrays',
        channel_type: 'email',
        trigger_type: 'error_spike',
        subject: 'Update',
        body: 'Updated',
        recipients: manyRecipients,
      });

      expect(template.recipients).toHaveLength(50);

      // Update with fewer items
      const updated = await db.notificationTemplates.update(template.id, {
        recipients: ['single@example.com'],
      });

      expect(updated!.recipients).toEqual(['single@example.com']);
    });
  });
});
