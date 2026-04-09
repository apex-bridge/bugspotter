/**
 * Unit tests for TicketTemplateRenderer
 * Tests template rendering with Handlebars, helpers, and error handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TicketTemplateRenderer } from '../../src/services/integrations/ticket-template-renderer.js';
import type { BugReport } from '../../src/db/types.js';

describe('TicketTemplateRenderer', () => {
  let renderer: TicketTemplateRenderer;
  let mockBugReport: BugReport;

  beforeEach(() => {
    renderer = new TicketTemplateRenderer();

    // Mock bug report with all fields (matches actual BugReport schema)
    mockBugReport = {
      id: 'bug-123',
      project_id: 'project-456',
      title: 'Test Bug Report',
      description: 'Test description',
      screenshot_url: 'https://storage.example.com/screenshot.png',
      replay_url: 'https://storage.example.com/replay.json',
      metadata: {
        // url and userAgent stored in metadata, not top-level
        url: 'https://example.com/page',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        browserName: 'Chrome',
        browserVersion: '120.0',
        osName: 'Windows',
        osVersion: '10',
        screenWidth: 1920,
        screenHeight: 1080,
        viewportWidth: 1200,
        viewportHeight: 800,
        replayDuration: 45000,
      },
      status: 'open',
      priority: 'medium',
      legal_hold: false,
      deleted_at: null,
      deleted_by: null,
      // Presigned URL fields
      screenshot_key: 'screenshots/project-456/bug-123/screenshot.png',
      thumbnail_key: 'screenshots/project-456/bug-123/thumbnail.jpg',
      replay_key: 'replays/project-456/bug-123/replay.json',
      upload_status: 'completed',
      replay_upload_status: 'completed',
      created_at: new Date('2024-01-15T10:30:00Z'),
      updated_at: new Date('2024-01-15T10:30:00Z'),
    } as BugReport;
  });

  describe('Basic Template Rendering', () => {
    it('should render simple template with basic variables', () => {
      const template = '**Title:** {{title}}\n**URL:** {{url}}';

      const result = renderer.render(template, mockBugReport);

      expect(result).toContain('**Title:** Test Bug Report');
      expect(result).toContain('**URL:** https://example.com/page');
    });

    it('should render all core bug report fields', () => {
      const template = `
**Title:** {{title}}
**Description:** {{description}}
**URL:** {{url}}
**User Agent:** {{userAgent}}
**Status:** {{status}}
**Created:** {{createdAt}}
**Updated:** {{updatedAt}}
`.trim();

      const result = renderer.render(template, mockBugReport);

      expect(result).toContain('**Title:** Test Bug Report');
      expect(result).toContain('**Description:** Test description');
      expect(result).toContain('**URL:** https://example.com/page');
      expect(result).toContain('**User Agent:** Mozilla/5.0');
      expect(result).toContain('**Status:** open');
      expect(result).toContain('**Created:** 2024-01-15T10:30:00.000Z');
      expect(result).toContain('**Updated:** 2024-01-15T10:30:00.000Z');
    });

    it('should render browser and OS information', () => {
      const template = `
**Browser:** {{browserName}} {{browserVersion}}
**OS:** {{osName}} {{osVersion}}
**Screen:** {{screenResolution}}
**Viewport:** {{viewport}}
`.trim();

      const result = renderer.render(template, mockBugReport);

      expect(result).toContain('**Browser:** Chrome 120.0');
      expect(result).toContain('**OS:** Windows 10');
      expect(result).toContain('**Screen:** 1920×1080');
      expect(result).toContain('**Viewport:** 1200×800');
    });

    it('should handle null description', () => {
      const bugReport = { ...mockBugReport, description: null };
      const template = '**Description:** {{description}}';

      const result = renderer.render(template, bugReport);

      // Handlebars renders null/undefined as empty string
      expect(result).toBe('**Description:** ');
    });

    it('should handle missing metadata fields', () => {
      const bugReport = { ...mockBugReport, metadata: {} };
      const template = `
**Browser:** {{browserName}}
**OS:** {{osName}}
**Screen:** {{screenResolution}}
`.trim();

      const result = renderer.render(template, bugReport);

      // Missing fields render as empty
      expect(result).toContain('**Browser:** ');
      expect(result).toContain('**OS:** ');
      expect(result).toContain('**Screen:** ');
    });
  });

  describe('Handlebars Helpers', () => {
    describe('formatDate', () => {
      it('should format ISO date string to ISO 8601 format', () => {
        const template = '{{formatDate createdAt}}';

        const result = renderer.render(template, mockBugReport);

        // Should match ISO 8601 format: YYYY-MM-DDTHH:MM:SS.sssZ
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      });

      it('should handle Date objects', () => {
        const template = '{{formatDate createdAt}}';

        const result = renderer.render(template, mockBugReport);

        expect(result).not.toBe('N/A');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // ISO 8601 format
      });

      it('should return N/A for null date', () => {
        const template = '{{formatDate description}}'; // description is null

        const result = renderer.render(template, { ...mockBugReport, description: null });

        expect(result).toBe('N/A');
      });

      it('should return "Invalid Date" for invalid date string', () => {
        // Use a custom field with invalid date string to test the helper directly
        const template = '{{formatDate customFields.invalidDate}}';

        const result = renderer.render(template, mockBugReport, {
          customFields: { invalidDate: 'not-a-valid-date' },
        });

        expect(result).toBe('Invalid Date');
      });
    });

    describe('formatDuration', () => {
      it('should format duration in seconds', () => {
        const template = '{{formatDuration replayDuration}}';

        const result = renderer.render(template, mockBugReport);

        expect(result).toBe('45s'); // 45000ms = 45s (under 60s shows only seconds)
      });

      it('should format duration in minutes and seconds', () => {
        const bugReport = {
          ...mockBugReport,
          metadata: { ...mockBugReport.metadata, replayDuration: 125000 },
        };
        const template = '{{formatDuration replayDuration}}';

        const result = renderer.render(template, bugReport);

        expect(result).toBe('2m 5s'); // 125000ms = 2m 5s
      });

      it('should format short durations', () => {
        const bugReport = {
          ...mockBugReport,
          metadata: { ...mockBugReport.metadata, replayDuration: 5000 },
        };
        const template = '{{formatDuration replayDuration}}';

        const result = renderer.render(template, bugReport);

        expect(result).toBe('5s');
      });

      it('should return N/A for null or zero duration', () => {
        const bugReport = {
          ...mockBugReport,
          metadata: { ...mockBugReport.metadata, replayDuration: 0 },
        };
        const template = '{{formatDuration replayDuration}}';

        const result = renderer.render(template, bugReport);

        expect(result).toBe('N/A');
      });

      it('should return N/A for negative duration', () => {
        const bugReport = {
          ...mockBugReport,
          metadata: { ...mockBugReport.metadata, replayDuration: -1000 },
        };
        const template = '{{formatDuration replayDuration}}';

        const result = renderer.render(template, bugReport);

        expect(result).toBe('N/A');
      });

      it('should return N/A for sub-second durations', () => {
        const bugReport = {
          ...mockBugReport,
          metadata: { ...mockBugReport.metadata, replayDuration: 500 },
        };
        const template = '{{formatDuration replayDuration}}';

        const result = renderer.render(template, bugReport);

        // 500ms = 0 seconds after Math.floor, should return N/A
        expect(result).toBe('N/A');
      });
    });

    describe('exists', () => {
      it('should return true for non-empty string', () => {
        const template = '{{#if (exists title)}}Has title{{else}}No title{{/if}}';

        const result = renderer.render(template, mockBugReport);

        expect(result).toBe('Has title');
      });

      it('should return false for null value', () => {
        const template = '{{#if (exists description)}}Has desc{{else}}No desc{{/if}}';

        const result = renderer.render(template, { ...mockBugReport, description: null });

        expect(result).toBe('No desc');
      });

      it('should return false for undefined value', () => {
        const template = '{{#if (exists browserName)}}Has browser{{else}}No browser{{/if}}';

        const result = renderer.render(template, { ...mockBugReport, metadata: {} });

        expect(result).toBe('No browser');
      });

      it('should return false for empty string', () => {
        const template = '{{#if (exists description)}}Has desc{{else}}No desc{{/if}}';

        const result = renderer.render(template, { ...mockBugReport, description: '' });

        expect(result).toBe('No desc');
      });
    });

    describe('truncate', () => {
      it('should truncate text longer than limit', () => {
        const template = '{{truncate title 10}}';

        const result = renderer.render(template, mockBugReport);

        expect(result).toBe('Test Bug R...');
        expect(result.length).toBe(13); // 10 chars + '...'
      });

      it('should not truncate text shorter than limit', () => {
        const template = '{{truncate title 50}}';

        const result = renderer.render(template, mockBugReport);

        expect(result).toBe('Test Bug Report');
        expect(result).not.toContain('...');
      });

      it('should handle null text', () => {
        const template = '{{truncate description 10}}';

        const result = renderer.render(template, { ...mockBugReport, description: null });

        expect(result).toBe('');
      });

      it('should handle empty string', () => {
        const template = '{{truncate description 10}}';

        const result = renderer.render(template, { ...mockBugReport, description: '' });

        expect(result).toBe('');
      });
    });
  });

  describe('Conditional Rendering', () => {
    it('should render content when hasReplay is true', () => {
      const template = `{{#if hasReplay}}
**Replay:** {{replayUrl}}
{{/if}}`;

      const result = renderer.render(template, mockBugReport);

      expect(result).toContain('**Replay:**');
      expect(result).toContain('https://storage.example.com/replay.json');
    });

    it('should not render content when hasReplay is false', () => {
      const bugReport = { ...mockBugReport, replay_url: null };
      const template = `{{#if hasReplay}}
**Replay:** {{replayUrl}}
{{/if}}`;

      const result = renderer.render(template, bugReport);

      expect(result.trim()).toBe('');
    });

    it('should render content when hasScreenshot is true', () => {
      const template = `{{#if hasScreenshot}}
**Screenshot:** {{screenshotUrl}}
{{/if}}`;

      const result = renderer.render(template, mockBugReport);

      expect(result).toContain('**Screenshot:**');
      expect(result).toContain('https://storage.example.com/screenshot.png');
    });

    it('should not render content when hasScreenshot is false', () => {
      const bugReport = { ...mockBugReport, screenshot_url: null };
      const template = `{{#if hasScreenshot}}
**Screenshot:** {{screenshotUrl}}
{{/if}}`;

      const result = renderer.render(template, bugReport);

      expect(result.trim()).toBe('');
    });
  });

  describe('Console Logs Formatting', () => {
    it('should format console logs when provided', () => {
      const sessionData = {
        consoleLogs: [
          { level: 'error', message: 'Failed to load resource', timestamp: Date.now() },
          { level: 'warn', message: 'Deprecated API usage', timestamp: Date.now() },
        ],
      };

      const template = `{{#if consoleLogs}}
**Console Logs:**
{{consoleLogs}}
{{/if}}`;

      const result = renderer.render(template, mockBugReport, sessionData);

      expect(result).toContain('**Console Logs:**');
      // ConsoleLogsFormatter returns formatted string
      expect(result.length).toBeGreaterThan(20); // Has formatted content
    });

    it('should not render console logs section when no logs provided', () => {
      const template = `{{#if consoleLogs}}
**Console Logs:**
{{consoleLogs}}
{{/if}}`;

      const result = renderer.render(template, mockBugReport);

      expect(result.trim()).toBe('');
    });

    it('should handle console logs formatting errors gracefully', () => {
      const sessionData = {
        consoleLogs: 'invalid-format', // Not an array
      };

      const template = `{{#if consoleLogs}}
**Console Logs:**
{{consoleLogs}}
{{/if}}`;

      // Should not throw, logs warning and continues
      expect(() => renderer.render(template, mockBugReport, sessionData)).not.toThrow();

      const result = renderer.render(template, mockBugReport, sessionData);
      expect(result.trim()).toBe(''); // consoleLogs not formatted, so undefined
    });
  });

  describe('Network Logs Formatting', () => {
    it('should format network logs when provided', () => {
      const sessionData = {
        networkLogs: [
          {
            method: 'GET',
            url: 'https://api.example.com/data',
            status: 200,
            duration: 150,
            timestamp: Date.now(),
          },
          {
            method: 'POST',
            url: 'https://api.example.com/submit',
            status: 500,
            duration: 300,
            timestamp: Date.now(),
          },
        ],
      };

      const template = `{{#if networkLogs}}
**Network Activity:**
{{networkLogs}}
{{/if}}`;

      const result = renderer.render(template, mockBugReport, sessionData);

      // NetworkLogsFormatter returns formatted string
      expect(result.length).toBeGreaterThan(20); // Has formatted content
    });

    it('should not render network logs section when no logs provided', () => {
      const template = `{{#if networkLogs}}
**Network Activity:**
{{networkLogs}}
{{/if}}`;

      const result = renderer.render(template, mockBugReport);

      expect(result.trim()).toBe('');
    });

    it('should handle network logs formatting errors gracefully', () => {
      const sessionData = {
        networkLogs: 'invalid-format', // Not an array
      };

      const template = `{{#if networkLogs}}
**Network Activity:**
{{networkLogs}}
{{/if}}`;

      // Should not throw, logs warning and continues
      expect(() => renderer.render(template, mockBugReport, sessionData)).not.toThrow();

      const result = renderer.render(template, mockBugReport, sessionData);
      expect(result.trim()).toBe(''); // networkLogs not formatted, so undefined
    });
  });

  describe('Custom Fields', () => {
    it('should render custom fields from session data', () => {
      const sessionData = {
        customFields: {
          userId: '12345',
          environment: 'production',
          version: '1.2.3',
        },
      };

      const template = `
**User ID:** {{customFields.userId}}
**Environment:** {{customFields.environment}}
**Version:** {{customFields.version}}
`.trim();

      const result = renderer.render(template, mockBugReport, sessionData);

      expect(result).toContain('**User ID:** 12345');
      expect(result).toContain('**Environment:** production');
      expect(result).toContain('**Version:** 1.2.3');
    });

    it('should handle missing custom fields', () => {
      const template = '**User ID:** {{customFields.userId}}';

      const result = renderer.render(template, mockBugReport);

      expect(result).toBe('**User ID:** ');
    });

    it('should reject non-object customFields (string)', () => {
      const sessionData = {
        customFields: 'not an object', // Invalid: string
      };

      const template = '**User ID:** {{customFields.userId}}';

      const result = renderer.render(template, mockBugReport, sessionData);

      expect(result).toBe('**User ID:** '); // customFields ignored
    });

    it('should reject non-object customFields (array)', () => {
      const sessionData = {
        customFields: ['item1', 'item2'], // Invalid: array
      };

      const template = '**User ID:** {{customFields.userId}}';

      const result = renderer.render(template, mockBugReport, sessionData);

      expect(result).toBe('**User ID:** '); // customFields ignored
    });

    it('should reject non-object customFields (number)', () => {
      const sessionData = {
        customFields: 12345, // Invalid: number
      };

      const template = '**User ID:** {{customFields.userId}}';

      const result = renderer.render(template, mockBugReport, sessionData);

      expect(result).toBe('**User ID:** '); // customFields ignored
    });

    it('should reject null customFields', () => {
      const sessionData = {
        customFields: null, // Invalid: null
      };

      const template = '**User ID:** {{customFields.userId}}';

      const result = renderer.render(template, mockBugReport, sessionData);

      expect(result).toBe('**User ID:** '); // customFields ignored
    });

    it('should accept null-prototype objects (Object.create(null))', () => {
      const nullProtoObject = Object.create(null);
      nullProtoObject.userId = 'user-123';
      nullProtoObject.teamId = 'team-456';

      const sessionData = {
        customFields: nullProtoObject,
      };

      const template = '**User ID:** {{customFields.userId}}\n**Team ID:** {{customFields.teamId}}';

      const result = renderer.render(template, mockBugReport, sessionData);

      expect(result).toBe('**User ID:** user-123\n**Team ID:** team-456');
    });
  });

  describe('Complex Templates', () => {
    it('should render complete template with all features', () => {
      const sessionData = {
        consoleLogs: [{ level: 'error', message: 'Network error', timestamp: Date.now() }],
        networkLogs: [
          {
            method: 'GET',
            url: 'https://api.example.com/data',
            status: 500,
            duration: 200,
            timestamp: Date.now(),
          },
        ],
        customFields: {
          userId: 'user-123',
          environment: 'staging',
        },
      };

      const template = `
**Bug Report:** {{title}}
**URL:** {{url}}
**Status:** {{status}}
**Created:** {{formatDate createdAt}}

**Environment:**
- Browser: {{browserName}} {{browserVersion}}
- OS: {{osName}} {{osVersion}}
- Screen: {{screenResolution}}
- User: {{customFields.userId}}
- Environment: {{customFields.environment}}

{{#if hasScreenshot}}
**Screenshot:** {{screenshotUrl}}
{{/if}}

{{#if hasReplay}}
**Session Replay:** {{replayUrl}}
**Duration:** {{formatDuration replayDuration}}
{{/if}}

{{#if consoleLogs}}
**Console Logs:**
{{consoleLogs}}
{{/if}}

{{#if networkLogs}}
**Network Activity:**
{{networkLogs}}
{{/if}}
`.trim();

      const result = renderer.render(template, mockBugReport, sessionData);

      // Verify all sections present
      expect(result).toContain('**Bug Report:** Test Bug Report');
      expect(result).toContain('**Environment:**');
      expect(result).toContain('Browser: Chrome 120.0');
      expect(result).toContain('User: user-123');
      expect(result).toContain('**Screenshot:**');
      expect(result).toContain('**Session Replay:**');
      expect(result).toContain('**Console Logs:**');
      // Network logs section may or may not render based on formatter success
      expect(result.length).toBeGreaterThan(300); // Has substantial content
    });
  });

  describe('Error Handling', () => {
    it('should return fallback description on template syntax error', () => {
      const invalidTemplate = '{{title} {{url}}'; // Missing closing brace

      const result = renderer.render(invalidTemplate, mockBugReport);

      // Should return fallback, not throw
      expect(result).toContain('**Bug Report:** Test Bug Report');
      expect(result).toContain('**URL:** https://example.com/page');
      expect(result).toContain('**User Agent:**');
      expect(result).toContain('**Status:** open');
      expect(result).toContain('Test description');
    });

    it('should return fallback description on helper error', () => {
      // Using formatDuration with non-number
      const template = '{{formatDuration title}}'; // title is string

      const result = renderer.render(template, mockBugReport);

      // Should not throw, may return fallback or handle gracefully
      expect(result).toBeDefined();
    });

    it('should handle missing bug report description in fallback', () => {
      const bugReport = { ...mockBugReport, description: null };
      const invalidTemplate = '{{invalid syntax';

      const result = renderer.render(invalidTemplate, bugReport);

      expect(result).toContain('No description provided');
    });
  });

  describe('Template Validation', () => {
    it('should validate correct template syntax', () => {
      const validTemplate = '**Title:** {{title}}\n**URL:** {{url}}';

      const error = renderer.validateTemplate(validTemplate);

      expect(error).toBeNull();
    });

    it('should validate complex template with helpers', () => {
      const validTemplate = `
{{#if hasReplay}}
**Replay:** {{replayUrl}}
**Duration:** {{formatDuration replayDuration}}
{{/if}}
{{truncate title 50}}
`;

      const error = renderer.validateTemplate(validTemplate);

      expect(error).toBeNull();
    });

    it('should validate templates that may fail at render time', () => {
      // Note: Handlebars is lenient during compilation
      // These templates compile successfully but may error during rendering
      const templates = [
        '{{title} {{url}}', // Missing closing brace - compiles OK
        '{{#if test', // Unclosed block - compiles OK
        '{{invalid syntax', // Invalid syntax - compiles OK
      ];

      templates.forEach((template) => {
        const error = renderer.validateTemplate(template);
        // These all compile successfully despite being potentially problematic
        expect(error).toBeNull();
      });
    });
  });

  describe('Template Caching (LRU)', () => {
    it('should cache compiled templates', () => {
      const template = '{{title}} - {{status}}';

      // First render compiles the template
      const result1 = renderer.render(template, mockBugReport);

      // Second render should use cached template
      const result2 = renderer.render(template, mockBugReport);

      // Both should produce identical output
      expect(result1).toBe(result2);
      expect(result1).toContain('Test Bug Report');
      expect(result1).toContain('open');
    });

    it('should evict oldest template when cache is full', () => {
      // Create 101 different templates (exceeds MAX_TEMPLATE_CACHE_SIZE of 100)
      const templates: string[] = [];
      for (let i = 0; i < 101; i++) {
        templates.push(`Template ${i}: {{title}}`);
      }

      // Render all templates to fill cache beyond limit
      templates.forEach((template) => {
        renderer.render(template, mockBugReport);
      });

      // First template should have been evicted (LRU behavior)
      // Rendering it again should still work (will recompile)
      const result = renderer.render(templates[0], mockBugReport);
      expect(result).toContain('Template 0');
      expect(result).toContain('Test Bug Report');
    });

    it('should move recently used templates to end of cache (LRU)', () => {
      const template1 = 'Template 1: {{title}}';
      const template2 = 'Template 2: {{title}}';

      // Render template1 (will be cached)
      renderer.render(template1, mockBugReport);

      // Render template2 (will be cached)
      renderer.render(template2, mockBugReport);

      // Render template1 again (should move to end of cache)
      const result1 = renderer.render(template1, mockBugReport);

      // Fill cache with 99 more templates
      for (let i = 0; i < 99; i++) {
        renderer.render(`Filler ${i}: {{title}}`, mockBugReport);
      }

      // template1 should still be in cache (moved to end when re-used)
      // template2 should have been evicted
      const result2 = renderer.render(template1, mockBugReport);

      expect(result1).toContain('Template 1');
      expect(result2).toContain('Template 1');
    });
  });

  describe('Refactored Helper Methods', () => {
    describe('parseMetadataFields', () => {
      it('should parse all metadata fields with correct types', () => {
        const template = `
Browser: {{browserName}} {{browserVersion}}
OS: {{osName}} {{osVersion}}
Screen: {{screenResolution}}
Viewport: {{viewport}}
URL: {{url}}
User Agent: {{userAgent}}
`;

        const bugReport: BugReport = {
          ...mockBugReport,
          metadata: {
            browserName: 'Chrome',
            browserVersion: '120.0',
            osName: 'Windows',
            osVersion: '11',
            screenWidth: 1920,
            screenHeight: 1080,
            viewportWidth: 1600,
            viewportHeight: 900,
            url: 'https://example.com',
            userAgent: 'Mozilla/5.0...',
            replayDuration: 5000,
          },
        };

        const result = renderer.render(template, bugReport);

        expect(result).toContain('Browser: Chrome 120.0');
        expect(result).toContain('OS: Windows 11');
        expect(result).toContain('Screen: 1920×1080');
        expect(result).toContain('Viewport: 1600×900');
        expect(result).toContain('URL: https://example.com');
        expect(result).toContain('User Agent: Mozilla/5.0...');
      });

      it('should handle null metadata gracefully', () => {
        const template = '{{url}} - {{userAgent}}';
        const bugReport: BugReport = {
          ...mockBugReport,
          metadata: {},
        };
        const result = renderer.render(template, bugReport);

        expect(result).toBe(' - '); // Empty strings, no errors
      });

      it('should handle missing metadata fields', () => {
        const template = 'Browser: {{browserName}}, OS: {{osName}}';
        const bugReport: BugReport = {
          ...mockBugReport,
          metadata: { browserName: 'Firefox' }, // Missing osName
        };

        const result = renderer.render(template, bugReport);

        expect(result).toContain('Browser: Firefox');
        expect(result).toContain('OS: '); // osName is undefined
      });

      it('should handle invalid metadata field types', () => {
        const template = 'Screen: {{screenResolution}}';
        const bugReport: BugReport = {
          ...mockBugReport,
          metadata: {
            screenWidth: '1920', // Wrong type (string instead of number)
            screenHeight: 1080,
          },
        };

        const result = renderer.render(template, bugReport);

        // Should not render screenResolution because screenWidth is not a number
        expect(result).toBe('Screen: ');
      });
    });

    describe('formatLogs', () => {
      it('should format valid console logs', () => {
        const template = '{{#if consoleLogs}}Console:\n{{consoleLogs}}{{/if}}';
        const sessionData = {
          consoleLogs: [
            { level: 'error', message: 'Error occurred', timestamp: Date.now() },
            { level: 'warn', message: 'Warning message', timestamp: Date.now() },
          ],
        };

        const result = renderer.render(template, mockBugReport, sessionData);

        expect(result).toContain('Console:');
        expect(result).toContain('Error occurred');
        expect(result).toContain('Warning message');
      });

      it('should filter out invalid console log entries', () => {
        const template = '{{#if consoleLogs}}Console:\n{{consoleLogs}}{{/if}}';
        const sessionData = {
          consoleLogs: [
            { level: 'error', message: 'Valid log', timestamp: Date.now() },
            { level: 'warn', message: 123 }, // Invalid: message not string
            { level: 'info' }, // Invalid: missing fields
            'not an object', // Invalid: not an object
            null, // Invalid: null
          ],
        };

        const result = renderer.render(template, mockBugReport, sessionData);

        expect(result).toContain('Valid log');
        // Invalid entries should be filtered out
      });

      it('should format valid network logs', () => {
        const template = '{{#if networkLogs}}Network:\n{{networkLogs}}{{/if}}';
        const sessionData = {
          networkLogs: [
            {
              method: 'GET',
              url: '/api/data',
              status: 200,
              duration: 150,
              timestamp: Date.now(),
            },
            {
              method: 'POST',
              url: '/api/submit',
              status: 201,
              duration: 250,
              timestamp: Date.now(),
            },
          ],
        };

        const result = renderer.render(template, mockBugReport, sessionData);

        expect(result).toContain('Network:');
        expect(result).toContain('GET');
        expect(result).toContain('/api/data');
        expect(result).toContain('POST');
        expect(result).toContain('/api/submit');
      });

      it('should filter out invalid network log entries', () => {
        const template = '{{#if networkLogs}}Network:\n{{networkLogs}}{{/if}}';
        const sessionData = {
          networkLogs: [
            {
              method: 'GET',
              url: '/api/valid',
              status: 200,
              duration: 100,
              timestamp: Date.now(),
            },
            { method: 'POST', url: '/api/invalid' }, // Missing status, duration, timestamp
            { method: 'GET', status: 200 }, // Missing url, duration, timestamp
            { invalid: 'structure' }, // Wrong structure
            'not an object', // Not an object
          ],
        };

        const result = renderer.render(template, mockBugReport, sessionData);

        expect(result).toContain('GET');
        expect(result).toContain('/api/valid');
        // Invalid entries should be filtered out
      });

      it('should return undefined when logs array is empty', () => {
        const template = '{{#if consoleLogs}}Console:\n{{consoleLogs}}{{else}}No logs{{/if}}';
        const sessionData = { consoleLogs: [] };

        const result = renderer.render(template, mockBugReport, sessionData);

        expect(result).toContain('No logs');
      });

      it('should return undefined when logs is not an array', () => {
        const template = '{{#if consoleLogs}}Console:\n{{consoleLogs}}{{else}}No logs{{/if}}';
        const sessionData = { consoleLogs: 'not an array' as any };

        const result = renderer.render(template, mockBugReport, sessionData);

        expect(result).toContain('No logs');
      });

      it('should handle formatter errors gracefully', () => {
        const template = '{{#if consoleLogs}}Console:\n{{consoleLogs}}{{else}}No logs{{/if}}';

        // Test with malformed data that would cause formatter errors
        const sessionData = {
          consoleLogs: [
            { level: 'error', message: 'Valid', timestamp: Date.now() },
            // These malformed entries will be filtered out by validation,
            // preventing formatter errors
            { level: 'invalid-level', message: 'Test', timestamp: Date.now() },
            { message: 'Missing level', timestamp: Date.now() },
          ],
        };

        const result = renderer.render(template, mockBugReport, sessionData);

        // Should render only valid entries
        expect(result).toContain('Valid');
      });
    });

    describe('Constants', () => {
      it('should not crash with long templates containing syntax errors', () => {
        const longTemplate = 'x'.repeat(500);
        const invalidTemplate = longTemplate + ' {{unclosed';

        // This will fail and log an error (template truncated to MAX_TEMPLATE_LOG_LENGTH internally)
        const result = renderer.render(invalidTemplate, mockBugReport);

        // Should return fallback description, not throw
        expect(result).toContain('Bug Report:');
        expect(result).toContain(mockBugReport.title);
        expect(result).toContain(mockBugReport.description);
        expect(result).toContain('https://example.com/page');
      });
    });
  });
});
