/**
 * Base Repository Date Filter Tests
 * Tests for buildDateRangeFilter method with automatic WHERE/AND detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { BaseRepository } from '../../src/db/repositories/base-repository.js';

// Mock pool for testing
let mockPool: Pool;

beforeEach(() => {
  mockPool = {
    query: async () => ({
      rows: [{ count: '0' }],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: [],
    }),
  } as unknown as Pool;
});

// Test repository class to expose BaseRepository's protected buildDateRangeFilter method
class TestDateFilterRepo extends BaseRepository<unknown> {
  constructor() {
    super(mockPool, 'application', 'test_table', []);
  }

  // Expose protected buildDateRangeFilter for testing
  public testBuildDateRangeFilter(
    fieldName: string,
    afterDate: Date | undefined,
    beforeDate: Date | undefined,
    values: unknown[],
    startParamCount: number,
    existingWhereClause = ''
  ) {
    return this.buildDateRangeFilter(
      fieldName,
      afterDate,
      beforeDate,
      values,
      startParamCount,
      existingWhereClause
    );
  }
}

describe('BaseRepository - buildDateRangeFilter', () => {
  let repo: TestDateFilterRepo;

  beforeEach(() => {
    repo = new TestDateFilterRepo();
  });

  describe('Automatic WHERE vs AND Detection', () => {
    it('should use WHERE when existingWhereClause is empty string', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        beforeDate,
        values,
        1,
        '' // No existing WHERE clause
      );

      expect(result.clause).toMatch(/^WHERE /);
      expect(result.clause).toBe(
        'WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz'
      );
      expect(result.paramCount).toBe(3);
      expect(values).toHaveLength(2);
      expect(values[0]).toBe(afterDate.toISOString());
      expect(values[1]).toBe(beforeDate.toISOString());
    });

    it('should use AND when existingWhereClause contains WHERE keyword', () => {
      const values: unknown[] = ['test-project-id'];
      const afterDate = new Date('2024-01-01T00:00:00Z');
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        beforeDate,
        values,
        2,
        ' WHERE project_id = $1' // Existing WHERE clause
      );

      expect(result.clause).toMatch(/^AND /);
      expect(result.clause).toBe(
        'AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz'
      );
      expect(result.paramCount).toBe(4);
      expect(values).toHaveLength(3);
      expect(values[1]).toBe(afterDate.toISOString());
      expect(values[2]).toBe(beforeDate.toISOString());
    });

    it('should use AND when existingWhereClause has WHERE with multiple conditions', () => {
      const values: unknown[] = ['test-project-id', 'open'];
      const afterDate = new Date('2024-06-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        3,
        ' WHERE project_id = $1 AND status = $2' // Complex existing WHERE
      );

      expect(result.clause).toMatch(/^AND /);
      expect(result.clause).toBe('AND created_at >= $3::timestamptz');
      expect(result.paramCount).toBe(4);
      expect(values).toHaveLength(3);
      expect(values[2]).toBe(afterDate.toISOString());
    });

    it('should handle lowercase WHERE keyword', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'timestamp',
        afterDate,
        undefined,
        values,
        1,
        ' where user_id = $1' // Lowercase WHERE
      );

      expect(result.clause).toMatch(/^AND /);
      expect(result.clause).toBe('AND timestamp >= $1::timestamptz');
    });

    it('should handle mixed case WHERE keyword', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'updated_at',
        afterDate,
        undefined,
        values,
        1,
        ' WhErE id = $1' // Mixed case WHERE
      );

      expect(result.clause).toMatch(/^AND /);
    });
  });

  describe('Date Range Combinations', () => {
    it('should handle only afterDate (created_after)', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        1,
        ''
      );

      expect(result.clause).toBe('WHERE created_at >= $1::timestamptz');
      expect(result.paramCount).toBe(2);
      expect(values).toHaveLength(1);
      expect(values[0]).toBe(afterDate.toISOString());
    });

    it('should handle only beforeDate (created_before)', () => {
      const values: unknown[] = [];
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        undefined,
        beforeDate,
        values,
        1,
        ''
      );

      expect(result.clause).toBe('WHERE created_at <= $1::timestamptz');
      expect(result.paramCount).toBe(2);
      expect(values).toHaveLength(1);
      expect(values[0]).toBe(beforeDate.toISOString());
    });

    it('should handle both afterDate and beforeDate (date range)', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        beforeDate,
        values,
        1,
        ''
      );

      expect(result.clause).toBe(
        'WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz'
      );
      expect(result.paramCount).toBe(3);
      expect(values).toHaveLength(2);
      expect(values[0]).toBe(afterDate.toISOString());
      expect(values[1]).toBe(beforeDate.toISOString());
    });

    it('should return empty clause when no dates provided', () => {
      const values: unknown[] = [];

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        undefined,
        undefined,
        values,
        1,
        ''
      );

      expect(result.clause).toBe('');
      expect(result.paramCount).toBe(1); // Unchanged
      expect(values).toHaveLength(0); // No values added
    });
  });

  describe('Parameter Numbering', () => {
    it('should start parameters from specified startParamCount', () => {
      const values: unknown[] = ['existing-value-1', 'existing-value-2', 'existing-value-3'];
      const afterDate = new Date('2024-01-01T00:00:00Z');
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        beforeDate,
        values,
        4, // Start at $4
        ' WHERE project_id = $1 AND user_id = $2 AND status = $3'
      );

      expect(result.clause).toBe(
        'AND created_at >= $4::timestamptz AND created_at <= $5::timestamptz'
      );
      expect(result.paramCount).toBe(6); // Next available param
      expect(values).toHaveLength(5);
      expect(values[3]).toBe(afterDate.toISOString());
      expect(values[4]).toBe(beforeDate.toISOString());
    });

    it('should correctly increment paramCount for single date', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'timestamp',
        afterDate,
        undefined,
        values,
        5,
        ''
      );

      expect(result.clause).toBe('WHERE timestamp >= $5::timestamptz');
      expect(result.paramCount).toBe(6);
    });

    it('should handle large parameter numbers correctly', () => {
      const values: unknown[] = new Array(99).fill('dummy-value');
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        100,
        ' WHERE id = $1'
      );

      expect(result.clause).toBe('AND created_at >= $100::timestamptz');
      expect(result.paramCount).toBe(101);
      expect(values).toHaveLength(100);
    });
  });

  describe('Different Field Names', () => {
    it('should work with created_at field', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        1,
        ''
      );

      expect(result.clause).toContain('created_at >=');
    });

    it('should work with updated_at field', () => {
      const values: unknown[] = [];
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const result = repo.testBuildDateRangeFilter(
        'updated_at',
        undefined,
        beforeDate,
        values,
        1,
        ''
      );

      expect(result.clause).toContain('updated_at <=');
    });

    it('should work with timestamp field', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'timestamp',
        afterDate,
        undefined,
        values,
        1,
        ''
      );

      expect(result.clause).toContain('timestamp >=');
    });

    it('should work with custom field names', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'delivery_time',
        afterDate,
        undefined,
        values,
        1,
        ''
      );

      expect(result.clause).toContain('delivery_time >=');
    });
  });

  describe('SQL Injection Prevention', () => {
    it('should reject field names with special characters', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      expect(() => {
        repo.testBuildDateRangeFilter(
          'created_at; DROP TABLE users--',
          afterDate,
          undefined,
          values,
          1,
          ''
        );
      }).toThrow(/Invalid SQL identifier/);
    });

    it('should reject field names with spaces', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      expect(() => {
        repo.testBuildDateRangeFilter('created at', afterDate, undefined, values, 1, '');
      }).toThrow(/Invalid SQL identifier/);
    });

    it('should reject field names with dots (table prefixes)', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      expect(() => {
        repo.testBuildDateRangeFilter('users.created_at', afterDate, undefined, values, 1, '');
      }).toThrow(/Invalid SQL identifier/);
    });

    it('should reject field names with dashes', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      expect(() => {
        repo.testBuildDateRangeFilter('created-at', afterDate, undefined, values, 1, '');
      }).toThrow(/Invalid SQL identifier/);
    });
  });

  describe('PostgreSQL Type Casting', () => {
    it('should always add ::timestamptz type cast to parameters', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        beforeDate,
        values,
        1,
        ''
      );

      // Ensure both parameters have explicit type casting
      expect(result.clause).toContain('$1::timestamptz');
      expect(result.clause).toContain('$2::timestamptz');
    });

    it('should add type cast even with only one date parameter', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        1,
        ''
      );

      expect(result.clause).toContain('::timestamptz');
    });
  });

  describe('Date Value Formatting', () => {
    it('should convert dates to ISO string format', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-15T10:30:45.123Z');

      repo.testBuildDateRangeFilter('created_at', afterDate, undefined, values, 1, '');

      expect(values[0]).toBe('2024-01-15T10:30:45.123Z');
      expect(typeof values[0]).toBe('string');
    });

    it('should preserve timezone information in ISO string', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-06-15T14:30:00Z');
      const beforeDate = new Date('2024-06-20T18:45:30Z');

      repo.testBuildDateRangeFilter('created_at', afterDate, beforeDate, values, 1, '');

      expect(values[0]).toBe('2024-06-15T14:30:00.000Z');
      expect(values[1]).toBe('2024-06-20T18:45:30.000Z');
    });
  });

  describe('Edge Cases', () => {
    it('should handle whitespace in existingWhereClause', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        1,
        '  WHERE  project_id = $1  ' // Extra whitespace
      );

      expect(result.clause).toMatch(/^AND /);
    });

    it('should handle very long existingWhereClause', () => {
      const values: unknown[] = [];
      const afterDate = new Date('2024-01-01T00:00:00Z');
      const longWhereClause =
        ' WHERE ' + Array.from({ length: 20 }, (_, i) => `col${i} = $${i + 1}`).join(' AND ');

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        21,
        longWhereClause
      );

      expect(result.clause).toMatch(/^AND /);
      expect(result.clause).toContain('$21::timestamptz');
    });

    it('should handle same date for afterDate and beforeDate (single day)', () => {
      const values: unknown[] = [];
      const sameDate = new Date('2024-06-15T00:00:00Z');

      const result = repo.testBuildDateRangeFilter('created_at', sameDate, sameDate, values, 1, '');

      expect(result.clause).toBe(
        'WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz'
      );
      expect(values[0]).toBe(values[1]);
    });

    it('should handle dates with millisecond precision', () => {
      const values: unknown[] = [];
      const preciseDate = new Date('2024-01-01T12:34:56.789Z');

      repo.testBuildDateRangeFilter('created_at', preciseDate, undefined, values, 1, '');

      expect(values[0]).toBe('2024-01-01T12:34:56.789Z');
    });
  });

  describe('Integration Scenarios', () => {
    it('should work in bug report list scenario', () => {
      // Simulate bug report list query building
      const values: unknown[] = ['test-project-id'];
      const afterDate = new Date('2024-01-01T00:00:00Z');
      const beforeDate = new Date('2024-12-31T23:59:59Z');

      const existingWhereClause = ' WHERE project_id = $1';

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        beforeDate,
        values,
        2,
        existingWhereClause
      );

      const finalQuery = `SELECT * FROM bug_reports${existingWhereClause}${result.clause} ORDER BY created_at DESC LIMIT 10`;

      expect(finalQuery).toContain('WHERE project_id = $1');
      expect(finalQuery).toContain('AND created_at >= $2::timestamptz');
      expect(finalQuery).toContain('AND created_at <= $3::timestamptz');
      expect(values).toEqual([
        'test-project-id',
        '2024-01-01T00:00:00.000Z',
        '2024-12-31T23:59:59.000Z',
      ]);
    });

    it('should work in notification history list scenario', () => {
      // Simulate notification history query building
      const values: unknown[] = ['test-project-id', 'email'];
      const afterDate = new Date('2024-06-01T00:00:00Z');

      const existingWhereClause = ' WHERE project_id = $1 AND channel = $2';

      const result = repo.testBuildDateRangeFilter(
        'created_at',
        afterDate,
        undefined,
        values,
        3,
        existingWhereClause
      );

      expect(result.clause).toBe('AND created_at >= $3::timestamptz');
      expect(result.paramCount).toBe(4);
      expect(values).toHaveLength(3);
    });

    it('should work in audit log list scenario', () => {
      // Simulate audit log query building where conditions are built separately
      const conditions: string[] = ['project_id = $1', 'action = $2'];
      const values: unknown[] = ['test-project-id', 'bug_report.create'];
      const afterDate = new Date('2024-01-01T00:00:00Z');

      // Build WHERE clause from existing conditions
      const existingWhereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

      const result = repo.testBuildDateRangeFilter(
        'timestamp',
        afterDate,
        undefined,
        values,
        3,
        existingWhereClause
      );

      // Extract just the condition part (remove WHERE/AND prefix for conditions array)
      const conditionOnly = result.clause.replace(/^\s*(WHERE|AND)\s+/, '');
      conditions.push(conditionOnly);

      const finalQuery = `SELECT * FROM audit_logs WHERE ${conditions.join(' AND ')}`;

      expect(finalQuery).toContain('timestamp >= $3::timestamptz');
      expect(values).toHaveLength(3);
    });
  });
});
