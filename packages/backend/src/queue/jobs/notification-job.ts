/**
 * Notification Job Definition
 * Processes notifications (email, Slack, webhooks)
 */

import type { NotificationJobData, NotificationJobResult } from '../types.js';

export const NOTIFICATION_JOB_NAME = 'send-notification';

export interface NotificationJob {
  name: typeof NOTIFICATION_JOB_NAME;
  data: NotificationJobData;
}

/**
 * Validate notification job data
 */
export function validateNotificationJobData(data: unknown): data is NotificationJobData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Partial<NotificationJobData>;

  return !!(
    d.bugReportId &&
    typeof d.bugReportId === 'string' &&
    d.projectId &&
    typeof d.projectId === 'string' &&
    d.type &&
    ['email', 'slack', 'webhook'].includes(d.type) &&
    d.recipients &&
    Array.isArray(d.recipients) &&
    d.recipients.length > 0 &&
    d.event &&
    ['created', 'updated', 'resolved', 'deleted'].includes(d.event)
  );
}

/**
 * Create notification job result
 */
export function createNotificationJobResult(
  type: string,
  recipientCount: number,
  successCount: number,
  failureCount: number,
  errors?: string[]
): NotificationJobResult {
  return {
    type,
    recipientCount,
    successCount,
    failureCount,
    errors,
  };
}
