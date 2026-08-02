/**
 * Intelligence Worker Tests
 *
 * Covers processAnalyzeJob's org-threshold resolution (issue #237): the
 * automated dedup/auto-close path must forward the org's configured
 * intelligence_similarity_threshold to the intelligence service, and must
 * omit the param entirely when no org setting exists so the service's own
 * global default applies.
 *
 * processAnalyzeJob is exported specifically so this suite can drive it
 * directly — the repo has no harness for running a job through a created
 * worker's internal processor callback (see the spec's constraint 6).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processAnalyzeJob } from '../../src/queue/workers/intelligence-worker.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IntelligenceClient } from '../../src/services/intelligence/intelligence-client.js';
import type { DedupRuleExecutor } from '../../src/services/rules/executor.js';

describe('Intelligence Worker - processAnalyzeJob org threshold', () => {
  let mockJob: any;
  let mockClient: any;
  let mockRuleExecutor: DedupRuleExecutor;

  beforeEach(() => {
    mockJob = {
      id: 'job-1',
      data: {
        bugReportId: 'bug-1',
        projectId: 'proj-1',
        payload: { bug_id: 'bug-1' },
      },
      // ProgressTracker calls this as processAnalyzeJob's first step; without
      // it the job throws before reaching the code under test.
      updateProgress: vi.fn(),
    };

    mockClient = {
      analyzeBug: vi.fn().mockResolvedValue({ embedding_generated: true, stored: true }),
      getSimilarBugs: vi.fn().mockResolvedValue({ is_duplicate: false, similar_bugs: [] }),
    };

    // Never invoked on the is_duplicate:false path these tests exercise.
    mockRuleExecutor = {} as DedupRuleExecutor;
  });

  function dbWithSettings(settings: Record<string, unknown>): DatabaseClient {
    return {
      organizations: { findById: vi.fn().mockResolvedValue({ settings }) },
    } as unknown as DatabaseClient;
  }

  // AC E
  it('forwards the org similarity threshold to getSimilarBugs', async () => {
    const mockDb = dbWithSettings({ intelligence_similarity_threshold: 0.7 });

    await processAnalyzeJob(
      mockJob,
      mockClient as IntelligenceClient,
      mockDb,
      'org-1',
      Date.now(),
      mockRuleExecutor
    );

    expect(mockClient.getSimilarBugs).toHaveBeenCalledWith(
      'bug-1',
      expect.objectContaining({ threshold: 0.7 })
    );
    expect(mockDb.organizations.findById).toHaveBeenCalledWith('org-1');
  });

  // AC F
  it('omits threshold when the org has none set', async () => {
    const mockDb = dbWithSettings({});

    await processAnalyzeJob(
      mockJob,
      mockClient as IntelligenceClient,
      mockDb,
      'org-1',
      Date.now(),
      mockRuleExecutor
    );

    expect(mockClient.getSimilarBugs).toHaveBeenCalledWith(
      'bug-1',
      expect.objectContaining({ threshold: undefined })
    );
  });

  // AC F (explicit null, not merely absent — mirrors route test case C2)
  it('omits threshold when the org setting is explicitly null', async () => {
    const mockDb = dbWithSettings({ intelligence_similarity_threshold: null });

    await processAnalyzeJob(
      mockJob,
      mockClient as IntelligenceClient,
      mockDb,
      'org-1',
      Date.now(),
      mockRuleExecutor
    );

    expect(mockClient.getSimilarBugs).toHaveBeenCalledWith(
      'bug-1',
      expect.objectContaining({ threshold: undefined })
    );
  });

  // AC G
  it('does not look up an org when resolvedOrgId is undefined', async () => {
    const mockDb = dbWithSettings({});

    await processAnalyzeJob(
      mockJob,
      mockClient as IntelligenceClient,
      mockDb,
      undefined,
      Date.now(),
      mockRuleExecutor
    );

    expect(mockDb.organizations.findById).not.toHaveBeenCalled();
    expect(mockClient.getSimilarBugs).toHaveBeenCalledWith(
      'bug-1',
      expect.objectContaining({ threshold: undefined })
    );
  });

  // AC H
  it('propagates when the org lookup rejects, failing the job', async () => {
    const mockDb = {
      organizations: { findById: vi.fn().mockRejectedValue(new Error('db unavailable')) },
    } as unknown as DatabaseClient;

    await expect(
      processAnalyzeJob(
        mockJob,
        mockClient as IntelligenceClient,
        mockDb,
        'org-1',
        Date.now(),
        mockRuleExecutor
      )
    ).rejects.toThrow('db unavailable');

    expect(mockClient.getSimilarBugs).not.toHaveBeenCalled();
  });
});
