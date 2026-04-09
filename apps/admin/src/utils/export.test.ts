import { describe, it, expect } from 'vitest';
import { sanitizeCSVField, formatCSVField } from './export';

describe('sanitizeCSVField', () => {
  describe('Quote Escaping', () => {
    it('should escape double quotes by doubling them', () => {
      expect(sanitizeCSVField('He said "hello"')).toBe('He said ""hello""');
    });

    it('should handle multiple quotes', () => {
      expect(sanitizeCSVField('"quoted" and "more quotes"')).toBe('""quoted"" and ""more quotes""');
    });

    it('should handle empty string', () => {
      expect(sanitizeCSVField('')).toBe('');
    });
  });

  describe('Newline Removal', () => {
    it('should replace \\n with space', () => {
      expect(sanitizeCSVField('Line 1\nLine 2')).toBe('Line 1 Line 2');
    });

    it('should replace \\r\\n with space', () => {
      expect(sanitizeCSVField('Line 1\r\nLine 2')).toBe('Line 1 Line 2');
    });

    it('should replace multiple newlines with single space', () => {
      expect(sanitizeCSVField('Line 1\n\n\nLine 2')).toBe('Line 1 Line 2');
    });

    it('should handle mixed newline types', () => {
      expect(sanitizeCSVField('A\nB\r\nC\rD')).toBe('A B C D');
    });
  });

  describe('CSV Injection Prevention', () => {
    it('should prepend single quote to value starting with =', () => {
      expect(sanitizeCSVField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    });

    it('should prepend single quote to value starting with +', () => {
      expect(sanitizeCSVField('+cmd|calc')).toBe("'+cmd|calc");
    });

    it('should prepend single quote to value starting with -', () => {
      expect(sanitizeCSVField('-2+3')).toBe("'-2+3");
    });

    it('should prepend single quote to value starting with @', () => {
      expect(sanitizeCSVField('@import')).toBe("'@import");
    });

    it('should prepend single quote to value starting with |', () => {
      expect(sanitizeCSVField('|whoami')).toBe("'|whoami");
    });

    it('should prepend single quote to value starting with %', () => {
      expect(sanitizeCSVField('%APPDATA%')).toBe("'%APPDATA%");
    });

    it('should not prepend quote to safe values', () => {
      expect(sanitizeCSVField('Normal text')).toBe('Normal text');
      expect(sanitizeCSVField('123')).toBe('123');
      expect(sanitizeCSVField('test@example.com')).toBe('test@example.com');
    });
  });

  describe('Combined Sanitization', () => {
    it('should handle quotes and newlines together', () => {
      expect(sanitizeCSVField('He said "hello"\nto everyone')).toBe(
        'He said ""hello"" to everyone'
      );
    });

    it('should handle formula characters with quotes', () => {
      expect(sanitizeCSVField('=CMD("calc")')).toBe('\'=CMD(""calc"")');
    });

    it('should handle all edge cases together', () => {
      expect(sanitizeCSVField('=SUM("A1:A10")\nTotal')).toBe('\'=SUM(""A1:A10"") Total');
    });
  });
});

describe('formatCSVField', () => {
  describe('Number Handling', () => {
    it('should convert numbers to strings', () => {
      expect(formatCSVField(123)).toBe('123');
      expect(formatCSVField(0)).toBe('0');
      expect(formatCSVField(-456)).toBe('-456');
    });

    it('should handle decimal numbers', () => {
      expect(formatCSVField(3.14)).toBe('3.14');
    });
  });

  describe('Comma Handling', () => {
    it('should wrap values containing commas in quotes', () => {
      expect(formatCSVField('value,with,commas')).toBe('"value,with,commas"');
    });

    it('should not wrap values without commas', () => {
      expect(formatCSVField('simple value')).toBe('simple value');
    });
  });

  describe('Formula Character Handling', () => {
    it('should wrap and sanitize values starting with =', () => {
      expect(formatCSVField('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
    });

    it('should wrap and sanitize values starting with +', () => {
      expect(formatCSVField('+cmd')).toBe('"\'+cmd"');
    });

    it('should wrap and sanitize values starting with -', () => {
      expect(formatCSVField('-formula')).toBe('"\'-formula"');
    });

    it('should wrap and sanitize values starting with @', () => {
      expect(formatCSVField('@import')).toBe('"\'@import"');
    });
  });

  describe('Quote Handling', () => {
    it('should wrap values with escaped quotes', () => {
      expect(formatCSVField('He said "hello"')).toBe('"He said ""hello"""');
    });

    it('should wrap values starting with quotes after sanitization', () => {
      const result = formatCSVField('"quoted"');
      expect(result).toMatch(/^".*"$/); // Should be wrapped
      expect(result).toContain('""'); // Quotes should be escaped
    });
  });

  describe('Newline Handling', () => {
    it('should wrap values that had newlines removed', () => {
      const result = formatCSVField('Line 1\nLine 2');
      expect(result).toBe('"Line 1 Line 2"');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      expect(formatCSVField('')).toBe('');
    });

    it('should handle plain text without special chars', () => {
      expect(formatCSVField('simple text')).toBe('simple text');
    });

    it('should handle complex combination', () => {
      const result = formatCSVField('=SUM("A1,A2")\nTotal');
      expect(result).toMatch(/^".*"$/); // Wrapped
      expect(result).toContain("'="); // Formula prevention
      expect(result).toContain('""'); // Quote escaping
      expect(result).not.toContain('\n'); // Newline removed
    });
  });
});
