/**
 * Tests for Jira mapper fixes:
 * 1. Markdown table → ADF table conversion
 * 2. Nested metadata variable resolution (extension stores metadata.metadata.browser)
 */

import { describe, it, expect } from 'vitest';
import { JiraBugReportMapper } from '../../../src/integrations/jira/mapper.js';
import type { BugReport } from '../../../src/db/types.js';
import type { JiraConfig, JiraDescription } from '../../../src/integrations/jira/types.js';

const testConfig: JiraConfig = {
  host: 'https://test.atlassian.net',
  email: 'test@example.com',
  apiToken: 'test-token',
  projectKey: 'TEST',
  issueType: 'Bug',
  enabled: true,
};

/**
 * Create a bug report with metadata structured like the Chrome extension sends it:
 * metadata = { console: [...], network: [...], metadata: { browser, os, url, ... } }
 */
function createExtensionBugReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'bug-ext-001',
    project_id: 'proj-001',
    title: 'Test Bug from Extension',
    description: 'Steps to reproduce the bug',
    priority: 'medium',
    status: 'open',
    metadata: {
      console: [{ level: 'error', message: 'Uncaught TypeError', timestamp: 1700000000 }],
      network: [
        { url: 'https://api.example.com/data', method: 'GET', status: 500, timestamp: 1700000000 },
      ],
      metadata: {
        browser: 'Chrome 120.0',
        os: 'Windows 11',
        url: 'https://app.example.com/dashboard',
        userAgent: 'Mozilla/5.0 Chrome/120.0',
        user_email: 'user@company.com',
        viewport: { width: 1920, height: 1080 },
      },
    },
    screenshot_url: 'https://storage.example.com/screenshot.png',
    replay_url: null,
    screenshot_key: 'screenshots/proj-001/bug-ext-001/screenshot.png',
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'completed',
    replay_upload_status: 'none',
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    organization_id: null,
    created_at: new Date('2025-03-01T10:00:00Z'),
    updated_at: new Date('2025-03-01T10:00:00Z'),
    ...overrides,
  };
}

/** Create a bug report with flat metadata (SDK-style, for backward compatibility) */
function createSDKBugReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'bug-sdk-001',
    project_id: 'proj-001',
    title: 'Test Bug from SDK',
    description: 'Bug description',
    priority: 'high',
    status: 'open',
    metadata: {
      browser: 'Firefox 121.0',
      os: 'macOS 14',
      url: 'https://app.example.com/settings',
      user_email: 'sdk-user@company.com',
    },
    screenshot_url: null,
    replay_url: null,
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'none',
    replay_upload_status: 'none',
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    organization_id: null,
    created_at: new Date('2025-03-01T10:00:00Z'),
    updated_at: new Date('2025-03-01T10:00:00Z'),
    ...overrides,
  };
}

describe('Nested metadata variable resolution (extension format)', () => {
  it('should resolve {{browser}} from metadata.metadata.browser', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createExtensionBugReport();

    const template = 'Browser: {{browser}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    expect(result.description).toBe('Browser: Chrome 120.0');
  });

  it('should resolve {{os}} from metadata.metadata.os', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createExtensionBugReport();

    const template = 'OS: {{os}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    expect(result.description).toBe('OS: Windows 11');
  });

  it('should resolve {{url}} from metadata.metadata.url', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createExtensionBugReport();

    const template = 'Page: {{url}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    expect(result.description).toBe('Page: https://app.example.com/dashboard');
  });

  it('should resolve {{user_email}} from metadata.metadata.user_email', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createExtensionBugReport();

    const template = 'Reporter: {{user_email}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    expect(result.description).toBe('Reporter: user@company.com');
  });

  it('should resolve all extension variables in a full template', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createExtensionBugReport();

    const template = '{{browser}} | {{os}} | {{url}} | {{user_email}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    expect(result.description).toBe(
      'Chrome 120.0 | Windows 11 | https://app.example.com/dashboard | user@company.com'
    );
  });

  it('should still resolve flat metadata (SDK format) for backward compatibility', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createSDKBugReport();

    const template = '{{browser}} | {{os}} | {{url}} | {{user_email}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    expect(result.description).toBe(
      'Firefox 121.0 | macOS 14 | https://app.example.com/settings | sdk-user@company.com'
    );
  });

  it('should prefer top-level metadata over nested metadata', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createExtensionBugReport({
      metadata: {
        browser: 'TopLevel Safari',
        metadata: { browser: 'Nested Chrome' },
      },
    });

    const template = 'Browser: {{browser}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    // Top-level getMeta should win over nested
    expect(result.description).toBe('Browser: TopLevel Safari');
  });

  it('should fall back to Unknown when metadata.metadata has no browser', () => {
    const mapper = new JiraBugReportMapper(testConfig, false);
    const bugReport = createExtensionBugReport({
      metadata: {
        console: [],
        network: [],
        metadata: { url: 'https://example.com' },
      },
    });

    const template = 'Browser: {{browser}}';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);

    expect(result.description).toBe('Browser: Unknown');
  });
});

describe('Markdown table to ADF conversion', () => {
  it('should convert a simple Markdown table to an ADF table node', () => {
    const mapper = new JiraBugReportMapper(testConfig, true); // useADF = true
    const bugReport = createExtensionBugReport();

    const template = `**Environment**

| Field   | Value        |
| ------- | ------------ |
| Browser | {{browser}}  |
| OS      | {{os}}       |`;

    const result = mapper.toJiraIssue(bugReport, undefined, null, template);
    const desc = result.description as JiraDescription;

    expect(desc.type).toBe('doc');
    expect(desc.version).toBe(1);

    // Find the table node in the ADF content
    const tableNode = desc.content.find((n: { type: string }) => n.type === 'table');
    expect(tableNode).toBeDefined();
    expect(tableNode!.type).toBe('table');

    // Verify table has rows (header + 2 data rows)
    expect(tableNode!.content).toHaveLength(3);

    // Verify header row uses tableHeader cells
    const headerRow = tableNode!.content![0];
    expect(headerRow.type).toBe('tableRow');
    expect(headerRow.content![0].type).toBe('tableHeader');
    expect(headerRow.content![1].type).toBe('tableHeader');

    // Verify data rows use tableCell
    const dataRow1 = tableNode!.content![1];
    expect(dataRow1.type).toBe('tableRow');
    expect(dataRow1.content![0].type).toBe('tableCell');

    // Verify variable substitution happened in the table
    const adfStr = JSON.stringify(desc);
    expect(adfStr).toContain('Chrome 120.0');
    expect(adfStr).toContain('Windows 11');
  });

  it('should handle template with text before and after the table', () => {
    const mapper = new JiraBugReportMapper(testConfig, true);
    const bugReport = createExtensionBugReport();

    const template = `## Bug Report

Some description text.

| Key      | Value       |
| -------- | ----------- |
| Priority | {{priority}} |

_Auto-created by BugSpotter_`;

    const result = mapper.toJiraIssue(bugReport, undefined, null, template);
    const desc = result.description as JiraDescription;

    // Should have heading, paragraph, table, and footer paragraph
    const types = desc.content.map((n: { type: string }) => n.type);
    expect(types).toContain('table');
    expect(types).toContain('heading');

    // Verify table content has the substituted priority
    const adfStr = JSON.stringify(desc);
    expect(adfStr).toContain('medium');
    expect(adfStr).toContain('Auto-created by BugSpotter');
  });

  it('should handle template with no tables (passthrough to md-to-adf)', () => {
    const mapper = new JiraBugReportMapper(testConfig, true);
    const bugReport = createExtensionBugReport();

    const template = '## Title\n\nJust a paragraph with **bold** text.';
    const result = mapper.toJiraIssue(bugReport, undefined, null, template);
    const desc = result.description as JiraDescription;

    expect(desc.type).toBe('doc');
    // No table nodes
    const tableNode = desc.content.find((n: { type: string }) => n.type === 'table');
    expect(tableNode).toBeUndefined();
  });

  it('should handle the exact user template from production', () => {
    const mapper = new JiraBugReportMapper(testConfig, true);
    const bugReport = createExtensionBugReport();
    const shareUrl = 'https://bugspotter.io/shared/abc123';

    const template = `## {{title}}

{{description}}

---

**Environment**

| Field    | Value         |
| -------- | ------------- |
| Priority | {{priority}}  |
| Reporter | {{user_email}} |
| Browser  | {{browser}}   |
| OS       | {{os}}        |
| Page URL | {{url}}       |

**Screenshot**

[View screenshot]({{screenshot_url}})

**Session Replay**

[View session replay]({{replay_url}})

---

_Auto-created by BugSpotter_`;

    const result = mapper.toJiraIssue(bugReport, shareUrl, null, template);
    const desc = result.description as JiraDescription;

    expect(desc.type).toBe('doc');

    // Should have a table node
    const tableNode = desc.content.find((n: { type: string }) => n.type === 'table');
    expect(tableNode).toBeDefined();

    // Table should have header + 5 data rows
    expect(tableNode!.content).toHaveLength(6);

    // All variables should be resolved
    const adfStr = JSON.stringify(desc);
    expect(adfStr).toContain('Test Bug from Extension');
    expect(adfStr).toContain('Steps to reproduce the bug');
    expect(adfStr).toContain('Chrome 120.0');
    expect(adfStr).toContain('Windows 11');
    expect(adfStr).toContain('https://app.example.com/dashboard');
    expect(adfStr).toContain('user@company.com');
    expect(adfStr).toContain('https://storage.example.com/screenshot.png');
    expect(adfStr).toContain('https://bugspotter.io/shared/abc123');

    // Should NOT contain raw pipe characters from table syntax
    expect(adfStr).not.toContain('| ----');
  });
});
