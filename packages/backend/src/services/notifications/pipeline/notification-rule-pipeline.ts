/**
 * Notification Rule Pipeline
 * Evaluates notification rules in a clean, testable manner
 */

import type { TriggerCondition } from '../../../types/notifications.js';
import { NotificationJob } from '../models/notification-job.js';
import { DeliveryResult } from '../models/delivery-result.js';
import type { Redis } from 'ioredis';
import { getLogger } from '../../../logger.js';

const logger = getLogger();

/**
 * Pipeline step interface
 */
export interface IPipelineStep {
  readonly name: string;
  evaluate(job: NotificationJob): Promise<StepResult>;
}

export interface StepResult {
  shouldContinue: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Filter check step - validates notification conditions
 */
export class FilterCheckStep implements IPipelineStep {
  readonly name = 'FilterCheck';

  constructor(private readonly trigger: TriggerCondition) {}

  async evaluate(job: NotificationJob): Promise<StepResult> {
    // Check if trigger has filter conditions via params
    const params = this.trigger.params;
    if (!params || Object.keys(params).length === 0) {
      return { shouldContinue: true };
    }

    // Evaluate each condition parameter
    const context = job.context as Record<string, unknown>;

    for (const [key, expectedValue] of Object.entries(params)) {
      const actualValue = context[key];

      // Handle array contains check
      if (Array.isArray(expectedValue)) {
        if (!expectedValue.includes(actualValue)) {
          return {
            shouldContinue: false,
            reason: `Filter mismatch: ${key} = ${actualValue}, expected one of ${expectedValue.join(', ')}`,
          };
        }
      }
      // Handle exact match
      else if (actualValue !== expectedValue) {
        return {
          shouldContinue: false,
          reason: `Filter mismatch: ${key} = ${actualValue}, expected ${expectedValue}`,
        };
      }
    }

    return { shouldContinue: true };
  }
}

/**
 * Throttle check step - prevents notification spam
 */
export class ThrottleCheckStep implements IPipelineStep {
  readonly name = 'ThrottleCheck';
  private static readonly THROTTLE_WINDOW_SECONDS = 300; // 5 minutes
  private static readonly THROTTLE_KEY_PREFIX = 'notification:throttle:';

  constructor(private readonly redis: Redis | null) {}

  async evaluate(job: NotificationJob): Promise<StepResult> {
    if (!this.redis) {
      logger.warn('Redis not available, skipping throttle check');
      return { shouldContinue: true };
    }

    try {
      const throttleKey = this.getThrottleKey(job);
      const exists = await this.redis.get(throttleKey);

      if (exists) {
        logger.info('Notification throttled', {
          projectId: job.projectId,
          bugId: job.bugId,
          channelId: job.channelId,
        });

        return {
          shouldContinue: false,
          reason: 'Throttled - notification sent recently',
          metadata: { throttleWindowSeconds: ThrottleCheckStep.THROTTLE_WINDOW_SECONDS },
        };
      }

      // Set throttle key
      await this.redis.setex(throttleKey, ThrottleCheckStep.THROTTLE_WINDOW_SECONDS, '1');

      return { shouldContinue: true };
    } catch (error) {
      logger.error('Throttle check failed', { error });
      // Fail open - allow notification if throttle check fails
      return { shouldContinue: true };
    }
  }

  private getThrottleKey(job: NotificationJob): string {
    return `${ThrottleCheckStep.THROTTLE_KEY_PREFIX}${job.getJobKey()}`;
  }
}

/**
 * Schedule check step - determines if notification should be delayed
 */
export class ScheduleCheckStep implements IPipelineStep {
  readonly name = 'ScheduleCheck';

  constructor(private readonly trigger: TriggerCondition) {}

  async evaluate(_job: NotificationJob): Promise<StepResult> {
    // Check if trigger has schedule configuration via params
    const params = this.trigger.params;
    const delayMinutes = params?.time_window ? this.parseTimeWindow(params.time_window) : 0;

    if (!delayMinutes || delayMinutes <= 0) {
      return { shouldContinue: true };
    }

    const delayMs = delayMinutes * 60 * 1000;
    const scheduledTime = new Date(Date.now() + delayMs);

    return {
      shouldContinue: false,
      reason: `Scheduled for ${scheduledTime.toISOString()}`,
      metadata: {
        scheduledTime: scheduledTime.toISOString(),
        delayMinutes,
      },
    };
  }

  private parseTimeWindow(window: string): number {
    // Parse time window like "5m", "1h", "1d" into minutes
    const match = window.match(/^(\d+)([mhd])$/);
    if (!match) {
      return 0;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'm':
        return value;
      case 'h':
        return value * 60;
      case 'd':
        return value * 60 * 24;
      default:
        return 0;
    }
  }
}

/**
 * Notification Rule Pipeline
 * Orchestrates all pipeline steps
 */
export class NotificationRulePipeline {
  private readonly steps: IPipelineStep[];

  constructor(trigger: TriggerCondition, redis: Redis | null) {
    this.steps = [
      new FilterCheckStep(trigger),
      new ThrottleCheckStep(redis),
      new ScheduleCheckStep(trigger),
    ];
  }

  /**
   * Evaluates all pipeline steps
   * Returns the first step that blocks delivery, or null if all pass
   */
  async evaluate(job: NotificationJob): Promise<{
    shouldDeliver: boolean;
    blockedBy?: string;
    result?: DeliveryResult;
  }> {
    for (const step of this.steps) {
      const result = await step.evaluate(job);

      if (!result.shouldContinue) {
        logger.info(`Notification blocked by ${step.name}`, {
          projectId: job.projectId,
          bugId: job.bugId,
          reason: result.reason,
        });

        // Determine delivery result type
        let deliveryResult: DeliveryResult;

        if (step.name === 'ThrottleCheck') {
          deliveryResult = DeliveryResult.throttled(
            job.channelId,
            job.triggerId,
            job.projectId,
            job.bugId,
            result.metadata
          );
        } else if (step.name === 'ScheduleCheck' && result.metadata?.scheduledTime) {
          deliveryResult = DeliveryResult.scheduled(
            job.channelId,
            job.triggerId,
            job.projectId,
            job.bugId,
            new Date(result.metadata.scheduledTime as string),
            result.metadata
          );
        } else {
          deliveryResult = DeliveryResult.skipped(
            job.channelId,
            job.triggerId,
            job.projectId,
            job.bugId,
            result.reason || 'Blocked by pipeline',
            result.metadata
          );
        }

        return {
          shouldDeliver: false,
          blockedBy: step.name,
          result: deliveryResult,
        };
      }
    }

    return { shouldDeliver: true };
  }

  /**
   * Gets all configured steps
   */
  getSteps(): readonly IPipelineStep[] {
    return this.steps;
  }
}
