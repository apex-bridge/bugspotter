import { describe, it, expect } from 'vitest';
import { formatTimestamp } from './format';

describe('formatTimestamp', () => {
  describe('Basic Formatting', () => {
    it('should format timestamp in 24-hour format', () => {
      // 2025-01-15 14:30:45 UTC
      const timestamp = new Date('2025-01-15T14:30:45Z').getTime();
      const result = formatTimestamp(timestamp);

      // Should match HH:MM:SS format (with potential timezone offset)
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should format midnight correctly', () => {
      const timestamp = new Date('2025-01-15T00:00:00Z').getTime();
      const result = formatTimestamp(timestamp);

      expect(result).toMatch(/^\d{2}:00:00$/);
    });

    it('should format noon correctly', () => {
      const timestamp = new Date('2025-01-15T12:00:00Z').getTime();
      const result = formatTimestamp(timestamp);

      expect(result).toMatch(/^\d{2}:00:00$/);
    });

    it('should handle single-digit hours with zero padding', () => {
      const timestamp = new Date('2025-01-15T09:05:03Z').getTime();
      const result = formatTimestamp(timestamp);

      // Should have zero-padded hours, minutes, seconds
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(result.split(':').every((part) => part.length === 2)).toBe(true);
    });
  });

  describe('Locale Support', () => {
    it('should use en-US locale by default', () => {
      const timestamp = new Date('2025-01-15T14:30:45Z').getTime();
      const result = formatTimestamp(timestamp);

      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should respect custom locale parameter', () => {
      const timestamp = new Date('2025-01-15T14:30:45Z').getTime();
      const result = formatTimestamp(timestamp, 'en-GB');

      // en-GB also uses 24-hour format with HH:MM:SS
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should always use 24-hour format regardless of locale', () => {
      const timestamp = new Date('2025-01-15T14:30:45Z').getTime();

      // Even with US locale, should not show AM/PM due to hour12: false
      const result = formatTimestamp(timestamp, 'en-US');
      expect(result).not.toContain('AM');
      expect(result).not.toContain('PM');
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle epoch timestamp (0)', () => {
      const result = formatTimestamp(0);

      // Should format Unix epoch (Jan 1, 1970 00:00:00 UTC)
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should handle current timestamp', () => {
      const now = Date.now();
      const result = formatTimestamp(now);

      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should handle future timestamp', () => {
      const future = new Date('2099-12-31T23:59:59Z').getTime();
      const result = formatTimestamp(future);

      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should handle very old timestamp', () => {
      const past = new Date('1900-01-01T12:00:00Z').getTime();
      const result = formatTimestamp(past);

      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('Consistency', () => {
    it('should format same timestamp consistently', () => {
      const timestamp = new Date('2025-01-15T14:30:45Z').getTime();

      const result1 = formatTimestamp(timestamp);
      const result2 = formatTimestamp(timestamp);

      expect(result1).toBe(result2);
    });

    it('should format sequential timestamps with 1-second difference', () => {
      const timestamp1 = new Date('2025-01-15T14:30:45Z').getTime();
      const timestamp2 = new Date('2025-01-15T14:30:46Z').getTime();

      const result1 = formatTimestamp(timestamp1);
      const result2 = formatTimestamp(timestamp2);

      // Should differ by 1 second
      expect(result1).not.toBe(result2);
      expect(result1).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(result2).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });
});
