/**
 * Plain Text Formatter Tests
 * Tests for plain text (Jira wiki markup) formatter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PlainTextFormatter } from '../../../../src/integrations/jira/formatters/plain-text-formatter.js';
import type { BugReport } from '../../../../src/db/types.js';

describe('Plain Text Formatter', () => {
  let formatter: PlainTextFormatter;
  let mockBugReport: BugReport;

  beforeEach(() => {
    formatter = new PlainTextFormatter();
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

  describe('emptyContent', () => {
    it('should return empty string', () => {
      const result = formatter['emptyContent']();
      expect(result).toBe('');
    });
  });

  describe('createSection', () => {
    it('should format section with wiki markup', () => {
      const result = formatter['createSection']('Test Section', 'Summary text', [
        'line 1',
        'line 2',
        'line 3',
      ]);

      expect(result).toContain('*Test Section*');
      expect(result).toContain('Summary text');
      expect(result).toContain('{code}');
      expect(result).toContain('line 1');
      expect(result).toContain('line 2');
      expect(result).toContain('line 3');
      // Implementation adds double newline at end for spacing between sections
      expect(result).toBe(
        '*Test Section*\nSummary text\n{code}\nline 1\nline 2\nline 3\n{code}\n\n'
      );
    });

    it('should handle empty log lines', () => {
      const result = formatter['createSection']('Heading', 'Summary', []);

      expect(result).toContain('*Heading*');
      expect(result).toContain('Summary');
      expect(result).toContain('{code}');
      expect(result).toContain('{code}');
    });
  });

  describe('createDetailsSection', () => {
    it('should format details with bold labels', () => {
      const fields = [
        { label: 'Field 1', value: 'Value 1' },
        { label: 'Field 2', value: 'Value 2' },
      ];

      const result = formatter['createDetailsSection']('Details', fields);

      expect(result).toContain('*Details*');
      expect(result).toContain('*Field 1:* Value 1');
      expect(result).toContain('*Field 2:* Value 2');
      expect(result).toBe('*Details*\n*Field 1:* Value 1\n*Field 2:* Value 2\n\n');
    });

    it('should handle empty fields array', () => {
      const result = formatter['createDetailsSection']('Details', []);

      expect(result).toContain('*Details*');
      expect(result).toBe('*Details*\n\n');
    });
  });

  describe('createAttachmentsSection', () => {
    it('should format attachments with links', () => {
      const links = [
        { label: 'Screenshot', url: 'https://example.com/screenshot.png' },
        { label: 'Replay', url: 'https://example.com/replay.json' },
      ];

      const result = formatter['createAttachmentsSection']('Attachments', links);

      expect(result).toContain('*Attachments*');
      expect(result).toContain('Screenshot: https://example.com/screenshot.png');
      expect(result).toContain('Replay: https://example.com/replay.json');
      expect(result).toBe(
        '*Attachments*\nScreenshot: https://example.com/screenshot.png\nReplay: https://example.com/replay.json\n\n'
      );
    });

    it('should handle empty links array', () => {
      const result = formatter['createAttachmentsSection']('Attachments', []);

      expect(result).toContain('*Attachments*');
      expect(result).toBe('*Attachments*\n\n');
    });
  });

  describe('addDescription', () => {
    it('should add description with double newline', () => {
      const result = formatter.addDescription('Bug description text');

      expect(result).toBe('Bug description text\n\n');
    });

    it('should handle multiline descriptions', () => {
      const description = 'Line 1\nLine 2\nLine 3';
      const result = formatter.addDescription(description);

      expect(result).toBe('Line 1\nLine 2\nLine 3\n\n');
    });
  });

  describe('addFooter', () => {
    it('should create footer with separator and italic text', () => {
      const result = formatter.addFooter();

      expect(result).toContain('---');
      expect(result).toContain('_Automatically created by BugSpotter_');
      expect(result).toBe('---\n_Automatically created by BugSpotter_');
    });
  });

  describe('Wiki Markup Validation', () => {
    it('should use correct bold syntax', () => {
      const result = formatter['createSection']('Bold', 'text', []);
      expect(result).toMatch(/\*Bold\*/);
    });

    it('should use correct code block syntax', () => {
      const result = formatter['createSection']('H', 'text', ['code']);
      expect(result).toContain('{code}');
      expect(result).toContain('code');
      expect(result).toMatch(/\{code\}\ncode\n\{code\}/);
    });

    it('should use correct italic syntax in footer', () => {
      const result = formatter.addFooter();
      expect(result).toMatch(/_[^_]+_/);
    });

    it('should use correct horizontal rule syntax', () => {
      const result = formatter.addFooter();
      expect(result).toContain('---');
    });
  });

  describe('Integration - formatBugReportDetails', () => {
    it('should format bug report details with wiki markup', () => {
      mockBugReport.metadata = {
        browser: {
          name: 'Firefox',
          version: '95.0',
        },
      };

      const result = formatter['formatBugReportDetails'](mockBugReport);

      expect(result).toContain('*Bug Report Details*');
      expect(result).toContain('*Bug Report ID:* bug-123');
      expect(result).toContain('*Status:* OPEN'); // Status is uppercased
      expect(result).toContain('*Browser:* Firefox 95.0');
    });

    it('should handle missing browser metadata', () => {
      const result = formatter['formatBugReportDetails'](mockBugReport);

      expect(result).toContain('*Bug Report Details*');
      expect(result).toContain('*Bug Report ID:*');
      expect(result).not.toContain('*Browser:*');
    });
  });

  describe('Integration - formatAttachments', () => {
    it('should format attachments with wiki markup', () => {
      mockBugReport.screenshot_url = 'https://cdn.example.com/screenshot.png';
      mockBugReport.replay_url = 'https://cdn.example.com/replay.json';

      const result = formatter['formatAttachments'](mockBugReport);

      expect(result).toContain('*Attachments*');
      expect(result).toContain('Screenshot: https://cdn.example.com/screenshot.png');
      expect(result).toContain('Session Replay: https://cdn.example.com/replay.json');
    });

    it('should prefer share replay URL over regular replay URL', () => {
      mockBugReport.replay_url = 'https://cdn.example.com/replay.json';
      const shareReplayUrl = 'https://share.example.com/replay/abc123';

      const result = formatter['formatAttachments'](mockBugReport, shareReplayUrl);

      expect(result).toContain(shareReplayUrl);
      expect(result).not.toContain(mockBugReport.replay_url);
    });

    it('should return empty string when no attachments', () => {
      const result = formatter['formatAttachments'](mockBugReport);
      expect(result).toBe('');
    });
  });

  describe('String Structure Validation', () => {
    it('should end sections with double newline for spacing', () => {
      const result = formatter['createSection']('H', 'text', ['code']);
      expect(result.endsWith('\n')).toBe(true);
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should end details sections with double newline for spacing', () => {
      const fields = [{ label: 'Field', value: 'Value' }];
      const result = formatter['createDetailsSection']('Details', fields);
      expect(result.endsWith('\n')).toBe(true);
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should end attachments sections with double newline for spacing', () => {
      const links = [{ label: 'Link', url: 'https://example.com' }];
      const result = formatter['createAttachmentsSection']('Links', links);
      expect(result.endsWith('\n')).toBe(true);
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should separate log lines with single newline', () => {
      const result = formatter['createSection']('H', 'text', ['line1', 'line2', 'line3']);
      expect(result).toContain('line1\nline2\nline3');
    });
  });
});
