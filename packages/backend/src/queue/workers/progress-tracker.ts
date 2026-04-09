/**
 * Progress Tracker
 *
 * Simplifies job progress tracking by providing a clean API for updating
 * progress through multi-step processing pipelines.
 *
 * Benefits:
 * - DRY: Eliminates repeated progress calculation logic
 * - KISS: Simple API (just call update with step number)
 * - Consistent progress reporting across all workers
 * - Automatic percentage calculation
 */

import type { IJobHandle } from '@bugspotter/message-broker';

/**
 * Tracks and updates job progress through defined steps
 *
 * Automatically calculates percentages based on current step and total steps.
 * Supports optional progress messages for better job observability.
 *
 * @example
 * ```typescript
 * const progress = new ProgressTracker(job, 4);
 *
 * await progress.update(1, 'Downloading');  // 25%
 * // ... do work ...
 * await progress.update(2, 'Processing');   // 50%
 * // ... do work ...
 * await progress.update(3, 'Uploading');    // 75%
 * // ... do work ...
 * await progress.complete('Done');          // 100%
 * ```
 */
export class ProgressTracker {
  private currentStep = 0;

  /**
   * Create a progress tracker for a job
   *
   * @param job - Job handle to track progress for
   * @param totalSteps - Total number of steps in the processing pipeline
   */
  constructor(
    private readonly job: IJobHandle,
    private readonly totalSteps: number
  ) {
    if (totalSteps <= 0) {
      throw new Error('Total steps must be greater than 0');
    }
  }

  /**
   * Update progress to a specific step
   *
   * Automatically calculates percentage: (step / totalSteps) * 100
   * Clamps result to 0-100 range for safety.
   *
   * @param step - Current step number (1-based)
   * @param message - Optional status message describing current operation
   */
  async update(step: number, message?: string): Promise<void> {
    if (step < 0 || step > this.totalSteps) {
      throw new Error(`Step ${step} out of range (1-${this.totalSteps})`);
    }

    this.currentStep = step;
    const percentage = Math.min(Math.round((step / this.totalSteps) * 100), 100);

    if (message) {
      await this.job.updateProgress({
        current: step,
        total: this.totalSteps,
        percentage,
        message,
      });
    } else {
      await this.job.updateProgress(percentage);
    }
  }

  /**
   * Mark job as complete (100%)
   *
   * @param message - Optional completion message
   */
  async complete(message?: string): Promise<void> {
    await this.update(this.totalSteps, message || 'Complete');
  }

  /**
   * Get current step number
   */
  getCurrentStep(): number {
    return this.currentStep;
  }

  /**
   * Get total steps
   */
  getTotalSteps(): number {
    return this.totalSteps;
  }

  /**
   * Get current progress percentage
   */
  getPercentage(): number {
    return Math.round((this.currentStep / this.totalSteps) * 100);
  }
}
