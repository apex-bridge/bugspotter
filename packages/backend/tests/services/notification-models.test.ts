/**
 * Notification Domain Models Tests
 * Unit tests for NotificationJob, NotificationContext, and DeliveryResult
 */

import { describe, it, expect } from 'vitest';
import { NotificationJob } from '../../src/services/notifications/models/notification-job.js';
import { NotificationContext } from '../../src/services/notifications/models/notification-context.js';
import { DeliveryResult } from '../../src/services/notifications/models/delivery-result.js';
import type {
  TriggerCondition,
  NotificationChannel,
  NotificationTemplate,
} from '../../src/types/notifications.js';

describe('Notification Domain Models', () => {
  describe('NotificationJob', () => {
    const mockTrigger: TriggerCondition = {
      event: 'new_bug',
      params: { priority: 'high' },
    };

    const mockChannel: NotificationChannel = {
      id: 'channel-123',
      type: 'email',
      name: 'Test Channel',
      project_id: 'project-123',
      config: {
        type: 'email',
        smtp_host: 'localhost',
        smtp_port: 587,
        smtp_secure: false,
        smtp_user: 'test@example.com',
        smtp_pass: 'password',
        from_address: 'noreply@example.com',
        from_name: 'Test Sender',
      },
      active: true,
      last_success_at: null,
      last_failure_at: null,
      failure_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    const mockTemplate: NotificationTemplate = {
      id: 'template-123',
      name: 'Bug Alert',
      channel_type: 'email',
      trigger_type: 'new_bug',
      subject: 'New Bug: {{bug.title}}',
      body: 'Bug {{bug.id}} reported',
      is_active: true,
      version: 1,
      variables: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    it('should create a notification job with all properties', () => {
      const job = new NotificationJob({
        trigger: mockTrigger,
        channel: mockChannel,
        template: mockTemplate,
        projectId: 'project-123',
        bugId: 'bug-456',
        context: {
          test: 'data',
          project: { id: 'p1', name: 'Test' },
          link: { bugDetail: 'http://test' },
          timestamp: '',
          timezone: 'UTC',
        },
      });

      expect(job.trigger).toBe(mockTrigger);
      expect(job.channel).toBe(mockChannel);
      expect(job.template).toBe(mockTemplate);
      expect(job.projectId).toBe('project-123');
      expect(job.bugId).toBe('bug-456');
      expect(job.context).toEqual({
        test: 'data',
        project: { id: 'p1', name: 'Test' },
        link: { bugDetail: 'http://test' },
        timestamp: '',
        timezone: 'UTC',
      });
      expect(job.createdAt).toBeInstanceOf(Date);
    });

    it('should provide convenience getters', () => {
      const job = new NotificationJob({
        trigger: mockTrigger,
        channel: mockChannel,
        template: mockTemplate,
        projectId: 'project-123',
        bugId: 'bug-456',
        context: {
          project: { id: 'p1', name: 'Test' },
          link: { bugDetail: 'http://test' },
          timestamp: '',
          timezone: 'UTC',
        },
      });

      expect(job.channelId).toBe('channel-123');
      expect(job.templateId).toBe('template-123');
      expect(job.triggerId).toBe('new_bug');
      expect(job.channelType).toBe('email');
    });

    it('should generate unique job keys for deduplication', () => {
      const job = new NotificationJob({
        trigger: mockTrigger,
        channel: mockChannel,
        template: mockTemplate,
        projectId: 'project-123',
        bugId: 'bug-456',
        context: {
          project: { id: 'p1', name: 'Test' },
          link: { bugDetail: 'http://test' },
          timestamp: '',
          timezone: 'UTC',
        },
      });

      const key = job.getJobKey();
      expect(key).toBe('project-123:bug-456:channel-123:template-123');
    });

    it('should match filters correctly', () => {
      const job = new NotificationJob({
        trigger: mockTrigger,
        channel: mockChannel,
        template: mockTemplate,
        projectId: 'project-123',
        bugId: 'bug-456',
        context: {
          project: { id: 'p1', name: 'Test' },
          link: { bugDetail: 'http://test' },
          timestamp: '',
          timezone: 'UTC',
        },
      });

      expect(job.matchesFilter({ projectId: 'project-123' })).toBe(true);
      expect(job.matchesFilter({ projectId: 'other-project' })).toBe(false);
      expect(job.matchesFilter({ bugId: 'bug-456' })).toBe(true);
      expect(job.matchesFilter({ bugId: 'other-bug' })).toBe(false);
      expect(job.matchesFilter({ channel: { id: 'channel-123' } as any })).toBe(true);
      expect(job.matchesFilter({ channel: { id: 'other-channel' } as any })).toBe(false);
    });
  });

  describe('NotificationContext', () => {
    it('should create context with all data', () => {
      const context = new NotificationContext({
        bugReport: {
          id: 'bug-123',
          title: 'Test Bug',
          description: 'Bug description',
          message: 'Test message',
          status: 'open',
          priority: 'high',
          severity: 'high',
        },
        project: {
          id: 'project-456',
          name: 'Test Project',
        },
        adminUrl: 'http://admin.test',
        metadata: {
          custom: 'value',
        },
      });

      expect(context.bugReport.id).toBe('bug-123');
      expect(context.project.name).toBe('Test Project');
      expect(context.metadata).toEqual({ custom: 'value' });
      expect(context.timestamp).toBeInstanceOf(Date);
    });

    it('should convert to template data format', () => {
      const context = new NotificationContext({
        bugReport: {
          id: 'bug-123',
          title: 'Test Bug',
          description: 'Bug description',
          message: 'Test message',
          status: 'open',
          priority: 'medium',
        },
        project: {
          id: 'project-456',
          name: 'Test Project',
        },
        adminUrl: 'http://admin.test',
      });

      const templateData = context.toTemplateData();

      // Bug data is transformed with computed fields
      expect(templateData.bug).toBeDefined();
      expect(templateData.bug!.id).toBe('bug-123');
      expect(templateData.bug!.title).toBe('Test Bug');
      expect(templateData.bug!.message).toBe('Test message');
      expect(templateData.bug!.status).toBe('open');
      expect(templateData.bug!.priority).toBe('medium');
      expect(templateData.bug!.priorityColor).toBe('#ffc107');
      expect(templateData.bug!.browser).toBe('Unknown');
      expect(templateData.bug!.os).toBe('Unknown');

      expect(templateData.project).toEqual(context.project);
      expect(typeof templateData.timestamp).toBe('string');
      expect(templateData.timezone).toBe('UTC');
      expect(templateData.link.bugDetail).toContain('bug-123');
    });

    it('should get metadata values with defaults', () => {
      const context = new NotificationContext({
        bugReport: {
          id: 'bug-123',
          title: 'Test',
          description: '',
          message: 'Test',
          status: 'open',
          priority: 'low',
        },
        project: { id: 'project-456', name: 'Test' },
        adminUrl: 'http://admin.test',
        metadata: { key1: 'value1' },
      });

      expect(context.getMetadata('key1')).toBe('value1');
      expect(context.getMetadata('missing')).toBeUndefined();
      expect(context.getMetadata('missing', 'default')).toBe('default');
    });

    it('should create summary string', () => {
      const context = new NotificationContext({
        bugReport: {
          id: 'bug-123',
          title: 'Test',
          description: '',
          message: 'Test',
          status: 'open',
          priority: 'low',
        },
        project: { id: 'project-456', name: 'My Project' },
        adminUrl: 'http://admin.test',
      });

      expect(context.getSummary()).toBe('Bug bug-123 in project My Project');
    });
  });

  describe('DeliveryResult', () => {
    it('should create success result', () => {
      const result = DeliveryResult.success(
        'channel-123',
        'trigger-456',
        'project-789',
        'bug-101',
        'Sent successfully',
        { attempts: 1 }
      );

      expect(result.status).toBe('success');
      expect(result.channelId).toBe('channel-123');
      expect(result.message).toBe('Sent successfully');
      expect(result.error).toBeNull();
      expect(result.retryable).toBe(false);
      expect(result.isSuccess()).toBe(true);
      expect(result.isFailure()).toBe(false);
      expect(result.shouldRetry()).toBe(false);
    });

    it('should create failure result', () => {
      const error = new Error('Network timeout');
      const result = DeliveryResult.failure(
        'channel-123',
        'trigger-456',
        'project-789',
        'bug-101',
        error,
        true,
        { attempts: 3 }
      );

      expect(result.status).toBe('failure');
      expect(result.error).toBe('Network timeout');
      expect(result.retryable).toBe(true);
      expect(result.isSuccess()).toBe(false);
      expect(result.isFailure()).toBe(true);
      expect(result.shouldRetry()).toBe(true);
    });

    it('should create skipped result', () => {
      const result = DeliveryResult.skipped(
        'channel-123',
        'trigger-456',
        'project-789',
        'bug-101',
        'Filter mismatch'
      );

      expect(result.status).toBe('skipped');
      expect(result.message).toBe('Filter mismatch');
      expect(result.retryable).toBe(false);
      expect(result.shouldRetry()).toBe(false);
    });

    it('should create throttled result', () => {
      const result = DeliveryResult.throttled(
        'channel-123',
        'trigger-456',
        'project-789',
        'bug-101'
      );

      expect(result.status).toBe('throttled');
      expect(result.message).toContain('throttled');
      expect(result.retryable).toBe(true);
    });

    it('should create scheduled result', () => {
      const scheduledTime = new Date('2025-01-01T12:00:00Z');
      const result = DeliveryResult.scheduled(
        'channel-123',
        'trigger-456',
        'project-789',
        'bug-101',
        scheduledTime
      );

      expect(result.status).toBe('scheduled');
      expect(result.message).toContain('2025-01-01T12:00:00.000Z');
      expect(result.metadata.scheduledTime).toBe('2025-01-01T12:00:00.000Z');
    });

    it('should generate summary strings', () => {
      const successResult = DeliveryResult.success('ch-1', 'tr-1', 'pr-1', 'bg-1');
      expect(successResult.getSummary()).toContain('SUCCESS');

      const failureResult = DeliveryResult.failure('ch-1', 'tr-1', 'pr-1', 'bg-1', 'Error msg');
      expect(failureResult.getSummary()).toContain('FAILURE');
      expect(failureResult.getSummary()).toContain('Error msg');
    });

    it('should convert to history record format', () => {
      const result = DeliveryResult.success(
        'channel-123',
        'trigger-456',
        'project-789',
        'bug-101',
        'Success',
        { test: 'data' }
      );

      const record = result.toHistoryRecord();

      expect(record.channel_id).toBe('channel-123');
      expect(record.trigger_id).toBe('trigger-456');
      expect(record.project_id).toBe('project-789');
      expect(record.bug_id).toBe('bug-101');
      expect(record.status).toBe('success');
      expect(record.message).toBe('Success');
      expect(record.error_message).toBeNull();
      expect(record.metadata).toEqual({ test: 'data' });
      expect(record.delivered_at).toBeInstanceOf(Date);
    });
  });
});
