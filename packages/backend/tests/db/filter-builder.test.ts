/**
 * FilterBuilder Tests
 */

import { describe, it, expect } from 'vitest';
import { createFilter } from '../../src/db/filter-builder.js';

describe('FilterBuilder', () => {
  describe('equals', () => {
    it('should add equality condition', () => {
      const { whereClause, values, paramCount } = createFilter().equals('status', 'active').build();

      expect(whereClause).toBe('WHERE status = $1');
      expect(values).toEqual(['active']);
      expect(paramCount).toBe(2);
    });

    it('should skip undefined values', () => {
      const { whereClause, values } = createFilter()
        .equals('status', 'active')
        .equals('type', undefined)
        .build();

      expect(whereClause).toBe('WHERE status = $1');
      expect(values).toEqual(['active']);
    });

    it('should skip null values', () => {
      const { whereClause, values } = createFilter()
        .equals('status', 'active')
        .equals('type', null)
        .build();

      expect(whereClause).toBe('WHERE status = $1');
      expect(values).toEqual(['active']);
    });

    it('should chain multiple conditions', () => {
      const { whereClause, values } = createFilter()
        .equals('status', 'active')
        .equals('type', 'admin')
        .equals('team_id', 'team-1')
        .build();

      expect(whereClause).toBe('WHERE status = $1 AND type = $2 AND team_id = $3');
      expect(values).toEqual(['active', 'admin', 'team-1']);
    });
  });

  describe('notEquals', () => {
    it('should add not equals condition', () => {
      const { whereClause, values } = createFilter().notEquals('status', 'deleted').build();

      expect(whereClause).toBe('WHERE status != $1');
      expect(values).toEqual(['deleted']);
    });
  });

  describe('compare', () => {
    it('should support various comparison operators', () => {
      const { whereClause, values } = createFilter()
        .compare('age', '>=', 18)
        .compare('score', '<', 100)
        .build();

      expect(whereClause).toBe('WHERE age >= $1 AND score < $2');
      expect(values).toEqual([18, 100]);
    });
  });

  describe('ilike', () => {
    it('should add case-insensitive search with contains mode', () => {
      const { whereClause, values } = createFilter().ilike('email', 'test').build();

      expect(whereClause).toBe('WHERE email ILIKE $1');
      expect(values).toEqual(['%test%']);
    });

    it('should support startsWith mode', () => {
      const { whereClause, values } = createFilter().ilike('name', 'John', 'startsWith').build();

      expect(whereClause).toBe('WHERE name ILIKE $1');
      expect(values).toEqual(['John%']);
    });

    it('should support endsWith mode', () => {
      const { whereClause, values } = createFilter().ilike('email', '.com', 'endsWith').build();

      expect(whereClause).toBe('WHERE email ILIKE $1');
      expect(values).toEqual(['%.com']);
    });

    it('should escape special LIKE characters', () => {
      const { values } = createFilter().ilike('name', '100%_value').build();

      expect(values).toEqual(['%100\\%\\_value%']);
    });

    it('should skip empty strings', () => {
      const { whereClause } = createFilter().ilike('name', '').build();

      expect(whereClause).toBe('');
    });
  });

  describe('like', () => {
    it('should add case-sensitive search', () => {
      const { whereClause, values } = createFilter()
        .like('resource', 'project', 'startsWith')
        .build();

      expect(whereClause).toBe('WHERE resource LIKE $1');
      expect(values).toEqual(['project%']);
    });
  });

  describe('ilikeAny', () => {
    it('should search across multiple columns', () => {
      const { whereClause, values } = createFilter()
        .ilikeAny(['name', 'description'], 'search')
        .build();

      expect(whereClause).toBe('WHERE (name ILIKE $1 OR description ILIKE $1)');
      expect(values).toEqual(['%search%']);
    });

    it('should skip empty search term', () => {
      const { whereClause } = createFilter().ilikeAny(['name', 'description'], '').build();

      expect(whereClause).toBe('');
    });
  });

  describe('dateRange', () => {
    it('should add date range conditions', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      const { whereClause, values } = createFilter()
        .dateRange('created_at', { after: startDate, before: endDate })
        .build();

      expect(whereClause).toBe(
        'WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz'
      );
      expect(values).toEqual([startDate.toISOString(), endDate.toISOString()]);
    });

    it('should support only after date', () => {
      const startDate = new Date('2024-01-01');

      const { whereClause, values } = createFilter()
        .dateRange('created_at', { after: startDate })
        .build();

      expect(whereClause).toBe('WHERE created_at >= $1::timestamptz');
      expect(values).toEqual([startDate.toISOString()]);
    });

    it('should support only before date', () => {
      const endDate = new Date('2024-12-31');

      const { whereClause, values } = createFilter()
        .dateRange('created_at', { before: endDate })
        .build();

      expect(whereClause).toBe('WHERE created_at <= $1::timestamptz');
      expect(values).toEqual([endDate.toISOString()]);
    });
  });

  describe('timestamp', () => {
    it('should add timestamp comparison', () => {
      const date = new Date('2024-06-15');

      const { whereClause, values } = createFilter().timestamp('expires_at', '<', date).build();

      expect(whereClause).toBe('WHERE expires_at < $1::timestamptz');
      expect(values).toEqual([date.toISOString()]);
    });
  });

  describe('in', () => {
    it('should add IN clause', () => {
      const { whereClause, values } = createFilter().in('status', ['active', 'pending']).build();

      expect(whereClause).toBe('WHERE status IN ($1, $2)');
      expect(values).toEqual(['active', 'pending']);
    });

    it('should skip empty arrays', () => {
      const { whereClause } = createFilter().in('status', []).build();

      expect(whereClause).toBe('');
    });
  });

  describe('any', () => {
    it('should add ANY clause', () => {
      const { whereClause, values } = createFilter().any('id', ['uuid1', 'uuid2']).build();

      expect(whereClause).toBe('WHERE id = ANY($1)');
      expect(values).toEqual([['uuid1', 'uuid2']]);
    });
  });

  describe('inArrayColumn', () => {
    it('should check if value is in array column', () => {
      const { whereClause, values } = createFilter().inArrayColumn('admin', 'tags').build();

      expect(whereClause).toBe('WHERE $1 = ANY(tags)');
      expect(values).toEqual(['admin']);
    });
  });

  describe('isNull / isNotNull', () => {
    it('should add IS NULL condition', () => {
      const { whereClause } = createFilter().isNull('deleted_at').build();

      expect(whereClause).toBe('WHERE deleted_at IS NULL');
    });

    it('should add IS NOT NULL condition', () => {
      const { whereClause } = createFilter().isNotNull('user_id').build();

      expect(whereClause).toBe('WHERE user_id IS NOT NULL');
    });
  });

  describe('when', () => {
    it('should conditionally add filters', () => {
      const isAdmin = true;
      const teamId = 'team-1';

      const { whereClause, values } = createFilter()
        .equals('status', 'active')
        .when(isAdmin, (b) => b.equals('team_id', teamId))
        .build();

      expect(whereClause).toBe('WHERE status = $1 AND team_id = $2');
      expect(values).toEqual(['active', 'team-1']);
    });

    it('should skip filters when condition is false', () => {
      const isAdmin = false;

      const { whereClause, values } = createFilter()
        .equals('status', 'active')
        .when(isAdmin, (b) => b.equals('team_id', 'team-1'))
        .build();

      expect(whereClause).toBe('WHERE status = $1');
      expect(values).toEqual(['active']);
    });
  });

  describe('raw', () => {
    it('should add raw SQL condition', () => {
      const builder = createFilter().equals('status', 'active');
      const paramCount = builder.getParamCount();

      builder.raw(`EXTRACT(YEAR FROM created_at) = $${paramCount}`, [2024]);

      const { whereClause, values } = builder.build();

      expect(whereClause).toBe('WHERE status = $1 AND EXTRACT(YEAR FROM created_at) = $2');
      expect(values).toEqual(['active', 2024]);
    });
  });

  describe('startParamCount', () => {
    it('should respect custom starting parameter count', () => {
      const { whereClause, values, paramCount } = createFilter(3)
        .equals('status', 'active')
        .build();

      expect(whereClause).toBe('WHERE status = $3');
      expect(values).toEqual(['active']);
      expect(paramCount).toBe(4);
    });
  });

  describe('buildConditions', () => {
    it('should build without WHERE keyword', () => {
      const { conditions, values } = createFilter()
        .equals('status', 'active')
        .equals('type', 'admin')
        .buildConditions();

      expect(conditions).toBe('status = $1 AND type = $2');
      expect(values).toEqual(['active', 'admin']);
    });
  });

  describe('hasConditions', () => {
    it('should return true when conditions exist', () => {
      const builder = createFilter().equals('status', 'active');

      expect(builder.hasConditions()).toBe(true);
    });

    it('should return false when no conditions', () => {
      const builder = createFilter().equals('status', undefined);

      expect(builder.hasConditions()).toBe(false);
    });
  });

  describe('SQL injection protection', () => {
    it('should reject invalid column names', () => {
      expect(() => {
        createFilter().equals('status; DROP TABLE users;', 'active').build();
      }).toThrow('Invalid SQL identifier');
    });

    it('should reject columns with special characters', () => {
      expect(() => {
        createFilter().equals("status'", 'active').build();
      }).toThrow('Invalid SQL identifier');
    });

    it('should reject empty column names', () => {
      expect(() => {
        createFilter().equals('', 'active').build();
      }).toThrow('SQL identifier length');
    });
  });

  describe('condition limit', () => {
    it('should enforce maximum condition limit', () => {
      const builder = createFilter();

      // Add 50 conditions (the max)
      for (let i = 0; i < 50; i++) {
        builder.equals(`col${i}`, `value${i}`);
      }

      // 51st should fail
      expect(() => {
        builder.equals('col50', 'value50');
      }).toThrow('Too many filter conditions');
    });
  });
});
