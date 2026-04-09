/**
 * Tests for Jira ADF (Atlassian Document Format) utilities
 */

import { describe, it, expect } from 'vitest';
import {
  buildJiraAdfDescription,
  adfHeading,
  adfParagraph,
  adfLink,
  adfCodeBlock,
  adfBulletList,
  type AdfNode,
  type BugReportForAdf,
  type ResourceUrls,
  type Environment,
} from '../../../src/integrations/plugin-utils/jira-adf.js';

describe('Plugin Utils - Jira ADF', () => {
  describe('adfHeading', () => {
    it('should create heading with correct structure', () => {
      const heading = adfHeading(2, 'Test Heading');
      expect(heading).toEqual({
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: 'Test Heading' }],
      });
    });

    it('should handle different heading levels', () => {
      const h1 = adfHeading(1, 'H1');
      const h6 = adfHeading(6, 'H6');
      expect(h1.attrs?.level).toBe(1);
      expect(h6.attrs?.level).toBe(6);
    });
  });

  describe('adfParagraph', () => {
    it('should create paragraph with correct structure', () => {
      const paragraph = adfParagraph('This is a paragraph');
      expect(paragraph).toEqual({
        type: 'paragraph',
        content: [{ type: 'text', text: 'This is a paragraph' }],
      });
    });

    it('should handle empty text', () => {
      const paragraph = adfParagraph('');
      expect(paragraph.type).toBe('paragraph');
      expect(paragraph.content).toEqual([{ type: 'text', text: '' }]);
    });
  });

  describe('adfLink', () => {
    it('should create link with correct structure', () => {
      const link = adfLink('Click here', 'https://example.com');
      expect(link).toEqual({
        type: 'text',
        text: 'Click here',
        marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
      });
    });

    it('should handle special characters in URL', () => {
      const link = adfLink('Test', 'https://example.com/path?query=value&foo=bar');
      expect(link.marks?.[0].attrs?.href).toBe('https://example.com/path?query=value&foo=bar');
    });
  });

  describe('adfCodeBlock', () => {
    it('should create code block with default language', () => {
      const codeBlock = adfCodeBlock('console.log("hello");');
      expect(codeBlock).toEqual({
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [{ type: 'text', text: 'console.log("hello");' }],
      });
    });

    it('should create code block with specified language', () => {
      const codeBlock = adfCodeBlock('SELECT * FROM users;', 'sql');
      expect(codeBlock.attrs?.language).toBe('sql');
    });

    it('should handle empty code', () => {
      const codeBlock = adfCodeBlock('');
      expect(codeBlock.type).toBe('codeBlock');
      expect(codeBlock.content).toEqual([{ type: 'text', text: '' }]);
    });
  });

  describe('adfBulletList', () => {
    it('should create bullet list with items', () => {
      const list = adfBulletList(['Item 1', 'Item 2', 'Item 3']);
      expect(list.type).toBe('bulletList');
      expect(list.content).toHaveLength(3);
      expect(list.content?.[0]).toEqual({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Item 1' }],
          },
        ],
      });
    });

    it('should handle empty array', () => {
      const list = adfBulletList([]);
      expect(list.type).toBe('bulletList');
      expect(list.content).toEqual([]);
    });

    it('should handle single item', () => {
      const list = adfBulletList(['Only item']);
      expect(list.content).toHaveLength(1);
    });
  });

  describe('buildJiraAdfDescription', () => {
    const mockBugReport: BugReportForAdf = {
      title: 'Test Bug',
      description: 'This is a test bug description',
      metadata: {
        console: [{ level: 'error', message: 'Test error' }],
        network: [],
      },
    };

    const mockUrls: ResourceUrls = {
      screenshot: 'https://example.com/screenshot.png',
      replay: 'https://example.com/replay.json',
      video: 'https://example.com/video.mp4',
      logs: 'https://example.com/logs.txt',
    };

    const mockEnv: Environment = {
      browser: 'Chrome',
      browserVersion: '120.0.0',
      os: 'Windows 11',
      url: 'https://app.example.com/page',
    };

    const mockConsoleLogs = [
      { level: 'error', message: 'Something went wrong' },
      { level: 'warn', message: 'Warning message' },
    ];

    it('should build complete ADF document with all sections', () => {
      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, mockConsoleLogs);

      expect(adf.type).toBe('doc');
      expect(adf.version).toBe(1);
      expect(adf.content).toBeDefined();
      expect(Array.isArray(adf.content)).toBe(true);
    });

    it('should include description section', () => {
      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, mockConsoleLogs);
      const content = adf.content as AdfNode[];

      // First should be description heading
      expect(content[0].type).toBe('heading');
      expect(content[0].content?.[0].text).toBe('Description');

      // Second should be description paragraph
      expect(content[1].type).toBe('paragraph');
      expect(content[1].content?.[0].text).toBe('This is a test bug description');
    });

    it('should include attachments section when URLs provided', () => {
      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, mockConsoleLogs);
      const content = adf.content as AdfNode[];

      // Find attachments heading
      const attachmentsHeading = content.find(
        (node) => node.type === 'heading' && node.content?.[0].text === 'Attachments'
      );
      expect(attachmentsHeading).toBeDefined();
    });

    it('should skip attachments section when no URLs provided', () => {
      const adf = buildJiraAdfDescription(mockBugReport, {}, mockEnv, mockConsoleLogs);
      const content = adf.content as AdfNode[];

      // Should not have attachments heading
      const attachmentsHeading = content.find(
        (node) => node.type === 'heading' && node.content?.[0].text === 'Attachments'
      );
      expect(attachmentsHeading).toBeUndefined();
    });

    it('should include environment section', () => {
      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, mockConsoleLogs);
      const content = adf.content as AdfNode[];

      // Find environment heading
      const envHeading = content.find(
        (node) => node.type === 'heading' && node.content?.[0].text === 'Environment'
      );
      expect(envHeading).toBeDefined();

      // Find environment bullet list
      const envList = content.find((node) => node.type === 'bulletList');
      expect(envList).toBeDefined();
      expect(envList?.content).toHaveLength(3); // browser+version, os, url
    });

    it('should include console logs section when logs provided', () => {
      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, mockConsoleLogs);
      const content = adf.content as AdfNode[];

      // Find console logs heading
      const logsHeading = content.find(
        (node) => node.type === 'heading' && node.content?.[0].text === 'Console Logs'
      );
      expect(logsHeading).toBeDefined();

      // Find code block
      const codeBlock = content.find((node) => node.type === 'codeBlock');
      expect(codeBlock).toBeDefined();
    });

    it('should skip console logs section when no logs provided', () => {
      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, []);
      const content = adf.content as AdfNode[];

      // Should not have console logs heading
      const logsHeading = content.find(
        (node) => node.type === 'heading' && node.content?.[0].text === 'Console Logs'
      );
      expect(logsHeading).toBeUndefined();
    });

    it('should handle missing description', () => {
      const bugReportNoDesc: BugReportForAdf = {
        title: 'Test Bug',
        description: '',
        metadata: { console: [], network: [] },
      };

      const adf = buildJiraAdfDescription(bugReportNoDesc, mockUrls, mockEnv, mockConsoleLogs);
      const content = adf.content as AdfNode[];

      // Should have default description
      const descParagraph = content.find((node) => node.type === 'paragraph');
      expect(descParagraph?.content?.[0].text).toBe('No description provided');
    });

    it('should handle partial URLs', () => {
      const partialUrls: ResourceUrls = {
        screenshot: 'https://example.com/screenshot.png',
        // Only screenshot, no replay/video/logs
      };

      const adf = buildJiraAdfDescription(mockBugReport, partialUrls, mockEnv, mockConsoleLogs);
      const content = adf.content as AdfNode[];

      // Should still have attachments section
      const attachmentsHeading = content.find(
        (node) => node.type === 'heading' && node.content?.[0].text === 'Attachments'
      );
      expect(attachmentsHeading).toBeDefined();
    });

    it('should format console logs correctly', () => {
      const logs = [
        { level: 'error', message: 'Error 1' },
        { level: 'warn', message: 'Warning 1' },
        { level: 'info', message: 'Info 1' },
      ];

      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, logs);
      const content = adf.content as AdfNode[];

      const codeBlock = content.find((node) => node.type === 'codeBlock');
      expect(codeBlock?.content?.[0].text).toBe('[error] Error 1\n[warn] Warning 1\n[info] Info 1');
    });

    it('should create valid ADF structure for Jira API', () => {
      const adf = buildJiraAdfDescription(mockBugReport, mockUrls, mockEnv, mockConsoleLogs);

      // Validate root structure
      expect(adf).toHaveProperty('type', 'doc');
      expect(adf).toHaveProperty('version', 1);
      expect(adf).toHaveProperty('content');

      // Validate all content nodes have type
      const content = adf.content as AdfNode[];
      content.forEach((node) => {
        expect(node).toHaveProperty('type');
      });
    });

    it('should handle minimal input', () => {
      const minimalReport: BugReportForAdf = {
        title: 'Minimal Bug',
        description: 'Minimal description',
        metadata: { console: [], network: [] },
      };

      const adf = buildJiraAdfDescription(minimalReport, {}, mockEnv, []);

      expect(adf.type).toBe('doc');
      expect(adf.version).toBe(1);
      expect(adf.content).toBeDefined();

      // Should only have description and environment sections
      const content = adf.content as AdfNode[];
      const headings = content.filter((node) => node.type === 'heading');
      expect(headings).toHaveLength(2); // Description + Environment
    });
  });
});
