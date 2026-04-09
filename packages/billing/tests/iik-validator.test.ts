import { describe, it, expect } from 'vitest';
import {
  validateIik,
  isValidIik,
  validateBik,
  isValidBik,
} from '../src/plugins/kz/iik-validator.js';

describe('IIK (IBAN) Validator', () => {
  describe('validateIik', () => {
    it('returns null for a valid KZ IBAN', () => {
      // KZ97 1234 5678 9012 3456 — computed with valid IBAN mod-97
      expect(validateIik('KZ971234567890123456')).toBeNull();
    });

    it('rejects empty string', () => {
      expect(validateIik('')).toBe('IIK is required');
    });

    it('rejects wrong length', () => {
      expect(validateIik('KZ1234')).toBe('IIK must be exactly 20 characters');
    });

    it('rejects non-KZ prefix', () => {
      expect(validateIik('US86125KZT1001000244')).toBe('IIK must start with KZ');
    });

    it('rejects non-numeric check digits', () => {
      expect(validateIik('KZAB125KZT1001000244')).toBe('IIK check digits must be numeric');
    });

    it('handles lowercase input', () => {
      expect(validateIik('kz971234567890123456')).toBeNull();
    });

    it('strips whitespace', () => {
      expect(validateIik('KZ97 1234 5678 9012 3456')).toBeNull();
    });

    it('rejects invalid checksum', () => {
      const result = validateIik('KZ00125KZT1001000244');
      expect(result).toBe('IIK checksum is invalid');
    });
  });

  describe('isValidIik', () => {
    it('returns true for valid IIK', () => {
      expect(isValidIik('KZ971234567890123456')).toBe(true);
    });

    it('returns false for invalid IIK', () => {
      expect(isValidIik('INVALID')).toBe(false);
    });
  });
});

describe('BIK Validator', () => {
  describe('validateBik', () => {
    it('returns null for valid BIK', () => {
      expect(validateBik('HSBKKZKX')).toBeNull();
    });

    it('rejects empty', () => {
      expect(validateBik('')).toBe('BIK is required');
    });

    it('accepts 11-character BIK (with branch code)', () => {
      expect(validateBik('HSBKKZKXXXX')).toBeNull();
    });

    it('rejects wrong length', () => {
      expect(validateBik('HSBK')).toBe('BIK must be 8 or 11 alphanumeric characters');
    });

    it('rejects 9 or 10 characters', () => {
      expect(validateBik('HSBKKZKXX')).toBe('BIK must be 8 or 11 alphanumeric characters');
      expect(validateBik('HSBKKZKXXX')).toBe('BIK must be 8 or 11 alphanumeric characters');
    });

    it('rejects special characters', () => {
      expect(validateBik('HSBK-KZX')).toBe('BIK must be 8 or 11 alphanumeric characters');
    });
  });

  describe('isValidBik', () => {
    it('returns true for valid BIK', () => {
      expect(isValidBik('HSBKKZKX')).toBe(true);
    });
  });
});
