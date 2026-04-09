/**
 * Notification Job Domain Model
 * Represents a notification to be processed
 */

import type {
  TriggerCondition,
  NotificationChannel,
  NotificationTemplate,
  TemplateRenderContext,
} from '../../../types/notifications.js';

export interface NotificationJobInput {
  trigger: TriggerCondition;
  channel: NotificationChannel;
  template: NotificationTemplate;
  projectId: string;
  bugId: string;
  context: TemplateRenderContext;
}

export class NotificationJob {
  readonly trigger: TriggerCondition;
  readonly channel: NotificationChannel;
  readonly template: NotificationTemplate;
  readonly projectId: string;
  readonly bugId: string;
  readonly context: TemplateRenderContext;
  readonly createdAt: Date;

  constructor(input: NotificationJobInput) {
    this.trigger = input.trigger;
    this.channel = input.channel;
    this.template = input.template;
    this.projectId = input.projectId;
    this.bugId = input.bugId;
    this.context = input.context;
    this.createdAt = new Date();
  }

  get channelId(): string {
    return this.channel.id;
  }

  get templateId(): string {
    return this.template.id;
  }

  get triggerId(): string {
    // TriggerCondition doesn't have an id, use event type as identifier
    return this.trigger.event;
  }

  get channelType(): string {
    return this.channel.type;
  }

  /**
   * Creates a job identifier for deduplication
   */
  getJobKey(): string {
    return `${this.projectId}:${this.bugId}:${this.channelId}:${this.templateId}`;
  }

  /**
   * Checks if this job matches the given filter criteria
   */
  matchesFilter(filter: Partial<NotificationJobInput>): boolean {
    if (filter.projectId && filter.projectId !== this.projectId) {
      return false;
    }
    if (filter.bugId && filter.bugId !== this.bugId) {
      return false;
    }
    if (filter.channel?.id && filter.channel.id !== this.channelId) {
      return false;
    }
    return true;
  }
}
