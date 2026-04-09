/**
 * Resolution Sync Trigger Tests
 *
 * Unit tests for fire-and-forget resolution sync queueing:
 * guards, per-org gating, job construction, error swallowing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { triggerResolutionSync } from '../../../src/api/utils/resolution-sync-trigger.js';
import { getIntelligenceConfig } from '../../../src/config/intelligence.config.js';
import { getOrgIntelligenceSettings } from '../../../src/services/intelligence/tenant-config.js';
import type { QueueManager } from '../../../src/queue/queue-manager.js';
import type { DatabaseClient } from '../../../src/db/client.js';

// Mock dependencies
vi.mock('../../../src/config/intelligence.config.js', () => ({
  getIntelligenceConfig: vi.fn(() => ({ enabled: true })),
}));

vi.mock('../../../src/services/intelligence/tenant-config.js', () => ({
  getOrgIntelligenceSettings: vi.fn(() =>
    Promise.resolve({ intelligence_enabled: true, intelligence_auto_analyze: true })
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

// ============================================================================
// Tests
// ============================================================================

describe('triggerResolutionSync', () => {
  let queueManager: QueueManager;

  beforeEach(() => {
    vi.clearAllMocks();
    queueManager = createMockQueueManager();

    mockedGetConfig.mockReturnValue({ enabled: true } as ReturnType<typeof getIntelligenceConfig>);
    mockedGetOrgSettings.mockResolvedValue({
      intelligence_enabled: true,
      intelligence_auto_analyze: true,
      intelligence_api_key: null,
      intelligence_provider: null,
      intelligence_similarity_threshold: 0.75,
      intelligence_dedup_action: 'flag',
      intelligence_api_key_provisioned_at: null,
      intelligence_api_key_provisioned_by: null,
    });
  });

  it('skips when queueManager is undefined', async () => {
    await triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fixed it', undefined);
    // Should not throw
  });

  it('skips when intelligence is globally disabled', async () => {
    mockedGetConfig.mockReturnValue({ enabled: false } as ReturnType<typeof getIntelligenceConfig>);

    await triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fixed', queueManager);
    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('queues resolution job with resolution_notes', async () => {
    await triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fixed the config', queueManager);

    expect(queueManager.addJob).toHaveBeenCalledWith(
      'intelligence',
      'process-intelligence',
      expect.objectContaining({
        type: 'resolution',
        bugReportId: 'bug-1',
        projectId: 'proj-1',
        payload: {
          resolution: 'Fixed the config',
          status: 'resolved',
        },
      }),
      expect.objectContaining({
        priority: 15,
        attempts: 3,
      })
    );
  });

  it('falls back to status as resolution text when notes are undefined', async () => {
    await triggerResolutionSync('bug-1', 'proj-1', 'closed', undefined, queueManager);

    expect(queueManager.addJob).toHaveBeenCalledWith(
      'intelligence',
      'process-intelligence',
      expect.objectContaining({
        payload: {
          resolution: 'closed',
          status: 'closed',
        },
      }),
      expect.any(Object)
    );
  });

  it('passes organizationId in job data when provided', async () => {
    const db = createMockDb();
    await triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fix', queueManager, {
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
      intelligence_api_key: null,
      intelligence_provider: null,
      intelligence_similarity_threshold: 0.75,
      intelligence_dedup_action: 'flag',
      intelligence_api_key_provisioned_at: null,
      intelligence_api_key_provisioned_by: null,
    });

    const db = createMockDb();
    await triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fix', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('skips (fail closed) when org settings lookup fails', async () => {
    mockedGetOrgSettings.mockRejectedValue(new Error('DB error'));

    const db = createMockDb();
    await triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fix', queueManager, {
      organizationId: 'org-1',
      db,
    });

    expect(queueManager.addJob).not.toHaveBeenCalled();
  });

  it('never throws even when addJob fails', async () => {
    (queueManager.addJob as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Queue down'));

    await expect(
      triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fix', queueManager)
    ).resolves.toBeUndefined();
  });

  it('warns when organizationId provided without db', async () => {
    await triggerResolutionSync('bug-1', 'proj-1', 'resolved', 'Fix', queueManager, {
      organizationId: 'org-1',
      // no db — should warn but still queue
    });

    expect(queueManager.addJob).toHaveBeenCalled();
  });
});
