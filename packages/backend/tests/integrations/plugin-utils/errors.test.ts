/**
 * Tests for error handling utilities
 */

import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  PluginError,
  createPluginError,
} from '../../../src/integrations/plugin-utils/errors.js';

describe('Plugin Utils - Error Handling', () => {
  describe('ERROR_CODES', () => {
    it('should have all expected error codes', () => {
      expect(ERROR_CODES.AUTH_FAILED).toBe('AUTH_FAILED');
      expect(ERROR_CODES.NETWORK_ERROR).toBe('NETWORK_ERROR');
      expect(ERROR_CODES.INVALID_CONFIG).toBe('INVALID_CONFIG');
      expect(ERROR_CODES.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND');
      expect(ERROR_CODES.RATE_LIMIT).toBe('RATE_LIMIT');
      expect(ERROR_CODES.TIMEOUT).toBe('TIMEOUT');
      expect(ERROR_CODES.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
      expect(ERROR_CODES.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
    });
  });

  describe('PluginError', () => {
    it('should create error with code and message', () => {
      const error = new PluginError(ERROR_CODES.AUTH_FAILED, 'Invalid credentials');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(PluginError);
      expect(error.name).toBe('PluginError');
      expect(error.code).toBe(ERROR_CODES.AUTH_FAILED);
      expect(error.message).toBe('Invalid credentials');
      expect(error.details).toEqual({});
    });

    it('should create error with details', () => {
      const details = { statusCode: 401, endpoint: '/api/auth' };
      const error = new PluginError(ERROR_CODES.AUTH_FAILED, 'Invalid credentials', details);

      expect(error.code).toBe(ERROR_CODES.AUTH_FAILED);
      expect(error.message).toBe('Invalid credentials');
      expect(error.details).toEqual(details);
    });

    it('should have stack trace', () => {
      const error = new PluginError(ERROR_CODES.NETWORK_ERROR, 'Request failed');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('PluginError');
    });
  });

  describe('createPluginError', () => {
    it('should create PluginError instance', () => {
      const error = createPluginError(ERROR_CODES.VALIDATION_ERROR, 'Invalid input');

      expect(error).toBeInstanceOf(PluginError);
      expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(error.message).toBe('Invalid input');
      expect(error.details).toEqual({});
    });

    it('should create error with details', () => {
      const details = { field: 'email', value: 'invalid' };
      const error = createPluginError(ERROR_CODES.VALIDATION_ERROR, 'Invalid email', details);

      expect(error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(error.message).toBe('Invalid email');
      expect(error.details).toEqual(details);
    });

    it('should handle all error codes', () => {
      const codes = Object.values(ERROR_CODES);

      codes.forEach((code) => {
        const error = createPluginError(code, `Test ${code}`);
        expect(error.code).toBe(code);
        expect(error.message).toBe(`Test ${code}`);
      });
    });

    it('should preserve error details', () => {
      const details = {
        statusCode: 429,
        retryAfter: 60,
        limit: 100,
        remaining: 0,
      };

      const error = createPluginError(ERROR_CODES.RATE_LIMIT, 'Rate limit exceeded', details);

      expect(error.details).toEqual(details);
      expect(error.details.statusCode).toBe(429);
      expect(error.details.retryAfter).toBe(60);
    });
  });
});
