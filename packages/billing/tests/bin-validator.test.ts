import { describe, it, expect } from 'vitest';
import { validateBin, isValidBin } from '../src/plugins/kz/bin-validator.js';

describe('BIN Validator', () => {
  describe('validateBin', () => {
    it('returns null for a valid BIN', () => {
      expect(validateBin('160105400019')).toBeNull();
      expect(validateBin('040840000481')).toBeNull();
      expect(validateBin('190940000029')).toBeNull();
    });

    it('rejects empty string', () => {
      expect(validateBin('')).toBe('BIN is required');
    });

    it('rejects non-digit characters', () => {
      expect(validateBin('04084000048A')).toBe('BIN must be exactly 12 digits');
    });

    it('rejects wrong length (too short)', () => {
      expect(validateBin('04084000048')).toBe('BIN must be exactly 12 digits');
    });

    it('rejects wrong length (too long)', () => {
      expect(validateBin('0408400004860')).toBe('BIN must be exactly 12 digits');
    });

    it('rejects invalid month (00)', () => {
      expect(validateBin('040040000486')).toBe('BIN has invalid month in date portion');
    });

    it('rejects invalid month (13)', () => {
      expect(validateBin('041340000486')).toBe('BIN has invalid month in date portion');
    });

    it('strips whitespace before validation', () => {
      expect(validateBin(' 160105400019 ')).toBeNull();
    });
  });

  describe('isValidBin', () => {
    it('returns true for valid BIN', () => {
      expect(isValidBin('160105400019')).toBe(true);
    });

    it('returns false for invalid BIN', () => {
      expect(isValidBin('123')).toBe(false);
    });
  });
});
