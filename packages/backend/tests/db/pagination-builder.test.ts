/**
 * PaginationBuilder Tests
 */

import { describe, it, expect } from 'vitest';
import { createPagination, calculatePaginationMetadata } from '../../src/db/pagination-builder.js';

describe('PaginationBuilder', () => {
  describe('page', () => {
    it('should set page and limit', () => {
      const builder = createPagination().page(2, 25);

      expect(builder.getPage()).toBe(2);
      expect(builder.getLimit()).toBe(25);
      expect(builder.getOffset()).toBe(25);
    });

    it('should use defaults when not specified', () => {
      const builder = createPagination();

      expect(builder.getPage()).toBe(1);
      expect(builder.getLimit()).toBe(20);
      expect(builder.getOffset()).toBe(0);
    });

    it('should reject invalid page numbers', () => {
      expect(() => {
        createPagination().page(0, 20);
      }).toThrow('Invalid page number');

      expect(() => {
        createPagination().page(-1, 20);
      }).toThrow('Invalid page number');

      expect(() => {
        createPagination().page(1.5, 20);
      }).toThrow('Invalid page number');
    });

    it('should reject invalid limits', () => {
      expect(() => {
        createPagination().page(1, 0);
      }).toThrow('Invalid limit');

      expect(() => {
        createPagination().page(1, 1001);
      }).toThrow('Invalid limit');

      expect(() => {
        createPagination().page(1, -5);
      }).toThrow('Invalid limit');
    });
  });

  describe('orderBy', () => {
    it('should add sort column', () => {
      const builder = createPagination().orderBy('created_at', 'desc');

      expect(builder.hasSorting()).toBe(true);
      expect(builder.buildOrderBy()).toBe('ORDER BY created_at DESC');
    });

    it('should support multiple sort columns', () => {
      const builder = createPagination().orderBy('priority', 'desc').orderBy('name', 'asc');

      expect(builder.buildOrderBy()).toBe('ORDER BY priority DESC, name ASC');
    });

    it('should normalize direction to lowercase', () => {
      const builder = createPagination().orderBy('name', 'ASC' as 'asc');

      expect(builder.buildOrderBy()).toBe('ORDER BY name ASC');
    });

    it('should reject invalid column names', () => {
      expect(() => {
        createPagination().orderBy('name; DROP TABLE', 'asc');
      }).toThrow('Invalid SQL identifier');
    });

    it('should reject SQL keywords as column names', () => {
      expect(() => {
        createPagination().orderBy('SELECT', 'asc');
      }).toThrow('reserved SQL keyword');
    });

    it('should reject invalid sort direction', () => {
      expect(() => {
        createPagination().orderBy('name', 'invalid' as 'asc');
      }).toThrow('Invalid sort direction');
    });

    it('should enforce maximum ORDER BY columns', () => {
      const builder = createPagination();

      // Add 10 columns (the max)
      for (let i = 0; i < 10; i++) {
        builder.orderBy(`col${i}`, 'asc');
      }

      // 11th should fail
      expect(() => {
        builder.orderBy('col10', 'asc');
      }).toThrow('Too many ORDER BY columns');
    });
  });

  describe('orderByValidated', () => {
    it('should use column from whitelist', () => {
      const allowedColumns = ['created_at', 'name', 'status'] as const;

      const builder = createPagination().orderByValidated(
        'name',
        'asc',
        allowedColumns,
        'created_at',
        'desc'
      );

      expect(builder.buildOrderBy()).toBe('ORDER BY name ASC');
    });

    it('should fall back to default when column not in whitelist', () => {
      const allowedColumns = ['created_at', 'name', 'status'] as const;

      const builder = createPagination().orderByValidated(
        'invalid_column',
        'asc',
        allowedColumns,
        'created_at',
        'desc'
      );

      expect(builder.buildOrderBy()).toBe('ORDER BY created_at ASC');
    });

    it('should use default direction when invalid', () => {
      const allowedColumns = ['created_at', 'name'] as const;

      const builder = createPagination().orderByValidated(
        'name',
        'invalid' as 'asc',
        allowedColumns,
        'created_at',
        'desc'
      );

      expect(builder.buildOrderBy()).toBe('ORDER BY name DESC');
    });

    it('should use defaults when values are undefined', () => {
      const allowedColumns = ['created_at', 'name'] as const;

      const builder = createPagination().orderByValidated(
        undefined,
        undefined,
        allowedColumns,
        'created_at',
        'desc'
      );

      expect(builder.buildOrderBy()).toBe('ORDER BY created_at DESC');
    });
  });

  describe('build', () => {
    it('should build complete pagination result', () => {
      const { orderByClause, limitClause, values, paramCount, metadata } = createPagination()
        .page(2, 25)
        .orderBy('created_at', 'desc')
        .build(100, 1);

      expect(orderByClause).toBe('ORDER BY created_at DESC');
      expect(limitClause).toBe('LIMIT $1 OFFSET $2');
      expect(values).toEqual([25, 25]);
      expect(paramCount).toBe(3);
      expect(metadata).toEqual({
        page: 2,
        limit: 25,
        total: 100,
        totalPages: 4,
      });
    });

    it('should respect custom starting parameter count', () => {
      const { limitClause, values, paramCount } = createPagination()
        .page(1, 20)
        .orderBy('name', 'asc')
        .build(50, 5);

      expect(limitClause).toBe('LIMIT $5 OFFSET $6');
      expect(values).toEqual([20, 0]);
      expect(paramCount).toBe(7);
    });

    it('should calculate totalPages correctly', () => {
      // Exact division
      expect(createPagination().page(1, 10).build(100, 1).metadata.totalPages).toBe(10);

      // With remainder
      expect(createPagination().page(1, 10).build(95, 1).metadata.totalPages).toBe(10);

      // Less than one page
      expect(createPagination().page(1, 10).build(5, 1).metadata.totalPages).toBe(1);

      // Empty result (returns 1 per REST convention)
      expect(createPagination().page(1, 10).build(0, 1).metadata.totalPages).toBe(1);
    });

    it('should return empty ORDER BY when no sorting specified', () => {
      const { orderByClause } = createPagination().page(1, 20).build(100, 1);

      expect(orderByClause).toBe('');
    });
  });

  describe('buildOrderBy', () => {
    it('should return empty string when no sorting', () => {
      expect(createPagination().buildOrderBy()).toBe('');
    });

    it('should build ORDER BY clause only', () => {
      const orderBy = createPagination()
        .orderBy('priority', 'desc')
        .orderBy('name', 'asc')
        .buildOrderBy();

      expect(orderBy).toBe('ORDER BY priority DESC, name ASC');
    });
  });

  describe('hasSorting', () => {
    it('should return false when no sorting', () => {
      expect(createPagination().hasSorting()).toBe(false);
    });

    it('should return true when sorting is set', () => {
      expect(createPagination().orderBy('name', 'asc').hasSorting()).toBe(true);
    });
  });
});

describe('calculatePaginationMetadata', () => {
  it('should calculate metadata correctly', () => {
    const metadata = calculatePaginationMetadata(2, 25, 100);

    expect(metadata).toEqual({
      page: 2,
      limit: 25,
      total: 100,
      totalPages: 4,
    });
  });

  it('should handle edge cases', () => {
    // Empty results (returns 1 per REST convention)
    expect(calculatePaginationMetadata(1, 20, 0)).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 1,
    });

    // Single item
    expect(calculatePaginationMetadata(1, 20, 1)).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });
});
