/**
 * Queue Configuration Tests
 * Tests for queue configuration loading and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadQueueConfig,
  validateQueueConfig,
  getQueueConfig,
} from '../../src/config/queue.config.js';
import type { QueueConfig } from '../../src/config/queue.config.js';

describe('Queue Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadQueueConfig()', () => {
    it('should load default configuration', () => {
      const config = loadQueueConfig();

      expect(config).toBeDefined();
      expect(config.redis).toBeDefined();
      expect(config.workers).toBeDefined();
      expect(config.jobs).toBeDefined();
    });

    it('should use Redis URL from environment', () => {
      process.env.REDIS_URL = 'redis://custom-host:6380';
      const config = loadQueueConfig();

      expect(config.redis.url).toBe('redis://custom-host:6380');
    });

    it('should use default Redis URL if not provided', () => {
      delete process.env.REDIS_URL;
      const config = loadQueueConfig();

      expect(config.redis.url).toBe('redis://localhost:6379');
    });

    it('should parse worker concurrency from environment', () => {
      process.env.WORKER_SCREENSHOT_CONCURRENCY = '10';
      process.env.WORKER_REPLAY_CONCURRENCY = '5';
      const config = loadQueueConfig();

      expect(config.workers.screenshot.concurrency).toBe(10);
      expect(config.workers.replay.concurrency).toBe(5);
    });

    it('should use default concurrency if not provided', () => {
      delete process.env.WORKER_SCREENSHOT_CONCURRENCY;
      const config = loadQueueConfig();

      expect(config.workers.screenshot.concurrency).toBe(5);
    });

    it('should parse job retention settings', () => {
      process.env.JOB_RETENTION_DAYS = '14';
      process.env.MAX_JOB_RETRIES = '5';
      const config = loadQueueConfig();

      expect(config.jobs.retentionDays).toBe(14);
      expect(config.jobs.maxRetries).toBe(5);
    });

    it('should parse worker enabled flags', () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';
      process.env.WORKER_REPLAY_ENABLED = 'false';
      const config = loadQueueConfig();

      expect(config.workers.screenshot.enabled).toBe(true);
      expect(config.workers.replay.enabled).toBe(false);
    });

    it('should parse Redis connection settings', () => {
      process.env.REDIS_RETRY_DELAY = '2000';
      const config = loadQueueConfig();

      expect(config.redis.retryDelay).toBe(2000);
    });
  });

  describe('validateQueueConfig()', () => {
    it('should validate correct configuration', () => {
      const validConfig: QueueConfig = {
        redis: {
          url: 'redis://localhost:6379',
          retryDelay: 1000,
        },
        workers: {
          screenshot: { enabled: true, concurrency: 5 },
          replay: { enabled: true, concurrency: 3 },
          integration: { enabled: true, concurrency: 10 },
          notification: { enabled: true, concurrency: 5 },
        },
        jobs: {
          maxRetries: 3,
          backoffDelay: 5000,
          retentionDays: 7,
          timeout: 300000,
        },
        replay: {
          chunkDurationSeconds: 30,
          maxReplaySizeMB: 50,
        },
        screenshot: {
          quality: 85,
          thumbnailWidth: 320,
          thumbnailHeight: 240,
        },
      };

      expect(() => validateQueueConfig(validConfig)).not.toThrow();
    });

    it('should reject empty Redis URL', () => {
      const invalidConfig = {
        redis: { url: '', retryDelay: 1000 },
        workers: {
          screenshot: { enabled: true, concurrency: 5 },
          replay: { enabled: true, concurrency: 3 },
          integration: { enabled: true, concurrency: 10 },
          notification: { enabled: true, concurrency: 5 },
        },
        jobs: { maxRetries: 3, backoffDelay: 5000, retentionDays: 7, timeout: 300000 },
        replay: { chunkDurationSeconds: 30, maxReplaySizeMB: 50 },
        screenshot: { quality: 85, thumbnailWidth: 320, thumbnailHeight: 240 },
      } as any;

      expect(() => validateQueueConfig(invalidConfig)).toThrow('REDIS_URL is required');
    });

    it('should reject negative concurrency', () => {
      const invalidConfig = {
        redis: { url: 'redis://localhost:6379', maxRetries: 3, retryDelay: 1000 },
        workers: {
          screenshot: { enabled: true, concurrency: -1 },
          replay: { enabled: true, concurrency: 3 },
          integration: { enabled: true, concurrency: 10 },
          notification: { enabled: true, concurrency: 5 },
        },
        jobs: { maxRetries: 3, backoffDelay: 5000, retentionDays: 7, timeout: 300000 },
        replay: { chunkDurationSeconds: 30, maxReplaySizeMB: 50 },
        screenshot: { quality: 85, thumbnailWidth: 320, thumbnailHeight: 240 },
      } as any;

      expect(() => validateQueueConfig(invalidConfig)).toThrow(
        'WORKER_SCREENSHOT_CONCURRENCY must be between 1 and 100'
      );
    });

    it('should reject zero concurrency', () => {
      const invalidConfig = {
        redis: { url: 'redis://localhost:6379', maxRetries: 3, retryDelay: 1000 },
        workers: {
          screenshot: { enabled: true, concurrency: 0 },
          replay: { enabled: true, concurrency: 3 },
          integration: { enabled: true, concurrency: 10 },
          notification: { enabled: true, concurrency: 5 },
        },
        jobs: { maxRetries: 3, backoffDelay: 5000, retentionDays: 7, timeout: 300000 },
        replay: { chunkDurationSeconds: 30, maxReplaySizeMB: 50 },
        screenshot: { quality: 85, thumbnailWidth: 320, thumbnailHeight: 240 },
      } as any;

      expect(() => validateQueueConfig(invalidConfig)).toThrow(
        'WORKER_SCREENSHOT_CONCURRENCY must be between 1 and 100'
      );
    });

    it('should reject invalid screenshot quality', () => {
      const invalidConfig = {
        redis: { url: 'redis://localhost:6379', maxRetries: 3, retryDelay: 1000 },
        workers: {
          screenshot: { enabled: true, concurrency: 5 },
          replay: { enabled: true, concurrency: 3 },
          integration: { enabled: true, concurrency: 10 },
          notification: { enabled: true, concurrency: 5 },
        },
        jobs: { maxRetries: 3, backoffDelay: 5000, retentionDays: 7, timeout: 300000 },
        replay: { chunkDurationSeconds: 30, maxReplaySizeMB: 50 },
        screenshot: { quality: 150, thumbnailWidth: 320, thumbnailHeight: 240 },
      } as any;

      expect(() => validateQueueConfig(invalidConfig)).toThrow(
        'SCREENSHOT_QUALITY must be between 1 and 100'
      );
    });

    it('should reject negative retention days', () => {
      const invalidConfig = {
        redis: { url: 'redis://localhost:6379', maxRetries: 3, retryDelay: 1000 },
        workers: {
          screenshot: { enabled: true, concurrency: 5 },
          replay: { enabled: true, concurrency: 3 },
          integration: { enabled: true, concurrency: 10 },
          notification: { enabled: true, concurrency: 5 },
        },
        jobs: { maxRetries: 3, backoffDelay: 5000, retentionDays: -1, timeout: 300000 },
        replay: { chunkDurationSeconds: 30, maxReplaySizeMB: 50 },
        screenshot: { quality: 85, thumbnailWidth: 320, thumbnailHeight: 240 },
      } as any;

      expect(() => validateQueueConfig(invalidConfig)).toThrow(
        'JOB_RETENTION_DAYS must be between 1 and 365'
      );
    });
  });

  describe('getQueueConfig()', () => {
    it('should return singleton configuration', () => {
      const config1 = getQueueConfig();
      const config2 = getQueueConfig();

      expect(config1).toBe(config2); // Same reference
    });

    it('should return validated configuration', () => {
      const config = getQueueConfig();

      expect(config).toBeDefined();
      expect(config.redis.url).toBeTruthy();
      expect(config.workers.screenshot.concurrency).toBeGreaterThan(0);
    });
  });

  describe('Configuration Defaults', () => {
    it('should have correct default Redis settings', () => {
      const config = loadQueueConfig();

      expect(config.redis.retryDelay).toBe(1000);
    });

    it('should have correct default worker concurrency', () => {
      const config = loadQueueConfig();

      expect(config.workers.screenshot.concurrency).toBe(5);
      expect(config.workers.replay.concurrency).toBe(3);
      expect(config.workers.integration.concurrency).toBe(10);
      expect(config.workers.notification.concurrency).toBe(5);
    });

    it('should have all workers enabled by default', () => {
      // Clear environment variables to test true defaults
      delete process.env.WORKER_SCREENSHOT_ENABLED;
      delete process.env.WORKER_REPLAY_ENABLED;
      delete process.env.WORKER_INTEGRATION_ENABLED;
      delete process.env.WORKER_NOTIFICATION_ENABLED;

      const config = loadQueueConfig();

      expect(config.workers.screenshot.enabled).toBe(true);
      expect(config.workers.replay.enabled).toBe(true);
      expect(config.workers.integration.enabled).toBe(true);
      expect(config.workers.notification.enabled).toBe(true);
    });

    it('should have correct default job settings', () => {
      const config = loadQueueConfig();

      expect(config.jobs.maxRetries).toBe(3);
      expect(config.jobs.backoffDelay).toBe(5000);
      expect(config.jobs.retentionDays).toBe(7);
      expect(config.jobs.timeout).toBe(300000); // 5 minutes
    });

    it('should have correct default processing settings', () => {
      const config = loadQueueConfig();

      expect(config.screenshot.quality).toBe(85);
      expect(config.screenshot.thumbnailWidth).toBe(320);
      expect(config.screenshot.thumbnailHeight).toBe(240);
      expect(config.replay.chunkDurationSeconds).toBe(30);
    });
  });

  describe('Environment Variable Parsing', () => {
    it('should handle string boolean values', () => {
      process.env.WORKER_SCREENSHOT_ENABLED = 'true';
      process.env.WORKER_REPLAY_ENABLED = 'false';
      const config = loadQueueConfig();

      expect(config.workers.screenshot.enabled).toBe(true);
      expect(config.workers.replay.enabled).toBe(false);
    });

    it('should handle numeric string values', () => {
      process.env.WORKER_SCREENSHOT_CONCURRENCY = '15';
      process.env.MAX_JOB_RETRIES = '5';
      const config = loadQueueConfig();

      expect(config.workers.screenshot.concurrency).toBe(15);
      expect(config.jobs.maxRetries).toBe(5);
    });

    it('should handle missing optional environment variables', () => {
      delete process.env.WORKER_SCREENSHOT_CONCURRENCY;
      delete process.env.JOB_RETENTION_DAYS;

      const config = loadQueueConfig();

      expect(config.workers.screenshot.concurrency).toBe(5); // default
      expect(config.jobs.retentionDays).toBe(7); // default
    });
  });
});
