/**
 * Linear Bug Report Mapper
 *
 * Converts a `BugReport` into the input payload Linear's `issueCreate`
 * mutation expects. Linear consumes Markdown for `description`, so this
 * mapper is dramatically simpler than the Jira mapper (which has to
 * produce ADF). No formatter classes; just string assembly.
 */

import type { BugReport } from '../../db/types.js';
import { getLogger } from '../../logger.js';
import type {
  LinearConfig,
  LinearIssueInput,
  LinearPriority,
  LinearTemplateConfig,
} from './types.js';
import { renderCustomTemplate } from './template-renderer.js';
import { applyFieldMappings } from './field-mappings.js';

const logger = getLogger();

const MAX_TITLE_LENGTH = 255;

/**
 * Default template config. Console/network sections are off by default
 * for the same reason as Jira's mapper — the shared replay link already
 * carries them, and Linear's UI is poor at handling huge code blocks.
 */
const DEFAULT_TEMPLATE_CONFIG: Required<LinearTemplateConfig> = {
  includeConsoleLogs: false,
  consoleLogLimit: 10,
  includeNetworkLogs: false,
  networkLogFilter: 'failures',
  networkLogLimit: 10,
  includeShareReplay: true,
  shareReplayExpiration: 720,
  shareReplayPassword: null,
};

/**
 * BugSpotter priority strings → Linear's integer priority scheme.
 * Linear: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low.
 */
export function mapPriorityToLinear(priority?: string): LinearPriority {
  const normalized = (priority ?? '').toLowerCase();
  switch (normalized) {
    case 'critical':
      return 1;
    case 'high':
      return 2;
    case 'medium':
      return 3;
    case 'low':
    case 'minor':
      return 4;
    default:
      return 0;
  }
}

interface ConsoleLogEntry {
  level?: string;
  message?: string;
  timestamp?: string | number;
}

interface NetworkLogEntry {
  method?: string;
  url?: string;
  status?: number;
  duration?: number;
}

function isConsoleLogEntry(value: unknown): value is ConsoleLogEntry {
  return value !== null && typeof value === 'object';
}

function isNetworkLogEntry(value: unknown): value is NetworkLogEntry {
  return value !== null && typeof value === 'object';
}

function buildConsoleSection(
  metadata: Record<string, unknown> | undefined,
  config: Required<LinearTemplateConfig>
): string {
  const consoleData = metadata?.console;
  if (!Array.isArray(consoleData)) {
    return '';
  }

  const entries = consoleData.filter(isConsoleLogEntry).slice(-config.consoleLogLimit);
  if (entries.length === 0) {
    return '';
  }

  const lines = entries.map((e) => {
    const lvl = (e.level ?? 'log').toUpperCase();
    const msg = String(e.message ?? '');
    return `- **[${lvl}]** ${msg}`;
  });

  return `### Console (last ${entries.length})\n\n${lines.join('\n')}\n`;
}

function buildNetworkSection(
  metadata: Record<string, unknown> | undefined,
  config: Required<LinearTemplateConfig>
): string {
  const networkData = metadata?.network;
  if (!Array.isArray(networkData)) {
    return '';
  }

  let entries = networkData.filter(isNetworkLogEntry);
  if (config.networkLogFilter === 'failures') {
    entries = entries.filter((e) => typeof e.status === 'number' && e.status >= 400);
  }
  entries = entries.slice(-config.networkLogLimit);
  if (entries.length === 0) {
    return '';
  }

  const lines = entries.map(
    (e) =>
      `- \`${e.method ?? 'GET'}\` ${e.url ?? ''} → **${e.status ?? '?'}**` +
      (typeof e.duration === 'number' ? ` (${e.duration}ms)` : '')
  );

  return `### Network (${entries.length})\n\n${lines.join('\n')}\n`;
}

function buildEnvironmentSection(bugReport: BugReport): string {
  const meta = bugReport.metadata ?? {};
  const get = (k: string): string => {
    const v = (meta as Record<string, unknown>)[k];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  };

  const rows: Array<[string, string]> = [
    ['Priority', bugReport.priority ?? 'medium'],
    ['Browser', get('browser') || 'Unknown'],
    ['OS', get('os') || 'Unknown'],
    ['Page URL', get('url')],
  ];

  const body = rows
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');

  return `### Environment\n\n| Field | Value |\n| --- | --- |\n${body}\n`;
}

function buildAttachmentsSection(bugReport: BugReport, shareReplayUrl?: string): string {
  const parts: string[] = [];
  if (shareReplayUrl) {
    parts.push(`- [Watch session replay](${shareReplayUrl})`);
  }
  if (bugReport.screenshot_url) {
    parts.push(`- [View screenshot](${bugReport.screenshot_url})`);
  }
  if (parts.length === 0) {
    return '';
  }
  return `### Attachments\n\n${parts.join('\n')}\n`;
}

/**
 * Build the default Markdown description body when no custom template is
 * provided. Matches the structure of the Jira default but in Markdown.
 */
function buildDefaultDescription(
  bugReport: BugReport,
  config: Required<LinearTemplateConfig>,
  shareReplayUrl?: string
): string {
  const sections: string[] = [];

  if (bugReport.description) {
    sections.push(bugReport.description);
  }

  if (config.includeConsoleLogs) {
    const s = buildConsoleSection(bugReport.metadata, config);
    if (s) {
      sections.push(s);
    }
  }
  if (config.includeNetworkLogs) {
    const s = buildNetworkSection(bugReport.metadata, config);
    if (s) {
      sections.push(s);
    }
  }

  sections.push(buildEnvironmentSection(bugReport));

  const effectiveShareUrl = config.includeShareReplay ? shareReplayUrl : undefined;
  const attachments = buildAttachmentsSection(bugReport, effectiveShareUrl);
  if (attachments) {
    sections.push(attachments);
  }

  sections.push('\n---\n_Created by BugSpotter_');

  return sections.join('\n\n');
}

export class LinearBugReportMapper {
  private config: LinearConfig;
  private templateConfig: Required<LinearTemplateConfig>;

  constructor(config: LinearConfig, templateConfig?: Partial<LinearTemplateConfig>) {
    this.config = config;
    this.templateConfig = { ...DEFAULT_TEMPLATE_CONFIG, ...templateConfig };
  }

  /**
   * Build the `LinearIssueInput` for a bug report.
   *
   * `fieldMappings` are applied last so per-rule overrides (e.g. assignee,
   * stateId from an integration rule) win over defaults. `descriptionTemplate`
   * — when present — replaces the entire description body; otherwise we
   * generate the default Markdown body.
   */
  toLinearIssueInput(
    bugReport: BugReport,
    shareReplayUrl?: string,
    fieldMappings?: Record<string, unknown> | null,
    descriptionTemplate?: string | null
  ): LinearIssueInput {
    // Linear has no hard title length cap but a 255-char ceiling keeps
    // URLs and tracking-tool integrations sane. Same threshold as Jira.
    const title =
      bugReport.title.length > MAX_TITLE_LENGTH
        ? bugReport.title.substring(0, MAX_TITLE_LENGTH - 3) + '...'
        : bugReport.title;

    const description = descriptionTemplate
      ? renderCustomTemplate(descriptionTemplate, bugReport, shareReplayUrl)
      : buildDefaultDescription(bugReport, this.templateConfig, shareReplayUrl);

    const input: LinearIssueInput = {
      teamId: this.config.teamId,
      title,
      description,
      priority: mapPriorityToLinear(bugReport.priority),
    };

    if (this.config.projectId) {
      input.projectId = this.config.projectId;
    }
    if (this.config.defaultLabels && this.config.defaultLabels.length > 0) {
      input.labelIds = [...this.config.defaultLabels];
    }

    if (fieldMappings && typeof fieldMappings === 'object') {
      logger.debug('Applying field mappings to Linear issue', {
        bugReportId: bugReport.id,
        mappingKeys: Object.keys(fieldMappings),
      });
      applyFieldMappings(input, fieldMappings);
    }

    return input;
  }
}
