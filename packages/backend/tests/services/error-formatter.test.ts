import { describe, it, expect } from 'vitest';
import { formatErrorForLog, formatErrorDetails } from '../../src/utils/error-formatter.js';

describe('formatErrorForLog', () => {
  it('should extract message from Error object', () => {
    const error = new Error('Database connection failed');
    expect(formatErrorForLog(error)).toBe('Database connection failed');
  });

  it('should handle string errors', () => {
    expect(formatErrorForLog('Network timeout')).toBe('Network timeout');
  });

  it('should handle null and undefined', () => {
    expect(formatErrorForLog(null)).toBe('null');
    expect(formatErrorForLog(undefined)).toBe('undefined');
  });

  it('should handle numeric errors', () => {
    expect(formatErrorForLog(404)).toBe('404');
    expect(formatErrorForLog(0)).toBe('0');
  });

  it('should handle boolean errors', () => {
    expect(formatErrorForLog(true)).toBe('true');
    expect(formatErrorForLog(false)).toBe('false');
  });

  it('should convert object errors to string', () => {
    const error = { message: 'Custom error object', code: 'ERR_001' };
    // Objects get converted to '[object Object]' via String()
    expect(formatErrorForLog(error)).toBe('[object Object]');
  });

  it('should handle array errors', () => {
    const error = ['error1', 'error2'];
    const result = formatErrorForLog(error);
    expect(result).toContain('error1');
    expect(result).toContain('error2');
  });

  it('should handle Error subclasses', () => {
    class CustomError extends Error {
      constructor(
        message: string,
        public code: string
      ) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const error = new CustomError('Operation failed', 'CUSTOM_001');
    expect(formatErrorForLog(error)).toBe('Operation failed');
  });

  it('should handle errors with empty message', () => {
    const error = new Error('');
    // Empty strings are valid error messages
    expect(formatErrorForLog(error)).toBe('');
  });

  it('should handle errors with whitespace-only message', () => {
    const error = new Error('   ');
    // Whitespace is preserved
    expect(formatErrorForLog(error)).toBe('   ');
  });
});

describe('formatErrorDetails', () => {
  it('should include stack trace for Error objects', () => {
    const error = new Error('Detailed error');
    const details = formatErrorDetails(error);

    expect(details.message).toBe('Detailed error');
    expect(details.stack).toBeDefined();
    expect(details.stack).toContain('Detailed error');
  });

  it('should handle non-Error objects without stack trace', () => {
    const error = { message: 'No stack trace' };
    const details = formatErrorDetails(error);

    expect(details.message).toBe('[object Object]');
    expect(details.stack).toBeUndefined();
  });

  it('should include stack trace for Error objects of different types', () => {
    const error = new TypeError('Type mismatch');
    const details = formatErrorDetails(error);

    expect(details.message).toBe('Type mismatch');
    expect(details.stack).toBeDefined();
    expect(details.stack).toContain('TypeError');
  });

  it('should handle string errors in details', () => {
    const details = formatErrorDetails('Simple string error');

    expect(details.message).toBe('Simple string error');
    expect(details.stack).toBeUndefined();
  });

  it('should handle null/undefined in details', () => {
    const nullDetails = formatErrorDetails(null);
    expect(nullDetails.message).toBe('null');
    expect(nullDetails.stack).toBeUndefined();

    const undefinedDetails = formatErrorDetails(undefined);
    expect(undefinedDetails.message).toBe('undefined');
    expect(undefinedDetails.stack).toBeUndefined();
  });

  it('should extract message and stack from custom Error subclasses', () => {
    class AppError extends Error {
      constructor(
        message: string,
        public code: string,
        public statusCode: number
      ) {
        super(message);
        this.name = 'AppError';
      }
    }

    const error = new AppError('Application error', 'APP_001', 400);
    const details = formatErrorDetails(error);

    // Only message and stack are extracted by formatErrorDetails
    expect(details.message).toBe('Application error');
    expect(details.stack).toBeDefined();
    // Custom properties are not preserved in the return type
    expect(details).toHaveProperty('message');
    expect(details).toHaveProperty('stack');
  });
});
