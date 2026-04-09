/**
 * Rule Matcher Service
 * Shared filtering and matching logic for both notifications and integrations
 *
 * Extracted from NotificationService to avoid duplication and provide
 * consistent filtering behavior across different rule types.
 */

import { getLogger } from '../logger.js';
import type { BugReport } from '../db/types.js';
import type { FilterCondition, FilterField } from '../types/notifications.js';

const logger = getLogger();

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context information passed through filter evaluation chain
 */
interface FilterContext {
  ruleId?: string;
  ruleName?: string;
  filterIndex?: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Field mapping from filter field names to bug report properties
 */
export const FIELD_MAP: Record<string, string> = {
  project: 'project_id',
  browser: 'metadata.browser',
  os: 'metadata.os',
  url_pattern: 'metadata.url',
  user_email: 'metadata.user.email',
  error_message: 'description',
  priority: 'priority',
  status: 'status',
  console_level: 'metadata.console',
  console_message: 'metadata.console',
  network_status: 'metadata.network',
  network_url: 'metadata.network',
} as const;

/**
 * Maps array filter fields to their corresponding object property names
 */
const ARRAY_FIELD_PROPERTY_MAP: Record<string, string> = {
  console_level: 'level',
  console_message: 'message',
  network_status: 'status',
  network_url: 'url',
} as const;

type FilterOperatorFn = (value: string, filterValue: string | string[]) => boolean;

/**
 * Filter operator implementations
 */
const FILTER_OPERATORS: Record<string, FilterOperatorFn> = {
  equals: (value, filterValue) => value === filterValue,
  contains: (value, filterValue) => value.includes(String(filterValue)),
  starts_with: (value, filterValue) => value.startsWith(String(filterValue)),
  ends_with: (value, filterValue) => value.endsWith(String(filterValue)),
  in: (value, filterValue) => Array.isArray(filterValue) && filterValue.includes(value),
  not_in: (value, filterValue) => Array.isArray(filterValue) && !filterValue.includes(value),
};

/**
 * Apply regex filter operator
 */
function applyRegexOperator(value: string, pattern: string, caseSensitive: boolean): boolean {
  try {
    const regex = new RegExp(pattern, caseSensitive ? '' : 'i');
    return regex.test(value);
  } catch {
    return false;
  }
}

// ============================================================================
// RULE MATCHER CLASS
// ============================================================================

export class RuleMatcher {
  /**
   * Check if bug report matches all filter conditions
   */
  static matchesFilters(
    bugReport: BugReport | Record<string, unknown>,
    filters: FilterCondition[],
    context?: FilterContext
  ): boolean {
    if (!filters || filters.length === 0) {
      logger.debug('No filters defined - match all', {
        bugReportId: bugReport.id,
        ruleId: context?.ruleId,
        ruleName: context?.ruleName,
      });
      return true; // No filters = match all
    }

    logger.debug('Evaluating filters (AND logic)', {
      bugReportId: bugReport.id,
      ruleId: context?.ruleId,
      ruleName: context?.ruleName,
      filterCount: filters.length,
    });

    let matchedCount = 0;

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      const matches = this.matchesFilter(bugReport, filter, { ...context, filterIndex: i });

      if (matches) {
        matchedCount++;
      } else {
        logger.debug('Filter chain broken - AND logic failed', {
          bugReportId: bugReport.id,
          ruleId: context?.ruleId,
          ruleName: context?.ruleName,
          failedAtIndex: i,
          totalFilters: filters.length,
          matchedSoFar: matchedCount,
          failedFilter: {
            field: filter.field,
            operator: filter.operator,
            value: filter.value,
          },
        });
        break; // Early exit on first failure (AND logic)
      }
    }

    const allMatched = matchedCount === filters.length;

    logger.debug(allMatched ? 'All filters matched' : 'Some filters failed', {
      bugReportId: bugReport.id,
      ruleId: context?.ruleId,
      ruleName: context?.ruleName,
      matchedCount,
      totalCount: filters.length,
      result: allMatched ? 'MATCH' : 'NO_MATCH',
    });

    return allMatched;
  }

  /**
   * Check if bug report matches a single filter condition
   */
  static matchesFilter(
    bugReport: BugReport | Record<string, unknown>,
    filter: FilterCondition,
    context?: FilterContext
  ): boolean {
    // Handle array fields (console logs, network requests) with special logic
    if (filter.field in ARRAY_FIELD_PROPERTY_MAP) {
      return this.matchesArrayField(bugReport, filter, context);
    }

    const fieldValue = this.getFieldValue(bugReport, filter.field);

    logger.debug('Evaluating single filter', {
      bugReportId: bugReport.id,
      ruleId: context?.ruleId,
      ruleName: context?.ruleName,
      filterIndex: context?.filterIndex,
      filter: {
        field: filter.field,
        operator: filter.operator,
        expectedValue: filter.value,
        caseSensitive: filter.case_sensitive ?? false,
      },
      actualValue: fieldValue,
      fieldPath: FIELD_MAP[filter.field] || filter.field,
    });

    if (fieldValue === undefined || fieldValue === null) {
      logger.debug('Filter failed: field value is null/undefined', {
        bugReportId: bugReport.id,
        ruleId: context?.ruleId,
        ruleName: context?.ruleName,
        filterIndex: context?.filterIndex,
        field: filter.field,
        fieldPath: FIELD_MAP[filter.field] || filter.field,
        result: 'NO_MATCH',
      });
      return false;
    }

    const stringValue = String(fieldValue);
    const matches = this.applyOperator(stringValue, filter);

    if (matches === null) {
      logger.warn('Unknown operator - filter failed', {
        bugReportId: bugReport.id,
        ruleId: context?.ruleId,
        ruleName: context?.ruleName,
        filterIndex: context?.filterIndex,
        operator: filter.operator,
        result: 'NO_MATCH',
      });
      return false;
    }

    logger.debug(matches ? 'Filter matched' : 'Filter failed', {
      bugReportId: bugReport.id,
      ruleId: context?.ruleId,
      ruleName: context?.ruleName,
      filterIndex: context?.filterIndex,
      field: filter.field,
      operator: filter.operator,
      expectedValue: filter.value,
      actualValue: fieldValue,
      caseSensitive: filter.case_sensitive ?? false,
      result: matches ? 'MATCH' : 'NO_MATCH',
    });

    return matches;
  }

  /**
   * Get field value from bug report using field mapping
   * Handles nested paths like 'metadata.browser'
   * Handles array fields like console logs and network requests
   */
  private static getFieldValue(
    bugReport: BugReport | Record<string, unknown>,
    field: FilterField
  ): unknown {
    const mappedField = FIELD_MAP[field] || field;

    // Handle nested paths (e.g., 'metadata.browser')
    if (mappedField.includes('.')) {
      const parts = mappedField.split('.');
      let value: unknown = bugReport;

      for (const part of parts) {
        if (value && typeof value === 'object' && part in value) {
          value = (value as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }

      return value;
    }

    // Direct field access
    return bugReport[mappedField as keyof typeof bugReport];
  }

  /**
   * Handle array field filtering (console logs, network requests)
   * Checks if ANY element in the array matches the filter condition
   */
  private static matchesArrayField(
    bugReport: BugReport | Record<string, unknown>,
    filter: FilterCondition,
    context?: FilterContext
  ): boolean {
    const arrayValue = this.getFieldValue(bugReport, filter.field);

    if (!Array.isArray(arrayValue)) {
      logger.debug('Array field is not an array or is missing', {
        bugReportId: bugReport.id,
        ruleId: context?.ruleId,
        field: filter.field,
        valueType: typeof arrayValue,
        result: 'NO_MATCH',
      });
      return false;
    }

    if (arrayValue.length === 0) {
      logger.debug('Array field is empty', {
        bugReportId: bugReport.id,
        ruleId: context?.ruleId,
        field: filter.field,
        result: 'NO_MATCH',
      });
      return false;
    }

    // Determine which property to check based on field type
    const propertyName = ARRAY_FIELD_PROPERTY_MAP[filter.field];
    if (!propertyName) {
      logger.warn('Array field missing property mapping - filter failed', {
        bugReportId: bugReport.id,
        ruleId: context?.ruleId,
        ruleName: context?.ruleName,
        filterIndex: context?.filterIndex,
        field: filter.field,
        availableFields: Object.keys(ARRAY_FIELD_PROPERTY_MAP),
        result: 'NO_MATCH',
      });
      return false;
    }

    // Check if ANY element matches the condition
    for (const item of arrayValue) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const itemValue = (item as Record<string, unknown>)[propertyName];
      if (itemValue === undefined || itemValue === null) {
        continue;
      }

      const stringValue = String(itemValue);
      const matches = this.applyOperator(stringValue, filter);

      if (matches) {
        logger.debug('Array field matched', {
          bugReportId: bugReport.id,
          ruleId: context?.ruleId,
          filterIndex: context?.filterIndex,
          field: filter.field,
          property: propertyName,
          operator: filter.operator,
          expectedValue: filter.value,
          matchedValue: itemValue,
          result: 'MATCH',
        });
        return true; // Found at least one match
      }
    }

    logger.debug('Array field - no matches found', {
      bugReportId: bugReport.id,
      ruleId: context?.ruleId,
      filterIndex: context?.filterIndex,
      field: filter.field,
      operator: filter.operator,
      expectedValue: filter.value,
      arrayLength: arrayValue.length,
      result: 'NO_MATCH',
    });

    return false;
  }

  /**
   * Apply filter operator to a value
   * Returns true if matches, false if doesn't match, null if operator is invalid
   */
  private static applyOperator(
    value: string,
    filter: Pick<FilterCondition, 'operator' | 'value' | 'case_sensitive'>
  ): boolean | null {
    const caseSensitive = filter.case_sensitive ?? false;
    const compareValue = caseSensitive ? value : value.toLowerCase();
    const filterValue = this.normalizeFilterValue(filter.value, caseSensitive);

    // Handle regex operator
    if (filter.operator === 'regex') {
      return applyRegexOperator(value, String(filterValue), caseSensitive);
    }

    // Apply standard operator
    const operatorFn = FILTER_OPERATORS[filter.operator];
    if (!operatorFn) {
      return null; // Invalid operator
    }

    return operatorFn(compareValue, filterValue);
  }

  /**
   * Normalize filter value for case-insensitive comparison
   */
  private static normalizeFilterValue(
    value: string | string[],
    caseSensitive: boolean
  ): string | string[] {
    if (caseSensitive) {
      return value;
    }
    return Array.isArray(value) ? value.map((v) => v.toLowerCase()) : String(value).toLowerCase();
  }

  /**
   * Build throttle group key based on grouping strategy
   * Uses metadata fields for error_signature and user_id
   */
  static buildThrottleGroupKey(
    groupBy: 'error_signature' | 'project' | 'user' | 'none',
    bugReport: BugReport | Record<string, unknown>
  ): string {
    switch (groupBy) {
      case 'error_signature': {
        // error_signature is typically in metadata
        const metadata = bugReport.metadata as Record<string, unknown> | undefined;
        const errorSig = metadata?.error_signature || metadata?.stack_trace;

        // Use bug report ID as fallback to prevent unrelated bugs from being grouped
        // This ensures each unique bug has its own throttle tracking
        if (!errorSig) {
          return `bug:${bugReport.id || 'unknown'}`;
        }

        return `error_sig:${errorSig}`;
      }
      case 'project':
        return `project:${bugReport.project_id || 'unknown'}`;
      case 'user': {
        // user info is in metadata.user
        const metadata = bugReport.metadata as Record<string, unknown> | undefined;
        const user = metadata?.user as Record<string, unknown> | undefined;
        const userId = user?.id || user?.email || 'unknown';
        return `user:${userId}`;
      }
      default:
        return 'global';
    }
  }

  /**
   * Extract simple filter values for quick checks
   * Useful for common cases without complex operators
   */
  static extractSimpleFilters(filters: FilterCondition[]): {
    priorities?: string[];
    statuses?: string[];
    browsers?: string[];
    os?: string[];
  } {
    const result: {
      priorities?: string[];
      statuses?: string[];
      browsers?: string[];
      os?: string[];
    } = {};

    for (const filter of filters) {
      if (filter.operator === 'in' || filter.operator === 'equals') {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];

        switch (filter.field) {
          case 'priority':
            result.priorities = values;
            break;
          case 'status':
            result.statuses = values;
            break;
          case 'browser':
            result.browsers = values;
            break;
          case 'os':
            result.os = values;
            break;
        }
      }
    }

    return result;
  }

  /**
   * Validate filter conditions
   * Returns true if all filters are valid
   */
  static validateFilters(filters: FilterCondition[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const filter of filters) {
      // Check operator is valid
      if (!FILTER_OPERATORS[filter.operator] && filter.operator !== 'regex') {
        errors.push(`Invalid operator: ${filter.operator}`);
      }

      // Check field is known (all FilterField types are in FIELD_MAP)
      if (!FIELD_MAP[filter.field]) {
        errors.push(`Unknown field: ${filter.field}`);
      }

      // Check value is appropriate for operator
      if (
        (filter.operator === 'in' || filter.operator === 'not_in') &&
        !Array.isArray(filter.value)
      ) {
        errors.push(`Operator ${filter.operator} requires array value`);
      }

      // Validate regex pattern
      if (filter.operator === 'regex') {
        try {
          new RegExp(String(filter.value));
        } catch {
          errors.push(`Invalid regex pattern: ${filter.value}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
