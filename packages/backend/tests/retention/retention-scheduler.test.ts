/**
 * Unit tests for RetentionScheduler
 * Tests cron scheduling, job execution, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock node-cron before importing
const mockSchedule = vi.fn();
const mockTask = {
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule,
  },
}));

// Mock RetentionService
const mockRetentionService = {
  applyRetentionPolicies: vi.fn().mockResolvedValue({
    totalDeleted: 10,
    totalArchived: 5,
    storageFreed: 1024000,
    screenshotsDeleted: 8,
    replaysDeleted: 7,
    projectsProcessed: 2,
    errors: [],
    durationMs: 1000,
    startedAt: new Date(),
    completedAt: new Date(),
  }),
};

// Import after mocks are set up
let RetentionScheduler: any;

describe('RetentionScheduler', () => {
  let scheduler: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSchedule.mockReturnValue(mockTask);

    // Dynamically import after mocks
    const module = await import('../../src/retention/retention-scheduler.js');
    RetentionScheduler = module.RetentionScheduler;

    scheduler = new RetentionScheduler(mockRetentionService as any);
  });

  afterEach(() => {
    if (scheduler) {
      scheduler.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with retention service', () => {
      expect(scheduler).toBeDefined();
    });
  });

  describe('start()', () => {
    it('should start scheduler with cron configuration', () => {
      scheduler.start();

      expect(mockSchedule).toHaveBeenCalledWith(
        expect.any(String), // cron schedule
        expect.any(Function), // callback
        expect.objectContaining({
          scheduled: true,
          timezone: expect.any(String),
        })
      );
    });

    it('should not start if already started', () => {
      scheduler.start();
      const firstCallCount = mockSchedule.mock.calls.length;

      scheduler.start(); // Try to start again

      // Should not call schedule again
      expect(mockSchedule).toHaveBeenCalledTimes(firstCallCount);
    });
  });

  describe('stop()', () => {
    it('should stop running scheduler', () => {
      scheduler.start();
      scheduler.stop();

      expect(mockTask.stop).toHaveBeenCalled();
    });

    it('should handle stop when not running', () => {
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('triggerManual()', () => {
    it('should manually trigger retention job', async () => {
      const result = await scheduler.triggerManual();

      expect(result).toBe(true);
      expect(mockRetentionService.applyRetentionPolicies).toHaveBeenCalledWith(
        expect.objectContaining({
          dryRun: false,
          batchSize: 100,
          maxErrorRate: 5,
          delayMs: 100,
        })
      );
    });

    it('should return false if job is already running', async () => {
      // Start a job
      const firstPromise = scheduler.triggerManual();

      // Try to start another before first completes
      const result = await scheduler.triggerManual();

      await firstPromise; // Clean up

      expect(result).toBe(false);
    });
  });

  describe('isJobRunning()', () => {
    it('should return false when not running', () => {
      expect(scheduler.isJobRunning()).toBe(false);
    });

    it('should return true when job is running', async () => {
      // Make the job take some time
      mockRetentionService.applyRetentionPolicies.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  totalDeleted: 1,
                  totalArchived: 0,
                  storageFreed: 0,
                  screenshotsDeleted: 0,
                  replaysDeleted: 0,
                  projectsProcessed: 1,
                  errors: [],
                  durationMs: 100,
                  startedAt: new Date(),
                  completedAt: new Date(),
                }),
              50
            )
          )
      );

      const promise = scheduler.triggerManual();

      // Check while running
      expect(scheduler.isJobRunning()).toBe(true);

      await promise; // Wait for completion

      // Should be false after completion
      expect(scheduler.isJobRunning()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle retention service errors gracefully', async () => {
      mockRetentionService.applyRetentionPolicies.mockRejectedValueOnce(
        new Error('Database connection lost')
      );

      // Should not throw
      await expect(scheduler.triggerManual()).resolves.toBe(true);

      // Job should complete despite error
      expect(scheduler.isJobRunning()).toBe(false);
    });

    it('should continue after error and allow next execution', async () => {
      // First call fails
      mockRetentionService.applyRetentionPolicies.mockRejectedValueOnce(
        new Error('Temporary error')
      );

      await scheduler.triggerManual();

      // Second call should succeed
      mockRetentionService.applyRetentionPolicies.mockResolvedValueOnce({
        totalDeleted: 5,
        totalArchived: 0,
        storageFreed: 0,
        screenshotsDeleted: 5,
        replaysDeleted: 0,
        projectsProcessed: 1,
        errors: [],
        durationMs: 500,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      const result = await scheduler.triggerManual();

      expect(result).toBe(true);
      expect(mockRetentionService.applyRetentionPolicies).toHaveBeenCalledTimes(2);
    });
  });

  describe('Integration', () => {
    it('should call retention service with correct options', async () => {
      await scheduler.triggerManual();

      expect(mockRetentionService.applyRetentionPolicies).toHaveBeenCalledWith({
        dryRun: false,
        batchSize: 100,
        maxErrorRate: 5,
        delayMs: 100,
      });
    });

    it('should complete full job lifecycle', async () => {
      scheduler.start();
      const result = await scheduler.triggerManual();
      scheduler.stop();

      expect(result).toBe(true);
      expect(mockSchedule).toHaveBeenCalled();
      expect(mockTask.stop).toHaveBeenCalled();
    });
  });

  describe('getNextRunTime()', () => {
    it('should return null when scheduler is not started', () => {
      const nextRun = scheduler.getNextRunTime();
      expect(nextRun).toBeNull();
    });

    it('should calculate next run time after scheduler is started', () => {
      scheduler.start();
      const nextRun = scheduler.getNextRunTime();

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should return null after scheduler is stopped', () => {
      scheduler.start();
      expect(scheduler.getNextRunTime()).toBeInstanceOf(Date);

      scheduler.stop();
      expect(scheduler.getNextRunTime()).toBeNull();
    });

    it('should calculate correct next run time for daily 2am schedule', () => {
      scheduler.start();
      const nextRun = scheduler.getNextRunTime();

      expect(nextRun).toBeInstanceOf(Date);
      // Should be 2am UTC
      expect(nextRun!.getUTCHours()).toBe(2);
      expect(nextRun!.getUTCMinutes()).toBe(0);
    });

    it('should handle multiple calls correctly', () => {
      scheduler.start();

      const firstCall = scheduler.getNextRunTime();
      const secondCall = scheduler.getNextRunTime();

      // Both calls should return valid dates
      expect(firstCall).toBeInstanceOf(Date);
      expect(secondCall).toBeInstanceOf(Date);

      // Should be the same time (no side effects)
      expect(firstCall!.getTime()).toBe(secondCall!.getTime());
    });

    it('should return date in the future', () => {
      scheduler.start();
      const nextRun = scheduler.getNextRunTime();
      const now = new Date();

      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun!.getTime()).toBeGreaterThan(now.getTime());

      // Should be within 24 hours (for daily schedule)
      const hoursDiff = (nextRun!.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(hoursDiff).toBeLessThan(24);
      expect(hoursDiff).toBeGreaterThan(0);
    });
  });
});
