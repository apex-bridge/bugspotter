/**
 * Notification Worker Tests
 * Unit tests for notification delivery worker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createNotificationWorker } from '../../src/queue/workers/notification-worker.js';
import type { DatabaseClient } from '../../src/db/client.js';
import type { IStorageService } from '../../src/storage/types.js';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import {
  validateNotificationJobData,
  createNotificationJobResult,
} from '../../src/queue/jobs/notification-job.js';

describe('Notification Worker', () => {
  let mockDb: Partial<DatabaseClient>;
  let mockStorage: Partial<IStorageService>;
  let mockRedis: Partial<Redis>;
  let mockPool: Partial<Pool>;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(),
      connect: vi.fn(),
      end: vi.fn(),
    };

    mockDb = {
      getPool: vi.fn().mockReturnValue(mockPool),
      bugReports: {
        findById: vi.fn().mockResolvedValue({
          id: 'bug-123',
          project_id: 'proj-456',
          title: 'Test Bug',
          description: 'Test description',
          status: 'open',
          priority: 'high',
          metadata: {},
        }),
      } as any,
      projects: {} as any,
      notificationChannels: {} as any,
      notificationRules: {} as any,
      notificationTemplates: {} as any,
      notificationHistory: {} as any,
    };

    mockStorage = {};

    mockRedis = {
      ping: vi.fn().mockResolvedValue('PONG'),
      on: vi.fn(),
      once: vi.fn(),
      duplicate: vi.fn().mockReturnThis(),
    };
  });

  describe('Worker Creation', () => {
    it('should create notification worker successfully', () => {
      const worker = createNotificationWorker(
        mockDb as DatabaseClient,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      expect(worker).toBeDefined();
      expect(worker.close).toBeDefined();
    });

    it('should create worker with correct configuration', () => {
      const worker = createNotificationWorker(
        mockDb as DatabaseClient,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      expect(worker).toBeDefined();
    });
  });

  describe('Job Data Validation', () => {
    it('should validate correct notification job data', () => {
      const validData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'email',
        recipients: ['user@example.com'],
        event: 'created',
      };

      expect(validateNotificationJobData(validData)).toBe(true);
    });

    it('should reject notification data without bugReportId', () => {
      const invalidData = {
        projectId: 'proj-456',
        type: 'email',
        recipients: ['user@example.com'],
        event: 'created',
      };

      expect(validateNotificationJobData(invalidData)).toBe(false);
    });

    it('should reject notification data without type', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        recipients: ['user@example.com'],
        event: 'created',
      };

      expect(validateNotificationJobData(invalidData)).toBe(false);
    });

    it('should reject notification data without recipients', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'email',
        event: 'created',
      };

      expect(validateNotificationJobData(invalidData)).toBe(false);
    });

    it('should reject notification data with empty recipients', () => {
      const invalidData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'email',
        recipients: [],
        event: 'created',
      };

      expect(validateNotificationJobData(invalidData)).toBe(false);
    });

    it('should validate data with multiple recipients', () => {
      const validData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'email',
        recipients: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
        event: 'created',
      };

      expect(validateNotificationJobData(validData)).toBe(true);
    });

    it('should validate data with optional metadata', () => {
      const validData = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'webhook',
        recipients: ['https://example.com/webhook'],
        event: 'created',
        metadata: { customField: 'value' },
      };

      expect(validateNotificationJobData(validData)).toBe(true);
    });
  });

  describe('Job Result Creation', () => {
    it('should create result with all required fields', () => {
      const result = createNotificationJobResult('email', 5, 5, 0);

      expect(result.type).toBe('email');
      expect(result.recipientCount).toBe(5);
      expect(result.successCount).toBe(5);
      expect(result.failureCount).toBe(0);
    });

    it('should create result with failures', () => {
      const result = createNotificationJobResult('slack', 5, 3, 2);

      expect(result.recipientCount).toBe(5);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(2);
    });

    it('should create result with errors', () => {
      const errors = ['Failed to send to user1', 'Failed to send to user2'];
      const result = createNotificationJobResult('email', 5, 3, 2, errors);

      expect(result.errors).toEqual(errors);
      expect(result.errors?.length).toBe(2);
    });

    it('should handle zero recipients scenario', () => {
      const result = createNotificationJobResult('email', 0, 0, 0);

      expect(result.recipientCount).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });
  });

  describe('Notification Types', () => {
    it('should support email notifications', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'email',
        recipients: ['test@example.com'],
        event: 'created',
      };

      expect(validateNotificationJobData(data)).toBe(true);
    });

    it('should support slack notifications', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'slack',
        recipients: ['#engineering', '@user'],
        event: 'updated',
      };

      expect(validateNotificationJobData(data)).toBe(true);
    });

    it('should support webhook notifications', () => {
      const data = {
        bugReportId: 'bug-123',
        projectId: 'proj-456',
        type: 'webhook',
        recipients: ['https://example.com/webhook'],
        event: 'resolved',
      };

      expect(validateNotificationJobData(data)).toBe(true);
    });
  });

  describe('Worker Lifecycle', () => {
    it('should allow closing the worker', async () => {
      const worker = createNotificationWorker(
        mockDb as DatabaseClient,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      await expect(worker.close()).resolves.not.toThrow();
    });

    it('should provide access to worker host', () => {
      const worker = createNotificationWorker(
        mockDb as DatabaseClient,
        mockStorage as IStorageService,
        mockRedis as Redis
      );

      expect(worker).toBeDefined();
      expect(worker.close).toBeDefined();
      expect(worker.pause).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should create result with all failures', () => {
      const result = createNotificationJobResult('email', 5, 0, 5);

      expect(result.recipientCount).toBe(5);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(5);
    });

    it('should handle mixed success and failure', () => {
      const result = createNotificationJobResult('email', 10, 8, 2);

      expect(result.recipientCount).toBe(10);
      expect(result.successCount).toBe(8);
      expect(result.failureCount).toBe(2);
    });
  });

  describe('Delivery Results', () => {
    it('should track delivery results accurately', () => {
      const totalRecipients = 10;
      const successCount = 7;
      const failureCount = 3;

      const result = createNotificationJobResult(
        'email',
        totalRecipients,
        successCount,
        failureCount
      );

      expect(result.recipientCount).toBe(totalRecipients);
      expect(result.successCount + result.failureCount).toBe(totalRecipients);
    });
  });
});
