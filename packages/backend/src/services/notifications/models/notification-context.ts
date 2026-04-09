/**
 * Notification Context Domain Model
 * Encapsulates all data needed for template rendering
 */

import type { TemplateRenderContext } from '../../../types/notifications.js';

export interface NotificationContextData {
  bugReport: {
    id: string;
    title: string;
    description: string;
    message: string;
    status: string;
    priority: string;
    severity?: string;
    url?: string;
    browser?: string;
    os?: string;
    user?: {
      email?: string;
      name?: string;
    };
    stack_trace?: string;
    session_id?: string;
    [key: string]: unknown;
  };
  project: {
    id: string;
    name: string;
    [key: string]: unknown;
  };
  adminUrl: string;
  metadata?: Record<string, unknown>;
}

export class NotificationContext {
  readonly bugReport: NotificationContextData['bugReport'];
  readonly project: NotificationContextData['project'];
  readonly adminUrl: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;

  constructor(data: NotificationContextData) {
    this.bugReport = data.bugReport;
    this.project = data.project;
    this.adminUrl = data.adminUrl;
    this.metadata = data.metadata || {};
    this.timestamp = new Date();
  }

  /**
   * Converts context to TemplateRenderContext for template rendering
   * Maps domain model to template structure expected by renderTemplate()
   */
  toTemplateData(): TemplateRenderContext {
    const priorityColors: Record<string, string> = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#28a745',
      default: '#6c757d',
    };

    return {
      bug: {
        id: this.bugReport.id,
        title: this.bugReport.title,
        message: this.bugReport.message || this.bugReport.description,
        priority: this.bugReport.priority,
        priorityColor: priorityColors[this.bugReport.priority] || priorityColors.default,
        status: this.bugReport.status,
        browser: this.bugReport.browser || 'Unknown',
        os: this.bugReport.os || 'Unknown',
        url: this.bugReport.url || '',
        user: this.bugReport.user || {},
        stack_trace: this.bugReport.stack_trace,
      },
      project: {
        id: this.project.id,
        name: this.project.name,
      },
      link: {
        bugDetail: `${this.adminUrl}/bugs/${this.bugReport.id}`,
        replay: this.bugReport.session_id
          ? `${this.adminUrl}/replay/${this.bugReport.session_id}`
          : undefined,
      },
      timestamp: this.timestamp.toISOString(),
      timezone: 'UTC',
    };
  }

  /**
   * Gets a specific metadata value
   */
  getMetadata<T = unknown>(key: string, defaultValue?: T): T | undefined {
    return (this.metadata[key] as T) ?? defaultValue;
  }

  /**
   * Creates a summary string for logging
   */
  getSummary(): string {
    return `Bug ${this.bugReport.id} in project ${this.project.name}`;
  }
}
