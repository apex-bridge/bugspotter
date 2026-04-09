/**
 * Enrichment Trigger Tests
 *
 * Unit tests for fire-and-forget enrichment queueing:
 * guards, per-org gating (intelligence_auto_enrich), job construction, error swallowing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerBugEnrichment } from '../../../src/api/utils/enrichment-trigger.js';
import { getIntelligenceConfig } from '../../../src/config/intelligence.config.js';
import { getOrgIntelligenceSettings } from '../../../src/services/intelligence/tenant-config.js';
import type { QueueManager } from '../../../src/queue/queue-manager.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { BugReport } from '../../../src/db/types.js';

// Mock dependencies
vi.mock('../../../src/config/intelligence.config.js', () => ({
  getIntelligenceConfig: vi.fn(() => ({ enabled: true })),
}));

vi.mock('../../../src/services/intelligence/tenant-config.js', () => ({
  getOrgIntelligenceSettings: vi.fn(() =>
    Promise.resolve({
      intelligence_enabled: true,
      intelligence_auto_analyze: true,
      intelligence_auto_enrich: true,
    })
  ),
}));

vi.mock('../../../src/queue/types.js', () => ({
  QUEUE_NAMES: { INTELLIGENCE: 'intelligence' },
}));

vi.mock('../../../src/queue/jobs/intelligence-job.js', () => ({
  INTELLIGENCE_JOB_NAME: 'process-intelligence',
}));

const mockedGetConfig = vi.mocked(getIntelligenceConfig);
const mockedGetOrgSettings = vi.mocked(getOrgIntelligenceSettings);

// ============================================================================
// Helpers
// ============================================================================

function createMockQueueManager(): QueueManager {
  return {
    addJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as QueueManager;
}

function createMockDb(): DatabaseClient {
  return {} as DatabaseClient;
}

function createMockBugReport(overrides?: Partial<BugReport>): BugReport {
  return {
    id: 'bug-1',
    title: 'Button not clickable',
    description: 'The submit button does not respond to clicks',
    metadata: null,
    project_id: 'proj-1',
    organization_id: null,
    ...overrides,
  } as BugReport;
}

// ============================================================================
// Tests
// ============================================================================

describe('triggerBugEnrichment', () => {
  let queueManager: QueueManager;

  beforeEach(() => {
    vi.clearAllMocks();
    queueManager = createMockQueueManager();

    mockedGetConfig.mockReturnValue({ enabled: true } as ReturnType<typeof getIntelligenceConfig>);
    mockedGetOrgSettings.mockResolvedValue({
      intelligence_enabled: true,
      intelligence_auto_analyze: true,
      intelligence_auto_enrich: true,
      intelligence_api_key: null,
      intelligence_provider: null,
      intelligence_similarity_threshold: 0.75,
      intelligence_dedup_action: 'flag',
      intelligence_api_key_provisioned_at: null,
      intelligence_api_key_provisioned_by: null,
    });
  });

  it('returns false when queueManager is undefined', async () => {
    const result = await triggerBugEnrichment(createMockBugReport(), 'proj-1', undefined);
    expect(result).toBe(false);
  });

  it('returns false when intelligence is globally disabled', async () => {
    mockedGetConfig.mockReturnValue({ enabled: false } as ReturnType<typeof getIntelligenceConfig>);

    const result = await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager);
    expect(result).toBe(false);
    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('returns true and queues enrichment job with correct payload', async () => {
    const bugReport = createMockBugReport({
      metadata: {
        console: [{ level: 'error', message: 'TypeError' }],
        network: [{ url: '/api/data', status: 500 }],
        metadata: { browser: 'Chrome' },
      },
    });

    const result = await triggerBugEnrichment(bugReport, 'proj-1', queueManager);

    expect(result).toBe(true);
    expect(queueManager.addJob).toHaveBeenCalledWith(
      'intelligence',
      'process-intelligence',
      expect.objectContaining({
        type: 'enrich',
        bugReportId: 'bug-1',
        projectId: 'proj-1',
        payload: expect.objectContaining({
          bug_id: 'bug-1',
          title: 'Button not clickable',
          description: 'The submit button does not respond to clicks',
          console_logs: [{ level: 'error', message: 'TypeError' }],
          network_logs: [{ url: '/api/data', status: 500 }],
          metadata: { browser: 'Chrome' },
        }),
      }),
      expect.objectContaining({
        priority: 20,
        attempts: 3,
      })
    );
  });

  it('passes organizationId in job data when provided', async () => {
    const db = createMockDb();
    await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(queueManager.addJob).toHaveBeenCalledWith(
      'intelligence',
      'process-intelligence',
      expect.objectContaining({
        organizationId: 'org-1',
      }),
      expect.any(Object)
    );
  });

  it('skips when org intelligence is disabled', async () => {
    mockedGetOrgSettings.mockResolvedValue({
      intelligence_enabled: false,
      intelligence_auto_analyze: true,
      intelligence_auto_enrich: true,
      intelligence_api_key: null,
      intelligence_provider: null,
      intelligence_similarity_threshold: 0.75,
      intelligence_dedup_action: 'flag',
      intelligence_api_key_provisioned_at: null,
      intelligence_api_key_provisioned_by: null,
    });

    const db = createMockDb();
    await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('skips when intelligence_auto_enrich is disabled for org', async () => {
    mockedGetOrgSettings.mockResolvedValue({
      intelligence_enabled: true,
      intelligence_auto_analyze: true,
      intelligence_auto_enrich: false,
      intelligence_api_key: null,
      intelligence_provider: null,
      intelligence_similarity_threshold: 0.75,
      intelligence_dedup_action: 'flag',
      intelligence_api_key_provisioned_at: null,
      intelligence_api_key_provisioned_by: null,
    });

    const db = createMockDb();
    await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('queues when auto_enrich is disabled but manualTrigger is true', async () => {
    mockedGetOrgSettings.mockResolvedValue({
      intelligence_enabled: true,
      intelligence_auto_analyze: true,
      intelligence_auto_enrich: false,
      intelligence_api_key: null,
      intelligence_provider: null,
      intelligence_similarity_threshold: 0.75,
      intelligence_dedup_action: 'flag',
      intelligence_api_key_provisioned_at: null,
      intelligence_api_key_provisioned_by: null,
    });

    const db = createMockDb();
    await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
      manualTrigger: true,
    });

    expect(queueManager.addJob).toHaveBeenCalled();
  });

  it('skips (fail closed) when org settings lookup fails', async () => {
    mockedGetOrgSettings.mockRejectedValue(new Error('DB error'));

    const db = createMockDb();
    await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('returns false and never throws when addJob fails', async () => {
    (queueManager.addJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Queue down'));

    const result = await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager);
    expect(result).toBe(false);
  });

  it('warns when organizationId provided without db', async () => {
    await triggerBugEnrichment(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      // no db — should warn but still queue
    });

    expect(queueManager.addJob).toHaveBeenCalled();
  });

  it('handles null metadata fields gracefully', async () => {
    const bugReport = createMockBugReport({ metadata: null });

    await triggerBugEnrichment(bugReport, 'proj-1', queueManager);

    expect(queueManager.addJob).toHaveBeenCalledWith(
      'intelligence',
      'process-intelligence',
      expect.objectContaining({
        payload: expect.objectContaining({
          console_logs: null,
          network_logs: null,
          metadata: null,
        }),
      }),
      expect.any(Object)
    );
  });
});
