/**
 * Integration Job Definition
 * Processes integrations with external platforms (Jira, GitHub, Linear, Slack)
 */

import type { IntegrationJobData, IntegrationJobResult } from '../types.js';

export const INTEGRATION_JOB_NAME = 'process-integration';

export interface IntegrationJob {
  name: typeof INTEGRATION_JOB_NAME;
  data: IntegrationJobData;
}

/**
 * Validate integration job data
 */
export function validateIntegrationJobData(data: unknown): data is IntegrationJobData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Partial<IntegrationJobData>;

  return !!(
    d.bugReportId &&
    typeof d.bugReportId === 'string' &&
    d.projectId &&
    typeof d.projectId === 'string' &&
    d.platform &&
    ['jira', 'github', 'linear', 'slack'].includes(d.platform) &&
    d.credentials &&
    typeof d.credentials === 'object' &&
    d.config &&
    typeof d.config === 'object'
  );
}

/**
 * Create integration job result
 */
export function createIntegrationJobResult(
  platform: string,
  externalId: string,
  externalUrl: string,
  status: 'created' | 'updated' | 'failed',
  metadata?: Record<string, unknown>
): IntegrationJobResult {
  return {
    platform,
    externalId,
    externalUrl,
    status,
    metadata,
  };
}
