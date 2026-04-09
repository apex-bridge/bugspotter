/**
 * Ticket Template Renderer Service
 * Renders Jira ticket description templates using Handlebars
 *
 * Supports template variables for bug report metadata, console logs,
 * network logs, session data, and custom fields.
 *
 * Example template:
 * ```
 * **Bug Report:** {{title}}
 * **URL:** {{url}}
 * **User Agent:** {{userAgent}}
 *
 * {{#if consoleLogs}}
 * **Console Logs:**
 * {{consoleLogs}}
 * {{/if}}
 *
 * {{#if networkLogs}}
 * **Network Activity:**
 * {{networkLogs}}
 * {{/if}}
 * ```
 */

import * as Handlebars from 'handlebars';
import type { TemplateDelegate as HandlebarsTemplateDelegate } from 'handlebars';
import { getLogger } from '../../logger.js';
import type { BugReport } from '../../db/types.js';
import { ConsoleLogsFormatter, type ConsoleLogEntry } from './console-logs-formatter.js';
import { NetworkLogsFormatter } from './network-logs-formatter.js';

const logger = getLogger();

/**
 * Maximum number of compiled templates to cache
 * Prevents unbounded memory growth in long-running services
 */
const MAX_TEMPLATE_CACHE_SIZE = 100;

/**
 * Maximum template length to include in error logs
 * Prevents excessive log output for large templates
 */
const MAX_TEMPLATE_LOG_LENGTH = 200;

/**
 * Valid console log levels for runtime validation
 * Using Set for O(1) lookup performance
 */
const VALID_CONSOLE_LOG_LEVELS = new Set(['error', 'warn', 'info', 'log', 'debug']);

/**
 * Template context with all available variables
 */
export interface TemplateContext {
  // Bug report core fields
  title: string;
  description: string | null;
  url: string;
  userAgent: string;
  status: string;
  createdAt: string;
  updatedAt: string;

  // Session/environment data
  browserName?: string;
  browserVersion?: string;
  osName?: string;
  osVersion?: string;
  screenResolution?: string;
  viewport?: string;

  // Formatted logs (if available)
  consoleLogs?: string;
  networkLogs?: string;

  // Replay data
  hasReplay: boolean;
  replayUrl?: string;
  replayDuration?: number;

  // Screenshot data
  hasScreenshot: boolean;
  screenshotUrl?: string;

  // Custom metadata
  customFields?: Record<string, unknown>;
}

/**
 * Service for rendering ticket description templates
 * Uses Handlebars for {{variable}} syntax and helpers
 */
export class TicketTemplateRenderer {
  private readonly handlebars: typeof Handlebars;
  private readonly consoleFormatter: ConsoleLogsFormatter;
  private readonly networkFormatter: NetworkLogsFormatter;
  private readonly templateCache: Map<string, HandlebarsTemplateDelegate>;

  constructor() {
    this.handlebars = Handlebars.create();
    this.consoleFormatter = new ConsoleLogsFormatter();
    this.networkFormatter = new NetworkLogsFormatter();
    this.templateCache = new Map();

    // Register custom helpers
    this.registerHelpers();
  }

  /**
   * Register Handlebars helpers for template rendering
   */
  private registerHelpers(): void {
    // Format dates
    this.handlebars.registerHelper('formatDate', (date: string | Date) => {
      if (!date) {
        return 'N/A';
      }
      const d = typeof date === 'string' ? new Date(date) : date;

      // Check if date is valid
      if (isNaN(d.getTime())) {
        return 'Invalid Date';
      }

      // ISO 8601 format: 2025-12-08T10:30:00.000Z
      // Universal, machine-readable, avoids locale ambiguity
      return d.toISOString();
    });

    // Format duration in milliseconds to human-readable
    this.handlebars.registerHelper('formatDuration', (ms: number) => {
      if (ms === null || ms === undefined || ms < 0 || !Number.isFinite(ms)) {
        return 'N/A';
      }
      const seconds = Math.floor(ms / 1000);
      if (seconds === 0) {
        return 'N/A';
      }
      if (seconds < 60) {
        return `${seconds}s`;
      }
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    });

    // Check if value exists and is not empty
    this.handlebars.registerHelper('exists', (value: unknown) => {
      return value !== null && value !== undefined && value !== '';
    });

    // Truncate text with ellipsis
    this.handlebars.registerHelper('truncate', (text: string, length: number) => {
      if (!text || typeof text !== 'string') {
        return '';
      }
      if (text.length <= length) {
        return text;
      }
      return text.substring(0, length) + '...';
    });
  }

  /**
   * Safely extract string value from metadata
   */
  private getStringFromMetadata(
    metadata: Record<string, unknown>,
    key: string
  ): string | undefined {
    const value = metadata?.[key];
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Safely extract number value from metadata
   */
  private getNumberFromMetadata(
    metadata: Record<string, unknown>,
    key: string
  ): number | undefined {
    const value = metadata?.[key];
    return typeof value === 'number' ? value : undefined;
  }

  /**
   * Create a type guard for validating log entries with required fields
   * @param requiredFields - Map of field names to their expected types
   * @returns Type guard function that validates entry structure
   */
  private createLogEntryValidator<T extends Record<string, unknown>>(
    requiredFields: Record<string, 'string' | 'number'>
  ): (entry: unknown) => entry is T {
    return (entry: unknown): entry is T => {
      if (typeof entry !== 'object' || entry === null) {
        return false;
      }

      const log = entry as Record<string, unknown>;
      return Object.entries(requiredFields).every(([key, type]) => typeof log[key] === type);
    };
  }

  /**
   * Type guard for console log entry
   * Uses ConsoleLogEntry interface from console-logs-formatter for consistency
   */
  private isConsoleLogEntry(entry: unknown): entry is ConsoleLogEntry {
    if (typeof entry !== 'object' || entry === null) {
      return false;
    }

    const log = entry as Record<string, unknown>;

    // Validate required fields with correct types
    if (typeof log.message !== 'string' || typeof log.timestamp !== 'number') {
      return false;
    }

    // Validate level is one of the allowed console log levels (O(1) lookup with Set)
    return typeof log.level === 'string' && VALID_CONSOLE_LOG_LEVELS.has(log.level);
  }

  /**
   * Type guard for network log entry
   */
  private readonly isNetworkLogEntry = this.createLogEntryValidator<{
    method: string;
    url: string;
    status: number;
    duration: number;
    timestamp: number;
  }>({
    method: 'string',
    url: 'string',
    status: 'number',
    duration: 'number',
    timestamp: 'number',
  });

  /**
   * Parse metadata fields with type checking
   * @param metadata - Bug report metadata object
   * @returns Parsed metadata fields with proper types
   */
  private parseMetadataFields(metadata: Record<string, unknown>) {
    return {
      browserName: this.getStringFromMetadata(metadata, 'browserName'),
      browserVersion: this.getStringFromMetadata(metadata, 'browserVersion'),
      osName: this.getStringFromMetadata(metadata, 'osName'),
      osVersion: this.getStringFromMetadata(metadata, 'osVersion'),
      screenWidth: this.getNumberFromMetadata(metadata, 'screenWidth'),
      screenHeight: this.getNumberFromMetadata(metadata, 'screenHeight'),
      viewportWidth: this.getNumberFromMetadata(metadata, 'viewportWidth'),
      viewportHeight: this.getNumberFromMetadata(metadata, 'viewportHeight'),
      url: this.getStringFromMetadata(metadata, 'url'),
      userAgent: this.getStringFromMetadata(metadata, 'userAgent'),
      replayDuration: this.getNumberFromMetadata(metadata, 'replayDuration'),
    };
  }

  /**
   * Format logs with validation and error handling
   * @param logs - Raw log data from session
   * @param formatter - Log formatter instance (must have format method returning object with content property)
   * @param validator - Type guard function for validating log entries
   * @param logType - Type name for error messages
   * @param bugReportId - Bug report ID for logging
   * @returns Formatted log string or undefined
   */
  private formatLogs<T, F extends { content: string }>(
    logs: unknown,
    formatter: { format: (logs: T[]) => F },
    validator: (entry: unknown) => entry is T,
    logType: string,
    bugReportId: string
  ): string | undefined {
    if (!Array.isArray(logs)) {
      return undefined;
    }

    try {
      // Validate and filter log entries
      const validLogs = (logs as unknown[]).filter(validator);

      if (validLogs.length === 0) {
        return undefined;
      }

      const formatted = formatter.format(validLogs);
      return formatted.content;
    } catch (error) {
      logger.warn(`Failed to format ${logType}`, {
        bugReportId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Validate that a value is a plain object (non-null, non-array object)
   * Accepts both regular objects and null-prototype objects created with Object.create(null)
   */
  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }

    const proto = Object.getPrototypeOf(value);
    // Accept objects with Object.prototype or null prototype (Object.create(null))
    return proto === Object.prototype || proto === null;
  }

  /**
   * Build template context from bug report and session data
   */
  private buildContext(
    bugReport: BugReport,
    sessionData?: Record<string, unknown>
  ): TemplateContext {
    // Extract browser/OS data from metadata with type checking
    const metadataFields = this.parseMetadataFields(bugReport.metadata);

    // Format console and network logs
    const consoleLogs = this.formatLogs(
      sessionData?.consoleLogs,
      this.consoleFormatter,
      this.isConsoleLogEntry,
      'console logs',
      bugReport.id
    );

    const networkLogs = this.formatLogs(
      sessionData?.networkLogs,
      this.networkFormatter,
      this.isNetworkLogEntry,
      'network logs',
      bugReport.id
    );

    // Validate customFields is a plain object
    const customFields = this.isPlainObject(sessionData?.customFields)
      ? sessionData.customFields
      : undefined;

    return {
      // Core fields
      title: bugReport.title,
      description: bugReport.description,
      url: metadataFields.url || '',
      userAgent: metadataFields.userAgent || '',
      status: bugReport.status,
      createdAt: bugReport.created_at.toISOString(),
      updatedAt: bugReport.updated_at.toISOString(),

      // Browser/OS
      browserName: metadataFields.browserName,
      browserVersion: metadataFields.browserVersion,
      osName: metadataFields.osName,
      osVersion: metadataFields.osVersion,
      screenResolution:
        metadataFields.screenWidth && metadataFields.screenHeight
          ? `${metadataFields.screenWidth}×${metadataFields.screenHeight}`
          : undefined,
      viewport:
        metadataFields.viewportWidth && metadataFields.viewportHeight
          ? `${metadataFields.viewportWidth}×${metadataFields.viewportHeight}`
          : undefined,

      // Formatted logs
      consoleLogs,
      networkLogs,

      // Replay
      hasReplay: !!bugReport.replay_url,
      replayUrl: bugReport.replay_url || undefined,
      replayDuration: metadataFields.replayDuration,

      // Screenshot
      hasScreenshot: !!bugReport.screenshot_url,
      screenshotUrl: bugReport.screenshot_url || undefined,

      // Custom fields (validated as plain object)
      customFields,
    };
  }

  /**
   * Render template with bug report data
   *
   * @param template - Handlebars template string with {{variable}} syntax
   * @param bugReport - Bug report to extract data from
   * @param sessionData - Optional session data (console logs, network logs, custom fields)
   * @returns Rendered template string
   *
   * @example
   * ```typescript
   * const template = `
   * **Bug:** {{title}}
   * **URL:** {{url}}
   * {{#if consoleLogs}}
   * **Console Logs:**
   * {{consoleLogs}}
   * {{/if}}
   * `;
   *
   * const rendered = renderer.render(template, bugReport, sessionData);
   * ```
   */
  render(template: string, bugReport: BugReport, sessionData?: Record<string, unknown>): string {
    try {
      logger.debug('Rendering ticket template', {
        bugReportId: bugReport.id,
        templateLength: template.length,
        hasSessionData: !!sessionData,
      });

      // Build context with all available variables
      const context = this.buildContext(bugReport, sessionData);

      // Get or compile template (with LRU caching)
      let compiledTemplate = this.templateCache.get(template);
      if (!compiledTemplate) {
        compiledTemplate = this.handlebars.compile(template);

        // Implement LRU: if cache is full, delete oldest entry
        if (this.templateCache.size >= MAX_TEMPLATE_CACHE_SIZE) {
          const firstKey = this.templateCache.keys().next().value;
          if (firstKey !== undefined) {
            this.templateCache.delete(firstKey);
          }
        }

        this.templateCache.set(template, compiledTemplate);
      } else {
        // LRU: Move to end by deleting and re-inserting
        this.templateCache.delete(template);
        this.templateCache.set(template, compiledTemplate);
      }

      // Render template
      const rendered = compiledTemplate(context);

      logger.debug('Template rendered successfully', {
        bugReportId: bugReport.id,
        renderedLength: rendered.length,
      });

      return rendered;
    } catch (error) {
      logger.error('Template rendering failed', {
        bugReportId: bugReport.id,
        error: error instanceof Error ? error.message : String(error),
        template: template.substring(0, MAX_TEMPLATE_LOG_LENGTH),
      });

      // Return fallback description on error
      return this.buildFallbackDescription(bugReport);
    }
  }

  /**
   * Build fallback description if template rendering fails
   */
  private buildFallbackDescription(bugReport: BugReport): string {
    const metadataFields = this.parseMetadataFields(bugReport.metadata);
    const url = metadataFields.url || 'N/A';
    const userAgent = metadataFields.userAgent || 'N/A';

    return `**Bug Report:** ${bugReport.title}

**URL:** ${url}
**User Agent:** ${userAgent}
**Status:** ${bugReport.status}

${bugReport.description || 'No description provided'}`;
  }

  /**
   * Validate template syntax without rendering
   *
   * Note: Handlebars compilation is lenient and only catches severe syntax errors.
   * Many issues (like {{title} missing closing brace, or {{#if}} without {{/if}})
   * will pass validation but fail at render time. Use this as a basic sanity check,
   * not comprehensive validation.
   *
   * @param template - Handlebars template string to validate
   * @returns Error message if invalid, null if valid
   */
  validateTemplate(template: string): string | null {
    try {
      this.handlebars.compile(template);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}
