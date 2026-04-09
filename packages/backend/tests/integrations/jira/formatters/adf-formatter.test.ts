/**
 * ADF Formatter Tests
 * Tests for Atlassian Document Format (Jira Cloud) formatter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ADFFormatter } from '../../../../src/integrations/jira/formatters/adf-formatter.js';
import type { BugReport } from '../../../../src/db/types.js';
import type { JiraDescriptionNode } from '../../../../src/integrations/jira/types.js';

describe('ADF Formatter', () => {
  let formatter: ADFFormatter;
  let mockBugReport: BugReport;

  beforeEach(() => {
    formatter = new ADFFormatter();
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
    it('should return empty array', () => {
      const result = formatter['emptyContent']() as JiraDescriptionNode[];
      expect(result).toEqual([]);
    });
  });

  describe('createSection', () => {
    it('should create ADF section with heading, summary, and code block', () => {
      const result = formatter['createSection']('Test Section', 'Summary text', [
        'line 1',
        'line 2',
        'line 3',
      ]) as JiraDescriptionNode[];

      expect(result).toHaveLength(3);

      // Heading
      expect(result[0].type).toBe('heading');
      expect(result[0].attrs?.level).toBe(3);
      expect(result[0].content?.[0]?.text).toBe('Test Section');
      expect(result[0].content?.[0]?.marks?.[0]?.type).toBe('strong');

      // Summary paragraph
      expect(result[1].type).toBe('paragraph');
      expect(result[1].content?.[0]?.text).toBe('Summary text');

      // Code block
      expect(result[2].type).toBe('codeBlock');
      expect(result[2].attrs?.language).toBe('text');
      expect(result[2].content?.[0]?.text).toBe('line 1\nline 2\nline 3');
    });
  });

  describe('createDetailsSection', () => {
    it('should create ADF details section with labeled fields', () => {
      const fields = [
        { label: 'Field 1', value: 'Value 1' },
        { label: 'Field 2', value: 'Value 2' },
      ];

      const result = formatter['createDetailsSection']('Details', fields) as JiraDescriptionNode[];

      expect(result).toHaveLength(3); // heading + 2 fields

      // Heading
      expect(result[0].type).toBe('heading');
      expect(result[0].content?.[0]?.text).toBe('Details');

      // Field 1
      expect(result[1].type).toBe('paragraph');
      expect(result[1].content?.[0]?.text).toBe('Field 1: ');
      expect(result[1].content?.[0]?.marks?.[0]?.type).toBe('strong');
      expect(result[1].content?.[1]?.text).toBe('Value 1');

      // Field 2
      expect(result[2].type).toBe('paragraph');
      expect(result[2].content?.[0]?.text).toBe('Field 2: ');
      expect(result[2].content?.[1]?.text).toBe('Value 2');
    });
  });

  describe('createAttachmentsSection', () => {
    it('should create ADF attachments section with links', () => {
      const links = [
        { label: 'Screenshot', url: 'https://example.com/screenshot.png' },
        { label: 'Replay', url: 'https://example.com/replay.json' },
      ];

      const result = formatter['createAttachmentsSection'](
        'Attachments',
        links
      ) as JiraDescriptionNode[];

      expect(result).toHaveLength(3); // heading + 2 links (no spacing)

      // Heading
      expect(result[0].type).toBe('heading');
      expect(result[0].content?.[0]?.text).toBe('Attachments');

      // Link 1
      expect(result[1].type).toBe('paragraph');
      expect(result[1].content?.[0]?.text).toBe('Screenshot: ');
      expect(result[1].content?.[1]?.text).toBe('https://example.com/screenshot.png');
      expect(result[1].content?.[1]?.marks?.[0]?.type).toBe('link');
      expect(result[1].content?.[1]?.marks?.[0]?.attrs?.href).toBe(
        'https://example.com/screenshot.png'
      );

      // Link 2
      expect(result[2].type).toBe('paragraph');
      expect(result[2].content?.[1]?.marks?.[0]?.attrs?.href).toBe(
        'https://example.com/replay.json'
      );
    });
  });

  describe('addDescription', () => {
    it('should create ADF paragraph with description (no spacing)', () => {
      const result = formatter.addDescription('Bug description text') as JiraDescriptionNode[];

      expect(result).toHaveLength(1); // Just the paragraph, no spacing

      // Description paragraph
      expect(result[0].type).toBe('paragraph');
      expect(result[0].content?.[0]?.text).toBe('Bug description text');
    });
  });

  describe('addFooter', () => {
    it('should create ADF footer with separator and text (no spacing)', () => {
      const result = formatter.addFooter() as JiraDescriptionNode[];

      expect(result).toHaveLength(2); // Separator + footer text, no spacing

      // Separator
      expect(result[0].type).toBe('paragraph');
      expect(result[0].content?.[0]?.text).toBe('---');

      // Footer text (plain, no italic after refactoring)
      expect(result[1].type).toBe('paragraph');
      expect(result[1].content?.[0]?.text).toBe('Automatically created by BugSpotter');
    });
  });

  describe('Integration - formatBugReportDetails', () => {
    it('should format bug report details with ADF nodes', () => {
      mockBugReport.metadata = {
        browser: {
          name: 'Chrome',
          version: '96.0',
        },
      };

      const result = formatter['formatBugReportDetails'](mockBugReport) as JiraDescriptionNode[];

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('heading');
      expect(result[0].content?.[0]?.text).toBe('Bug Report Details');

      // Should contain Bug Report ID field
      const bugIdField = result.find(
        (node) => node.type === 'paragraph' && node.content?.[0]?.text?.includes('Bug Report ID')
      );
      expect(bugIdField).toBeDefined();
      expect(bugIdField?.content?.[1]?.text).toBe('bug-123');

      // Should contain Browser field
      const browserField = result.find(
        (node) => node.type === 'paragraph' && node.content?.[0]?.text?.includes('Browser')
      );
      expect(browserField).toBeDefined();
      expect(browserField?.content?.[1]?.text).toBe('Chrome 96.0');
    });
  });

  describe('Integration - formatAttachments', () => {
    it('should format attachments with ADF link nodes', () => {
      mockBugReport.screenshot_url = 'https://cdn.example.com/screenshot.png';
      mockBugReport.replay_url = 'https://cdn.example.com/replay.json';

      const result = formatter['formatAttachments'](mockBugReport) as JiraDescriptionNode[];

      expect(result.length).toBeGreaterThan(0);

      // Should have heading
      const heading = result.find((node) => node.type === 'heading');
      expect(heading?.content?.[0]?.text).toBe('Attachments');

      // Should have screenshot link
      const screenshotLink = result.find(
        (node) => node.type === 'paragraph' && node.content?.[0]?.text?.includes('Screenshot')
      );
      expect(screenshotLink).toBeDefined();
      expect(screenshotLink?.content?.[1]?.marks?.[0]?.type).toBe('link');

      // Should have replay link
      const replayLink = result.find(
        (node) => node.type === 'paragraph' && node.content?.[0]?.text?.includes('Session Replay')
      );
      expect(replayLink).toBeDefined();
      expect(replayLink?.content?.[1]?.marks?.[0]?.type).toBe('link');
    });

    it('should return empty array when no attachments', () => {
      const result = formatter['formatAttachments'](mockBugReport) as JiraDescriptionNode[];
      expect(result).toEqual([]);
    });
  });

  describe('ADF Node Structure Validation', () => {
    it('should create valid heading nodes', () => {
      const result = formatter['createSection']('Heading', 'Summary', []) as JiraDescriptionNode[];
      const heading = result[0];

      expect(heading).toMatchObject({
        type: 'heading',
        attrs: { level: 3 },
        content: [
          {
            type: 'text',
            text: 'Heading',
            marks: [{ type: 'strong' }],
          },
        ],
      });
    });

    it('should create valid code block nodes', () => {
      const result = formatter['createSection']('Heading', 'Summary', [
        'code line',
      ]) as JiraDescriptionNode[];
      const codeBlock = result[2];

      expect(codeBlock).toMatchObject({
        type: 'codeBlock',
        attrs: { language: 'text' },
        content: [
          {
            type: 'text',
            text: 'code line',
          },
        ],
      });
    });

    it('should create valid link nodes', () => {
      const links = [{ label: 'Link', url: 'https://example.com' }];
      const result = formatter['createAttachmentsSection']('Links', links) as JiraDescriptionNode[];
      const linkParagraph = result[1]; // Index 1 after removing spacing

      expect(linkParagraph.content?.[1]).toMatchObject({
        type: 'text',
        text: 'https://example.com',
        marks: [
          {
            type: 'link',
            attrs: { href: 'https://example.com' },
          },
        ],
      });
    });
  });
});
