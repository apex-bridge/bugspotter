import type { NotificationService } from '../../services/notifications/notification-service.js';
import type { BugReport } from '../../db/types.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Trigger a bug report notification through the notification service
 *
 * Handles optional notificationService gracefully - logs but doesn't throw
 * if service is not configured. This allows the API to work even when
 * notifications are disabled.
 *
 * @param bugReport - The bug report data to include in notification
 * @param project - The project data
 * @param notificationService - Optional notification service instance
 *
 * @example
 * await triggerBugReportNotification(
 *   bugReport,
 *   request.authProject,
 *   notificationService
 * );
 */
export async function triggerBugReportNotification(
  bugReport: BugReport,
  project: Record<string, unknown>,
  notificationService?: NotificationService
): Promise<void> {
  if (!notificationService) {
    logger.debug('Notification service not available, skipping notification', {
      bugReportId: bugReport.id,
    });
    return;
  }

  try {
    await notificationService.processNewBug(
      bugReport as unknown as Record<string, unknown>,
      project
    );
    logger.info('Bug report notification triggered', {
      bugReportId: bugReport.id,
    });
  } catch (error) {
    // Log but don't throw - notifications are non-critical
    logger.error('Failed to trigger bug report notification', {
      bugReportId: bugReport.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
