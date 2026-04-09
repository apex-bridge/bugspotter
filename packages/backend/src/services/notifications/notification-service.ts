/**
 * Notification Service
 * Core orchestrator for processing and delivering notifications
 * Refactored to use domain models and dedicated services
 */

import type { DatabaseClient } from '../../db/client.js';
import type { QueueManager } from '../../queue/queue-manager.js';
import type { Redis } from 'ioredis';
import { RuleMatcher } from '../rule-matcher.js';
import { ChannelHandlerRegistry } from './handlers/channel-handler-registry.js';
import { NotificationJob } from './models/notification-job.js';
import { NotificationContext } from './models/notification-context.js';
import { DeliveryResult } from './models/delivery-result.js';
import { NotificationRulePipeline } from './pipeline/notification-rule-pipeline.js';
import { NotificationDeliveryService } from './pipeline/notification-delivery-service.js';
import { NotificationHistoryService } from './pipeline/notification-history-service.js';
import type {
  TriggerEvent,
  FilterCondition,
  TriggerCondition,
  NotificationJob as NotificationJobData,
  ChannelConfig,
} from '../../types/notifications.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

const NOTIFICATION_RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BACKOFF_DELAY_MS: 2000,
} as const;

// Filter operators and field mapping moved to RuleMatcher service
// for code reuse with integrations

// ============================================================================
// NOTIFICATION SERVICE
// ============================================================================

export class NotificationService {
  private readonly handlerRegistry: ChannelHandlerRegistry;
  private readonly deliveryService: NotificationDeliveryService;
  private readonly historyService: NotificationHistoryService;

  constructor(
    private readonly db: DatabaseClient,
    private readonly redis: Redis | null = null,
    private readonly queueManager?: QueueManager
  ) {
    logger.info('🔔 [NotificationService] Initializing orchestrator', {
      hasRedis: !!redis,
      hasQueue: !!queueManager,
      handlers: 5,
    });

    // Initialize services with dependency injection
    this.handlerRegistry = new ChannelHandlerRegistry();
    this.deliveryService = new NotificationDeliveryService(this.handlerRegistry.getAllHandlers());
    this.historyService = new NotificationHistoryService(db.getPool());
  }

  /**
   * Process a new bug report and queue notifications
   */
  async processNewBug(
    bug: Record<string, unknown>,
    project: Record<string, unknown>
  ): Promise<void> {
    // Validate required fields
    if (!bug.id || typeof bug.id !== 'string') {
      throw new Error('Bug ID is required');
    }
    if (!project.id || typeof project.id !== 'string') {
      throw new Error('Project ID is required');
    }

    await this.processTrigger('new_bug', { bug, project });
  }

  /**
   * Process a trigger event and queue matching notifications
   * Orchestrates rule matching and queueing/immediate delivery
   */
  async processTrigger(
    event: TriggerEvent,
    context: { bug?: Record<string, unknown>; project: Record<string, unknown> }
  ): Promise<void> {
    try {
      // Get all enabled rules that match this trigger
      const allRules = await this.db.notificationRules.findAllWithChannels({ enabled: true });
      const matchingRules = allRules.filter((rule) => {
        return rule.triggers.some((trigger) => this.matchesTrigger(trigger, event, context));
      });

      logger.info('Processing trigger', {
        event,
        totalRules: allRules.length,
        matchingRules: matchingRules.length,
      });

      for (const rule of matchingRules) {
        // Check if context matches rule filters (simple pre-check)
        if (rule.filters && rule.filters.length > 0) {
          if (!context.bug) {
            logger.debug('Rule has filters but bug context missing', {
              ruleId: rule.id,
              ruleName: rule.name,
            });
            continue;
          }
          if (!this.matchesFilters(context.bug, rule.filters)) {
            logger.debug('Bug does not match rule filters', {
              ruleId: rule.id,
              ruleName: rule.name,
            });
            continue;
          }
        }

        // Queue or send notification
        if (this.queueManager) {
          await this.queueManager.addJob(
            'notifications',
            `notification-${rule.id}-${Date.now()}`,
            {
              rule_id: rule.id,
              bug_id: context.bug?.id as string,
              channel_ids: rule.channels,
              trigger_event: event,
              timestamp: new Date(),
            } as NotificationJobData,
            {
              priority: rule.priority,
              attempts: NOTIFICATION_RETRY_CONFIG.MAX_ATTEMPTS,
              backoff: {
                type: 'exponential',
                delay: NOTIFICATION_RETRY_CONFIG.BACKOFF_DELAY_MS,
              },
            }
          );
          logger.info('Notification queued', { ruleId: rule.id, channels: rule.channels.length });
        } else {
          // Send immediately if no queue
          const bugId = context.bug?.id;
          await this.sendNotification({
            rule_id: rule.id,
            bug_id: typeof bugId === 'string' ? bugId : undefined,
            channel_ids: rule.channels,
            trigger_event: event,
            timestamp: new Date(),
          });
        }
      }
    } catch (error) {
      logger.error('Failed to process trigger', { event, error });
      throw error;
    }
  }

  /**
   * Send notification for a job (called by worker or immediately)
   * REFACTORED: Uses pipeline services for clean separation of concerns
   */
  async sendNotification(jobData: NotificationJobData): Promise<void> {
    try {
      // Fetch required data
      const { rule, bug, project, triggers } = await this.fetchNotificationData(jobData);
      if (!rule || !bug || !project) {
        return; // Error already logged
      }

      // Fetch channels and templates in batch
      const channelIds = jobData.channel_ids;
      if (channelIds.length === 0) {
        logger.warn('No channels specified in notification job', { ruleId: jobData.rule_id });
        return;
      }

      const channelMap = await this.db.notificationChannels.findByIds(channelIds);
      const channelTypes = [
        ...new Set([...channelMap.values()].filter((c) => c.active).map((c) => c.type)),
      ];
      const templateMap = await this.db.notificationTemplates.findActiveTemplatesByChannelTypes(
        channelTypes,
        jobData.trigger_event
      );

      // Create notification context from fetched data
      const notificationContext = new NotificationContext({
        bugReport: {
          id: bug.id,
          title: (bug.title as string) || 'Untitled',
          description: (bug.description as string) || '',
          message: (bug.error_message as string) || (bug.description as string) || '',
          status: (bug.status as string) || 'open',
          priority: (bug.severity as string) || 'medium',
          severity: bug.severity as string | undefined,
          url: bug.url as string | undefined,
          browser: bug.browser as string | undefined,
          os: bug.operating_system as string | undefined,
          user: bug.user_email
            ? { email: bug.user_email as string, name: bug.user_name as string | undefined }
            : undefined,
          stack_trace: bug.stack_trace as string | undefined,
          session_id: bug.session_id as string | undefined,
        },
        project: {
          id: project.id,
          name: project.name,
        },
        adminUrl: process.env.ADMIN_URL || 'http://localhost:3001',
        metadata: {
          ruleId: rule.id,
          ruleName: rule.name,
        },
      });

      // Process each channel
      const deliveryResults: DeliveryResult[] = [];

      for (const channelId of channelIds) {
        const channel = channelMap.get(channelId);
        if (!channel || !channel.active) {
          logger.warn('Channel not found or inactive', { channelId });
          continue;
        }

        const template = templateMap.get(channel.type);
        if (!template) {
          logger.warn('No active template for channel type', {
            channelId,
            channelType: channel.type,
            triggerEvent: jobData.trigger_event,
          });
          continue;
        }

        // Find trigger with full configuration
        const trigger = triggers.find((t) => t.event === jobData.trigger_event);
        if (!trigger) {
          logger.warn('Trigger not found in rule', {
            ruleId: rule.id,
            triggerEvent: jobData.trigger_event,
          });
          continue;
        }

        // Create notification job domain model
        const job = new NotificationJob({
          trigger,
          channel,
          template,
          projectId: project.id,
          bugId: bug.id,
          context: notificationContext.toTemplateData(),
        });

        // Evaluate pipeline rules (filter, throttle, schedule)
        const pipeline = new NotificationRulePipeline(trigger, this.redis);
        const evaluation = await pipeline.evaluate(job);

        if (!evaluation.shouldDeliver) {
          logger.info('Notification blocked by pipeline', {
            blockedBy: evaluation.blockedBy,
            channelId: job.channelId,
            projectId: job.projectId,
          });

          // Record blocked delivery in history
          if (evaluation.result) {
            await this.historyService.recordDelivery(evaluation.result);
            deliveryResults.push(evaluation.result);
          }
          continue;
        }

        // Deliver notification
        try {
          const result = await this.deliveryService.deliver(job, notificationContext);
          await this.historyService.recordDelivery(result);
          deliveryResults.push(result);

          // Update channel health on success/failure
          if (result.isSuccess()) {
            await this.db.notificationChannels.updateHealth(channelId, true);
          } else if (result.isFailure()) {
            await this.db.notificationChannels.updateHealth(channelId, false);
          }
        } catch (deliveryError) {
          logger.error('Unexpected delivery error', {
            channelId: job.channelId,
            error: deliveryError,
          });

          const failureResult = DeliveryResult.failure(
            job.channelId,
            job.triggerId,
            job.projectId,
            job.bugId,
            deliveryError instanceof Error ? deliveryError : 'Unknown error',
            false
          );
          await this.historyService.recordDelivery(failureResult);
          deliveryResults.push(failureResult);
        }
      }

      logger.info('Notification job completed', {
        ruleId: rule.id,
        bugId: bug.id,
        totalChannels: channelIds.length,
        successCount: deliveryResults.filter((r) => r.isSuccess()).length,
        failureCount: deliveryResults.filter((r) => r.isFailure()).length,
        skippedCount: deliveryResults.filter((r) => r.status === 'skipped').length,
      });
    } catch (error) {
      logger.error('Failed to send notification', { job: jobData, error });
      throw error;
    }
  }

  /**
   * Fetch and validate data required for notification
   */
  private async fetchNotificationData(job: NotificationJobData): Promise<{
    rule: { id: string; name: string; [key: string]: unknown } | null;
    bug: { id: string; project_id: string; [key: string]: unknown } | null;
    project: { id: string; name: string; [key: string]: unknown } | null;
    triggers: TriggerCondition[];
  }> {
    if (!job.bug_id) {
      logger.error('Bug ID missing in job', { ruleId: job.rule_id });
      return { rule: null, bug: null, project: null, triggers: [] };
    }

    const [rule, bug] = await Promise.all([
      this.db.notificationRules.findByIdWithChannels(job.rule_id),
      this.db.bugReports.findById(job.bug_id),
    ]);

    if (!rule) {
      logger.error('Rule not found', { ruleId: job.rule_id });
      return { rule: null, bug: null, project: null, triggers: [] };
    }

    if (!bug) {
      logger.error('Bug not found', { bugId: job.bug_id });
      return { rule: null, bug: null, project: null, triggers: [] };
    }

    const project = await this.db.projects.findById(bug.project_id);
    if (!project) {
      logger.error('Project not found', { projectId: bug.project_id });
      return { rule: null, bug: null, project: null, triggers: [] };
    }

    return {
      rule: rule as unknown as { id: string; name: string; [key: string]: unknown },
      bug: bug as unknown as { id: string; project_id: string; [key: string]: unknown },
      project: project as unknown as { id: string; name: string; [key: string]: unknown },
      triggers: (rule.triggers || []) as TriggerCondition[],
    };
  }

  /**
   * Test a channel configuration
   * Uses delivery service for consistent testing
   */
  async testChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const channel = await this.db.notificationChannels.findById(channelId);
      if (!channel) {
        return { success: false, error: 'Channel not found' };
      }

      const result = await this.deliveryService.testChannel(
        channel.type,
        { id: channel.id, config: channel.config as unknown as ChannelConfig },
        'Test notification from BugSpotter'
      );

      return {
        success: result.isSuccess(),
        error: result.error || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check if bug matches rule filters
   * Delegates to shared RuleMatcher service
   */
  private matchesFilters(bug: Record<string, unknown>, filters: FilterCondition[]): boolean {
    return RuleMatcher.matchesFilters(bug, filters);
  }

  /**
   * Check if trigger matches event and parameters
   */
  private matchesTrigger(
    trigger: { event: TriggerEvent; params?: Record<string, unknown> },
    event: TriggerEvent,
    context: { bug?: Record<string, unknown>; project: Record<string, unknown> }
  ): boolean {
    // Event must match
    if (trigger.event !== event) {
      return false;
    }

    // If no params specified, trigger matches
    if (!trigger.params) {
      return true;
    }

    // Check trigger-specific parameters
    const bug = context.bug;
    if (!bug && trigger.params) {
      // Trigger has params but no bug context to check against
      return false;
    }

    // Check priority parameter
    if (trigger.params.priority && bug) {
      const bugPriority = bug.priority as string | undefined;
      if (bugPriority !== trigger.params.priority) {
        return false;
      }
    }

    // Check priority change parameters (for priority_change event)
    if (event === 'priority_change' && bug) {
      if (trigger.params.from_priority || trigger.params.to_priority) {
        const currentPriority = bug.priority as string | undefined;
        const previousPriority = bug.previous_priority as string | undefined;

        if (trigger.params.from_priority && previousPriority !== trigger.params.from_priority) {
          return false;
        }
        if (trigger.params.to_priority && currentPriority !== trigger.params.to_priority) {
          return false;
        }
      }
    }

    // Additional params (threshold, time_window, spike_multiplier) would need
    // more complex logic with historical data - can be implemented when needed

    return true;
  }

  // matchesFilter, normalizeFilterValue, and getFieldValue removed
  // All filter logic now handled by RuleMatcher service
  // Throttle, schedule, and history logic now handled by pipeline services
}
