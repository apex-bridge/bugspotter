/**
 * Base Formatter Tests
 * Tests for shared formatter logic and type guards
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isConsoleLogEntry,
  isNetworkLogEntry,
  JiraDescriptionFormatter,
} from '../../../../src/integrations/jira/formatters/base-formatter.js';
import type {
  ConsoleLogEntry,
  NetworkLogEntry,
} from '../../../../src/integrations/jira/formatters/base-formatter.js';
import type { BugReport } from '../../../../src/db/types.js';

/**
 * Mock formatter implementation for testing protected methods
 */
class MockFormatter extends JiraDescriptionFormatter {
  protected emptyContent(): string {
    return '';
  }

  protected createSection(heading: string, summary: string, logLines: string[]): string {
    return `SECTION: ${heading}\n${summary}\n${logLines.join('\n')}`;
  }

  protected createDetailsSection(
    heading: string,
    fields: Array<{ label: string; value: string }>
  ): string {
    const fieldLines = fields.map((f) => `${f.label}: ${f.value}`);
    return `DETAILS: ${heading}\n${fieldLines.join('\n')}`;
  }

  protected createAttachmentsSection(
    heading: string,
    links: Array<{ label: string; url: string }>
  ): string {
    const linkLines = links.map((l) => `${l.label}: ${l.url}`);
    return `ATTACHMENTS: ${heading}\n${linkLines.join('\n')}`;
  }

  public addDescription(description: string): string {
    return `DESC: ${description}`;
  }

  public addFooter(): string {
    return 'FOOTER';
  }
}

describe('Base Formatter - Type Guards', () => {
  describe('isConsoleLogEntry', () => {
    it('should accept valid console log entry', () => {
      const entry = {
        level: 'error',
        message: 'Test error',
        timestamp: 1638360000000,
      };

      expect(isConsoleLogEntry(entry)).toBe(true);
    });

    it('should accept console log entry with args', () => {
      const entry = {
        level: 'log',
        message: 'Test log',
        timestamp: 1638360000000,
        args: ['arg1', 'arg2'],
      };

      expect(isConsoleLogEntry(entry)).toBe(true);
    });

    it('should accept all valid log levels', () => {
      const levels = ['log', 'info', 'warn', 'error', 'debug'];

      levels.forEach((level) => {
        const entry = {
          level,
          message: 'Test message',
          timestamp: 1638360000000,
        };
        expect(isConsoleLogEntry(entry)).toBe(true);
      });
    });

    it('should reject null', () => {
      expect(isConsoleLogEntry(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isConsoleLogEntry(undefined)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(isConsoleLogEntry('test')).toBe(false);
      expect(isConsoleLogEntry(123)).toBe(false);
      expect(isConsoleLogEntry(true)).toBe(false);
    });

    it('should reject invalid level', () => {
      const entry = {
        level: 'invalid',
        message: 'Test',
        timestamp: 1638360000000,
      };

      expect(isConsoleLogEntry(entry)).toBe(false);
    });

    it('should reject missing level', () => {
      const entry = {
        message: 'Test',
        timestamp: 1638360000000,
      };

      expect(isConsoleLogEntry(entry)).toBe(false);
    });

    it('should reject missing message', () => {
      const entry = {
        level: 'error',
        timestamp: 1638360000000,
      };

      expect(isConsoleLogEntry(entry)).toBe(false);
    });

    it('should reject missing timestamp', () => {
      const entry = {
        level: 'error',
        message: 'Test',
      };

      expect(isConsoleLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for level', () => {
      const entry = {
        level: 123,
        message: 'Test',
        timestamp: 1638360000000,
      };

      expect(isConsoleLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for message', () => {
      const entry = {
        level: 'error',
        message: 123,
        timestamp: 1638360000000,
      };

      expect(isConsoleLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for timestamp', () => {
      const entry = {
        level: 'error',
        message: 'Test',
        timestamp: '1638360000000',
      };

      expect(isConsoleLogEntry(entry)).toBe(false);
    });
  });

  describe('isNetworkLogEntry', () => {
    it('should accept valid network log entry', () => {
      const entry = {
        method: 'GET',
        url: 'https://api.example.com',
        timestamp: 1638360000000,
      };

      expect(isNetworkLogEntry(entry)).toBe(true);
    });

    it('should accept network log entry with optional fields', () => {
      const entry = {
        method: 'POST',
        url: 'https://api.example.com',
        status: 200,
        statusText: 'OK',
        timestamp: 1638360000000,
        duration: 123,
        requestHeaders: { 'content-type': 'application/json' },
        responseHeaders: { 'content-type': 'application/json' },
      };

      expect(isNetworkLogEntry(entry)).toBe(true);
    });

    it('should reject null', () => {
      expect(isNetworkLogEntry(null)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isNetworkLogEntry(undefined)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(isNetworkLogEntry('test')).toBe(false);
      expect(isNetworkLogEntry(123)).toBe(false);
    });

    it('should reject missing method', () => {
      const entry = {
        url: 'https://api.example.com',
        timestamp: 1638360000000,
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });

    it('should reject missing url', () => {
      const entry = {
        method: 'GET',
        timestamp: 1638360000000,
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });

    it('should reject missing timestamp', () => {
      const entry = {
        method: 'GET',
        url: 'https://api.example.com',
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for method', () => {
      const entry = {
        method: 123,
        url: 'https://api.example.com',
        timestamp: 1638360000000,
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for url', () => {
      const entry = {
        method: 'GET',
        url: 123,
        timestamp: 1638360000000,
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for timestamp', () => {
      const entry = {
        method: 'GET',
        url: 'https://api.example.com',
        timestamp: '1638360000000',
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for optional status', () => {
      const entry = {
        method: 'GET',
        url: 'https://api.example.com',
        timestamp: 1638360000000,
        status: '200',
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });

    it('should reject wrong type for optional duration', () => {
      const entry = {
        method: 'GET',
        url: 'https://api.example.com',
        timestamp: 1638360000000,
        duration: '123',
      };

      expect(isNetworkLogEntry(entry)).toBe(false);
    });
  });
});

describe('Base Formatter - Protected Methods', () => {
  let formatter: MockFormatter;
  let mockBugReport: BugReport;

  beforeEach(() => {
    formatter = new MockFormatter();
    mockBugReport = {
      id: 'bug-123',
      project_id: 'proj-1',
      status: 'open',
      title: 'Test bug',
      description: 'Test description',
      created_at: new Date('2021-12-01T12:00:00Z'),
      updated_at: new Date('2021-12-01T12:00:00Z'),
      screenshot_key: null,
      screenshot_url: null,
      thumbnail_key: null,
      replay_key: null,
      replay_url: null,
      upload_status: 'pending',
      replay_upload_status: 'pending',
      metadata: {},
      priority: 'medium',
      deleted_at: null,
      deleted_by: null,
      legal_hold: false,
    };
  });

  describe('formatConsoleLogs', () => {
    it('should return empty content for empty entries', () => {
      const result = formatter.formatConsoleLogs([], 0, 0);
      expect(result).toBe('');
    });

    it('should format console logs with counts', () => {
      const entries: ConsoleLogEntry[] = [
        { level: 'error', message: 'Error 1', timestamp: 1638360000000 },
        { level: 'warn', message: 'Warning 1', timestamp: 1638360001000 },
      ];

      const result = formatter.formatConsoleLogs(entries, 1, 1);

      expect(result).toContain('SECTION: 🖥️ Console Logs');
      expect(result).toContain('Last 2 console entries (1 errors, 1 warnings)');
      expect(result).toContain('ERROR Error 1');
      expect(result).toContain('WARN  Warning 1');
    });

    it('should format timestamps as ISO strings', () => {
      const entries: ConsoleLogEntry[] = [
        { level: 'log', message: 'Test', timestamp: 1638360000000 },
      ];

      const result = formatter.formatConsoleLogs(entries, 0, 0);

      expect(result).toContain('2021-12-01T12:00:00.000Z');
    });

    it('should pad log levels correctly', () => {
      const entries: ConsoleLogEntry[] = [
        { level: 'log', message: 'Test 1', timestamp: 1638360000000 },
        { level: 'error', message: 'Test 2', timestamp: 1638360001000 },
        { level: 'debug', message: 'Test 3', timestamp: 1638360002000 },
      ];

      const result = formatter.formatConsoleLogs(entries, 1, 0);

      expect(result).toContain('LOG  ');
      expect(result).toContain('ERROR');
      expect(result).toContain('DEBUG');
    });
  });

  describe('formatNetworkLogs', () => {
    it('should return empty content for empty entries', () => {
      const result = formatter.formatNetworkLogs([]);
      expect(result).toBe('');
    });

    it('should format network logs', () => {
      const entries: NetworkLogEntry[] = [
        {
          method: 'GET',
          url: 'https://api.example.com/users',
          status: 200,
          timestamp: 1638360000000,
        },
        {
          method: 'POST',
          url: 'https://api.example.com/data',
          status: 500,
          timestamp: 1638360001000,
        },
      ];

      const result = formatter.formatNetworkLogs(entries);

      expect(result).toContain('SECTION: 🌐 Network Logs');
      expect(result).toContain('Last 2 network requests');
      expect(result).toContain('GET https://api.example.com/users → 200');
      expect(result).toContain('POST https://api.example.com/data → 500');
    });

    it('should handle missing status', () => {
      const entries: NetworkLogEntry[] = [
        {
          method: 'GET',
          url: 'https://api.example.com/users',
          timestamp: 1638360000000,
        },
      ];

      const result = formatter.formatNetworkLogs(entries);

      expect(result).toContain('GET https://api.example.com/users → ---');
    });

    it('should include duration when present', () => {
      const entries: NetworkLogEntry[] = [
        {
          method: 'GET',
          url: 'https://api.example.com/users',
          status: 200,
          duration: 123,
          timestamp: 1638360000000,
        },
      ];

      const result = formatter.formatNetworkLogs(entries);

      expect(result).toContain('(123ms)');
    });

    it('should omit duration when not present', () => {
      const entries: NetworkLogEntry[] = [
        {
          method: 'GET',
          url: 'https://api.example.com/users',
          status: 200,
          timestamp: 1638360000000,
        },
      ];

      const result = formatter.formatNetworkLogs(entries);

      expect(result).not.toContain('ms)');
    });
  });

  describe('formatBugReportDetails', () => {
    it('should format basic bug report details', () => {
      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('DETAILS: Bug Report Details');
      expect(result).toContain('Bug Report ID: bug-123');
      expect(result).toContain('Status: OPEN');
      expect(result).toContain('Created: 2021-12-01T12:00:00.000Z');
    });

    it('should include browser when present as object', () => {
      mockBugReport.metadata = {
        browser: {
          name: 'Chrome',
          version: '96.0.4664.110',
        },
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('Browser: Chrome 96.0.4664.110');
    });

    it('should handle partial browser metadata', () => {
      mockBugReport.metadata = {
        browser: {
          name: 'Firefox',
        },
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('Browser: Firefox'); // No trailing space after trim()
    });

    it('should skip browser when invalid format', () => {
      mockBugReport.metadata = {
        browser: 'Chrome 96',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).not.toContain('Browser:');
    });

    it('should include OS when present', () => {
      mockBugReport.metadata = {
        os: 'Windows 11',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('OS: Windows 11');
    });

    it('should include screen resolution when present', () => {
      mockBugReport.metadata = {
        screen: '1920x1080',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('Screen: 1920x1080');
    });

    it('should include user agent when present', () => {
      mockBugReport.metadata = {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('User Agent: Mozilla/5.0');
    });

    it('should include URL when present', () => {
      mockBugReport.metadata = {
        url: 'https://example.com/page',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('URL: https://example.com/page');
    });

    it('should include Source when present in metadata', () => {
      mockBugReport.metadata = {
        source: 'extension',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('Source: extension');
    });

    it('should include API Key with ellipsis when present in metadata', () => {
      mockBugReport.metadata = {
        apiKeyPrefix: 'bgs_12345',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('API Key: bgs_12345...');
    });

    it('should not include Source when missing from metadata', () => {
      mockBugReport.metadata = {};

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).not.toContain('Source:');
    });

    it('should not include API Key when missing from metadata', () => {
      mockBugReport.metadata = {};

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).not.toContain('API Key:');
    });

    it('should include all metadata fields when present', () => {
      mockBugReport.metadata = {
        browser: { name: 'Chrome', version: '96.0' },
        os: 'Windows 11',
        screen: '1920x1080',
        userAgent: 'Mozilla/5.0...',
        url: 'https://example.com',
      };

      const result = formatter.formatBugReportDetails(mockBugReport);

      expect(result).toContain('Browser: Chrome 96.0');
      expect(result).toContain('OS: Windows 11');
      expect(result).toContain('Screen: 1920x1080');
      expect(result).toContain('User Agent: Mozilla/5.0');
      expect(result).toContain('URL: https://example.com');
    });
  });

  describe('formatAttachments', () => {
    it('should return empty content when no attachments', () => {
      const result = formatter.formatAttachments(mockBugReport);
      expect(result).toBe('');
    });

    it('should format screenshot URL', () => {
      mockBugReport.screenshot_key = 'screenshot.png';
      mockBugReport.screenshot_url = 'https://cdn.example.com/screenshot.png';
      mockBugReport.upload_status = 'completed';

      const result = formatter.formatAttachments(mockBugReport);

      expect(result).toContain('ATTACHMENTS: Attachments');
      expect(result).toContain('📸 Screenshot: https://cdn.example.com/screenshot.png');
    });

    it('should format replay URL', () => {
      mockBugReport.replay_key = 'replay.json';
      mockBugReport.replay_url = 'https://cdn.example.com/replay.json';
      mockBugReport.replay_upload_status = 'completed';

      const result = formatter.formatAttachments(mockBugReport);

      expect(result).toContain('🎥 Session Replay: https://cdn.example.com/replay.json');
    });

    it('should prefer share replay URL over regular replay URL', () => {
      mockBugReport.replay_key = 'replay.json';
      mockBugReport.replay_url = 'https://cdn.example.com/replay.json';
      mockBugReport.replay_upload_status = 'completed';

      const shareReplayUrl = 'https://cdn.example.com/shared/abc123';
      const result = formatter.formatAttachments(mockBugReport, shareReplayUrl);

      expect(result).toContain('🎥 Session Replay (Shared): https://cdn.example.com/shared/abc123');
      expect(result).not.toContain('https://cdn.example.com/replay.json');
    });

    it('should format both screenshot and replay URLs', () => {
      mockBugReport.screenshot_key = 'screenshot.png';
      mockBugReport.screenshot_url = 'https://cdn.example.com/screenshot.png';
      mockBugReport.replay_key = 'replay.json';
      mockBugReport.replay_url = 'https://cdn.example.com/replay.json';
      mockBugReport.upload_status = 'completed';
      mockBugReport.replay_upload_status = 'completed';

      const result = formatter.formatAttachments(mockBugReport);

      expect(result).toContain('📸 Screenshot');
      expect(result).toContain('🎥 Session Replay');
    });
  });
});
