import { describe, it, expect, vi } from 'vitest';
import { BullMQWorkerHostFactory } from '../src/adapters/bullmq/factory.js';

vi.mock('bullmq', () => {
  const MockWorker = vi.fn().mockImplementation(function (this: any) {
    this.close = vi.fn().mockResolvedValue(undefined);
    this.pause = vi.fn().mockResolvedValue(undefined);
    this.resume = vi.fn().mockResolvedValue(undefined);
    this.on = vi.fn();
  });
  return { Worker: MockWorker };
});

function createMockRedis() {
  return {
    options: { host: 'localhost', port: 6379 },
  } as any;
}

describe('BullMQWorkerHostFactory', () => {
  it('should create a worker host', () => {
    const factory = new BullMQWorkerHostFactory({
      connection: createMockRedis(),
    });

    const processor = vi.fn().mockResolvedValue({ done: true });
    const worker = factory.createWorker('test-queue', processor);

    expect(worker).toBeDefined();
    expect(worker.close).toBeDefined();
    expect(worker.pause).toBeDefined();
    expect(worker.resume).toBeDefined();
    expect(worker.on).toBeDefined();
  });

  it('should pass concurrency option', async () => {
    const factory = new BullMQWorkerHostFactory({
      connection: createMockRedis(),
    });

    factory.createWorker('q', vi.fn(), { concurrency: 10 });

    const { Worker } = await import('bullmq');
    expect(Worker).toHaveBeenCalledWith(
      'q',
      expect.any(Function),
      expect.objectContaining({ concurrency: 10 })
    );
  });

  it('should pass limiter option', async () => {
    const factory = new BullMQWorkerHostFactory({
      connection: createMockRedis(),
    });

    const limiter = { max: 5, duration: 2000 };
    factory.createWorker('q', vi.fn(), { limiter });

    const { Worker } = await import('bullmq');
    expect(Worker).toHaveBeenLastCalledWith(
      'q',
      expect.any(Function),
      expect.objectContaining({ limiter })
    );
  });

  it('should pass customOptions from factory constructor', async () => {
    const factory = new BullMQWorkerHostFactory({
      connection: createMockRedis(),
      customOptions: { lockDuration: 120000 },
    });

    factory.createWorker('q', vi.fn());

    const { Worker } = await import('bullmq');
    expect(Worker).toHaveBeenLastCalledWith(
      'q',
      expect.any(Function),
      expect.objectContaining({ lockDuration: 120000 })
    );
  });
});
