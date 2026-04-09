import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BullMQBroker } from '../src/adapters/bullmq/broker.js';
import { QueueNotRegisteredError, MessageBrokerTimeoutError } from '../src/errors.js';

// Mock bullmq
vi.mock('bullmq', () => {
  const mockJob = {
    id: 'job-001',
    waitUntilFinished: vi.fn().mockResolvedValue({ result: 'ok' }),
  };

  const MockQueue = vi.fn().mockImplementation(function (this: any) {
    this.add = vi.fn().mockResolvedValue(mockJob);
    this.close = vi.fn().mockResolvedValue(undefined);
    this.getJob = vi.fn().mockResolvedValue(mockJob);
  });

  const MockQueueEvents = vi.fn().mockImplementation(function (this: any) {
    this.close = vi.fn().mockResolvedValue(undefined);
  });

  return { Queue: MockQueue, QueueEvents: MockQueueEvents };
});

function createMockRedis() {
  return {
    ping: vi.fn().mockResolvedValue('PONG'),
    duplicate: vi.fn().mockReturnThis(),
    options: { host: 'localhost', port: 6379 },
  } as any;
}

describe('BullMQBroker', () => {
  let broker: BullMQBroker;
  let mockRedis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis = createMockRedis();
    broker = new BullMQBroker({ connection: mockRedis });
  });

  describe('registerQueue()', () => {
    it('should register a queue', () => {
      broker.registerQueue('screenshots');
      // Should not throw on getRawQueue
      expect(() => broker.getRawQueue('screenshots')).not.toThrow();
    });

    it('should be idempotent (registering twice does not duplicate)', async () => {
      broker.registerQueue('screenshots');
      broker.registerQueue('screenshots');
      // Still works fine
      expect(() => broker.getRawQueue('screenshots')).not.toThrow();

      const { Queue } = await import('bullmq');
      // Queue constructor called only once for this queue name
      expect(Queue).toHaveBeenCalledTimes(1);
    });
  });

  describe('publish()', () => {
    it('should publish a job and return its id', async () => {
      broker.registerQueue('screenshots');
      const jobId = await broker.publish('screenshots', 'process', { key: 'val' });
      expect(jobId).toBe('job-001');
    });

    it('should pass options to queue.add', async () => {
      broker.registerQueue('screenshots');
      const opts = { priority: 1, delay: 5000 };
      await broker.publish('screenshots', 'process', { key: 'val' }, opts);

      const queue = broker.getRawQueue('screenshots');
      expect(queue.add).toHaveBeenCalledWith('process', { key: 'val' }, opts);
    });

    it('should throw QueueNotRegisteredError for unregistered queue', async () => {
      await expect(broker.publish('unknown', 'job', {})).rejects.toThrow(QueueNotRegisteredError);
    });
  });

  describe('publishAndWait()', () => {
    it('should publish and wait for result', async () => {
      broker.registerQueue('payments');
      const result = await broker.publishAndWait('payments', 'checkout', { org: '1' });
      expect(result).toEqual({ result: 'ok' });
    });

    it('should throw QueueNotRegisteredError for unregistered queue', async () => {
      await expect(broker.publishAndWait('unknown', 'job', {})).rejects.toThrow(
        QueueNotRegisteredError
      );
    });

    it('should throw MessageBrokerTimeoutError when timeout expires', async () => {
      broker.registerQueue('payments');

      // Make waitUntilFinished hang forever
      const { Queue } = await import('bullmq');
      const mockQueue = (Queue as any).mock.results[0].value;
      const hangingJob = {
        id: 'job-hang',
        waitUntilFinished: vi.fn().mockReturnValue(new Promise(() => {})),
      };
      mockQueue.add.mockResolvedValue(hangingJob);

      await expect(
        broker.publishAndWait('payments', 'checkout', { org: '1' }, { timeout: 50 })
      ).rejects.toThrow(MessageBrokerTimeoutError);
    });

    it('should not timeout when result arrives before deadline', async () => {
      broker.registerQueue('payments');

      const { Queue } = await import('bullmq');
      const mockQueue = (Queue as any).mock.results[0].value;
      const fastJob = {
        id: 'job-fast',
        waitUntilFinished: vi.fn().mockResolvedValue({ checkoutUrl: 'https://pay.me' }),
      };
      mockQueue.add.mockResolvedValue(fastJob);

      const result = await broker.publishAndWait('payments', 'checkout', {}, { timeout: 5000 });
      expect(result).toEqual({ checkoutUrl: 'https://pay.me' });
    });

    it('should strip timeout from job options passed to queue.add', async () => {
      broker.registerQueue('payments');
      await broker.publishAndWait('payments', 'checkout', {}, { timeout: 5000, priority: 1 });

      const queue = broker.getRawQueue('payments');
      expect(queue.add).toHaveBeenCalledWith('checkout', {}, { priority: 1 });
    });
  });

  describe('healthCheck()', () => {
    it('should return true for all queues when Redis is healthy', async () => {
      broker.registerQueue('screenshots');
      broker.registerQueue('replays');

      const result = await broker.healthCheck();
      expect(result).toEqual({ screenshots: true, replays: true });
      expect(mockRedis.ping).toHaveBeenCalled();
    });

    it('should return false for all queues when Redis ping fails', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection refused'));

      broker.registerQueue('screenshots');
      broker.registerQueue('replays');

      const result = await broker.healthCheck();
      expect(result).toEqual({ screenshots: false, replays: false });
    });

    it('should return empty object when no queues registered', async () => {
      const result = await broker.healthCheck();
      expect(result).toEqual({});
    });
  });

  describe('shutdown()', () => {
    it('should close all queues and queue events', async () => {
      broker.registerQueue('screenshots');
      broker.registerQueue('replays');

      const q1 = broker.getRawQueue('screenshots');
      const q2 = broker.getRawQueue('replays');
      const qe1 = broker.getRawQueueEvents('screenshots');
      const qe2 = broker.getRawQueueEvents('replays');

      await broker.shutdown();

      expect(q1.close).toHaveBeenCalled();
      expect(q2.close).toHaveBeenCalled();
      expect(qe1.close).toHaveBeenCalled();
      expect(qe2.close).toHaveBeenCalled();
    });

    it('should clear internal maps after shutdown', async () => {
      broker.registerQueue('screenshots');
      await broker.shutdown();

      // Queue is no longer accessible
      expect(() => broker.getRawQueue('screenshots')).toThrow(QueueNotRegisteredError);
    });
  });

  describe('getRawQueue() / getRawQueueEvents()', () => {
    it('should return the raw queue', () => {
      broker.registerQueue('screenshots');
      const queue = broker.getRawQueue('screenshots');
      expect(queue).toBeDefined();
      expect(queue.add).toBeDefined();
    });

    it('should return the raw queue events', () => {
      broker.registerQueue('screenshots');
      const qe = broker.getRawQueueEvents('screenshots');
      expect(qe).toBeDefined();
      expect(qe.close).toBeDefined();
    });

    it('should throw QueueNotRegisteredError for unknown queue', () => {
      expect(() => broker.getRawQueue('unknown')).toThrow(QueueNotRegisteredError);
      expect(() => broker.getRawQueueEvents('unknown')).toThrow(QueueNotRegisteredError);
    });
  });

  describe('getConnection()', () => {
    it('should return the Redis connection', () => {
      expect(broker.getConnection()).toBe(mockRedis);
    });
  });

  describe('constructor options', () => {
    it('should pass defaultJobOptions to Queue constructor', async () => {
      const opts = {
        connection: mockRedis,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      };
      const b = new BullMQBroker(opts);
      b.registerQueue('test-q');

      const { Queue } = await import('bullmq');
      expect(Queue).toHaveBeenCalledWith(
        'test-q',
        expect.objectContaining({
          defaultJobOptions: opts.defaultJobOptions,
        })
      );
    });
  });
});
