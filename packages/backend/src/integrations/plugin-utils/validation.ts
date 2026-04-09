/**
 * Validation utilities for custom plugins
 * Provides reusable validators for common config fields
 */

import validator from 'validator';

export type Validator = (value: unknown, fieldName: string) => string | null;

/**
 * Reusable field validators
 */
export const validators = {
  /**
   * Validate required field is present and non-empty
   */
  required: (value: any, fieldName: string): string | null => {
    if (value === null || value === undefined || value === '') {
      return `${fieldName} is required`;
    }
    return null;
  },

  /**
   * Validate URL format
   */
  url: (value: any, fieldName: string): string | null => {
    if (!value) {
      return null;
    } // Optional field
    try {
      new URL(value);
      return null;
    } catch {
      return `${fieldName} must be a valid URL`;
    }
  },

  /**
   * Validate email format
   */
  email: (value: any, fieldName: string): string | null => {
    if (!value) {
      return null;
    } // Optional field
    if (!validator.isEmail(String(value))) {
      return `${fieldName} must be a valid email`;
    }
    return null;
  },

  /**
   * Validate value matches a regex pattern
   */
  pattern:
    (pattern: RegExp, description: string): Validator =>
    (value: any, fieldName: string): string | null => {
      if (!value) {
        return null;
      } // Optional field
      if (!pattern.test(value)) {
        return `${fieldName} ${description}`;
      }
      return null;
    },

  /**
   * Validate value is one of allowed options
   */
  oneOf:
    (options: any[]): Validator =>
    (value: any, fieldName: string): string | null => {
      if (!value) {
        return null;
      } // Optional field
      if (!options.includes(value)) {
        return `${fieldName} must be one of: ${options.join(', ')}`;
      }
      return null;
    },

  /**
   * Validate string length is within range
   */
  length:
    (min?: number, max?: number): Validator =>
    (value: any, fieldName: string): string | null => {
      if (!value) {
        return null;
      } // Optional field
      const len = String(value).length;
      if (min !== undefined && len < min) {
        return `${fieldName} must be at least ${min} characters`;
      }
      if (max !== undefined && len > max) {
        return `${fieldName} must be at most ${max} characters`;
      }
      return null;
    },

  /**
   * Validate number is within range
   */
  range:
    (min?: number, max?: number): Validator =>
    (value: any, fieldName: string): string | null => {
      if (value === null || value === undefined) {
        return null;
      } // Optional field
      const num = Number(value);
      if (isNaN(num)) {
        return `${fieldName} must be a number`;
      }
      if (min !== undefined && num < min) {
        return `${fieldName} must be at least ${min}`;
      }
      if (max !== undefined && num > max) {
        return `${fieldName} must be at most ${max}`;
      }
      return null;
    },
};

export interface FieldValidation {
  name: string;
  value: any;
  validator: Validator;
}

/**
 * Validate multiple fields and collect errors
 * @param fields - Array of field validations
 * @returns Array of error messages (empty if all valid)
 * @example
 * const errors = validateFields([
 *   { name: 'apiUrl', value: config.apiUrl, validator: validators.required },
 *   { name: 'apiUrl', value: config.apiUrl, validator: validators.url },
 *   { name: 'apiKey', value: config.apiKey, validator: validators.required }
 * ]);
 * if (errors.length > 0) {
 *   throw createPluginError(ERROR_CODES.VALIDATION_ERROR, errors.join('; '));
 * }
 */
export function validateFields(fields: FieldValidation[]): string[] {
  const errors: string[] = [];
  for (const field of fields) {
    const error = field.validator(field.value, field.name);
    if (error) {
      errors.push(error);
    }
  }
  return errors;
}

/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  message?: string;
}

/**
 * Create standardized validation result
 * @param isValid - Whether validation passed
 * @param errors - Array of error messages
 * @returns Validation result object
 */
export function createValidationResult(isValid: boolean, errors: string[] = []): ValidationResult {
  const filteredErrors = errors.filter(Boolean);
  return {
    valid: isValid,
    errors: filteredErrors,
    ...(filteredErrors.length > 0 && { message: filteredErrors.join('; ') }),
  };
}
