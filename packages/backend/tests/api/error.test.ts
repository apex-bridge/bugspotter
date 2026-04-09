/**
 * Error Handler Tests
 * Tests for global error handling middleware
 */

import { describe, it, expect } from 'vitest';
import { AppError } from '../../src/api/middleware/error.js';

describe('Error Handling', () => {
  describe('AppError', () => {
    it('should create custom error with default values', () => {
      const error = new AppError('Something went wrong');

      expect(error.message).toBe('Something went wrong');
      expect(error.statusCode).toBe(500);
      expect(error.error).toBe('InternalServerError');
      expect(error.name).toBe('AppError');
    });

    it('should create custom error with status code', () => {
      const error = new AppError('Not found', 404, 'NotFound');

      expect(error.statusCode).toBe(404);
      expect(error.error).toBe('NotFound');
    });

    it('should create custom error with details', () => {
      const error = new AppError('Validation failed', 400, 'ValidationError', {
        field: 'email',
        issue: 'Invalid format',
      });

      expect(error.details).toEqual({
        field: 'email',
        issue: 'Invalid format',
      });
    });

    it('should capture stack trace', () => {
      const error = new AppError('Test error');
      expect(error.stack).toBeDefined();
    });
  });
});
