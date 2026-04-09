/**
 * Progress Tracker Tests
 * Unit tests for job progress tracking functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProgressTracker } from '../../src/queue/workers/progress-tracker.js';
import type { IJobHandle } from '@bugspotter/message-broker';

describe('ProgressTracker', () => {
  let mockJob: IJobHandle;
  let updateProgressSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateProgressSpy = vi.fn().mockResolvedValue(undefined);
    mockJob = {
      updateProgress: updateProgressSpy,
      id: 'test-job-123',
      name: 'test-job',
      data: {},
      attemptsMade: 0,
      log: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('Constructor', () => {
    it('should create a progress tracker with valid total steps', () => {
      const tracker = new ProgressTracker(mockJob, 4);
      expect(tracker.getTotalSteps()).toBe(4);
      expect(tracker.getCurrentStep()).toBe(0);
    });

    it('should throw error if total steps is zero', () => {
      expect(() => new ProgressTracker(mockJob, 0)).toThrow('Total steps must be greater than 0');
    });

    it('should throw error if total steps is negative', () => {
      expect(() => new ProgressTracker(mockJob, -5)).toThrow('Total steps must be greater than 0');
    });
  });

  describe('update()', () => {
    it('should update progress with step and percentage', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      await tracker.update(2, 'Processing');

      expect(updateProgressSpy).toHaveBeenCalledWith({
        current: 2,
        total: 4,
        percentage: 50,
        message: 'Processing',
      });
      expect(tracker.getCurrentStep()).toBe(2);
    });

    it('should calculate correct percentages', async () => {
      const tracker = new ProgressTracker(mockJob, 4);

      await tracker.update(1, 'Step 1');
      expect(updateProgressSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ percentage: 25 })
      );

      await tracker.update(2, 'Step 2');
      expect(updateProgressSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ percentage: 50 })
      );

      await tracker.update(3, 'Step 3');
      expect(updateProgressSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ percentage: 75 })
      );

      await tracker.update(4, 'Step 4');
      expect(updateProgressSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ percentage: 100 })
      );
    });

    it('should update progress without message', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      await tracker.update(2);

      expect(updateProgressSpy).toHaveBeenCalledWith(50);
      expect(tracker.getCurrentStep()).toBe(2);
    });

    it('should handle rounding for non-divisible steps', async () => {
      const tracker = new ProgressTracker(mockJob, 3);

      await tracker.update(1, 'Step 1');
      expect(updateProgressSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ percentage: 33 })
      );

      await tracker.update(2, 'Step 2');
      expect(updateProgressSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ percentage: 67 })
      );
    });

    it('should clamp percentage to 100', async () => {
      const tracker = new ProgressTracker(mockJob, 1);
      await tracker.update(1, 'Complete');

      expect(updateProgressSpy).toHaveBeenCalledWith(expect.objectContaining({ percentage: 100 }));
    });

    it('should throw error for step out of range (negative)', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      await expect(tracker.update(-1, 'Invalid')).rejects.toThrow('Step -1 out of range (1-4)');
    });

    it('should throw error for step out of range (too high)', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      await expect(tracker.update(5, 'Invalid')).rejects.toThrow('Step 5 out of range (1-4)');
    });

    it('should allow updating to step 0', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      await tracker.update(0, 'Reset');

      expect(updateProgressSpy).toHaveBeenCalledWith({
        current: 0,
        total: 4,
        percentage: 0,
        message: 'Reset',
      });
    });
  });

  describe('complete()', () => {
    it('should mark job as complete with default message', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      await tracker.complete();

      expect(updateProgressSpy).toHaveBeenCalledWith({
        current: 4,
        total: 4,
        percentage: 100,
        message: 'Complete',
      });
      expect(tracker.getCurrentStep()).toBe(4);
    });

    it('should mark job as complete with custom message', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      await tracker.complete('All done!');

      expect(updateProgressSpy).toHaveBeenCalledWith({
        current: 4,
        total: 4,
        percentage: 100,
        message: 'All done!',
      });
    });
  });

  describe('Getters', () => {
    it('should return current step', async () => {
      const tracker = new ProgressTracker(mockJob, 5);
      expect(tracker.getCurrentStep()).toBe(0);

      await tracker.update(3);
      expect(tracker.getCurrentStep()).toBe(3);
    });

    it('should return total steps', () => {
      const tracker = new ProgressTracker(mockJob, 7);
      expect(tracker.getTotalSteps()).toBe(7);
    });

    it('should return current percentage', async () => {
      const tracker = new ProgressTracker(mockJob, 4);
      expect(tracker.getPercentage()).toBe(0);

      await tracker.update(2);
      expect(tracker.getPercentage()).toBe(50);

      await tracker.complete();
      expect(tracker.getPercentage()).toBe(100);
    });
  });

  describe('Multiple updates', () => {
    it('should handle multiple sequential updates', async () => {
      const tracker = new ProgressTracker(mockJob, 4);

      await tracker.update(1, 'Download');
      await tracker.update(2, 'Process');
      await tracker.update(3, 'Upload');
      await tracker.complete('Done');

      expect(updateProgressSpy).toHaveBeenCalledTimes(4);
      expect(tracker.getCurrentStep()).toBe(4);
      expect(tracker.getPercentage()).toBe(100);
    });

    it('should allow updating to previous step', async () => {
      const tracker = new ProgressTracker(mockJob, 4);

      await tracker.update(3, 'Step 3');
      expect(tracker.getCurrentStep()).toBe(3);

      await tracker.update(2, 'Back to step 2');
      expect(tracker.getCurrentStep()).toBe(2);
      expect(tracker.getPercentage()).toBe(50);
    });
  });

  describe('Edge cases', () => {
    it('should handle single step pipeline', async () => {
      const tracker = new ProgressTracker(mockJob, 1);
      await tracker.update(1, 'Only step');

      expect(updateProgressSpy).toHaveBeenCalledWith({
        current: 1,
        total: 1,
        percentage: 100,
        message: 'Only step',
      });
    });

    it('should handle large number of steps', async () => {
      const tracker = new ProgressTracker(mockJob, 100);
      await tracker.update(50, 'Halfway');

      expect(updateProgressSpy).toHaveBeenCalledWith({
        current: 50,
        total: 100,
        percentage: 50,
        message: 'Halfway',
      });
    });

    it('should handle job progress update failures gracefully', async () => {
      updateProgressSpy.mockRejectedValueOnce(new Error('Update failed'));
      const tracker = new ProgressTracker(mockJob, 4);

      await expect(tracker.update(2, 'Test')).rejects.toThrow('Update failed');
    });
  });
});
