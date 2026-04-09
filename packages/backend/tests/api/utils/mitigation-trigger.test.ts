/**
 * Mitigation Trigger Tests
 *
 * Unit tests for fire-and-forget mitigation queueing:
 * guards, per-org gating, job construction, dedup, error swallowing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerBugMitigation } from '../../../src/api/utils/mitigation-trigger.js';
import { getIntelligenceConfig } from '../../../src/config/intelligence.config.js';
import { getOrgIntelligenceSettings } from '../../../src/services/intelligence/tenant-config.js';
import type { QueueManager } from '../../../src/queue/queue-manager.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { BugReport } from '../../../src/db/types.js';

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
    title: 'Checkout crash',
    description: 'TypeError in payment form',
    metadata: null,
    project_id: 'proj-1',
    organization_id: null,
    ...overrides,
  } as BugReport;
}

describe('triggerBugMitigation', () => {
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
    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', undefined);
    expect(result).toBe(false);
  });

  it('returns false when intelligence is globally disabled', async () => {
    mockedGetConfig.mockReturnValue({ enabled: false } as ReturnType<typeof getIntelligenceConfig>);
    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager);
    expect(result).toBe(false);
    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('queues mitigation job with correct payload', async () => {
    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager);

    expect(result).toBe(true);
    expect(queueManager.addJob).toHaveBeenCalledWith(
      'intelligence',
      'process-intelligence',
      expect.objectContaining({
        type: 'mitigation',
        bugReportId: 'bug-1',
        projectId: 'proj-1',
        payload: expect.objectContaining({
          bug_id: 'bug-1',
          use_similar_bugs: true,
        }),
      }),
      expect.objectContaining({
        priority: 25,
        attempts: 3,
        removeOnComplete: true,
        removeOnFail: true,
      })
    );
  });

  it('uses deterministic job ID for auto-trigger deduplication', async () => {
    await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager);

    expect(queueManager.addJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        jobId: 'mitigation-bug-1',
      })
    );
  });

  it('uses unique job ID for manual triggers (allows re-generation)', async () => {
    const db = createMockDb();
    await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager, {
      manualTrigger: true,
      db,
    });

    const call = (queueManager.addJob as ReturnType<typeof vi.fn>).mock.calls[0];
    const jobId = call[3].jobId as string;
    expect(jobId).toMatch(/^mitigation-bug-1-\d+$/);
  });

  it('passes organizationId in job data when provided', async () => {
    const db = createMockDb();
    await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(queueManager.addJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ organizationId: 'org-1' }),
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
    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(result).toBe(false);
    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('skips when auto_enrich is disabled (non-manual trigger)', async () => {
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
    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(result).toBe(false);
  });

  it('proceeds when auto_enrich is disabled but manualTrigger is true', async () => {
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
    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager, {
      organizationId: 'org-1',
      db,
      manualTrigger: true,
    });

    expect(result).toBe(true);
  });

  it('returns true when job already exists (dedup)', async () => {
    (queueManager.addJob as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Job already exists')
    );

    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager);
    expect(result).toBe(true);
  });

  it('swallows unexpected queue errors and returns false', async () => {
    (queueManager.addJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Redis down'));

    const result = await triggerBugMitigation(createMockBugReport(), 'proj-1', queueManager);
    expect(result).toBe(false);
  });
});
