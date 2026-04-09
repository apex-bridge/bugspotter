/**
 * Jira Mapper Enhanced Tests
 * Tests for console logs, network logs, and share replay functionality
 */

import { describe, it, expect } from 'vitest';
import { JiraBugReportMapper } from '../../../src/integrations/jira/mapper.js';
import type { BugReport } from '../../../src/db/types.js';
import type { JiraConfig } from '../../../src/integrations/jira/types.js';
import type { BugPriority } from '@bugspotter/types';

describe('JiraBugReportMapper - Enhanced Features', () => {
  const mockConfig: JiraConfig = {
    host: 'https://example.atlassian.net',
    email: 'test@example.com',
    apiToken: 'test-token',
    projectKey: 'PROJ',
    issueType: 'Bug',
    enabled: true,
  };

  const createMockBugReport = (metadata: Record<string, unknown> = {}): BugReport => ({
    id: 'bug-123',
    project_id: 'proj-456',
    organization_id: 'org-789',
    title: 'Test Bug',
    description: 'Test description',
    priority: 'high' as BugPriority,
    status: 'open',
    screenshot_url: null,
    replay_url: null,
    replay_key: null,
    screenshot_key: null,
    thumbnail_key: null,
    upload_status: 'none',
    replay_upload_status: 'none',
    metadata,
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    created_at: new Date('2025-01-15T10:30:00Z'),
    updated_at: new Date('2025-01-15T10:30:00Z'),
  });

  describe('Console Logs', () => {
    it('should include console logs in ADF description when present', () => {
      const consoleLogs = [
        { level: 'error', message: 'Error occurred', timestamp: Date.now() },
        { level: 'warn', message: 'Warning message', timestamp: Date.now() },
        { level: 'log', message: 'Normal log', timestamp: Date.now() },
      ];

      const bugReport = createMockBugReport({ console: consoleLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeConsoleLogs: true });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Console Logs');
      expect(descStr).toContain('Error occurred');
      expect(descStr).toContain('Warning message');
      expect(descStr).toContain('Normal log');
    });

    it('should count errors and warnings correctly', () => {
      const consoleLogs = [
        { level: 'error', message: 'Error 1', timestamp: Date.now() },
        { level: 'error', message: 'Error 2', timestamp: Date.now() },
        { level: 'warn', message: 'Warning 1', timestamp: Date.now() },
        { level: 'log', message: 'Log 1', timestamp: Date.now() },
      ];

      const bugReport = createMockBugReport({ console: consoleLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeConsoleLogs: true });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('2 errors');
      expect(descStr).toContain('1 warnings');
    });

    it('should respect console log limit configuration', () => {
      const consoleLogs = Array.from({ length: 100 }, (_, i) => ({
        level: 'log',
        message: `Log ${i}`,
        timestamp: Date.now() + i,
      }));

      const bugReport = createMockBugReport({ console: consoleLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, {
        includeConsoleLogs: true,
        consoleLogLimit: 10,
      });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      // Should only include last 10 entries
      expect(descStr).toContain('Last 10 console entries');
      expect(descStr).toContain('Log 99'); // Last entry
      expect(descStr).not.toContain('Log 89'); // Should not include 90th entry (index 89)
    });

    it('should not include console logs when disabled in config', () => {
      const consoleLogs = [{ level: 'error', message: 'Error occurred', timestamp: Date.now() }];

      const bugReport = createMockBugReport({ console: consoleLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeConsoleLogs: false });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).not.toContain('Console Logs');
      expect(descStr).not.toContain('Error occurred');
    });

    it('should handle empty console logs array', () => {
      const bugReport = createMockBugReport({ console: [] });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeConsoleLogs: true });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).not.toContain('Console Logs');
    });

    it('should format console logs with timestamps', () => {
      const timestamp = new Date('2025-01-15T10:30:00Z').getTime();
      const consoleLogs = [{ level: 'error', message: 'Test error', timestamp }];

      const bugReport = createMockBugReport({ console: consoleLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeConsoleLogs: true });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('2025-01-15T10:30:00');
      expect(descStr).toContain('ERROR');
      expect(descStr).toContain('Test error');
    });
  });

  describe('Network Logs', () => {
    it('should include network logs in ADF description when present', () => {
      const networkLogs = [
        {
          method: 'GET',
          url: 'https://api.example.com/users',
          status: 404,
          timestamp: Date.now(),
        },
        {
          method: 'POST',
          url: 'https://api.example.com/data',
          status: 500,
          timestamp: Date.now(),
        },
      ];

      const bugReport = createMockBugReport({ network: networkLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeNetworkLogs: true });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Network Logs');
      expect(descStr).toContain('/users');
      expect(descStr).toContain('/data');
    });

    it('should filter failures only by default', () => {
      const networkLogs = [
        {
          method: 'GET',
          url: 'https://api.example.com/success',
          status: 200,
          timestamp: Date.now(),
        },
        {
          method: 'POST',
          url: 'https://api.example.com/not-found',
          status: 404,
          timestamp: Date.now(),
        },
        {
          method: 'GET',
          url: 'https://api.example.com/server-error',
          status: 500,
          timestamp: Date.now(),
        },
      ];

      const bugReport = createMockBugReport({ network: networkLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeNetworkLogs: true }); // Enable logs, default filter: failures
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('→ 404');
      expect(descStr).toContain('→ 500');
      expect(descStr).not.toContain('→ 200'); // Success should be filtered out (check for status code, not timestamp)
    });

    it('should include all network logs when filter is set to all', () => {
      const networkLogs = [
        {
          method: 'GET',
          url: 'https://api.example.com/success',
          status: 200,
          timestamp: Date.now(),
        },
        {
          method: 'POST',
          url: 'https://api.example.com/not-found',
          status: 404,
          timestamp: Date.now(),
        },
      ];

      const bugReport = createMockBugReport({ network: networkLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, {
        includeNetworkLogs: true,
        networkLogFilter: 'all',
      });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('→ 200');
      expect(descStr).toContain('→ 404');
    });

    it('should respect network log limit configuration', () => {
      const networkLogs = Array.from({ length: 50 }, (_, i) => ({
        method: 'GET',
        url: `https://api.example.com/endpoint-${i}`,
        status: 404,
        timestamp: Date.now() + i,
      }));

      const bugReport = createMockBugReport({ network: networkLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, {
        includeNetworkLogs: true,
        networkLogLimit: 5,
      });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      // Should only include last 5 entries
      expect(descStr).toContain('Last 5 network requests');
      expect(descStr).toContain('endpoint-49'); // Last entry
      expect(descStr).not.toContain('endpoint-44'); // Should not include 45th entry (index 44)
    });

    it('should not include network logs when disabled in config', () => {
      const networkLogs = [
        {
          method: 'GET',
          url: 'https://api.example.com/test',
          status: 404,
          timestamp: Date.now(),
        },
      ];

      const bugReport = createMockBugReport({ network: networkLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeNetworkLogs: false });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).not.toContain('Network Logs');
    });

    it('should handle empty network logs array', () => {
      const bugReport = createMockBugReport({ network: [] });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeNetworkLogs: true });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).not.toContain('Network Logs');
    });

    it('should format network logs with method, URL, and status', () => {
      const timestamp = new Date('2025-01-15T10:30:00Z').getTime();
      const networkLogs = [
        {
          method: 'POST',
          url: 'https://api.example.com/users',
          status: 500,
          duration: 1234,
          timestamp,
        },
      ];

      const bugReport = createMockBugReport({ network: networkLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, { includeNetworkLogs: true });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('POST');
      expect(descStr).toContain('/users');
      expect(descStr).toContain('→ 500');
      expect(descStr).toContain('1234ms');
    });
  });

  describe('Share Replay URL', () => {
    it('should include share replay URL when provided', () => {
      const bugReport = createMockBugReport();
      const shareReplayUrl = 'https://bugspotter.example.com/shared/abc123';
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugReport, shareReplayUrl);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Session Replay (Shared)');
      expect(descStr).toContain('abc123');
    });

    it('should prioritize share replay URL over regular replay URL', () => {
      const bugReport = createMockBugReport();
      bugReport.replay_url = 'https://bugspotter.example.com/replay/old-url';
      const shareReplayUrl = 'https://bugspotter.example.com/shared/new-token';
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugReport, shareReplayUrl);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Session Replay (Shared)');
      expect(descStr).toContain('new-token');
      expect(descStr).not.toContain('old-url');
    });

    it('should fall back to replay_url when share URL not provided', () => {
      const bugReport = createMockBugReport();
      bugReport.replay_url = 'https://bugspotter.example.com/replay/original';
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Session Replay');
      expect(descStr).not.toContain('(Shared)');
      expect(descStr).toContain('original');
    });
  });

  describe('Browser Metadata', () => {
    it('should include browser metadata when present', () => {
      const bugReport = createMockBugReport({
        browser: {
          name: 'Chrome',
          version: '120.0.0',
        },
      });
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Browser:');
      expect(descStr).toContain('Chrome');
      expect(descStr).toContain('120.0.0');
    });

    it('should handle missing browser metadata gracefully', () => {
      const bugReport = createMockBugReport({});
      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      // Should not throw error, browser section simply not included
      expect(descStr).toBeDefined();
    });
  });

  describe('Plain Text Format', () => {
    it('should include console logs in plain text format', () => {
      const consoleLogs = [{ level: 'error', message: 'Test error', timestamp: Date.now() }];

      const bugReport = createMockBugReport({ console: consoleLogs });
      const mapper = new JiraBugReportMapper(mockConfig, false, {
        includeConsoleLogs: true,
      }); // Plain text
      const description = mapper.formatDescription(bugReport) as string;

      expect(description).toContain('*🖥️ Console Logs*');
      expect(description).toContain('Test error');
      expect(description).toContain('{code}');
    });

    it('should include network logs in plain text format', () => {
      const networkLogs = [
        {
          method: 'GET',
          url: 'https://api.example.com/test',
          status: 404,
          timestamp: Date.now(),
        },
      ];

      const bugReport = createMockBugReport({ network: networkLogs });
      const mapper = new JiraBugReportMapper(mockConfig, false, {
        includeNetworkLogs: true,
      }); // Plain text
      const description = mapper.formatDescription(bugReport) as string;

      expect(description).toContain('*🌐 Network Logs*');
      expect(description).toContain('GET');
      expect(description).toContain('404');
    });

    it('should include share replay URL in plain text format', () => {
      const bugReport = createMockBugReport();
      const shareReplayUrl = 'https://bugspotter.example.com/shared/token123';
      const mapper = new JiraBugReportMapper(mockConfig, false); // Plain text
      const description = mapper.formatDescription(bugReport, shareReplayUrl) as string;

      expect(description).toContain('🎥 Session Replay (Shared)');
      expect(description).toContain('token123');
    });
  });

  describe('Template Configuration', () => {
    it('should use default configuration when not provided', () => {
      const bugReport = createMockBugReport({
        console: [{ level: 'error', message: 'Error', timestamp: Date.now() }],
        network: [
          { method: 'GET', url: 'https://api.example.com', status: 404, timestamp: Date.now() },
        ],
      });

      const mapper = new JiraBugReportMapper(mockConfig);
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      // Default config: includeConsoleLogs=false, includeNetworkLogs=false (data available in shared replay)
      expect(descStr).not.toContain('Console Logs');
      expect(descStr).not.toContain('Network Logs');
    });

    it('should merge custom config with defaults', () => {
      const consoleLogs = Array.from({ length: 100 }, (_, i) => ({
        level: 'log',
        message: `Log ${i}`,
        timestamp: Date.now(),
      }));

      const bugReport = createMockBugReport({ console: consoleLogs });
      const mapper = new JiraBugReportMapper(mockConfig, true, {
        includeConsoleLogs: true, // Enable console logs for this test
        consoleLogLimit: 25,
        // Other defaults should still apply
      });
      const issue = mapper.toJiraIssue(bugReport);
      const descStr = JSON.stringify(issue.description);

      expect(descStr).toContain('Last 25 console entries');
    });
  });
});
