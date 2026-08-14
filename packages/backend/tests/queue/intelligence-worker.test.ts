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
import { DelayedError } from 'bullmq';
import {
  processAnalyzeJob,
  processIntelligenceJob,
} from '../../src/queue/workers/intelligence-worker.js';
import type { DatabaseClient } from '../../src/db/client.js';
import {
  IntelligenceError,
  type IntelligenceClient,
} from '../../src/services/intelligence/intelligence-client.js';
import type { IntelligenceClientFactory } from '../../src/services/intelligence/tenant-config.js';
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

describe('Intelligence Worker - processIntelligenceJob llm_unavailable rescheduling', () => {
  let mockJob: any;
  let mockClient: any;
  let mockClientFactory: IntelligenceClientFactory;
  let mockDb: DatabaseClient;
  let mockRuleExecutor: DedupRuleExecutor;

  beforeEach(() => {
    mockJob = {
      id: 'job-1',
      data: {
        type: 'analyze',
        bugReportId: 'bug-1',
        projectId: 'proj-1',
        // validateIntelligenceJobData requires title for type 'analyze', not
        // just bug_id - omitting it fails validation before the job ever
        // reaches client.analyzeBug, let alone the reschedule path.
        payload: { bug_id: 'bug-1', title: 'Test bug' },
      },
      updateProgress: vi.fn(),
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    };

    mockClient = {
      analyzeBug: vi.fn(),
      getSimilarBugs: vi.fn().mockResolvedValue({ is_duplicate: false, similar_bugs: [] }),
    };

    // resolveClient falls through to getGlobalClient() when the project has
    // no organization_id (self-hosted path).
    mockClientFactory = {
      getGlobalClient: vi.fn().mockReturnValue(mockClient),
      getClientForOrg: vi.fn(),
    } as unknown as IntelligenceClientFactory;

    mockDb = {
      projects: {
        findById: vi.fn().mockResolvedValue({ id: 'proj-1', organization_id: null }),
      },
    } as unknown as DatabaseClient;

    mockRuleExecutor = {} as DedupRuleExecutor;
  });

  // AC #1 — retryAfter present reschedules at the server-supplied delay
  it('moves job to delayed using retryAfter when llm_unavailable', async () => {
    const retryAfter = 45;
    mockClient.analyzeBug.mockRejectedValueOnce(
      new IntelligenceError('LLM unavailable', 'llm_unavailable', 503, { retryAfter })
    );

    const before = Date.now();
    await expect(
      processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor)
    ).rejects.toBeInstanceOf(DelayedError);
    const after = Date.now();

    expect(mockJob.moveToDelayed).toHaveBeenCalledOnce();
    const [calledAt, calledToken] = mockJob.moveToDelayed.mock.calls[0];
    expect(calledAt).toBeGreaterThanOrEqual(before + retryAfter * 1000);
    expect(calledAt).toBeLessThanOrEqual(after + retryAfter * 1000);
    expect(calledToken).toBe('test-token');
  });

  // AC #2 — retryAfter absent falls back to the 30s floor
  it('falls back to 30s delay when retryAfter is absent', async () => {
    mockClient.analyzeBug.mockRejectedValueOnce(
      new IntelligenceError('LLM unavailable', 'llm_unavailable', 503)
    );

    const before = Date.now();
    await expect(
      processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor)
    ).rejects.toBeInstanceOf(DelayedError);
    const after = Date.now();

    const [calledAt] = mockJob.moveToDelayed.mock.calls[0];
    expect(calledAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(calledAt).toBeLessThanOrEqual(after + 30_000);
  });

  // AC #3 — retryAfter explicitly 0 also falls back to the 30s floor.
  // Distinct from the absent case: proves `||` handles an explicit falsy 0
  // where `??` would not (`0 ?? 30` evaluates to `0`).
  it('falls back to 30s delay when retryAfter is explicitly 0', async () => {
    mockClient.analyzeBug.mockRejectedValueOnce(
      new IntelligenceError('LLM unavailable', 'llm_unavailable', 503, { retryAfter: 0 })
    );

    const before = Date.now();
    await expect(
      processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor)
    ).rejects.toBeInstanceOf(DelayedError);
    const after = Date.now();

    const [calledAt] = mockJob.moveToDelayed.mock.calls[0];
    expect(calledAt).toBeGreaterThanOrEqual(before + 30_000);
    expect(calledAt).toBeLessThanOrEqual(after + 30_000);
  });

  // AC #4 — a non-llm_unavailable error propagates normally, no reschedule
  it('does not call moveToDelayed for non-llm_unavailable errors', async () => {
    mockClient.analyzeBug.mockRejectedValueOnce(
      new IntelligenceError('Service error', 'server_error', 500)
    );

    await expect(
      processIntelligenceJob(mockJob, 'test-token', mockClientFactory, mockDb, mockRuleExecutor)
    ).rejects.not.toBeInstanceOf(DelayedError);

    expect(mockJob.moveToDelayed).not.toHaveBeenCalled();
  });
});
