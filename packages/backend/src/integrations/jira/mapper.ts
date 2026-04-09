/**
 * Jira Bug Report Mapper
 * Converts BugReport to Jira issue format
 */

import type { BugReport } from '../../db/types.js';
import type {
  JiraConfig,
  JiraIssueFields,
  JiraPriority,
  JiraDescription,
  JiraDescriptionNode,
  JiraTemplateConfig,
} from './types.js';
import { SHARE_TOKEN_EXPIRATION_HOURS } from './types.js';
import { ADFFormatter, PlainTextFormatter } from './formatters/index.js';
import type { ConsoleLogEntry, NetworkLogEntry } from './formatters/index.js';
import { isConsoleLogEntry, isNetworkLogEntry } from './formatters/index.js';
import { getLogger } from '../../logger.js';
import { renderCustomTemplate } from './template-renderer.js';
import { markdownToADFWithTables } from './markdown-to-adf.js';
import { applyFieldMappings } from './field-mappings.js';

const logger = getLogger();

/**
 * Add spacing between sections
 */
function addSpacing(content: JiraDescriptionNode[]): void {
  content.push({
    type: 'paragraph',
    content: [],
  });
}

/**
 * Default template configuration
 * Console/network logs disabled by default to avoid CONTENT_LIMIT_EXCEEDED errors
 * All data is available via the shared replay link
 */
const DEFAULT_TEMPLATE_CONFIG: Required<JiraTemplateConfig> = {
  includeConsoleLogs: false, // Available in shared replay
  consoleLogLimit: 10, // Reduced limit if enabled
  includeNetworkLogs: false, // Available in shared replay
  networkLogFilter: 'failures',
  networkLogLimit: 10, // Reduced limit if enabled
  includeShareReplay: true,
  shareReplayExpiration: SHARE_TOKEN_EXPIRATION_HOURS,
  shareReplayPassword: null,
};

/**
 * Map BugSpotter priority to Jira priority
 */
function mapPriorityToJira(priority?: string): JiraPriority {
  const priorityMap: Record<string, JiraPriority> = {
    critical: 'Highest',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    minor: 'Lowest',
  };

  return priorityMap[priority?.toLowerCase() || 'medium'] || 'Medium';
}

/**
 * Format console logs for Jira description
 */
function formatConsoleLogs(
  metadata: Record<string, unknown>,
  config: Required<JiraTemplateConfig>
): { entries: ConsoleLogEntry[]; errorCount: number; warningCount: number } {
  const consoleData = metadata?.console;

  if (!Array.isArray(consoleData)) {
    return { entries: [], errorCount: 0, warningCount: 0 };
  }

  const consoleLogs = consoleData.filter(isConsoleLogEntry);

  if (!consoleLogs.length) {
    return { entries: [], errorCount: 0, warningCount: 0 };
  }

  const errorCount = consoleLogs.filter((log) => log.level === 'error').length;
  const warningCount = consoleLogs.filter((log) => log.level === 'warn').length;
  const entries = consoleLogs.slice(-config.consoleLogLimit);

  return { entries, errorCount, warningCount };
}

/**
 * Format network logs for Jira description
 */
function formatNetworkLogs(
  metadata: Record<string, unknown>,
  config: Required<JiraTemplateConfig>
): NetworkLogEntry[] {
  const networkData = metadata?.network;

  if (!Array.isArray(networkData)) {
    return [];
  }

  const networkLogs = networkData.filter(isNetworkLogEntry);

  if (!networkLogs.length) {
    return [];
  }

  let filtered = networkLogs;
  if (config.networkLogFilter === 'failures') {
    filtered = networkLogs.filter((log) => log.status && log.status >= 400);
  }

  return filtered.slice(-config.networkLogLimit);
}

/**
 * Create Jira Atlassian Document Format (ADF) description
 * Used in newer Jira Cloud instances for rich text
 */
function createADFDescription(
  bugReport: BugReport,
  config: Required<JiraTemplateConfig>,
  shareReplayUrl?: string
): JiraDescription {
  const sections: JiraDescriptionNode[][] = [];
  const formatter = new ADFFormatter();

  if (bugReport.description) {
    sections.push(formatter.addDescription(bugReport.description) as JiraDescriptionNode[]);
  }

  if (config.includeConsoleLogs && bugReport.metadata) {
    const { entries, errorCount, warningCount } = formatConsoleLogs(bugReport.metadata, config);
    const consoleContent = formatter.formatConsoleLogs(
      entries,
      errorCount,
      warningCount
    ) as JiraDescriptionNode[];
    if (consoleContent.length > 0) {
      sections.push(consoleContent);
    }
  }

  if (config.includeNetworkLogs && bugReport.metadata) {
    const networkEntries = formatNetworkLogs(bugReport.metadata, config);
    const networkContent = formatter.formatNetworkLogs(networkEntries) as JiraDescriptionNode[];
    if (networkContent.length > 0) {
      sections.push(networkContent);
    }
  }

  sections.push(formatter.formatBugReportDetails(bugReport) as JiraDescriptionNode[]);

  const effectiveShareUrl = config.includeShareReplay ? shareReplayUrl : undefined;
  const attachments = formatter.formatAttachments(
    bugReport,
    effectiveShareUrl
  ) as JiraDescriptionNode[];
  if (attachments.length > 0) {
    sections.push(attachments);
  }

  sections.push(formatter.addFooter() as JiraDescriptionNode[]);

  // Orchestrator owns spacing: add spacing between all sections
  const content: JiraDescriptionNode[] = [];
  sections.forEach((section, index) => {
    content.push(...section);
    if (index < sections.length - 1) {
      addSpacing(content);
    }
  });

  return {
    type: 'doc',
    version: 1,
    content,
  };
}

/**
 * Create plain text description (fallback for older Jira versions)
 */
function createPlainTextDescription(
  bugReport: BugReport,
  config: Required<JiraTemplateConfig>,
  shareReplayUrl?: string
): string {
  const parts: string[] = [];
  const formatter = new PlainTextFormatter();

  if (bugReport.description) {
    parts.push(formatter.addDescription(bugReport.description) as string);
  }

  if (config.includeConsoleLogs && bugReport.metadata) {
    const { entries, errorCount, warningCount } = formatConsoleLogs(bugReport.metadata, config);
    const consoleContent = formatter.formatConsoleLogs(entries, errorCount, warningCount) as string;
    if (consoleContent) {
      parts.push(consoleContent);
    }
  }

  if (config.includeNetworkLogs && bugReport.metadata) {
    const networkEntries = formatNetworkLogs(bugReport.metadata, config);
    const networkContent = formatter.formatNetworkLogs(networkEntries) as string;
    if (networkContent) {
      parts.push(networkContent);
    }
  }

  parts.push(formatter.formatBugReportDetails(bugReport) as string);

  const effectiveShareUrl = config.includeShareReplay ? shareReplayUrl : undefined;
  const attachments = formatter.formatAttachments(bugReport, effectiveShareUrl) as string;
  if (attachments) {
    parts.push(attachments);
  }

  parts.push(formatter.addFooter() as string);

  return parts.join('');
}

/**
 * Jira Bug Report Mapper
 * Converts BugReport to Jira issue format
 */
export class JiraBugReportMapper {
  private config: JiraConfig;
  private useADF: boolean;
  private templateConfig: Required<JiraTemplateConfig>;

  constructor(config: JiraConfig, useADF = true, templateConfig?: Partial<JiraTemplateConfig>) {
    this.config = config;
    this.useADF = useADF;
    this.templateConfig = { ...DEFAULT_TEMPLATE_CONFIG, ...templateConfig };
  }

  /**
   * Convert BugReport to Jira issue fields
   */
  toJiraIssue(
    bugReport: BugReport,
    shareReplayUrl?: string,
    fieldMappings?: Record<string, unknown> | null,
    descriptionTemplate?: string | null
  ): JiraIssueFields {
    // Truncate title to Jira's 255 character limit
    const summary =
      bugReport.title.length > 255 ? bugReport.title.substring(0, 252) + '...' : bugReport.title;

    // Use custom description template if provided, otherwise use default formatting
    let description: string | JiraDescription;
    if (descriptionTemplate) {
      const renderedTemplate = renderCustomTemplate(descriptionTemplate, bugReport, shareReplayUrl);

      if (this.useADF) {
        try {
          description = markdownToADFWithTables(renderedTemplate);
        } catch (error) {
          logger.warn(
            'Markdown to ADF conversion failed (recoverable - using plain text fallback)',
            {
              bugReportId: bugReport.id,
              recoverable: true,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              template: renderedTemplate.substring(0, 200),
              suggestion: 'Check custom template syntax for Markdown compatibility',
            }
          );
          description = {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: renderedTemplate }],
              },
            ],
          };
        }
      } else {
        description = renderedTemplate;
      }

      logger.debug('Using custom description template', {
        bugReportId: bugReport.id,
        templateLength: descriptionTemplate.length,
        renderedLength: renderedTemplate.length,
      });
    } else {
      description = this.useADF
        ? createADFDescription(bugReport, this.templateConfig, shareReplayUrl)
        : createPlainTextDescription(bugReport, this.templateConfig, shareReplayUrl);

      logger.debug('Using default description template', {
        bugReportId: bugReport.id,
        useADF: this.useADF,
      });
    }

    const issueFields: JiraIssueFields = {
      project: {
        key: this.config.projectKey,
      },
      issuetype: {
        name: this.config.issueType || 'Bug',
      },
      summary,
      description,
      priority: {
        name: mapPriorityToJira(bugReport.priority),
      },
      labels: ['bugspotter', 'automated'],
    };

    // Apply field mappings from integration rule (if present)
    if (fieldMappings && typeof fieldMappings === 'object') {
      logger.debug('Applying field mappings to Jira issue', {
        bugReportId: bugReport.id,
        fieldMappings,
        mappingKeys: Object.keys(fieldMappings),
      });
      applyFieldMappings(issueFields, fieldMappings);
    } else {
      logger.debug('No field mappings to apply', {
        bugReportId: bugReport.id,
        hasFieldMappings: !!fieldMappings,
        fieldMappingsType: typeof fieldMappings,
      });
    }

    return issueFields;
  }

  /**
   * Format description for Jira (convenience method)
   */
  formatDescription(bugReport: BugReport, shareReplayUrl?: string): string | JiraDescription {
    return this.useADF
      ? createADFDescription(bugReport, this.templateConfig, shareReplayUrl)
      : createPlainTextDescription(bugReport, this.templateConfig, shareReplayUrl);
  }
}
