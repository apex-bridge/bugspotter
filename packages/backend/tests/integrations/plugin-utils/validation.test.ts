/**
 * Tests for validation utilities
 */

import { describe, it, expect } from 'vitest';
import {
  validators,
  validateFields,
  createValidationResult,
} from '../../../src/integrations/plugin-utils/validation.js';

describe('Plugin Utils - Validation', () => {
  describe('validators.required', () => {
    it('should pass for non-empty values', () => {
      expect(validators.required('value', 'Field')).toBeNull();
      expect(validators.required(123, 'Field')).toBeNull();
      expect(validators.required(true, 'Field')).toBeNull();
      expect(validators.required([], 'Field')).toBeNull();
      expect(validators.required({}, 'Field')).toBeNull();
    });

    it('should fail for empty/null/undefined', () => {
      expect(validators.required(null, 'Field')).toBe('Field is required');
      expect(validators.required(undefined, 'Field')).toBe('Field is required');
      expect(validators.required('', 'Field')).toBe('Field is required');
    });
  });

  describe('validators.url', () => {
    it('should pass for valid URLs', () => {
      expect(validators.url('https://example.com', 'URL')).toBeNull();
      expect(validators.url('http://localhost:3000', 'URL')).toBeNull();
      expect(validators.url('https://api.example.com/v1', 'URL')).toBeNull();
    });

    it('should fail for invalid URLs', () => {
      expect(validators.url('not-a-url', 'URL')).toBe('URL must be a valid URL');
      expect(validators.url('example.com', 'URL')).toBe('URL must be a valid URL');
      // Note: ftp:// is actually a valid protocol, so we test with truly invalid input
      expect(validators.url('ht!tp://invalid', 'URL')).toBe('URL must be a valid URL');
    });

    it('should pass for null/undefined (optional)', () => {
      expect(validators.url(null, 'URL')).toBeNull();
      expect(validators.url(undefined, 'URL')).toBeNull();
    });
  });

  describe('validators.email', () => {
    it('should pass for valid emails', () => {
      expect(validators.email('user@example.com', 'Email')).toBeNull();
      expect(validators.email('test.user+tag@domain.co.uk', 'Email')).toBeNull();
    });

    it('should fail for invalid emails', () => {
      expect(validators.email('not-an-email', 'Email')).toBe('Email must be a valid email');
      expect(validators.email('user@', 'Email')).toBe('Email must be a valid email');
      expect(validators.email('@example.com', 'Email')).toBe('Email must be a valid email');
      expect(validators.email('user@domain', 'Email')).toBe('Email must be a valid email');
    });

    it('should pass for null/undefined (optional)', () => {
      expect(validators.email(null, 'Email')).toBeNull();
      expect(validators.email(undefined, 'Email')).toBeNull();
    });
  });

  describe('validators.pattern', () => {
    it('should validate regex patterns', () => {
      const alphanumeric = validators.pattern(/^[a-zA-Z0-9]+$/, 'must be alphanumeric');

      expect(alphanumeric('abc123', 'Field')).toBeNull();
      expect(alphanumeric('ABC', 'Field')).toBeNull();
      expect(alphanumeric('123', 'Field')).toBeNull();
      expect(alphanumeric('abc-123', 'Field')).toBe('Field must be alphanumeric');
      expect(alphanumeric('abc 123', 'Field')).toBe('Field must be alphanumeric');
    });

    it('should pass for null/undefined (optional)', () => {
      const validator = validators.pattern(/^[A-Z]+$/, 'must be uppercase');

      expect(validator(null, 'Field')).toBeNull();
      expect(validator(undefined, 'Field')).toBeNull();
    });
  });

  describe('validators.oneOf', () => {
    it('should validate allowed values', () => {
      const statusValidator = validators.oneOf(['open', 'closed', 'pending']);

      expect(statusValidator('open', 'Status')).toBeNull();
      expect(statusValidator('closed', 'Status')).toBeNull();
      expect(statusValidator('pending', 'Status')).toBeNull();
      expect(statusValidator('invalid', 'Status')).toBe(
        'Status must be one of: open, closed, pending'
      );
    });

    it('should work with numbers', () => {
      const numberValidator = validators.oneOf([1, 2, 3]);

      expect(numberValidator(1, 'Number')).toBeNull();
      expect(numberValidator(2, 'Number')).toBeNull();
      expect(numberValidator(4, 'Number')).toBe('Number must be one of: 1, 2, 3');
    });

    it('should pass for null/undefined (optional)', () => {
      const validator = validators.oneOf(['a', 'b', 'c']);

      expect(validator(null, 'Field')).toBeNull();
      expect(validator(undefined, 'Field')).toBeNull();
    });
  });

  describe('validators.length', () => {
    it('should validate minimum length', () => {
      const minLength = validators.length(3);

      expect(minLength('abc', 'Field')).toBeNull();
      expect(minLength('abcd', 'Field')).toBeNull();
      expect(minLength('ab', 'Field')).toBe('Field must be at least 3 characters');
    });

    it('should validate maximum length', () => {
      const maxLength = validators.length(undefined, 5);

      expect(maxLength('abc', 'Field')).toBeNull();
      expect(maxLength('abcde', 'Field')).toBeNull();
      expect(maxLength('abcdef', 'Field')).toBe('Field must be at most 5 characters');
    });

    it('should validate length range', () => {
      const rangeValidator = validators.length(3, 5);

      expect(rangeValidator('abc', 'Field')).toBeNull();
      expect(rangeValidator('abcd', 'Field')).toBeNull();
      expect(rangeValidator('abcde', 'Field')).toBeNull();
      expect(rangeValidator('ab', 'Field')).toBe('Field must be at least 3 characters');
      expect(rangeValidator('abcdef', 'Field')).toBe('Field must be at most 5 characters');
    });

    it('should pass for null/undefined (optional)', () => {
      const validator = validators.length(3, 10);

      expect(validator(null, 'Field')).toBeNull();
      expect(validator(undefined, 'Field')).toBeNull();
    });
  });

  describe('validators.range', () => {
    it('should validate minimum value', () => {
      const minRange = validators.range(10);

      expect(minRange(10, 'Field')).toBeNull();
      expect(minRange(15, 'Field')).toBeNull();
      expect(minRange(5, 'Field')).toBe('Field must be at least 10');
    });

    it('should validate maximum value', () => {
      const maxRange = validators.range(undefined, 100);

      expect(maxRange(50, 'Field')).toBeNull();
      expect(maxRange(100, 'Field')).toBeNull();
      expect(maxRange(101, 'Field')).toBe('Field must be at most 100');
    });

    it('should validate value range', () => {
      const rangeValidator = validators.range(0, 10);

      expect(rangeValidator(0, 'Field')).toBeNull();
      expect(rangeValidator(5, 'Field')).toBeNull();
      expect(rangeValidator(10, 'Field')).toBeNull();
      expect(rangeValidator(-1, 'Field')).toBe('Field must be at least 0');
      expect(rangeValidator(11, 'Field')).toBe('Field must be at most 10');
    });

    it('should fail for non-numbers', () => {
      const validator = validators.range(0, 100);

      expect(validator('not-a-number', 'Field')).toBe('Field must be a number');
    });

    it('should pass for null/undefined (optional)', () => {
      const validator = validators.range(0, 100);

      expect(validator(null, 'Field')).toBeNull();
      expect(validator(undefined, 'Field')).toBeNull();
    });
  });

  describe('validateFields', () => {
    it('should validate multiple fields successfully', () => {
      const errors = validateFields([
        { name: 'URL', value: 'https://example.com', validator: validators.url },
        { name: 'Email', value: 'user@example.com', validator: validators.email },
        { name: 'Name', value: 'John', validator: validators.required },
      ]);

      expect(errors).toEqual([]);
    });

    it('should collect multiple errors', () => {
      const errors = validateFields([
        { name: 'URL', value: 'invalid-url', validator: validators.url },
        { name: 'Email', value: '', validator: validators.required },
        { name: 'Status', value: 'invalid', validator: validators.oneOf(['open', 'closed']) },
      ]);

      expect(errors).toHaveLength(3);
      expect(errors[0]).toBe('URL must be a valid URL');
      expect(errors[1]).toBe('Email is required');
      expect(errors[2]).toBe('Status must be one of: open, closed');
    });

    it('should handle empty field array', () => {
      const errors = validateFields([]);

      expect(errors).toEqual([]);
    });

    it('should validate same field with multiple validators', () => {
      const errors = validateFields([
        { name: 'Password', value: 'ab', validator: validators.required },
        { name: 'Password', value: 'ab', validator: validators.length(8) },
      ]);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toBe('Password must be at least 8 characters');
    });
  });

  describe('createValidationResult', () => {
    it('should create successful result', () => {
      const result = createValidationResult(true, []);

      expect(result).toEqual({
        valid: true,
        errors: [],
      });
    });

    it('should create failed result with errors', () => {
      const errors = ['Field1 is required', 'Field2 must be a valid URL'];
      const result = createValidationResult(false, errors);

      expect(result).toEqual({
        valid: false,
        errors,
        message: 'Field1 is required; Field2 must be a valid URL',
      });
    });

    it('should filter out null/undefined errors', () => {
      const errors = ['Error 1', null, 'Error 2', undefined, 'Error 3'] as any[];
      const result = createValidationResult(false, errors);

      expect(result.errors).toEqual(['Error 1', 'Error 2', 'Error 3']);
      expect(result.message).toBe('Error 1; Error 2; Error 3');
    });

    it('should not include message for empty errors', () => {
      const result = createValidationResult(false, []);

      expect(result).toEqual({
        valid: false,
        errors: [],
      });
      expect(result.message).toBeUndefined();
    });
  });
});
