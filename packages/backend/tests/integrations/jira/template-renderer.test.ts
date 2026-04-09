/**
 * Jira Template Renderer Tests
 * Tests for custom description template rendering with variable substitution
 */

import { describe, it, expect } from 'vitest';
import { JiraBugReportMapper } from '../../../src/integrations/jira/mapper.js';
import type { BugReport } from '../../../src/db/types.js';
import type { JiraConfig } from '../../../src/integrations/jira/types.js';

// Helper to create test bug report
function createTestBugReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'bug-123',
    project_id: 'project-456',
    title: 'Test Bug',
    description: 'Test description',
    priority: 'high',
    status: 'open',
    metadata: {
      browser: 'Chrome',
      os: 'Windows',
      url: 'https://example.com',
      user_email: 'test@example.com',
      error: {
        message: 'TypeError: Cannot read property',
        type: 'TypeError',
        stack: 'Error at line 10',
      },
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
    created_at: new Date('2024-01-01T12:00:00Z'),
    updated_at: new Date('2024-01-01T12:00:00Z'),
    ...overrides,
  };
}

// Test Jira config
const testConfig: JiraConfig = {
  host: 'https://test.atlassian.net',
  email: 'test@example.com',
  apiToken: 'test-token',
  projectKey: 'TEST',
  issueType: 'Bug',
  enabled: true,
};

describe('JiraBugReportMapper - Custom Template Rendering', () => {
  describe('Basic variable substitution', () => {
    it('should replace simple metadata variables', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = 'Browser: {{browser}}, OS: {{os}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Browser: Chrome, OS: Windows');
    });

    it('should replace bug report direct fields', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = 'Title: {{title}}, Priority: {{priority}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Title: Test Bug, Priority: high');
    });

    it('should replace nested metadata variables', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = 'Error: {{error.message}} ({{error.type}})';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Error: TypeError: Cannot read property (TypeError)');
    });

    it('should replace timestamp with ISO format', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = 'Occurred at: {{timestamp}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Occurred at: 2024-01-01T12:00:00.000Z');
    });
  });

  describe('Missing metadata handling', () => {
    it('should replace missing metadata with fallback values', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({ metadata: {} });

      const template = 'Browser: {{browser}}, Email: {{user_email}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Browser: Unknown, Email: Unknown');
    });

    it('should handle missing nested metadata gracefully', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({ metadata: { browser: 'Chrome' } });

      const template = 'Error: {{error.message}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Error: ');
    });

    it('should handle null metadata with fallback values', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({ metadata: null as any });

      const template = 'Browser: {{browser}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Browser: Unknown');
    });
  });

  describe('Unmatched variables', () => {
    it('should remove unmatched variables from template', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = 'Browser: {{browser}}, Nonexistent: {{fake_variable}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Browser: Chrome, Nonexistent: ');
    });

    it('should remove all unmatched variables', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = '{{var1}} {{var2}} {{var3}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('  ');
    });
  });

  describe('Special characters and edge cases', () => {
    it('should handle metadata values with special characters', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          url: 'https://example.com?param=value&other=123',
          browser: 'Chrome (v120.0)',
        },
      });

      const template = 'URL: {{url}}, Browser: {{browser}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe(
        'URL: https://example.com?param=value&other=123, Browser: Chrome (v120.0)'
      );
    });

    it('should handle metadata values with curly braces', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          custom: 'Value with {braces}',
        },
      });

      const template = 'Custom: {{metadata.custom}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Custom: Value with {braces}');
    });

    it('should use default template when template is empty string', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = '';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      // Empty template triggers default formatting, not custom template
      expect(typeof result.description).toBe('string');
      expect((result.description as string).length).toBeGreaterThan(0);
      expect(result.description as string).toContain('Bug Report Details');
    });

    it('should handle template with only variables', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = '{{browser}}{{os}}{{url}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('ChromeWindowshttps://example.com');
    });

    it('should handle numeric metadata values', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          viewport_width: 1920,
          viewport_height: 1080,
        },
      });

      const template = 'Viewport: {{viewport_width}}x{{viewport_height}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Viewport: 1920x1080');
    });
  });

  describe('Dynamic metadata fields', () => {
    it('should support metadata.* variables for custom fields', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          request_id: 'req-12345',
          session_id: 'sess-67890',
        },
      });

      const template = 'Request: {{metadata.request_id}}, Session: {{metadata.session_id}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Request: req-12345, Session: sess-67890');
    });

    it('should support nested metadata fields', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          custom: {
            field1: 'value1',
            field2: 'value2',
          },
        },
      });

      const template = 'Field1: {{metadata.custom.field1}}, Field2: {{metadata.custom.field2}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Field1: value1, Field2: value2');
    });
  });

  describe('Security considerations', () => {
    it('should not execute code from metadata values', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          malicious: '${alert("xss")}',
        },
      });

      const template = 'Value: {{metadata.malicious}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      // Should output the string literally, not execute it
      expect(result.description).toBe('Value: ${alert("xss")}');
    });

    it('should handle metadata with regex special characters safely', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          'special.*chars': 'test+value',
        },
      });

      const template = 'Value: {{metadata.special.*chars}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      // Should handle special regex characters without breaking
      expect(result.description).toBe('Value: test+value');
    });

    it('should not allow template injection via metadata keys', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: {
          '{{browser}}': 'injected',
          // No actual 'browser' key, so fallback applies
        },
      });

      const template = 'Browser: {{browser}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      // Should use fallback 'Unknown', not the malicious key
      expect(result.description).toBe('Browser: Unknown');
    });
  });

  describe('ADF format with custom template', () => {
    it('should convert Markdown template to ADF structure using md-to-adf', () => {
      const mapper = new JiraBugReportMapper(testConfig, true); // useADF = true
      const bugReport = createTestBugReport();

      const template = 'Browser: {{browser}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      // md-to-adf returns an ADF Document object
      // Check that it's an object (not a string) and has the expected structure
      expect(typeof result.description).toBe('object');
      expect(result.description).not.toBeNull();

      // Verify the rendered text is in the ADF structure
      const adfString = JSON.stringify(result.description);
      expect(adfString).toContain('Browser: Chrome');
    });
  });

  describe('Fallback to default template', () => {
    it('should use default formatting when template is null', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const result = mapper.toJiraIssue(bugReport, undefined, null, null);

      // Should contain default formatted content (not custom template)
      expect(typeof result.description).toBe('string');
      expect((result.description as string).length).toBeGreaterThan(0);
    });

    it('should use default formatting when template is undefined', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const result = mapper.toJiraIssue(bugReport, undefined, null, undefined);

      // Should contain default formatted content
      expect(typeof result.description).toBe('string');
      expect((result.description as string).length).toBeGreaterThan(0);
    });
  });

  describe('Source and API key prefix variables', () => {
    it('should render {{source}} from metadata', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: { source: 'extension' },
      });

      const template = 'Source: {{source}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Source: extension');
    });

    it('should render {{source}} as "api" when missing from metadata', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({ metadata: {} });

      const template = 'Source: {{source}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Source: api');
    });

    it('should render {{api_key_prefix}} from metadata', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: { apiKeyPrefix: 'bgs_12345' },
      });

      const template = 'API Key: {{api_key_prefix}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('API Key: bgs_12345');
    });

    it('should render {{api_key_prefix}} as empty when missing', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({ metadata: {} });

      const template = 'API Key: {{api_key_prefix}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('API Key: ');
    });

    it('should render both source and api_key_prefix together', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport({
        metadata: { source: 'sdk', apiKeyPrefix: 'bgs_abc' },
      });

      const template = 'Source: {{source}}, Key: {{api_key_prefix}}';
      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toBe('Source: sdk, Key: bgs_abc');
    });
  });

  describe('Complex real-world templates', () => {
    it('should render multi-line template with multiple variables', () => {
      const mapper = new JiraBugReportMapper(testConfig, false);
      const bugReport = createTestBugReport();

      const template = `Error Report
Type: {{error.type}}
Message: {{error.message}}

Environment:
- Browser: {{browser}}
- OS: {{os}}
- URL: {{url}}

User: {{user_email}}
Time: {{timestamp}}`;

      const result = mapper.toJiraIssue(bugReport, undefined, null, template);

      expect(result.description).toContain('Type: TypeError');
      expect(result.description).toContain('Message: TypeError: Cannot read property');
      expect(result.description).toContain('Browser: Chrome');
      expect(result.description).toContain('OS: Windows');
      expect(result.description).toContain('URL: https://example.com');
      expect(result.description).toContain('User: test@example.com');
      expect(result.description).toContain('Time: 2024-01-01T12:00:00.000Z');
    });
  });
});
