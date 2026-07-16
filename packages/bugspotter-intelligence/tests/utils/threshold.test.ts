import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveThreshold, THRESHOLD_MIN, THRESHOLD_MAX } from '../../src/utils/threshold.js';

describe('resolveThreshold', () => {
  afterEach(() => {
    delete process.env.SIMILARITY_THRESHOLD;
  });

  describe('query param present', () => {
    it('returns valid param value', () => {
      expect(resolveThreshold(0.7)).toBe(0.7);
    });

    it('accepts boundary values', () => {
      expect(resolveThreshold(THRESHOLD_MIN)).toBe(THRESHOLD_MIN);
      expect(resolveThreshold(THRESHOLD_MAX)).toBe(THRESHOLD_MAX);
    });

    it('throws 422 for value below min', () => {
      expect(() => resolveThreshold(0.4)).toThrow();
      expect(() => resolveThreshold(0.4)).toThrow(/between/);
    });

    it('throws 422 for value above max', () => {
      expect(() => resolveThreshold(1.1)).toThrow(/between/);
    });

    it('throws 422 for NaN', () => {
      expect(() => resolveThreshold(NaN)).toThrow(/number/);
    });
  });

  describe('query param absent — env fallback', () => {
    it('uses SIMILARITY_THRESHOLD env var when valid', () => {
      process.env.SIMILARITY_THRESHOLD = '0.75';
      expect(resolveThreshold(undefined)).toBe(0.75);
    });

    it('falls back to 0.85 when env var is missing', () => {
      expect(resolveThreshold(undefined)).toBe(0.85);
    });

    it('falls back to 0.85 when env var is NaN', () => {
      process.env.SIMILARITY_THRESHOLD = 'bad';
      expect(resolveThreshold(undefined)).toBe(0.85);
    });

    it('falls back to 0.85 when env var is below min', () => {
      process.env.SIMILARITY_THRESHOLD = '0.1';
      expect(resolveThreshold(undefined)).toBe(0.85);
    });

    it('falls back to 0.85 when env var is above max', () => {
      process.env.SIMILARITY_THRESHOLD = '1.5';
      expect(resolveThreshold(undefined)).toBe(0.85);
    });
  });

  describe('query param takes precedence over env', () => {
    it('uses param value even when env is set', () => {
      process.env.SIMILARITY_THRESHOLD = '0.6';
      expect(resolveThreshold(0.9)).toBe(0.9);
    });
  });
});
