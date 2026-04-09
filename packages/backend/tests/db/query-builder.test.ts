import { describe, it, expect } from 'vitest';
import {
  buildWhereClause,
  buildUpdateClause,
  buildPaginationClause,
  buildOrderByClause,
  serializeJsonField,
  deserializeJsonField,
  deserializeRow,
} from '../../src/db/query-builder.js';

describe('Query Builder', () => {
  describe('buildWhereClause', () => {
    it('should build simple WHERE clause with equality operators', () => {
      const result = buildWhereClause({
        status: 'open',
        priority: 'high',
      });

      expect(result.clause).toBe('WHERE status = $1 AND priority = $2');
      expect(result.values).toEqual(['open', 'high']);
      expect(result.paramCount).toBe(3);
    });

    it('should build WHERE clause with custom operators', () => {
      const result = buildWhereClause({
        age: { value: 18, operator: '>=' },
        score: { value: 100, operator: '<=' },
      });

      expect(result.clause).toBe('WHERE age >= $1 AND score <= $2');
      expect(result.values).toEqual([18, 100]);
      expect(result.paramCount).toBe(3);
    });

    it('should mix simple and custom operator filters', () => {
      const result = buildWhereClause({
        status: 'active',
        age: { value: 21, operator: '>' },
      });

      expect(result.clause).toBe('WHERE status = $1 AND age > $2');
      expect(result.values).toEqual(['active', 21]);
      expect(result.paramCount).toBe(3);
    });

    it('should skip undefined values', () => {
      const result = buildWhereClause({
        status: 'open',
        priority: undefined,
        assignee: 'john',
      });

      expect(result.clause).toBe('WHERE status = $1 AND assignee = $2');
      expect(result.values).toEqual(['open', 'john']);
      expect(result.paramCount).toBe(3);
    });

    it('should skip null values', () => {
      const result = buildWhereClause({
        status: 'open',
        priority: null,
        assignee: 'john',
      });

      expect(result.clause).toBe('WHERE status = $1 AND assignee = $2');
      expect(result.values).toEqual(['open', 'john']);
      expect(result.paramCount).toBe(3);
    });

    it('should return empty clause for empty filters', () => {
      const result = buildWhereClause({});

      expect(result.clause).toBe('');
      expect(result.values).toEqual([]);
      expect(result.paramCount).toBe(1);
    });

    it('should return empty clause when all values are undefined/null', () => {
      const result = buildWhereClause({
        status: undefined,
        priority: null,
      });

      expect(result.clause).toBe('');
      expect(result.values).toEqual([]);
      expect(result.paramCount).toBe(1);
    });

    it('should respect custom startParamCount', () => {
      const result = buildWhereClause(
        {
          status: 'open',
          priority: 'high',
        },
        5
      );

      expect(result.clause).toBe('WHERE status = $5 AND priority = $6');
      expect(result.values).toEqual(['open', 'high']);
      expect(result.paramCount).toBe(7);
    });

    it('should handle custom operators without explicit value property', () => {
      const result = buildWhereClause({
        created_at: { value: '2025-01-01', operator: '>=' },
      });

      expect(result.clause).toBe('WHERE created_at >= $1');
      expect(result.values).toEqual(['2025-01-01']);
    });
  });

  describe('buildUpdateClause', () => {
    it('should build UPDATE SET clause', () => {
      const result = buildUpdateClause({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
      });

      expect(result.clause).toBe('name = $1, email = $2, age = $3');
      expect(result.values).toEqual(['John Doe', 'john@example.com', 30]);
      expect(result.paramCount).toBe(4);
    });

    it('should skip undefined values', () => {
      const result = buildUpdateClause({
        name: 'John Doe',
        email: undefined,
        age: 30,
      });

      expect(result.clause).toBe('name = $1, age = $2');
      expect(result.values).toEqual(['John Doe', 30]);
      expect(result.paramCount).toBe(3);
    });

    it('should skip null values (consistent with WHERE clause behavior)', () => {
      const result = buildUpdateClause({
        name: 'John Doe',
        email: null,
        age: 30,
      });

      // Note: null values are filtered out by buildParameterizedClause
      // This is intentional to maintain consistency with buildWhereClause
      expect(result.clause).toBe('name = $1, age = $2');
      expect(result.values).toEqual(['John Doe', 30]);
      expect(result.paramCount).toBe(3);
    });

    it('should return empty clause for empty data', () => {
      const result = buildUpdateClause({});

      expect(result.clause).toBe('');
      expect(result.values).toEqual([]);
      expect(result.paramCount).toBe(1);
    });

    it('should return empty clause when all values are undefined', () => {
      const result = buildUpdateClause({
        name: undefined,
        email: undefined,
      });

      expect(result.clause).toBe('');
      expect(result.values).toEqual([]);
      expect(result.paramCount).toBe(1);
    });

    it('should respect custom startParamCount', () => {
      const result = buildUpdateClause(
        {
          name: 'John',
          age: 25,
        },
        10
      );

      expect(result.clause).toBe('name = $10, age = $11');
      expect(result.values).toEqual(['John', 25]);
      expect(result.paramCount).toBe(12);
    });

    it('should handle boolean values', () => {
      const result = buildUpdateClause({
        is_active: true,
        is_verified: false,
      });

      expect(result.clause).toBe('is_active = $1, is_verified = $2');
      expect(result.values).toEqual([true, false]);
    });

    it('should handle zero values', () => {
      const result = buildUpdateClause({
        count: 0,
        score: 0,
      });

      expect(result.clause).toBe('count = $1, score = $2');
      expect(result.values).toEqual([0, 0]);
    });

    it('should handle empty string values', () => {
      const result = buildUpdateClause({
        name: '',
        description: '',
      });

      expect(result.clause).toBe('name = $1, description = $2');
      expect(result.values).toEqual(['', '']);
    });
  });

  describe('buildPaginationClause', () => {
    it('should build pagination clause with default values', () => {
      const result = buildPaginationClause();

      expect(result.clause).toBe('LIMIT $1 OFFSET $2');
      expect(result.values).toEqual([20, 0]);
    });

    it('should build pagination clause for page 1', () => {
      const result = buildPaginationClause(1, 10);

      expect(result.clause).toBe('LIMIT $1 OFFSET $2');
      expect(result.values).toEqual([10, 0]);
    });

    it('should build pagination clause for page 2', () => {
      const result = buildPaginationClause(2, 10);

      expect(result.clause).toBe('LIMIT $1 OFFSET $2');
      expect(result.values).toEqual([10, 10]);
    });

    it('should build pagination clause for page 3', () => {
      const result = buildPaginationClause(3, 25);

      expect(result.clause).toBe('LIMIT $1 OFFSET $2');
      expect(result.values).toEqual([25, 50]);
    });

    it('should respect custom startParamCount', () => {
      const result = buildPaginationClause(2, 15, 5);

      expect(result.clause).toBe('LIMIT $5 OFFSET $6');
      expect(result.values).toEqual([15, 15]);
    });

    it('should handle large page numbers', () => {
      const result = buildPaginationClause(100, 20);

      expect(result.clause).toBe('LIMIT $1 OFFSET $2');
      expect(result.values).toEqual([20, 1980]);
    });

    it('should handle custom limit values', () => {
      const result = buildPaginationClause(1, 100);

      expect(result.clause).toBe('LIMIT $1 OFFSET $2');
      expect(result.values).toEqual([100, 0]);
    });

    it('should handle maximum allowed limit (1000)', () => {
      const result = buildPaginationClause(1, 1000);

      expect(result.clause).toBe('LIMIT $1 OFFSET $2');
      expect(result.values).toEqual([1000, 0]);
    });

    it('should throw error for negative page number', () => {
      expect(() => buildPaginationClause(-1, 20)).toThrow(
        'Invalid page number: -1. Must be an integer >= 1'
      );
    });

    it('should throw error for zero page number', () => {
      expect(() => buildPaginationClause(0, 20)).toThrow(
        'Invalid page number: 0. Must be an integer >= 1'
      );
    });

    it('should throw error for decimal page number', () => {
      expect(() => buildPaginationClause(1.5, 20)).toThrow(
        'Invalid page number: 1.5. Must be an integer >= 1'
      );
    });

    it('should throw error for negative limit', () => {
      expect(() => buildPaginationClause(1, -10)).toThrow(
        'Invalid limit: -10. Must be an integer between 1 and 1000'
      );
    });

    it('should throw error for zero limit', () => {
      expect(() => buildPaginationClause(1, 0)).toThrow(
        'Invalid limit: 0. Must be an integer between 1 and 1000'
      );
    });

    it('should throw error for decimal limit', () => {
      expect(() => buildPaginationClause(1, 20.7)).toThrow(
        'Invalid limit: 20.7. Must be an integer between 1 and 1000'
      );
    });

    it('should throw error for limit exceeding maximum (1000)', () => {
      expect(() => buildPaginationClause(1, 1001)).toThrow(
        'Invalid limit: 1001. Must be an integer between 1 and 1000'
      );
    });

    it('should throw error for excessively large limit (DoS protection)', () => {
      expect(() => buildPaginationClause(1, 999999)).toThrow(
        'Invalid limit: 999999. Must be an integer between 1 and 1000'
      );
    });

    it('should throw error for NaN page', () => {
      expect(() => buildPaginationClause(NaN, 20)).toThrow('Invalid page number');
    });

    it('should throw error for NaN limit', () => {
      expect(() => buildPaginationClause(1, NaN)).toThrow('Invalid limit');
    });

    it('should throw error for Infinity page', () => {
      expect(() => buildPaginationClause(Infinity, 20)).toThrow('Invalid page number');
    });

    it('should throw error for Infinity limit', () => {
      expect(() => buildPaginationClause(1, Infinity)).toThrow('Invalid limit');
    });
  });

  describe('buildOrderByClause', () => {
    it('should build ORDER BY clause with default values', () => {
      const result = buildOrderByClause();

      expect(result).toBe('ORDER BY created_at DESC');
    });

    it('should build ORDER BY clause with custom column', () => {
      const result = buildOrderByClause('name');

      expect(result).toBe('ORDER BY name DESC');
    });

    it('should build ORDER BY clause with ascending order', () => {
      const result = buildOrderByClause('priority', 'asc');

      expect(result).toBe('ORDER BY priority ASC');
    });

    it('should build ORDER BY clause with descending order', () => {
      const result = buildOrderByClause('updated_at', 'desc');

      expect(result).toBe('ORDER BY updated_at DESC');
    });

    it('should allow column names with underscores', () => {
      const result = buildOrderByClause('created_at');

      expect(result).toBe('ORDER BY created_at DESC');
    });

    it('should allow column names with numbers', () => {
      const result = buildOrderByClause('field123');

      expect(result).toBe('ORDER BY field123 DESC');
    });

    it('should throw error for SQL injection attempt with semicolon', () => {
      expect(() => buildOrderByClause('name; DROP TABLE users--')).toThrow(
        'Invalid SQL identifier'
      );
    });

    it('should throw error for SQL injection attempt with spaces', () => {
      expect(() => buildOrderByClause('name DESC; DROP')).toThrow('Invalid SQL identifier');
    });

    it('should throw error for column names with special characters', () => {
      expect(() => buildOrderByClause('user.name')).toThrow('Invalid SQL identifier');
    });

    it('should throw error for column names with parentheses', () => {
      expect(() => buildOrderByClause('COUNT(*)')).toThrow('Invalid SQL identifier');
    });

    it('should throw error for column names with hyphens', () => {
      expect(() => buildOrderByClause('user-name')).toThrow('Invalid SQL identifier');
    });

    it('should throw error for empty column name', () => {
      expect(() => buildOrderByClause('')).toThrow('Invalid SQL identifier');
    });
  });

  describe('serializeJsonField', () => {
    it('should serialize object to JSON string', () => {
      const result = serializeJsonField({ name: 'John', age: 30 });

      expect(result).toBe('{"name":"John","age":30}');
    });

    it('should serialize array to JSON string', () => {
      const result = serializeJsonField([1, 2, 3, 4, 5]);

      expect(result).toBe('[1,2,3,4,5]');
    });

    it('should serialize nested objects', () => {
      const result = serializeJsonField({
        user: { name: 'John' },
        settings: { theme: 'dark' },
      });

      expect(result).toBe('{"user":{"name":"John"},"settings":{"theme":"dark"}}');
    });

    it('should handle null by returning SQL NULL', () => {
      const result = serializeJsonField(null);

      expect(result).toBeNull();
    });

    it('should handle undefined by converting to empty object', () => {
      const result = serializeJsonField(undefined);

      expect(result).toBe('{}');
    });

    it('should serialize empty object', () => {
      const result = serializeJsonField({});

      expect(result).toBe('{}');
    });

    it('should serialize boolean values', () => {
      const result = serializeJsonField({ enabled: true, disabled: false });

      expect(result).toBe('{"enabled":true,"disabled":false}');
    });
  });

  describe('deserializeJsonField', () => {
    it('should deserialize JSON string to object', () => {
      const result = deserializeJsonField('{"name":"John","age":30}');

      expect(result).toEqual({ name: 'John', age: 30 });
    });

    it('should deserialize JSON string to array', () => {
      const result = deserializeJsonField('[1,2,3,4,5]');

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should return object as-is if not a string', () => {
      const obj = { name: 'John', age: 30 };
      const result = deserializeJsonField(obj);

      expect(result).toEqual(obj);
    });

    it('should return array as-is if not a string', () => {
      const arr = [1, 2, 3];
      const result = deserializeJsonField(arr);

      expect(result).toEqual(arr);
    });

    it('should deserialize nested objects', () => {
      const result = deserializeJsonField('{"user":{"name":"John"},"settings":{"theme":"dark"}}');

      expect(result).toEqual({
        user: { name: 'John' },
        settings: { theme: 'dark' },
      });
    });

    it('should deserialize empty object', () => {
      const result = deserializeJsonField('{}');

      expect(result).toEqual({});
    });

    it('should handle boolean values', () => {
      const result = deserializeJsonField('{"enabled":true,"disabled":false}');

      expect(result).toEqual({ enabled: true, disabled: false });
    });

    it('should support generic type parameter', () => {
      interface User {
        name: string;
        age: number;
      }

      const result = deserializeJsonField<User>('{"name":"John","age":30}');

      expect(result.name).toBe('John');
      expect(result.age).toBe(30);
    });
  });

  describe('deserializeRow', () => {
    it('should deserialize specified JSON fields in a row', () => {
      const row = {
        id: '123',
        name: 'Test',
        metadata: '{"browser":"Chrome","os":"Mac"}',
        settings: '{"theme":"dark","lang":"en"}',
      };

      const result = deserializeRow(row, ['metadata', 'settings']);

      expect(result).toEqual({
        id: '123',
        name: 'Test',
        metadata: { browser: 'Chrome', os: 'Mac' },
        settings: { theme: 'dark', lang: 'en' },
      });
    });

    it('should skip non-JSON fields', () => {
      const row = {
        id: '123',
        name: 'Test',
        count: 42,
      };

      const result = deserializeRow(row, ['metadata']);

      expect(result).toEqual({
        id: '123',
        name: 'Test',
        count: 42,
      });
    });

    it('should handle rows with undefined JSON fields', () => {
      const row = {
        id: '123',
        name: 'Test',
        metadata: undefined,
      };

      const result = deserializeRow(row, ['metadata']);

      expect(result).toEqual({
        id: '123',
        name: 'Test',
        metadata: undefined,
      });
    });

    it('should handle rows with null JSON fields', () => {
      const row = {
        id: '123',
        name: 'Test',
        metadata: null,
      };

      const result = deserializeRow(row, ['metadata']);

      expect(result).toEqual({
        id: '123',
        name: 'Test',
        metadata: null,
      });
    });

    it('should deserialize multiple JSON fields', () => {
      const row = {
        id: '123',
        data1: '{"a":1}',
        data2: '{"b":2}',
        data3: '{"c":3}',
      };

      const result = deserializeRow(row, ['data1', 'data2', 'data3']);

      expect(result).toEqual({
        id: '123',
        data1: { a: 1 },
        data2: { b: 2 },
        data3: { c: 3 },
      });
    });

    it('should handle empty jsonFields array', () => {
      const row = {
        id: '123',
        name: 'Test',
        metadata: '{"key":"value"}',
      };

      const result = deserializeRow(row, []);

      expect(result).toEqual({
        id: '123',
        name: 'Test',
        metadata: '{"key":"value"}',
      });
    });

    it('should preserve already-deserialized JSON fields', () => {
      const row = {
        id: '123',
        metadata: { browser: 'Chrome' }, // Already an object
      };

      const result = deserializeRow(row, ['metadata']);

      expect(result).toEqual({
        id: '123',
        metadata: { browser: 'Chrome' },
      });
    });
  });

  describe('SQL Injection Protection', () => {
    it('should prevent SQL injection in buildWhereClause with malicious column names', () => {
      expect(() =>
        buildWhereClause({
          'id; DROP TABLE users--': 'value',
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should prevent SQL injection in buildWhereClause with OR statement', () => {
      expect(() =>
        buildWhereClause({
          'id = 1 OR 1=1 --': 'value',
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should prevent SQL injection in buildWhereClause with spaces', () => {
      expect(() =>
        buildWhereClause({
          'id DESC; DROP': 'value',
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should prevent SQL injection in buildWhereClause with special characters', () => {
      expect(() =>
        buildWhereClause({
          'user.email': 'test@example.com',
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should prevent SQL injection in buildUpdateClause with malicious column names', () => {
      expect(() =>
        buildUpdateClause({
          'name; DROP TABLE users--': 'John',
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should prevent SQL injection in buildUpdateClause with OR statement', () => {
      expect(() =>
        buildUpdateClause({
          'name = "admin" OR 1=1 --': 'value',
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should prevent SQL injection in buildUpdateClause with parentheses', () => {
      expect(() =>
        buildUpdateClause({
          'name); DROP TABLE users--': 'value',
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should allow valid column names in buildWhereClause', () => {
      const result = buildWhereClause({
        user_id: '123',
        email_address: 'test@example.com',
        field123: 'value',
      });

      expect(result.clause).toContain('WHERE');
      expect(result.values).toHaveLength(3);
    });

    it('should allow valid column names in buildUpdateClause', () => {
      const result = buildUpdateClause({
        first_name: 'John',
        last_name: 'Doe',
        age123: 30,
      });

      expect(result.clause).toBeTruthy();
      expect(result.values).toHaveLength(3);
    });

    it('should prevent SQL injection with custom operators in buildWhereClause', () => {
      expect(() =>
        buildWhereClause({
          'id; DROP TABLE users--': { value: 1, operator: '=' },
        })
      ).toThrow('Invalid SQL identifier');
    });

    it('should allow valid column names with custom operators', () => {
      const result = buildWhereClause({
        created_at: { value: '2025-01-01', operator: '>=' },
        age: { value: 18, operator: '>' },
      });

      expect(result.clause).toContain('WHERE');
      expect(result.values).toEqual(['2025-01-01', 18]);
    });
  });
});
