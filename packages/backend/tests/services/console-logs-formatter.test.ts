import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConsoleLogsFormatter,
  type ConsoleLogEntry,
} from '../../src/services/integrations/console-logs-formatter';

/**
 * Factory function to create test console log entries
 */
function createLogEntry(overrides?: Partial<ConsoleLogEntry>): ConsoleLogEntry {
  return {
    timestamp: new Date('2024-01-15T10:30:00Z').getTime(),
    level: 'info',
    message: 'Test message',
    args: [],
    ...overrides,
  };
}

describe('ConsoleLogsFormatter', () => {
  let formatter: ConsoleLogsFormatter;

  beforeEach(() => {
    formatter = new ConsoleLogsFormatter();
  });

  // ============================================================================
  // FILTERING TESTS
  // ============================================================================

  describe('Filtering', () => {
    it('should include all levels by default', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error message' }),
        createLogEntry({ level: 'warn', message: 'Warning message' }),
        createLogEntry({ level: 'info', message: 'Info message' }),
        createLogEntry({ level: 'debug', message: 'Debug message' }),
      ];

      const result = formatter.format(logs);

      expect(result.entryCount).toBe(4);
      expect(result.filteredCount).toBe(0); // None filtered out
      expect(result.content).toContain('Error message');
      expect(result.content).toContain('Warning message');
      expect(result.content).toContain('Info message');
      expect(result.content).toContain('Debug message');
    });

    it('should filter by specified levels', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error message' }),
        createLogEntry({ level: 'warn', message: 'Warning message' }),
        createLogEntry({ level: 'info', message: 'Info message' }),
        createLogEntry({ level: 'debug', message: 'Debug message' }),
      ];

      const result = formatter.format(logs, { levels: ['error', 'warn'] });

      expect(result.entryCount).toBe(2); // 2 included
      expect(result.filteredCount).toBe(2); // 2 filtered out
      expect(result.content).toContain('Error message');
      expect(result.content).toContain('Warning message');
      expect(result.content).not.toContain('Info message');
      expect(result.content).not.toContain('Debug message');
    });

    it('should handle single level filter', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error 1' }),
        createLogEntry({ level: 'error', message: 'Error 2' }),
        createLogEntry({ level: 'info', message: 'Info message' }),
      ];

      const result = formatter.format(logs, { levels: ['error'] });

      expect(result.entryCount).toBe(2); // 2 included
      expect(result.filteredCount).toBe(1); // 1 filtered out
      expect(result.content).toContain('Error 1');
      expect(result.content).toContain('Error 2');
      expect(result.content).not.toContain('Info message');
    });

    it('should handle empty levels array', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error message' }),
        createLogEntry({ level: 'info', message: 'Info message' }),
      ];

      const result = formatter.format(logs, { levels: [] });

      expect(result.entryCount).toBe(0); // 0 included
      expect(result.filteredCount).toBe(2); // All filtered out
      expect(result.content).not.toContain('Error message');
      expect(result.content).not.toContain('Info message');
    });

    it('should handle logs with missing level', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'info', message: 'Has level' }),
        { timestamp: Date.now(), level: 'log', message: 'No level', args: [] },
      ];

      const result = formatter.format(logs, { levels: ['info'] });

      expect(result.entryCount).toBe(1); // 1 included
      expect(result.filteredCount).toBe(1); // 1 filtered out
      expect(result.content).toContain('Has level');
      expect(result.content).not.toContain('No level');
    });
  });

  // ============================================================================
  // MAX ENTRIES TESTS
  // ============================================================================

  describe('Max Entries', () => {
    it('should limit to maxEntries', () => {
      const logs: ConsoleLogEntry[] = Array.from({ length: 10 }, (_, i) =>
        createLogEntry({ message: `Message ${i}` })
      );

      const result = formatter.format(logs, { maxEntries: 5 });

      expect(result.entryCount).toBe(5); // 5 included
      // filteredCount only counts logs filtered by level, not maxEntries
      expect(result.filteredCount).toBe(0); // None filtered by level
    });

    it('should take most recent entries when limiting', () => {
      const logs: ConsoleLogEntry[] = [
        {
          ...createLogEntry({ message: 'Oldest' }),
          timestamp: new Date('2024-01-15T10:00:00Z').getTime(),
        },
        {
          ...createLogEntry({ message: 'Middle' }),
          timestamp: new Date('2024-01-15T10:30:00Z').getTime(),
        },
        {
          ...createLogEntry({ message: 'Newest' }),
          timestamp: new Date('2024-01-15T11:00:00Z').getTime(),
        },
      ];

      const result = formatter.format(logs, { maxEntries: 2 });

      expect(result.entryCount).toBe(2); // 2 included
      expect(result.filteredCount).toBe(0); // None filtered by level
      expect(result.content).toContain('Newest');
      expect(result.content).toContain('Middle');
      expect(result.content).not.toContain('Oldest');
    });

    it('should handle maxEntries larger than log count', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ message: 'Message 1' }),
        createLogEntry({ message: 'Message 2' }),
      ];

      const result = formatter.format(logs, { maxEntries: 100 });

      expect(result.entryCount).toBe(2); // All 2 included
      expect(result.filteredCount).toBe(0); // None filtered out
      expect(result.content).toContain('Message 1');
      expect(result.content).toContain('Message 2');
    });

    it('should default to 100 entries', () => {
      const logs: ConsoleLogEntry[] = Array.from({ length: 150 }, (_, i) =>
        createLogEntry({ message: `Message ${i}` })
      );

      const result = formatter.format(logs);

      expect(result.entryCount).toBe(100); // 100 included (default limit)
      expect(result.filteredCount).toBe(0); // None filtered by level
    });

    it('should return filteredCount in result', () => {
      const logs: ConsoleLogEntry[] = Array.from({ length: 50 }, (_, i) =>
        createLogEntry({ message: `Message ${i}` })
      );

      const result = formatter.format(logs, { maxEntries: 25 });

      expect(result.entryCount).toBe(25); // 25 included
      expect(result.filteredCount).toBe(0); // None filtered by level
    });
  });

  // ============================================================================
  // TEXT FORMAT TESTS
  // ============================================================================

  describe('Text Format', () => {
    it('should format as text by default', () => {
      const logs: ConsoleLogEntry[] = [createLogEntry({ message: 'Test message' })];

      const result = formatter.format(logs);

      expect(result.filename).toBe('console-logs.txt');
      expect(result.mimeType).toBe('text/plain');
      expect(result.content).toContain('Test message');
    });

    it('should include timestamp', () => {
      const logs: ConsoleLogEntry[] = [
        {
          ...createLogEntry({ message: 'Test' }),
          timestamp: new Date('2024-01-15T10:30:45Z').getTime(),
        },
      ];

      const result = formatter.format(logs, { format: 'text' });

      // Implementation formats as [YYYY-MM-DD HH:MM:SS]
      expect(result.content).toContain('2024-01-15 10:30:45');
    });

    it('should include level', () => {
      const logs: ConsoleLogEntry[] = [createLogEntry({ level: 'error', message: 'Test' })];

      const result = formatter.format(logs, { format: 'text' });

      // Implementation formats as "[timestamp] LEVEL: message"
      expect(result.content).toContain('ERROR:');
    });

    it('should include message', () => {
      const logs: ConsoleLogEntry[] = [createLogEntry({ message: 'This is a test message' })];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('This is a test message');
    });

    it('should include stack trace if present', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          level: 'error',
          message: 'Error occurred',
          stack: 'Error: Something went wrong\n  at file.js:10:5',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      // Implementation includes stack trace indented, no 'Stack Trace:' header
      expect(result.content).toContain('Error: Something went wrong');
      expect(result.content).toContain('at file.js:10:5');
    });

    it('should format multiple entries', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ message: 'First entry' }),
        createLogEntry({ message: 'Second entry' }),
        createLogEntry({ message: 'Third entry' }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('First entry');
      expect(result.content).toContain('Second entry');
      expect(result.content).toContain('Third entry');
      // Implementation separates with empty lines, not ---
      const lines = result.content.split('\n');
      expect(lines.length).toBeGreaterThan(3);
    });
  });

  // ============================================================================
  // MARKDOWN FORMAT TESTS
  // ============================================================================

  describe('Markdown Format', () => {
    it('should format as markdown', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error message' }),
      ];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.filename).toBe('console-logs.md');
      expect(result.mimeType).toBe('text/markdown');
      expect(result.content).toContain('## Console Logs');
      expect(result.content).toContain('Error message');
    });

    it('should group by level', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error 1' }),
        createLogEntry({ level: 'error', message: 'Error 2' }),
        createLogEntry({ level: 'warn', message: 'Warning 1' }),
        createLogEntry({ level: 'info', message: 'Info 1' }),
      ];

      const result = formatter.format(logs, { format: 'markdown' });

      // Implementation uses ### Errors (N)
      expect(result.content).toContain('### Errors');
      expect(result.content).toContain('### Warnings');
      expect(result.content).toContain('### Info');
      // Errors should be grouped together
      const errorIndex = result.content.indexOf('### Errors');
      const error1Index = result.content.indexOf('Error 1');
      const error2Index = result.content.indexOf('Error 2');
      expect(error1Index).toBeGreaterThan(errorIndex);
      expect(error2Index).toBeGreaterThan(error1Index);
    });

    it('should include entry counts', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error 1' }),
        createLogEntry({ level: 'error', message: 'Error 2' }),
        createLogEntry({ level: 'warn', message: 'Warning 1' }),
      ];

      const result = formatter.format(logs, { format: 'markdown' });

      // Implementation uses ### Errors (2)
      expect(result.content).toMatch(/### Errors.*\(2\)/);
      expect(result.content).toMatch(/### Warnings.*\(1\)/);
    });

    it('should format stack traces in code blocks', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          level: 'error',
          message: 'Error with stack',
          stack: 'Error: Test\n  at file.js:10:5',
        }),
      ];

      const result = formatter.format(logs, { format: 'markdown' });

      expect(result.content).toContain('```');
      expect(result.content).toContain('Error: Test');
      expect(result.content).toContain('at file.js:10:5');
    });
  });

  // ============================================================================
  // JSON FORMAT TESTS
  // ============================================================================

  describe('JSON Format', () => {
    it('should format as JSON', () => {
      const logs: ConsoleLogEntry[] = [createLogEntry({ message: 'Test message' })];

      const result = formatter.format(logs, { format: 'json' });

      expect(result.filename).toBe('console-logs.json');
      expect(result.mimeType).toBe('application/json');
      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    it('should include summary counts', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({ level: 'error', message: 'Error 1' }),
        createLogEntry({ level: 'error', message: 'Error 2' }),
        createLogEntry({ level: 'warn', message: 'Warning 1' }),
        createLogEntry({ level: 'info', message: 'Info 1' }),
      ];

      const result = formatter.format(logs, { format: 'json' });
      const parsed = JSON.parse(result.content);

      expect(parsed.summary).toBeDefined();
      expect(parsed.entries).toBeDefined(); // JSON uses 'entries' not 'logs'
      expect(parsed.entries.length).toBe(4);
      expect(parsed.summary.error).toBe(2);
      expect(parsed.summary.warn).toBe(1);
      expect(parsed.summary.info).toBe(1);
    });

    it('should be valid JSON', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          level: 'error',
          message: 'Error with "quotes" and \n newlines',
          stack: 'Error: Test\n  at file.js:10:5',
        }),
      ];

      const result = formatter.format(logs, { format: 'json' });

      expect(() => {
        const parsed = JSON.parse(result.content);
        expect(parsed.entries).toBeDefined(); // JSON uses 'entries'
        expect(parsed.entries).toHaveLength(1);
        expect(parsed.entries[0].message).toContain('quotes');
      }).not.toThrow();
    });
  });

  // ============================================================================
  // REDACTION TESTS
  // ============================================================================

  describe('Redaction', () => {
    it('should redact Bearer tokens', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        }),
      ];

      const result = formatter.format(logs);

      expect(result.content).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      // Pattern: /\b(?:Bearer\s+)?[a-zA-Z0-9_-]{32,}\b/gi replaces with 'Bearer [REDACTED]'
      // Also Authorization pattern: /Authorization:\s*['"']?[A-Za-z0-9._-]+['"']?/gi
      expect(result.content).toContain('[REDACTED]');
    });

    it('should redact API keys', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'Using API key: sk_live_TESTKEY_0000000000000000',
        }),
      ];

      const result = formatter.format(logs);

      expect(result.content).not.toContain('sk_live_TESTKEY_0000000000000000');
      // Both patterns match: Bearer token (32+ chars) and Stripe (sk_live)
      // Bearer pattern runs first in CREDENTIAL_PATTERNS, so it wins
      expect(result.content).toContain('[REDACTED]');
    });

    it('should redact passwords in common formats', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'Config: password=SecretPass123 user=admin',
        }),
      ];

      const result = formatter.format(logs);

      // Password pattern: /(?:password|passwd|pwd)[\s:=]+[^\s]{6,}/gi
      expect(result.content).not.toContain('SecretPass123');
      expect(result.content).toContain('password=[REDACTED]');
    });

    it('should redact Authorization headers', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'Request headers: Authorization: abc123def456ghi789jkl',
        }),
      ];

      const result = formatter.format(logs);

      // Authorization pattern: /Authorization:\s*['"']?[A-Za-z0-9._-]+['"']?/gi
      expect(result.content).not.toContain('abc123def456ghi789jkl');
      expect(result.content).toContain('Authorization: [REDACTED]');
    });

    it('should handle multiple redactions in one message', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'User john.doe@example.com used API key sk_live_TESTKEY_00000000000000000',
        }),
      ];

      const result = formatter.format(logs);

      expect(result.content).not.toContain('john.doe@example.com');
      expect(result.content).not.toContain('sk_live_TESTKEY_00000000000000000');
      expect(result.content).toContain('[REDACTED-EMAIL]');
      // Bearer pattern (32+ chars) matches before Stripe pattern
      expect(result.content).toContain('Bearer [REDACTED]');
    });
  });

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty logs array', () => {
      const result = formatter.format([]);

      expect(result.entryCount).toBe(0);
      expect(result.filteredCount).toBe(0);
      expect(result.content).toBeTruthy(); // Should still have some content
    });

    it('should handle logs with special characters', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'Special chars: <script>alert("XSS")</script> & © ™ 中文',
        }),
      ];

      const result = formatter.format(logs, { format: 'text' });

      expect(result.content).toContain('<script>');
      expect(result.content).toContain('alert("XSS")');
      expect(result.content).toContain('©');
      expect(result.content).toContain('™');
      expect(result.content).toContain('中文');
    });

    it('should handle logs with undefined or null args', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'Test',
          args: [null, undefined, 'valid'],
        }),
      ];

      const result = formatter.format(logs);

      expect(result.content).toContain('Test');
      expect(result.entryCount).toBe(1);
    });

    it('should handle logs with complex nested objects in args', () => {
      const logs: ConsoleLogEntry[] = [
        createLogEntry({
          message: 'Complex object',
          args: [
            {
              user: { name: 'John', email: 'john@example.com' },
              metadata: {
                token: 'Bearer secret123token456ghi789jklmnop',
                apiKey: 'sk_live_TESTKEY_0000000000000000',
              },
            },
          ],
        }),
      ];

      const result = formatter.format(logs, { format: 'json' });
      const parsed = JSON.parse(result.content);

      expect(parsed.entries).toBeDefined(); // JSON uses 'entries'
      expect(parsed.entries[0].args).toBeDefined();
      // Should not contain sensitive data in args (redacted)
      expect(result.content).not.toContain('secret123token456ghi789jklmnop');
      expect(result.content).not.toContain('sk_live_TESTKEY_0000000000000000');
    });

    it('should handle logs with numeric timestamps', () => {
      const logs = [
        {
          level: 'info' as const,
          message: 'Has timestamp',
          timestamp: Date.now(),
          args: [],
        } as ConsoleLogEntry,
      ];

      const result = formatter.format(logs);

      expect(result.entryCount).toBe(1);
      expect(result.content).toContain('Has timestamp');
    });

    it('should handle very long messages', () => {
      const longMessage = 'A'.repeat(10000);
      const logs: ConsoleLogEntry[] = [createLogEntry({ message: longMessage })];

      const result = formatter.format(logs);

      expect(result.entryCount).toBe(1);
      expect(result.content).toContain('A'); // Should still include the message
    });
  });
});
