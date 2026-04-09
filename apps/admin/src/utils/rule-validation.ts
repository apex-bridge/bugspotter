/**
 * Integration Rule Validation Utilities
 */

import type { FilterCondition, ThrottleConfig } from '../types';
import type { FieldMappings } from '@bugspotter/types';

export interface RuleFormValues {
  name: string;
  enabled: boolean;
  priority: number;
  filters: FilterCondition[];
  throttle?: ThrottleConfig | null;
  autoCreate: boolean;
  fieldMappings: FieldMappings | null;
  descriptionTemplate: string | null;
}

export const VALIDATION_MESSAGES = {
  NAME_REQUIRED: 'Rule name is required',
  NAME_TOO_LONG: 'Rule name must be 255 characters or less',
  PRIORITY_INVALID: 'Priority must be 0 or greater',
  EMPTY_FILTERS: 'All filter values must be filled in',
  THROTTLE_REQUIRED:
    'At least one rate limit (per hour or per day) is required when throttling is enabled',
  THROTTLE_HOUR_INVALID: 'Max tickets per hour must be greater than 0',
  THROTTLE_DAY_INVALID: 'Max tickets per day must be greater than 0',
  THROTTLE_INTERVAL_INVALID: 'Digest interval must be greater than 0 minutes',
} as const;

function validateThrottleConfig(throttle?: ThrottleConfig | null): string | null {
  if (!throttle) {
    return null;
  }

  // Require at least one rate limit when throttling is enabled
  if (throttle.max_per_hour === undefined && throttle.max_per_day === undefined) {
    return VALIDATION_MESSAGES.THROTTLE_REQUIRED;
  }

  if (throttle.max_per_hour !== undefined && throttle.max_per_hour <= 0) {
    return VALIDATION_MESSAGES.THROTTLE_HOUR_INVALID;
  }

  if (throttle.max_per_day !== undefined && throttle.max_per_day <= 0) {
    return VALIDATION_MESSAGES.THROTTLE_DAY_INVALID;
  }

  if (throttle.digest_interval_minutes !== undefined && throttle.digest_interval_minutes <= 0) {
    return VALIDATION_MESSAGES.THROTTLE_INTERVAL_INVALID;
  }

  return null;
}

function validateFilters(filters: FilterCondition[]): string | null {
  const emptyFilters = filters.filter((f) => {
    if (Array.isArray(f.value)) {
      return f.value.length === 0 || f.value.every((v: string) => !v.trim());
    }
    return !f.value || f.value.trim() === '';
  });

  if (emptyFilters.length > 0) {
    return VALIDATION_MESSAGES.EMPTY_FILTERS;
  }

  return null;
}

/**
 * Validates rule form values and returns error message if invalid
 * @returns null if valid, error message string if invalid
 */
export function validateRuleForm(values: RuleFormValues): string | null {
  const trimmedName = values.name.trim();

  if (!trimmedName) {
    return VALIDATION_MESSAGES.NAME_REQUIRED;
  }

  if (trimmedName.length > 255) {
    return VALIDATION_MESSAGES.NAME_TOO_LONG;
  }

  if (values.priority < 0) {
    return VALIDATION_MESSAGES.PRIORITY_INVALID;
  }

  const filterError = validateFilters(values.filters);
  if (filterError) {
    return filterError;
  }

  const throttleError = validateThrottleConfig(values.throttle);
  if (throttleError) {
    return throttleError;
  }

  return null;
}
