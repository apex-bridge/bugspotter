/**
 * Tests for FilterBuilder edge cases and atomicity
 * Validates proper error handling and state consistency
 */

import { describe, it, expect } from 'vitest';
import { createFilter } from '../../src/db/filter-builder.js';
import { SqlValidationError } from '../../src/db/repositories/base-repository.js';

describe('FilterBuilder - Edge Cases', () => {
  describe('Atomic Operations', () => {
    it('should reject dateRange atomically when both conditions would exceed limit', () => {
      const builder = createFilter();

      // Add 49 conditions (1 below the 50 limit)
      for (let i = 0; i < 49; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }

      // Verify we have 49 conditions
      const beforeState = builder.build();
      expect(beforeState.whereClause.split(' AND ')).toHaveLength(49);
      expect(beforeState.values).toHaveLength(49);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // EXPECTED BEHAVIOR: Should throw error WITHOUT modifying builder state
      // The operation should be atomic - either both conditions added or neither
      expect(() => {
        builder.dateRange('timestamp', { after: startDate, before: endDate });
      }).toThrow(SqlValidationError);
      expect(() => {
        builder.dateRange('timestamp', { after: startDate, before: endDate });
      }).toThrow(/Too many filter conditions/);

      // CRITICAL: Builder state should be UNCHANGED after error
      const afterErrorState = builder.build();

      // Should still have exactly 49 conditions (not 50)
      expect(afterErrorState.whereClause.split(' AND ')).toHaveLength(49);
      expect(afterErrorState.values).toHaveLength(49);

      // Should NOT have ANY part of the dateRange
      expect(afterErrorState.whereClause).not.toContain('timestamp >=');
      expect(afterErrorState.whereClause).not.toContain('timestamp <=');

      // Should NOT have the date values
      expect(afterErrorState.values).not.toContain(startDate.toISOString());
      expect(afterErrorState.values).not.toContain(endDate.toISOString());
    });

    it('should succeed when dateRange fits within condition limit', () => {
      const builder = createFilter();

      // Add 48 conditions (2 below the 50 limit)
      for (let i = 0; i < 48; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      // This should succeed because both conditions fit
      expect(() => {
        builder.dateRange('timestamp', { after: startDate, before: endDate });
      }).not.toThrow();

      const result = builder.build();

      // Should have both conditions
      expect(result.whereClause.split(' AND ')).toHaveLength(50);
      expect(result.whereClause).toContain('timestamp >=');
      expect(result.whereClause).toContain('timestamp <=');
      expect(result.values).toContain(startDate.toISOString());
      expect(result.values).toContain(endDate.toISOString());
    });

    it('should succeed with only after when at limit minus 1', () => {
      const builder = createFilter();

      // Add 49 conditions
      for (let i = 0; i < 49; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }

      const startDate = new Date('2024-01-01');

      // Only 'after' - should succeed
      expect(() => {
        builder.dateRange('timestamp', { after: startDate });
      }).not.toThrow();

      const result = builder.build();
      expect(result.whereClause.split(' AND ')).toHaveLength(50);
      expect(result.whereClause).toContain('timestamp >=');
    });

    it('should succeed with only before when at limit minus 1', () => {
      const builder = createFilter();

      // Add 49 conditions
      for (let i = 0; i < 49; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }

      const endDate = new Date('2024-12-31');

      // Only 'before' - should succeed
      expect(() => {
        builder.dateRange('timestamp', { before: endDate });
      }).not.toThrow();

      const result = builder.build();
      expect(result.whereClause.split(' AND ')).toHaveLength(50);
      expect(result.whereClause).toContain('timestamp <=');
    });
  });

  describe('Condition Limit Enforcement', () => {
    it('should throw error when exactly at limit and trying to add one more', () => {
      const builder = createFilter();

      // Add exactly 50 conditions
      for (let i = 0; i < 50; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }

      // Try to add one more
      expect(() => {
        builder.equals('extra_column', 'extra_value');
      }).toThrow(SqlValidationError);
      expect(() => {
        builder.equals('extra_column', 'extra_value');
      }).toThrow(/Too many filter conditions/);
    });

    it('should enforce limit across different filter types', () => {
      const builder = createFilter();

      // Mix of different filter types totaling 50
      for (let i = 0; i < 25; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }
      for (let i = 0; i < 25; i++) {
        builder.ilike(`search_${i}`, `query_${i}`);
      }

      // Now at limit
      expect(() => {
        builder.isNotNull('extra_column');
      }).toThrow(SqlValidationError);
    });
  });

  describe('Other Atomic Operations', () => {
    it('should handle ilikeAny atomically (single condition despite multiple columns)', () => {
      const builder = createFilter();

      // Add 49 conditions
      for (let i = 0; i < 49; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }

      // ilikeAny creates ONE condition with OR, should succeed
      expect(() => {
        builder.ilikeAny(['col1', 'col2', 'col3'], 'search');
      }).not.toThrow();

      const result = builder.build();
      expect(result.whereClause.split(' AND ')).toHaveLength(50);
      expect(result.whereClause).toContain('col1 ILIKE');
      expect(result.whereClause).toContain('OR');
    });

    it('should handle in() with multiple values as single condition', () => {
      const builder = createFilter();

      // Add 49 conditions
      for (let i = 0; i < 49; i++) {
        builder.equals(`column_${i}`, `value_${i}`);
      }

      // in() creates ONE condition despite multiple values
      expect(() => {
        builder.in('status', ['active', 'pending', 'completed']);
      }).not.toThrow();

      const result = builder.build();
      expect(result.whereClause.split(' AND ')).toHaveLength(50);
      expect(result.whereClause).toContain('IN ($50, $51, $52)');
    });
  });

  describe('Builder State Consistency', () => {
    it('should maintain consistent paramCount and values length', () => {
      const builder = createFilter();

      builder
        .equals('a', 1)
        .ilike('b', 'test')
        .in('c', [1, 2, 3])
        .dateRange('d', { after: new Date('2024-01-01'), before: new Date('2024-12-31') });

      const result = builder.build();

      // paramCount should match number of actual parameters
      // equals: 1 param, ilike: 1 param, in: 3 params, dateRange: 2 params = 7 total
      expect(result.values).toHaveLength(7);
      expect(result.paramCount).toBe(8); // Next parameter would be $8
    });

    it('should not modify builder state on validation errors', () => {
      const builder = createFilter();
      builder.equals('a', 1);

      const beforeError = builder.build();
      const beforeParamCount = builder.getParamCount();
      const beforeValues = builder.getValues();

      // Try to add invalid column name
      expect(() => {
        builder.equals('invalid; DROP TABLE users;--', 'hack');
      }).toThrow(SqlValidationError);

      // State should be unchanged after error
      const afterError = builder.build();
      expect(afterError.whereClause).toBe(beforeError.whereClause);
      expect(builder.getParamCount()).toBe(beforeParamCount);
      expect(builder.getValues()).toEqual(beforeValues);
    });
  });

  describe('ilikeAny Search Modes', () => {
    it('should support contains mode (default)', () => {
      const builder = createFilter();
      builder.ilikeAny(['name', 'description'], 'test');

      const result = builder.build();

      expect(result.whereClause).toContain('(name ILIKE $1 OR description ILIKE $1)');
      expect(result.values[0]).toBe('%test%');
    });

    it('should support startsWith mode', () => {
      const builder = createFilter();
      builder.ilikeAny(['name', 'description'], 'test', 'startsWith');

      const result = builder.build();

      expect(result.whereClause).toContain('(name ILIKE $1 OR description ILIKE $1)');
      expect(result.values[0]).toBe('test%');
    });

    it('should support endsWith mode', () => {
      const builder = createFilter();
      builder.ilikeAny(['name', 'description'], 'test', 'endsWith');

      const result = builder.build();

      expect(result.whereClause).toContain('(name ILIKE $1 OR description ILIKE $1)');
      expect(result.values[0]).toBe('%test');
    });

    it('should support exact mode', () => {
      const builder = createFilter();
      builder.ilikeAny(['name', 'description'], 'test', 'exact');

      const result = builder.build();

      expect(result.whereClause).toContain('(name ILIKE $1 OR description ILIKE $1)');
      expect(result.values[0]).toBe('test');
    });

    it('should escape special characters in all modes', () => {
      const builder = createFilter();
      builder.ilikeAny(['col1', 'col2'], '50%_off\\sale', 'contains');

      const result = builder.build();

      // Should escape %, _, and \
      expect(result.values[0]).toBe('%50\\%\\_off\\\\sale%');
    });

    it('should work with multiple columns in different modes', () => {
      const builder = createFilter();

      builder.ilikeAny(['first_name', 'last_name', 'email'], 'john', 'startsWith');

      const result = builder.build();

      expect(result.whereClause).toContain(
        '(first_name ILIKE $1 OR last_name ILIKE $1 OR email ILIKE $1)'
      );
      expect(result.values[0]).toBe('john%');
    });

    it('should handle empty columns array gracefully', () => {
      const builder = createFilter();
      builder.ilikeAny([], 'test', 'contains');

      const result = builder.build();

      expect(result.whereClause).toBe('');
      expect(result.values).toHaveLength(0);
    });

    it('should handle null/undefined values gracefully', () => {
      const builder = createFilter();
      builder.ilikeAny(['col1', 'col2'], null, 'contains');
      builder.ilikeAny(['col1', 'col2'], undefined, 'startsWith');
      builder.ilikeAny(['col1', 'col2'], '', 'endsWith');

      const result = builder.build();

      expect(result.whereClause).toBe('');
      expect(result.values).toHaveLength(0);
    });
  });
});
