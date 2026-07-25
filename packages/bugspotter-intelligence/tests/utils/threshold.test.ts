import { describe, it, expect, afterEach } from 'vitest';
import { resolveThreshold, THRESHOLD_MIN, THRESHOLD_MAX } from '../../src/utils/threshold.js';
import { AppError } from '../../src/errors.js';

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

  describe('org default threshold (second fallback)', () => {
    it('uses orgDefault when query param absent and orgDefault valid', () => {
      expect(resolveThreshold(undefined, 0.75)).toBe(0.75);
    });

    it('accepts orgDefault boundary values', () => {
      expect(resolveThreshold(undefined, THRESHOLD_MIN)).toBe(THRESHOLD_MIN);
      expect(resolveThreshold(undefined, THRESHOLD_MAX)).toBe(THRESHOLD_MAX);
    });

    it('query param takes precedence over orgDefault', () => {
      expect(resolveThreshold(0.8, 0.6)).toBe(0.8);
    });

    it('falls back to env when orgDefault is below min', () => {
      process.env.SIMILARITY_THRESHOLD = '0.7';
      expect(resolveThreshold(undefined, 0.3)).toBe(0.7);
    });

    it('falls back to env when orgDefault is above max', () => {
      process.env.SIMILARITY_THRESHOLD = '0.7';
      expect(resolveThreshold(undefined, 1.5)).toBe(0.7);
    });

    it('falls back to 0.85 when orgDefault is NaN and env missing', () => {
      expect(resolveThreshold(undefined, NaN)).toBe(0.85);
    });

    it('falls back to 0.85 when orgDefault is undefined and env missing', () => {
      expect(resolveThreshold(undefined, undefined)).toBe(0.85);
    });
  });

  describe('threshold — error type', () => {
    it('throws AppError with statusCode 422 for an out-of-range value', () => {
      let caught: unknown;
      try {
        resolveThreshold(-1);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).statusCode).toBe(422);
    });
  });
});
