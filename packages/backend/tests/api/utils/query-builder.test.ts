/**
 * Unit tests for query builder utilities
 */

import { describe, it, expect } from 'vitest';
import { parseDateFilter } from '../../../src/api/utils/query-builder.js';
import { ValidationError } from '../../../src/api/middleware/error.js';

describe('parseDateFilter', () => {
  describe('Valid dates', () => {
    it('should parse ISO 8601 date string', () => {
      const result = parseDateFilter('2024-03-15T10:30:00.000Z', 'created_at');

      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe('2024-03-15T10:30:00.000Z');
    });

    it('should parse date-only string', () => {
      const result = parseDateFilter('2024-01-01', 'created_at');

      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toContain('2024-01-01');
    });

    it('should parse date with timezone', () => {
      const result = parseDateFilter('2024-12-31T23:59:59+05:00', 'updated_at');

      expect(result).toBeInstanceOf(Date);
      expect(result).not.toBeUndefined();
    });
  });

  describe('Undefined/empty input', () => {
    it('should return undefined for undefined input', () => {
      const result = parseDateFilter(undefined, 'created_at');

      expect(result).toBeUndefined();
    });

    it('should return undefined for missing parameter', () => {
      const result = parseDateFilter(undefined, 'updated_at');

      expect(result).toBeUndefined();
    });
  });

  describe('Invalid dates', () => {
    it('should throw ValidationError for invalid date string', () => {
      expect(() => {
        parseDateFilter('not-a-date', 'created_at');
      }).toThrow(ValidationError);

      expect(() => {
        parseDateFilter('not-a-date', 'created_at');
      }).toThrow('Invalid created_at date: not-a-date');
    });

    it('should throw ValidationError for malformed ISO date', () => {
      expect(() => {
        parseDateFilter('2024-13-45T99:99:99Z', 'updated_at');
      }).toThrow(ValidationError);

      expect(() => {
        parseDateFilter('2024-13-45T99:99:99Z', 'updated_at');
      }).toThrow('Invalid updated_at date:');
    });

    it('should include field name in error message', () => {
      expect(() => {
        parseDateFilter('invalid', 'created_before');
      }).toThrow('created_before');

      expect(() => {
        parseDateFilter('bad-date', 'deleted_at');
      }).toThrow('deleted_at');
    });
  });

  describe('Edge cases', () => {
    it('should handle dates far in the past', () => {
      const result = parseDateFilter('1970-01-01T00:00:00.000Z', 'created_at');

      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(0);
    });

    it('should handle dates far in the future', () => {
      const result = parseDateFilter('2099-12-31T23:59:59.999Z', 'created_at');

      expect(result).toBeInstanceOf(Date);
      expect(result?.getUTCFullYear()).toBe(2099); // Use getUTCFullYear to avoid timezone issues
    });

    it('should handle leap year dates', () => {
      const result = parseDateFilter('2024-02-29', 'created_at');

      expect(result).toBeInstanceOf(Date);
      expect(result?.getMonth()).toBe(1); // February is month 1 (0-indexed)
      expect(result?.getDate()).toBe(29);
    });
  });

  describe('Real-world scenarios', () => {
    it('should parse query parameter from frontend', () => {
      // Frontend sends ISO string from Date.toISOString()
      const frontendDate = new Date('2024-06-15T14:30:00Z').toISOString();
      const result = parseDateFilter(frontendDate, 'created_after');

      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe(frontendDate);
    });

    it('should handle different field names correctly', () => {
      const testCases = [
        'created_at',
        'updated_at',
        'deleted_at',
        'created_after',
        'created_before',
        'scheduled_at',
      ];

      for (const fieldName of testCases) {
        expect(() => {
          parseDateFilter('invalid-date', fieldName);
        }).toThrow(fieldName);
      }
    });

    it('should work in filter building pipeline', () => {
      // Simulating actual usage in reports controller
      const queryParams = {
        created_after: '2024-01-01',
        created_before: '2024-12-31',
      };

      const createdAfter = parseDateFilter(queryParams.created_after, 'created_after');
      const createdBefore = parseDateFilter(queryParams.created_before, 'created_before');

      expect(createdAfter).toBeInstanceOf(Date);
      expect(createdBefore).toBeInstanceOf(Date);
      expect(createdAfter! < createdBefore!).toBe(true);
    });
  });
});
