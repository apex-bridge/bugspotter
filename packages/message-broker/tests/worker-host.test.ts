import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BullMQWorkerHost } from '../src/adapters/bullmq/worker-host.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// Track event handlers registered on the mock worker
const workerEventHandlers = new Map<string, AnyFn>();
const mockWorkerInstance = {
  close: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  on: vi.fn().mockImplementation((event: string, handler: AnyFn) => {
    workerEventHandlers.set(event, handler);
  }),
};

let capturedProcessor: AnyFn;

vi.mock('bullmq', () => {
  // Must use function (not arrow) so it can be called with `new`
  const MockWorker = vi.fn().mockImplementation(function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this: any,
    _queue: string,
    processor: AnyFn
  ) {
    capturedProcessor = processor;
    Object.assign(this, mockWorkerInstance);
  });
  return { Worker: MockWorker };
});

function createMockRedis() {
  return {
    options: { host: 'localhost', port: 6379 },
  } as any;
}

describe('BullMQWorkerHost', () => {
  let host: BullMQWorkerHost<{ key: string }, { result: string }>;
  const processor = vi.fn().mockResolvedValue({ result: 'done' });

  beforeEach(() => {
    vi.clearAllMocks();
    workerEventHandlers.clear();

    host = new BullMQWorkerHost({
      queue: 'test-queue',
      processor,
      connection: createMockRedis(),
      concurrency: 3,
    });
  });

  describe('constructor', () => {
    it('should create a BullMQ Worker with correct queue name', async () => {
      const { Worker } = await import('bullmq');
      expect(Worker).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Function),
        expect.objectContaining({ concurrency: 3 })
      );
    });

    it('should pass limiter to worker options', async () => {
      const limiter = { max: 10, duration: 1000 };
      new BullMQWorkerHost({
        queue: 'limited-q',
        processor,
        connection: createMockRedis(),
        limiter,
      });

      const { Worker } = await import('bullmq');
      expect(Worker).toHaveBeenLastCalledWith(
        'limited-q',
        expect.any(Function),
        expect.objectContaining({ limiter })
      );
    });

    it('should pass customOptions to worker', async () => {
      new BullMQWorkerHost({
        queue: 'custom-q',
        processor,
        connection: createMockRedis(),
        customOptions: { lockDuration: 60000 },
      });

      const { Worker } = await import('bullmq');
      expect(Worker).toHaveBeenLastCalledWith(
        'custom-q',
        expect.any(Function),
        expect.objectContaining({ lockDuration: 60000 })
      );
    });
  });

  describe('processor wrapping', () => {
    it('should wrap BullMQ Job into IJobHandle before calling processor', async () => {
      const mockBullJob = {
        id: 'job-42',
        name: 'test-job',
        data: { key: 'value' },
        attemptsMade: 1,
        updateProgress: vi.fn(),
        log: vi.fn(),
      };

      await capturedProcessor(mockBullJob);

      expect(processor).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'job-42',
          name: 'test-job',
          data: { key: 'value' },
          attemptsMade: 1,
        })
      );
    });

    it('should return the processor result', async () => {
      const mockBullJob = {
        id: 'j1',
        name: 'n',
        data: { key: 'k' },
        attemptsMade: 0,
        updateProgress: vi.fn(),
        log: vi.fn(),
      };

      const result = await capturedProcessor(mockBullJob);
      expect(result).toEqual({ result: 'done' });
    });
  });

  describe('close()', () => {
    it('should delegate to underlying worker', async () => {
      await host.close();
      expect(mockWorkerInstance.close).toHaveBeenCalled();
    });
  });

  describe('pause()', () => {
    it('should delegate to underlying worker', async () => {
      await host.pause();
      expect(mockWorkerInstance.pause).toHaveBeenCalled();
    });
  });

  describe('resume()', () => {
    it('should delegate to underlying worker', async () => {
      await host.resume();
      expect(mockWorkerInstance.resume).toHaveBeenCalled();
    });
  });

  describe('getRawWorker()', () => {
    it('should return the underlying BullMQ worker', () => {
      const raw = host.getRawWorker();
      expect(raw).toBeDefined();
      expect(raw.close).toBeDefined();
      expect(raw.pause).toBeDefined();
      expect(raw.resume).toBeDefined();
    });
  });

  describe('on()', () => {
    it('should wrap completed events with BullMQJobHandle', () => {
      const handler = vi.fn();
      host.on('completed', handler);

      expect(mockWorkerInstance.on).toHaveBeenCalledWith('completed', expect.any(Function));

      // Simulate the BullMQ worker emitting a completed event
      const bullJob = {
        id: 'job-1',
        name: 'test',
        data: { key: 'v' },
        attemptsMade: 0,
        updateProgress: vi.fn(),
        log: vi.fn(),
      };
      const registeredHandler = workerEventHandlers.get('completed')!;
      const resultValue = { result: 'success' };
      registeredHandler(bullJob, resultValue);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'job-1', name: 'test' }),
        resultValue
      );
    });

    it('should wrap active events with BullMQJobHandle', () => {
      const handler = vi.fn();
      host.on('active', handler);

      expect(mockWorkerInstance.on).toHaveBeenCalledWith('active', expect.any(Function));
    });

    it('should wrap failed events with BullMQJobHandle', () => {
      const handler = vi.fn();
      host.on('failed', handler);

      expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));

      // Simulate failed event with a job
      const bullJob = {
        id: 'job-fail',
        name: 'test',
        data: {},
        attemptsMade: 3,
        updateProgress: vi.fn(),
        log: vi.fn(),
      };
      const err = new Error('Processing failed');
      const registeredHandler = workerEventHandlers.get('failed')!;
      registeredHandler(bullJob, err);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-fail' }), err);
    });

    it('should handle failed events with undefined job', () => {
      const handler = vi.fn();
      host.on('failed', handler);

      const err = new Error('No job');
      const registeredHandler = workerEventHandlers.get('failed')!;
      registeredHandler(undefined, err);

      expect(handler).toHaveBeenCalledWith(undefined, err);
    });

    it('should pass through error events directly', () => {
      const handler = vi.fn();
      host.on('error', handler);

      expect(mockWorkerInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should pass through unknown events directly', () => {
      const handler = vi.fn();
      host.on('drained', handler);

      expect(mockWorkerInstance.on).toHaveBeenCalledWith('drained', expect.any(Function));
    });
  });
});
