/**
 * Jira Mapper Tests
 */

import { describe, it, expect } from 'vitest';
import { JiraBugReportMapper } from '../../../src/integrations/jira/mapper.js';
import type { BugReport } from '../../../src/db/types.js';
import type { JiraConfig, JiraDescription } from '../../../src/integrations/jira/types.js';
import type { BugPriority } from '@bugspotter/types';

/**
 * Helper type for tests that need to access custom fields on Jira issues
 * Extends the base Jira issue type with an index signature for custom fields
 */
type JiraIssueWithCustomFields = ReturnType<JiraBugReportMapper['toJiraIssue']> &
  Record<string, unknown>;

describe('JiraBugReportMapper', () => {
  const mockConfig: JiraConfig = {
    host: 'https://example.atlassian.net',
    email: 'test@example.com',
    apiToken: 'test-token',
    projectKey: 'PROJ',
    issueType: 'Bug',
    enabled: true,
  };

  const mockBugReport: BugReport = {
    id: 'bug-123',
    project_id: 'proj-456',
    title: 'Application crashes on login',
    description: 'The app crashes when user tries to login with email',
    priority: 'critical' as BugPriority,
    status: 'open',
    screenshot_url: null,
    replay_url: null,
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'none',
    replay_upload_status: 'none',
    metadata: {
      browser: 'Chrome 120.0.0',
      os: 'Windows 11',
      custom_data: { feature_flag: 'new_auth' },
    },
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    created_at: new Date('2025-01-15T10:30:00Z'),
    updated_at: new Date('2025-01-15T10:30:00Z'),
  };

  describe('toJiraIssue', () => {
    it('should convert bug report to Jira issue format', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(mockBugReport);

      expect(issue.project.key).toBe('PROJ');
      expect(issue.issuetype.name).toBe('Bug');
      expect(issue.summary).toBe('Application crashes on login');
    });

    it('should format description in ADF format by default', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(mockBugReport);

      expect(typeof issue.description).toBe('object');
      if (typeof issue.description !== 'string') {
        expect(issue.description.type).toBe('doc');
        expect(issue.description.version).toBe(1);
        expect(issue.description.content).toBeDefined();
      }
    });

    it('should include bug report details in ADF description', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(mockBugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Bug Report Details');
      expect(descStr).toContain('bug-123');
      expect(descStr).toContain('OPEN');
    });

    it('should include browser metadata when present as object', () => {
      const bugWithBrowserObj: BugReport = {
        ...mockBugReport,
        metadata: {
          browser: { name: 'Chrome', version: '120.0.0' },
          os: 'Windows 11',
        },
      };

      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugWithBrowserObj);
      const descStr = JSON.stringify(issue.description);

      // Browser metadata is displayed inline
      expect(descStr).toContain('Browser');
      expect(descStr).toContain('Chrome');
      expect(descStr).toContain('120.0.0');
    });

    it('should include URLs when present', () => {
      const bugWithUrls: BugReport = {
        ...mockBugReport,
        screenshot_url: 'https://example.com/screenshot.png',
        replay_url: 'https://example.com/replay.json',
      };

      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugWithUrls);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Attachments');
      expect(descStr).toContain('screenshot.png');
      expect(descStr).toContain('replay.json');
    });

    it('should handle missing optional fields', () => {
      const minimalBugReport: BugReport = {
        id: 'bug-456',
        project_id: 'proj-789',
        title: 'Simple bug',
        description: 'Description',
        priority: 'medium' as BugPriority,
        status: 'open',
        screenshot_url: null,
        replay_url: null,
        screenshot_key: null,
        thumbnail_key: null,
        replay_key: null,
        upload_status: 'none',
        replay_upload_status: 'none',
        metadata: {},
        deleted_at: null,
        deleted_by: null,
        legal_hold: false,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(minimalBugReport);

      expect(issue.summary).toBe('Simple bug');
      expect(issue.description).toBeDefined();
    });

    it('should map priority to Jira priority names', () => {
      const mapper = new JiraBugReportMapper(mockConfig);

      const criticalBug = { ...mockBugReport, priority: 'critical' as BugPriority };
      const highBug = { ...mockBugReport, priority: 'high' as BugPriority };
      const mediumBug = { ...mockBugReport, priority: 'medium' as BugPriority };
      const lowBug = { ...mockBugReport, priority: 'low' as BugPriority };

      expect(mapper.toJiraIssue(criticalBug).priority?.name).toBe('Highest');
      expect(mapper.toJiraIssue(highBug).priority?.name).toBe('High');
      expect(mapper.toJiraIssue(mediumBug).priority?.name).toBe('Medium');
      expect(mapper.toJiraIssue(lowBug).priority?.name).toBe('Low');
    });

    it('should include bugspotter and automated labels', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(mockBugReport);

      expect(issue.labels).toContain('bugspotter');
      expect(issue.labels).toContain('automated');
    });

    it('should truncate long titles to 255 characters', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const longTitle = 'A'.repeat(300);
      const bugWithLongTitle = { ...mockBugReport, title: longTitle };

      const issue = mapper.toJiraIssue(bugWithLongTitle);

      expect(issue.summary.length).toBeLessThanOrEqual(255);
      expect(issue.summary).toContain('...');
    });
  });

  describe('formatDescription', () => {
    it('should return ADF format when useADF is true', () => {
      const mapper = new JiraBugReportMapper(mockConfig, true);
      const description = mapper.formatDescription(mockBugReport);

      expect(typeof description).toBe('object');
      if (typeof description !== 'string') {
        expect(description.type).toBe('doc');
      }
    });

    it('should return plain text when useADF is false', () => {
      const mapper = new JiraBugReportMapper(mockConfig, false);
      const description = mapper.formatDescription(mockBugReport);

      expect(typeof description).toBe('string');
    });
  });

  describe('ADF formatting', () => {
    it('should create proper paragraph nodes', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const description = mapper.formatDescription(mockBugReport) as JiraDescription;

      const paragraphs = description.content.filter((node) => node.type === 'paragraph');
      expect(paragraphs.length).toBeGreaterThan(0);
    });

    it('should create proper heading nodes', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const description = mapper.formatDescription(mockBugReport) as JiraDescription;

      const headings = description.content.filter((node) => node.type === 'heading');
      expect(headings.length).toBeGreaterThan(0);
      expect(headings[0].attrs?.level).toBeDefined();
    });

    it('should create headings for sections', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const description = mapper.formatDescription(mockBugReport) as JiraDescription;

      const headings = description.content.filter((node) => node.type === 'heading');
      // Should have at least Bug Report Details heading
      expect(headings.length).toBeGreaterThan(0);
      expect(headings.some((h) => JSON.stringify(h).includes('Bug Report Details'))).toBe(true);
    });
  });

  describe('toJiraIssue with custom description template', () => {
    it('should render custom template with replay_url variable', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const template = 'Bug: {{title}}\nReplay: {{replay_url}}';
      const shareReplayUrl = 'https://app.bugspotter.io/shared/abc123';

      const issue = mapper.toJiraIssue(mockBugReport, shareReplayUrl, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      expect(descStr).toContain('Bug: Application crashes on login');
      expect(descStr).toContain('Replay: https://app.bugspotter.io/shared/abc123');
    });

    it('should render custom template with screenshot_url variable', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const bugWithScreenshot: BugReport = {
        ...mockBugReport,
        screenshot_url: 'https://cdn.bugspotter.io/screenshots/img123.png',
      };
      const template = 'Bug: {{title}}\nScreenshot: {{screenshot_url}}';

      const issue = mapper.toJiraIssue(bugWithScreenshot, undefined, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      expect(descStr).toContain('Bug: Application crashes on login');
      expect(descStr).toContain('Screenshot: https://cdn.bugspotter.io/screenshots/img123.png');
    });

    it('should prioritize shareReplayUrl over bug_report.replay_url', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const bugWithReplay: BugReport = {
        ...mockBugReport,
        replay_url: 'https://s3.amazonaws.com/direct-replay.gz',
      };
      const template = 'Replay: {{replay_url}}';
      const shareReplayUrl = 'https://app.bugspotter.io/shared/xyz789';

      const issue = mapper.toJiraIssue(bugWithReplay, shareReplayUrl, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      // Should use share URL, not direct S3 URL
      expect(descStr).toContain('Replay: https://app.bugspotter.io/shared/xyz789');
      expect(descStr).not.toContain('s3.amazonaws.com');
    });

    it('should use bug_report.replay_url as fallback when shareReplayUrl not provided', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const bugWithReplay: BugReport = {
        ...mockBugReport,
        replay_url: 'https://s3.amazonaws.com/direct-replay.gz',
      };
      const template = 'Replay: {{replay_url}}';

      const issue = mapper.toJiraIssue(bugWithReplay, undefined, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      expect(descStr).toContain('Replay: https://s3.amazonaws.com/direct-replay.gz');
    });

    it('should render empty string for replay_url when not available', () => {
      const mapper = new JiraBugReportMapper(mockConfig, false); // Use plain text
      const template = 'Replay: {{replay_url}}';

      const issue = mapper.toJiraIssue(mockBugReport, undefined, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      expect(descStr).toContain('Replay: ');
      expect(descStr).not.toContain('null');
      expect(descStr).not.toContain('undefined');
    });

    it('should render empty string for screenshot_url when not available', () => {
      const mapper = new JiraBugReportMapper(mockConfig, false); // Use plain text
      const template = 'Screenshot: {{screenshot_url}}';

      const issue = mapper.toJiraIssue(mockBugReport, undefined, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      expect(descStr).toContain('Screenshot: ');
      expect(descStr).not.toContain('null');
      expect(descStr).not.toContain('undefined');
    });

    it('should render template with both replay and screenshot URLs', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const bugWithMedia: BugReport = {
        ...mockBugReport,
        screenshot_url: 'https://cdn.bugspotter.io/screenshots/img.png',
      };
      const template = 'Bug: {{title}}\nReplay: {{replay_url}}\nScreenshot: {{screenshot_url}}';
      const shareReplayUrl = 'https://app.bugspotter.io/shared/abc';

      const issue = mapper.toJiraIssue(bugWithMedia, shareReplayUrl, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      expect(descStr).toContain('Bug: Application crashes on login');
      expect(descStr).toContain('Replay: https://app.bugspotter.io/shared/abc');
      expect(descStr).toContain('Screenshot: https://cdn.bugspotter.io/screenshots/img.png');
    });

    it('should combine custom template with other standard variables', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const template = 'Title: {{title}}\nBrowser: {{browser}}\nOS: {{os}}\nReplay: {{replay_url}}';
      const shareReplayUrl = 'https://app.bugspotter.io/shared/test';

      const issue = mapper.toJiraIssue(mockBugReport, shareReplayUrl, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      expect(descStr).toContain('Title: Application crashes on login');
      expect(descStr).toContain('Browser: Chrome 120.0.0');
      expect(descStr).toContain('OS: Windows 11');
      expect(descStr).toContain('Replay: https://app.bugspotter.io/shared/test');
    });

    it('should remove empty Markdown links when URLs are not available', () => {
      // Use false as second parameter to disable ADF
      const mapper = new JiraBugReportMapper(mockConfig, false);
      const template =
        '**Session Replay**:\n[Watch Session Replay]({{replay_url}})\n\n**Screenshot**:\n[View Screenshot]({{screenshot_url}})';

      // Create bug report without URLs
      const bugReportWithoutUrls = {
        ...mockBugReport,
        replay_url: null,
        screenshot_url: null,
      };

      const issue = mapper.toJiraIssue(bugReportWithoutUrls, undefined, null, template);

      const descStr =
        typeof issue.description === 'string'
          ? issue.description
          : JSON.stringify(issue.description);

      // Empty links should be removed entirely
      expect(descStr).not.toContain('[Watch Session Replay]()');
      expect(descStr).not.toContain('[View Screenshot]()');
      // Section headers should still be present
      expect(descStr).toContain('**Session Replay**:');
      expect(descStr).toContain('**Screenshot**:');
    });

    it('should preserve valid Markdown links when URLs are available', () => {
      // Use false as second parameter to disable ADF
      const mapper = new JiraBugReportMapper(mockConfig, false);
      const template =
        '**Session Replay**:\n[Watch Session Replay]({{replay_url}})\n\n**Screenshot**:\n[View Screenshot]({{screenshot_url}})';
      const shareReplayUrl = 'https://app.bugspotter.io/shared/xyz';

      // Create bug report with screenshot URL
      const bugReportWithUrls = {
        ...mockBugReport,
        screenshot_url: 'https://cdn.bugspotter.io/screenshots/img.png',
      };

      const issue = mapper.toJiraIssue(bugReportWithUrls, shareReplayUrl, null, template);

      // Description should be plain text (string)
      expect(typeof issue.description).toBe('string');
      const descStr = issue.description as string;

      // Valid links should be preserved
      expect(descStr).toContain('[Watch Session Replay](https://app.bugspotter.io/shared/xyz)');
      expect(descStr).toContain('[View Screenshot](https://cdn.bugspotter.io/screenshots/img.png)');
    });
  });

  describe('toJiraIssue with field mappings', () => {
    describe('falsy value handling', () => {
      it('should apply boolean false values', () => {
        const mapper = new JiraBugReportMapper(mockConfig);
        const fieldMappings = {
          customfield_10001: false,
        };

        const issue = mapper.toJiraIssue(
          mockBugReport,
          undefined,
          fieldMappings
        ) as JiraIssueWithCustomFields;

        expect(issue.customfield_10001).toBe(false);
      });

      it('should apply numeric zero values', () => {
        const mapper = new JiraBugReportMapper(mockConfig);
        const fieldMappings = {
          customfield_10002: 0,
        };

        const issue = mapper.toJiraIssue(
          mockBugReport,
          undefined,
          fieldMappings
        ) as JiraIssueWithCustomFields;

        expect(issue.customfield_10002).toBe(0);
      });

      it('should apply empty string values', () => {
        const mapper = new JiraBugReportMapper(mockConfig);
        const fieldMappings = {
          customfield_10003: '',
        };

        const issue = mapper.toJiraIssue(
          mockBugReport,
          undefined,
          fieldMappings
        ) as JiraIssueWithCustomFields;

        expect(issue.customfield_10003).toBe('');
      });

      it('should skip null values', () => {
        const mapper = new JiraBugReportMapper(mockConfig);
        const fieldMappings = {
          customfield_10004: null,
        };

        const issue = mapper.toJiraIssue(
          mockBugReport,
          undefined,
          fieldMappings
        ) as JiraIssueWithCustomFields;

        expect(issue.customfield_10004).toBeUndefined();
      });

      it('should skip undefined values', () => {
        const mapper = new JiraBugReportMapper(mockConfig);
        const fieldMappings = {
          customfield_10005: undefined,
        };

        const issue = mapper.toJiraIssue(
          mockBugReport,
          undefined,
          fieldMappings
        ) as JiraIssueWithCustomFields;

        expect(issue.customfield_10005).toBeUndefined();
      });

      it('should handle mixed falsy and truthy values', () => {
        const mapper = new JiraBugReportMapper(mockConfig);
        const fieldMappings = {
          customfield_bool: false,
          customfield_number: 0,
          customfield_string: '',
          customfield_null: null,
          customfield_undefined: undefined,
          customfield_truthy: 'value',
        };

        const issue = mapper.toJiraIssue(
          mockBugReport,
          undefined,
          fieldMappings
        ) as JiraIssueWithCustomFields;

        // Falsy values should be applied
        expect(issue.customfield_bool).toBe(false);
        expect(issue.customfield_number).toBe(0);
        expect(issue.customfield_string).toBe('');

        // null and undefined should be skipped
        expect(issue.customfield_null).toBeUndefined();
        expect(issue.customfield_undefined).toBeUndefined();

        // Truthy value should be applied
        expect(issue.customfield_truthy).toBe('value');
      });

      it('should apply false to standard fields like priority', () => {
        const mapper = new JiraBugReportMapper(mockConfig);
        const fieldMappings = {
          // Example: disable auto-assignment or other boolean field
          customfield_autoassign: false,
        };

        const issue = mapper.toJiraIssue(
          mockBugReport,
          undefined,
          fieldMappings
        ) as JiraIssueWithCustomFields;

        expect(issue.customfield_autoassign).toBe(false);
      });
    });

    it('should set assignee from field mappings', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        assignee: {
          accountId: '5d123abc456def789ghi012',
        },
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.assignee).toBeDefined();
      expect(issue.assignee?.accountId).toBe('5d123abc456def789ghi012');
    });

    it('should not set assignee when field mappings is null', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(mockBugReport, undefined, null);

      expect(issue.assignee).toBeUndefined();
    });

    it('should not set assignee when assignee mapping is missing', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        labels: ['custom-label'],
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.assignee).toBeUndefined();
      // Should still apply labels
      expect(issue.labels).toContain('custom-label');
    });

    it('should handle invalid assignee mapping gracefully', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        assignee: 'invalid-string-instead-of-object',
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.assignee).toBeUndefined();
    });

    it('should handle missing accountId in assignee mapping', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        assignee: {
          // Missing accountId
        },
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.assignee).toBeUndefined();
    });

    it('should set components from field mappings', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        components: [{ name: 'Frontend' }, { id: '10001' }],
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.components).toBeDefined();
      expect(issue.components).toHaveLength(2);
      expect(issue.components?.[0]).toEqual({ name: 'Frontend' });
      expect(issue.components?.[1]).toEqual({ id: '10001' });
    });

    it('should append labels from field mappings to default labels', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        labels: ['urgent', 'customer-reported'],
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.labels).toContain('bugspotter');
      expect(issue.labels).toContain('automated');
      expect(issue.labels).toContain('urgent');
      expect(issue.labels).toContain('customer-reported');
    });

    it('should override priority from field mappings', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        priority: { name: 'Critical' },
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.priority?.name).toBe('Critical');
    });

    it('should override description from field mappings', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        description: 'Custom description from integration rule',
      };

      const issue = mapper.toJiraIssue(mockBugReport, undefined, fieldMappings);

      expect(issue.description).toBe('Custom description from integration rule');
    });

    it('should handle custom fields from field mappings', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        customfield_10001: 'Sprint 42',
        customfield_10002: { value: 'In Progress' },
      };

      const issue = mapper.toJiraIssue(
        mockBugReport,
        undefined,
        fieldMappings
      ) as JiraIssueWithCustomFields;

      expect(issue.customfield_10001).toBe('Sprint 42');
      expect(issue.customfield_10002).toEqual({
        value: 'In Progress',
      });
    });

    it('should apply multiple field mappings simultaneously', () => {
      const mapper = new JiraBugReportMapper(mockConfig);
      const fieldMappings = {
        assignee: { accountId: '5d123abc' },
        components: [{ name: 'Backend' }],
        labels: ['production-bug'],
        priority: { name: 'Highest' },
        customfield_10001: 'Epic-123',
      };

      const issue = mapper.toJiraIssue(
        mockBugReport,
        undefined,
        fieldMappings
      ) as JiraIssueWithCustomFields;

      expect(issue.assignee?.accountId).toBe('5d123abc');
      expect(issue.components?.[0]).toEqual({ name: 'Backend' });
      expect(issue.labels).toContain('production-bug');
      expect(issue.priority?.name).toBe('Highest');
      expect(issue.customfield_10001).toBe('Epic-123');
    });
  });
});
