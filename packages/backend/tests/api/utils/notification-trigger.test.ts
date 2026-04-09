/**
 * Unit tests for notification trigger helper
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerBugReportNotification } from '../../../src/api/utils/notification-trigger.js';
import type { NotificationService } from '../../../src/services/notifications/notification-service.js';
import type { BugReport } from '../../../src/db/types.js';

describe('triggerBugReportNotification', () => {
  let mockNotificationService: NotificationService;
  let mockBugReport: BugReport;
  let mockProject: Record<string, unknown>;

  beforeEach(() => {
    mockNotificationService = {
      processNewBug: vi.fn(),
    } as unknown as NotificationService;

    mockBugReport = {
      id: 'bug-123',
      project_id: 'proj-456',
      title: 'Test Bug',
      description: 'Test description',
      priority: 'high',
      status: 'open',
      metadata: {},
      screenshot_url: null,
      replay_url: null,
      screenshot_key: null,
      replay_key: null,
      upload_status: 'none',
      replay_upload_status: 'none',
      thumbnail_key: null,
      deleted_at: null,
      deleted_by: null,
      legal_hold: false,
      created_at: new Date(),
      updated_at: new Date(),
    };

    mockProject = {
      id: 'proj-456',
      name: 'Test Project',
      api_key: 'bgs_test',
    };
  });

  describe('With notification service available', () => {
    it('should call processNewBug with correct parameters', async () => {
      await triggerBugReportNotification(mockBugReport, mockProject, mockNotificationService);

      expect(mockNotificationService.processNewBug).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bug-123' }),
        expect.objectContaining({ id: 'proj-456' })
      );
      expect(mockNotificationService.processNewBug).toHaveBeenCalledTimes(1);
    });

    it('should not throw when notification succeeds', async () => {
      vi.mocked(mockNotificationService.processNewBug).mockResolvedValue(undefined);

      await expect(
        triggerBugReportNotification(mockBugReport, mockProject, mockNotificationService)
      ).resolves.not.toThrow();
    });

    it('should catch and log errors without throwing', async () => {
      const error = new Error('Notification service failed');
      vi.mocked(mockNotificationService.processNewBug).mockRejectedValue(error);

      // Should not throw - notifications are non-critical
      await expect(
        triggerBugReportNotification(mockBugReport, mockProject, mockNotificationService)
      ).resolves.not.toThrow();
    });

    it('should handle non-Error objects in catch block', async () => {
      vi.mocked(mockNotificationService.processNewBug).mockRejectedValue('String error');

      await expect(
        triggerBugReportNotification(mockBugReport, mockProject, mockNotificationService)
      ).resolves.not.toThrow();
    });
  });

  describe('Without notification service (undefined)', () => {
    it('should handle missing notification service gracefully', async () => {
      await expect(
        triggerBugReportNotification(mockBugReport, mockProject, undefined)
      ).resolves.not.toThrow();
    });

    it('should not call processNewBug when service is undefined', async () => {
      const spy = vi.fn();
      const undefinedService = undefined;

      await triggerBugReportNotification(mockBugReport, mockProject, undefinedService);

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('Different bug report scenarios', () => {
    it('should work with minimal bug report data', async () => {
      const minimalBugReport: BugReport = {
        ...mockBugReport,
        description: null,
        screenshot_url: null,
        replay_url: null,
      };

      await expect(
        triggerBugReportNotification(minimalBugReport, mockProject, mockNotificationService)
      ).resolves.not.toThrow();

      expect(mockNotificationService.processNewBug).toHaveBeenCalled();
    });

    it('should work with complete bug report data', async () => {
      const completeBugReport: BugReport = {
        ...mockBugReport,
        description: 'Full description',
        screenshot_url: 'https://storage/screenshot.png',
        replay_url: 'https://storage/replay.gz',
        screenshot_key: 'screenshots/proj/bug/screenshot.png',
        replay_key: 'replays/proj/bug/replay.gz',
        upload_status: 'completed',
        replay_upload_status: 'completed',
      };

      await expect(
        triggerBugReportNotification(completeBugReport, mockProject, mockNotificationService)
      ).resolves.not.toThrow();

      expect(mockNotificationService.processNewBug).toHaveBeenCalledWith(
        expect.objectContaining({
          screenshot_url: 'https://storage/screenshot.png',
          replay_url: 'https://storage/replay.gz',
        }),
        expect.any(Object)
      );
    });
  });

  describe('Project data handling', () => {
    it('should accept project as Record<string, unknown>', async () => {
      const dynamicProject = {
        id: 'proj-999',
        name: 'Dynamic Project',
        customField: 'custom value',
        nestedData: { key: 'value' },
      };

      await expect(
        triggerBugReportNotification(mockBugReport, dynamicProject, mockNotificationService)
      ).resolves.not.toThrow();

      expect(mockNotificationService.processNewBug).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ id: 'proj-999' })
      );
    });
  });

  describe('Concurrent calls', () => {
    it('should handle multiple simultaneous notifications', async () => {
      const bugReports = [
        { ...mockBugReport, id: 'bug-1' },
        { ...mockBugReport, id: 'bug-2' },
        { ...mockBugReport, id: 'bug-3' },
      ];

      await Promise.all(
        bugReports.map((bug) =>
          triggerBugReportNotification(bug, mockProject, mockNotificationService)
        )
      );

      expect(mockNotificationService.processNewBug).toHaveBeenCalledTimes(3);
    });

    it('should isolate errors between concurrent calls', async () => {
      vi.mocked(mockNotificationService.processNewBug).mockImplementation((bug) => {
        if ((bug as any).id === 'bug-fail') {
          return Promise.reject(new Error('Failed notification'));
        }
        return Promise.resolve();
      });

      const bugReports = [
        { ...mockBugReport, id: 'bug-success' },
        { ...mockBugReport, id: 'bug-fail' },
        { ...mockBugReport, id: 'bug-success-2' },
      ];

      const results = await Promise.allSettled(
        bugReports.map((bug) =>
          triggerBugReportNotification(bug, mockProject, mockNotificationService)
        )
      );

      // All should resolve (none should throw)
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(mockNotificationService.processNewBug).toHaveBeenCalledTimes(3);
    });
  });
});
