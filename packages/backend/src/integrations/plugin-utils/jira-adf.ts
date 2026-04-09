/**
 * Jira ADF (Atlassian Document Format) utilities
 * Helper functions for building properly formatted Jira descriptions
 */

/**
 * Basic ADF node structure
 * Flexible interface for Atlassian Document Format nodes
 */
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  version?: number;
}

export interface BugReportForAdf {
  title: string;
  description?: string | null;
  metadata?: {
    console?: Array<{ level: string; message: string }>;
    network?: Array<{ method: string; url: string; status: number; duration: number }>;
  } | null;
}

export interface ResourceUrls {
  screenshot?: string;
  replay?: string;
  video?: string;
  logs?: string;
}

export interface Environment {
  browser: string;
  browserVersion: string;
  os: string;
  url: string;
}

// ============================================================================
// SECTION BUILDERS (Private Helpers)
// ============================================================================

/**
 * Build description section
 * @param description - Bug description text
 * @returns Array of ADF nodes (heading + paragraph)
 */
function buildDescriptionSection(description: string | null | undefined): AdfNode[] {
  return [adfHeading(2, 'Description'), adfParagraph(description || 'No description provided')];
}

/**
 * Build attachments section
 * @param urls - Resource URLs (screenshot, replay, etc.)
 * @returns Array of ADF nodes (heading + paragraph with links), or empty array if no URLs
 */
function buildAttachmentsSection(urls: ResourceUrls): AdfNode[] {
  if (!urls.screenshot && !urls.replay) {
    return [];
  }

  const linkNodes: AdfNode[] = [];

  if (urls.screenshot) {
    linkNodes.push(adfLink('📸 Screenshot', urls.screenshot));
    if (urls.replay) {
      linkNodes.push({ type: 'text', text: ' | ' });
    }
  }

  if (urls.replay) {
    linkNodes.push(adfLink('🎬 Session Replay', urls.replay));
  }

  return [
    adfHeading(2, 'Attachments'),
    {
      type: 'paragraph',
      content: linkNodes,
    },
  ];
}

/**
 * Build environment section
 * @param env - Environment information
 * @returns Array of ADF nodes (heading + bullet list)
 */
function buildEnvironmentSection(env: Environment): AdfNode[] {
  return [
    adfHeading(2, 'Environment'),
    adfBulletList([
      `Browser: ${env.browser} ${env.browserVersion}`,
      `OS: ${env.os}`,
      `URL: ${env.url}`,
    ]),
  ];
}

/**
 * Build console logs section
 * @param consoleLogs - Console logs to include
 * @returns Array of ADF nodes (heading + code block), or empty array if no logs
 */
function buildConsoleLogsSection(
  consoleLogs: Array<{ level: string; message: string }>
): AdfNode[] {
  if (consoleLogs.length === 0) {
    return [];
  }

  const logText = consoleLogs.map((log) => `[${log.level}] ${log.message}`).join('\n');

  return [adfHeading(2, 'Console Logs'), adfCodeBlock(logText)];
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Build Atlassian Document Format (ADF) description for Jira tickets
 * Includes bug description, attachments, environment, and console logs
 * @param bugReport - Bug report data
 * @param urls - Resource URLs (screenshot, replay, etc.)
 * @param env - Environment information
 * @param consoleLogs - Console logs to include
 * @returns ADF document structure
 * @example
 * const description = buildJiraAdfDescription(
 *   bugReport,
 *   { screenshot: 'https://...', replay: 'https://...' },
 *   { browser: 'Chrome', browserVersion: '120', os: 'Windows 10', url: 'https://app.com' },
 *   [{ level: 'error', message: 'Uncaught TypeError' }]
 * );
 */
export function buildJiraAdfDescription(
  bugReport: BugReportForAdf,
  urls: ResourceUrls,
  env: Environment,
  consoleLogs: Array<{ level: string; message: string }> = []
): AdfNode {
  return {
    type: 'doc',
    version: 1,
    content: [
      ...buildDescriptionSection(bugReport.description),
      ...buildAttachmentsSection(urls),
      ...buildEnvironmentSection(env),
      ...buildConsoleLogsSection(consoleLogs),
    ],
  };
}

/**
 * Build ADF heading
 * @param level - Heading level (1-6)
 * @param text - Heading text
 * @returns ADF heading node
 */
export function adfHeading(level: number, text: string): AdfNode {
  return {
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  };
}

/**
 * Build ADF paragraph
 * @param text - Paragraph text
 * @returns ADF paragraph node
 */
export function adfParagraph(text: string): AdfNode {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text }],
  };
}

/**
 * Build ADF link
 * @param text - Link text
 * @param href - Link URL
 * @returns ADF text node with link mark
 */
export function adfLink(text: string, href: string): AdfNode {
  return {
    type: 'text',
    text,
    marks: [{ type: 'link', attrs: { href } }],
  };
}

/**
 * Build ADF code block
 * @param code - Code content
 * @param language - Optional language for syntax highlighting
 * @returns ADF code block node
 */
export function adfCodeBlock(code: string, language = 'javascript'): AdfNode {
  return {
    type: 'codeBlock',
    ...(language && { attrs: { language } }),
    content: [{ type: 'text', text: code }],
  };
}

/**
 * Build ADF bullet list
 * @param items - Array of text items
 * @returns ADF bullet list node
 */
export function adfBulletList(items: string[]): AdfNode {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: item }],
        },
      ],
    })),
  };
}
