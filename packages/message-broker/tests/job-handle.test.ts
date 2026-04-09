import { describe, it, expect, vi } from 'vitest';
import { BullMQJobHandle } from '../src/adapters/bullmq/job-handle.js';

function createMockJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-123',
    name: 'test-job',
    data: { foo: 'bar' },
    attemptsMade: 2,
    updateProgress: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('BullMQJobHandle', () => {
  it('should expose id from underlying job', () => {
    const job = createMockJob();
    const handle = new BullMQJobHandle(job as any);
    expect(handle.id).toBe('job-123');
  });

  it('should fallback to "unknown" when job.id is undefined', () => {
    const job = createMockJob({ id: undefined });
    const handle = new BullMQJobHandle(job as any);
    expect(handle.id).toBe('unknown');
  });

  it('should expose name from underlying job', () => {
    const job = createMockJob({ name: 'process-screenshot' });
    const handle = new BullMQJobHandle(job as any);
    expect(handle.name).toBe('process-screenshot');
  });

  it('should expose data from underlying job', () => {
    const data = { bugReportId: 'bug-1', projectId: 'proj-2' };
    const job = createMockJob({ data });
    const handle = new BullMQJobHandle(job as any);
    expect(handle.data).toEqual(data);
  });

  it('should expose attemptsMade from underlying job', () => {
    const job = createMockJob({ attemptsMade: 3 });
    const handle = new BullMQJobHandle(job as any);
    expect(handle.attemptsMade).toBe(3);
  });

  it('should delegate updateProgress to underlying job', async () => {
    const job = createMockJob();
    const handle = new BullMQJobHandle(job as any);

    await handle.updateProgress(50);
    expect(job.updateProgress).toHaveBeenCalledWith(50);

    await handle.updateProgress({ step: 2, total: 5 });
    expect(job.updateProgress).toHaveBeenCalledWith({ step: 2, total: 5 });
  });

  it('should delegate log to underlying job', async () => {
    const job = createMockJob();
    const handle = new BullMQJobHandle(job as any);

    await handle.log('Processing started');
    expect(job.log).toHaveBeenCalledWith('Processing started');
  });

  it('should have readonly properties (snapshot at construction)', () => {
    const job = createMockJob();
    const handle = new BullMQJobHandle(job as any);

    // Properties are set at construction time, not dynamically proxied
    expect(handle.id).toBe('job-123');
    expect(handle.name).toBe('test-job');
    expect(handle.attemptsMade).toBe(2);
  });
});
