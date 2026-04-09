/**
 * Unit tests for NotificationService
 * Tests trigger matching, filter matching, throttling, and scheduling logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from '../../../src/services/notifications/notification-service.js';
import type { DatabaseClient } from '../../../src/db/client.js';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockDb: any;
  let mockQueueManager: any;

  beforeEach(() => {
    // Mock database client
    mockDb = {
      getPool: vi.fn().mockReturnValue({
        query: vi.fn(),
        connect: vi.fn(),
        end: vi.fn(),
      }),
      notificationRules: {
        findAllWithChannels: vi.fn(),
        findByIdWithChannels: vi.fn(),
      },
      notificationChannels: {
        findById: vi.fn(),
        updateHealth: vi.fn().mockResolvedValue(1),
      },
      notificationTemplates: {
        findActiveTemplate: vi.fn(),
      },
      notificationHistory: {
        create: vi.fn(),
        update: vi.fn(),
      },
      notificationThrottle: {
        isThrottled: vi.fn(),
      },
      bugReports: {
        findById: vi.fn(),
      },
      projects: {
        findById: vi.fn(),
      },
    };

    // Mock queue manager
    mockQueueManager = {
      addJob: vi.fn().mockResolvedValue('job-123'),
    };

    service = new NotificationService(mockDb as DatabaseClient, null, mockQueueManager);
  });

  describe('processTrigger - Trigger Matching', () => {
    it('should match trigger with event only (no params)', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Basic Rule',
        triggers: [{ event: 'new_bug' }],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Test Bug', priority: 'high' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledWith(
        'notifications',
        expect.stringContaining('notification-rule-1'),
        expect.objectContaining({
          rule_id: 'rule-1',
          bug_id: 'bug-1',
        }),
        expect.objectContaining({
          priority: 1,
        })
      );
    });

    it('should match trigger with priority parameter', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Critical Only',
        triggers: [{ event: 'new_bug', params: { priority: 'critical' } }],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Critical Bug', priority: 'critical' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should NOT match trigger when priority does not match', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Critical Only',
        triggers: [{ event: 'new_bug', params: { priority: 'critical' } }],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Low Priority Bug', priority: 'low' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should match priority_change with from/to parameters', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Priority Escalation',
        triggers: [
          {
            event: 'priority_change',
            params: { from_priority: 'medium', to_priority: 'critical' },
          },
        ],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = {
        id: 'bug-1',
        title: 'Escalated Bug',
        priority: 'critical',
        previous_priority: 'medium',
      };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('priority_change', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should NOT match priority_change when from_priority does not match', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Priority Escalation',
        triggers: [
          {
            event: 'priority_change',
            params: { from_priority: 'low', to_priority: 'critical' },
          },
        ],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = {
        id: 'bug-1',
        title: 'Escalated Bug',
        priority: 'critical',
        previous_priority: 'medium', // Does not match 'low'
      };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('priority_change', { bug, project });

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should NOT match trigger with params when bug context is missing', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Critical Only',
        triggers: [{ event: 'new_bug', params: { priority: 'critical' } }],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { project }); // No bug context

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });
  });

  describe('processTrigger - Filter Matching', () => {
    it('should skip rule when filters exist but bug context is missing', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Filtered Rule',
        triggers: [{ event: 'new_bug' }],
        filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { project }); // No bug context

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });

    it('should match when filters are empty array', async () => {
      const rule = {
        id: 'rule-1',
        name: 'No Filters',
        triggers: [{ event: 'new_bug' }],
        filters: [], // Empty array
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Test Bug', priority: 'low' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should match when filters are null/undefined', async () => {
      const rule = {
        id: 'rule-1',
        name: 'No Filters',
        triggers: [{ event: 'new_bug' }],
        filters: null,
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Test Bug', priority: 'low' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should apply filters when they exist', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Critical Browser Filter',
        triggers: [{ event: 'new_bug' }],
        filters: [
          { field: 'priority', operator: 'equals', value: 'critical' },
          { field: 'browser', operator: 'contains', value: 'Chrome' },
        ],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = {
        id: 'bug-1',
        title: 'Critical Chrome Bug',
        priority: 'critical',
        metadata: {
          browser: 'Chrome 120.0',
        },
      };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should NOT match when filters do not match', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Critical Only',
        triggers: [{ event: 'new_bug' }],
        filters: [{ field: 'priority', operator: 'equals', value: 'critical' }],
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Low Priority Bug', priority: 'low' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).not.toHaveBeenCalled();
    });
  });

  describe('processTrigger - Input Validation', () => {
    it('should throw error when bug.id is missing', async () => {
      const bug = { title: 'Test Bug' }; // No id
      const project = { id: 'project-1', name: 'Test Project' };

      await expect(service.processNewBug(bug, project)).rejects.toThrow('Bug ID is required');
    });

    it('should throw error when bug.id is not a string', async () => {
      const bug = { id: 123, title: 'Test Bug' }; // id is number
      const project = { id: 'project-1', name: 'Test Project' };

      await expect(service.processNewBug(bug as any, project)).rejects.toThrow(
        'Bug ID is required'
      );
    });

    it('should throw error when project.id is missing', async () => {
      const bug = { id: 'bug-1', title: 'Test Bug' };
      const project = { name: 'Test Project' }; // No id

      await expect(service.processNewBug(bug, project)).rejects.toThrow('Project ID is required');
    });

    it('should throw error when project.id is not a string', async () => {
      const bug = { id: 'bug-1', title: 'Test Bug' };
      const project = { id: 123, name: 'Test Project' }; // id is number

      await expect(service.processNewBug(bug, project as any)).rejects.toThrow(
        'Project ID is required'
      );
    });
  });

  describe('processTrigger - Throttling', () => {
    it('should queue notification even if throttle config exists (pipeline handles throttling)', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Throttled Rule',
        triggers: [{ event: 'new_bug' }],
        throttle: { max_per_hour: 5 },
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);
      mockDb.notificationThrottle.isThrottled.mockResolvedValue(true);

      const bug = { id: 'bug-1', title: 'Test Bug', priority: 'high' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      // Should queue job - throttling is checked by pipeline later
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should send notification when not throttled', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Throttled Rule',
        triggers: [{ event: 'new_bug' }],
        throttle: { max_per_hour: 5 },
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);
      mockDb.notificationThrottle.isThrottled.mockResolvedValue(false);

      const bug = { id: 'bug-1', title: 'Test Bug', priority: 'high' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });
  });

  describe('processTrigger - Scheduling', () => {
    it('should queue notification with immediate schedule', async () => {
      const rule = {
        id: 'rule-1',
        name: 'Immediate Rule',
        triggers: [{ event: 'new_bug' }],
        schedule: { type: 'immediate' },
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Test Bug', priority: 'high' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);
    });

    it('should queue notification even outside business hours (pipeline handles scheduling)', async () => {
      // Mock date to be outside business hours (e.g., Sunday)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-10-19T12:00:00Z')); // Sunday

      const rule = {
        id: 'rule-1',
        name: 'Business Hours Only',
        triggers: [{ event: 'new_bug' }],
        schedule: {
          type: 'business_hours',
          business_hours: {
            days: [1, 2, 3, 4, 5], // Monday-Friday (Sunday is 0)
            start: '09:00',
            end: '17:00',
          },
        },
        channels: ['channel-1'],
        priority: 1,
        enabled: true,
      };

      mockDb.notificationRules.findAllWithChannels.mockResolvedValue([rule]);

      const bug = { id: 'bug-1', title: 'Test Bug', priority: 'high' };
      const project = { id: 'project-1', name: 'Test Project' };

      await service.processTrigger('new_bug', { bug, project });

      // Should queue job - scheduling is checked by pipeline later
      expect(mockQueueManager.addJob).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('testChannel', () => {
    it('should return error when channel not found', async () => {
      mockDb.notificationChannels.findById.mockResolvedValue(null);

      const result = await service.testChannel('channel-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Channel not found');
    });

    it('should return error for unknown channel type', async () => {
      mockDb.notificationChannels.findById.mockResolvedValue({
        id: 'channel-1',
        type: 'unknown-type',
        config: {},
      });

      const result = await service.testChannel('channel-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No handler found for channel type');
    });
  });
});
