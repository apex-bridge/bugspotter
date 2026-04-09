/**
 * Tests for formatting utilities
 */

import { describe, it, expect } from 'vitest';
import { formatDateShort, formatDate, formatNumber, getPreferredLocale } from '../../utils/format';

describe('formatDateShort', () => {
  it('should format ISO date string to short date format', () => {
    // Using a date in the middle of the day to avoid timezone edge cases
    const result = formatDateShort('2025-06-15T12:00:00Z', 'en-US');
    expect(result).toMatch(/6\/15\/2025|06\/15\/2025/);
  });

  it('should format with different locale', () => {
    // Using a date in the middle of the day to avoid timezone edge cases
    const result = formatDateShort('2025-06-15T12:00:00Z', 'en-GB');
    expect(result).toMatch(/15\/6\/2025|15\/06\/2025/);
  });

  it('should use browser locale when not specified', () => {
    const result = formatDateShort('2025-06-15T12:00:00Z');
    // Should return a string in some date format
    expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('should handle dates at beginning of year', () => {
    const result = formatDateShort('2025-01-15T12:00:00Z', 'en-US');
    expect(result).toMatch(/1\/15\/2025|01\/15\/2025/);
  });
});

describe('formatDate', () => {
  it('should format ISO date string with time', () => {
    const result = formatDate('2025-12-31T23:59:59Z', 'en-US');
    // Should include date and time components
    expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
    expect(result).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});

describe('formatNumber', () => {
  it('should format numbers with thousand separators', () => {
    const result = formatNumber(1234567, 'en-US');
    expect(result).toBe('1,234,567');
  });

  it('should handle null values', () => {
    const result = formatNumber(null);
    expect(result).toBe('0');
  });

  it('should handle undefined values', () => {
    const result = formatNumber(undefined);
    expect(result).toBe('0');
  });

  it('should format zero', () => {
    const result = formatNumber(0);
    expect(result).toBe('0');
  });
});

describe('getPreferredLocale', () => {
  it('should return a valid locale string', () => {
    const locale = getPreferredLocale();
    expect(typeof locale).toBe('string');
    expect(locale.length).toBeGreaterThan(0);
  });
});
