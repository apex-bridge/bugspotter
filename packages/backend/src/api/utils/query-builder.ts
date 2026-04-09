/**
 * Query Builder Utilities
 * Helper functions for building query parameters
 */

import { PAGINATION, SORTING } from './constants.js';
import { ValidationError } from '../middleware/error.js';

/**
 * Pagination options for database queries
 */
export interface PaginationOptions {
  page: number;
  limit: number;
}

/**
 * Sort options for database queries
 */
export interface SortOptions<T extends string = string> {
  sort_by: T;
  order: 'asc' | 'desc';
}

/**
 * Build pagination options with defaults
 *
 * @param page - Page number (1-indexed)
 * @param limit - Items per page
 * @returns Pagination options with defaults applied
 */
export function buildPagination(page?: number, limit?: number): PaginationOptions {
  return {
    page: page || PAGINATION.DEFAULT_PAGE,
    limit: limit || PAGINATION.DEFAULT_LIMIT,
  };
}

/**
 * Build empty pagination metadata (zero total results)
 */
export function buildEmptyPagination(pagination: PaginationOptions) {
  return {
    page: pagination.page,
    limit: pagination.limit,
    total: 0,
    totalPages: 0,
  };
}

/**
 * Build sort options with defaults
 * Generic version that preserves specific string literal types
 *
 * @param sortBy - Field to sort by
 * @param order - Sort order (asc/desc)
 * @param defaultSortBy - Default sort field
 * @returns Sort options with defaults applied
 */
export function buildSort<T extends string>(
  sortBy: T | undefined,
  order: 'asc' | 'desc' | undefined,
  defaultSortBy: T
): SortOptions<T> {
  return {
    sort_by: sortBy || defaultSortBy,
    order: order || (SORTING.DEFAULT_ORDER as 'asc' | 'desc'),
  };
}

/**
 * Parse and validate a date filter parameter
 *
 * Converts string date to Date object and validates it's a valid date.
 * Returns undefined if input is undefined (allows optional dates).
 *
 * @param dateString - ISO date string from query parameter
 * @param fieldName - Name of field for error messages
 * @returns Parsed Date object or undefined
 * @throws ValidationError if date string is invalid
 *
 * @example
 * const createdAfter = parseDateFilter(query.created_after, 'created_after');
 * const createdBefore = parseDateFilter(query.created_before, 'created_before');
 */
export function parseDateFilter(
  dateString: string | undefined,
  fieldName: string
): Date | undefined {
  if (!dateString) {
    return undefined;
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new ValidationError(`Invalid ${fieldName} date: ${dateString}`);
  }

  return date;
}
