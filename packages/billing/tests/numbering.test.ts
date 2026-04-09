import { describe, it, expect } from 'vitest';
import { formatNumber, parseNumber } from '../src/plugins/kz/numbering.js';

describe('Invoice Numbering', () => {
  describe('formatNumber', () => {
    it('formats with zero-padded sequence', () => {
      expect(formatNumber('INV', 2026, 1)).toBe('INV-2026-0001');
    });

    it('formats larger sequence numbers', () => {
      expect(formatNumber('INV', 2026, 42)).toBe('INV-2026-0042');
    });

    it('formats 4+ digit sequences', () => {
      expect(formatNumber('INV', 2026, 12345)).toBe('INV-2026-12345');
    });

    it('works with ACT prefix', () => {
      expect(formatNumber('ACT', 2026, 7)).toBe('ACT-2026-0007');
    });
  });

  describe('parseNumber', () => {
    it('parses a valid invoice number', () => {
      expect(parseNumber('INV-2026-0001')).toEqual({
        prefix: 'INV',
        year: 2026,
        seq: 1,
      });
    });

    it('parses a valid act number', () => {
      expect(parseNumber('ACT-2026-0042')).toEqual({
        prefix: 'ACT',
        year: 2026,
        seq: 42,
      });
    });

    it('parses large sequence numbers', () => {
      expect(parseNumber('INV-2026-12345')).toEqual({
        prefix: 'INV',
        year: 2026,
        seq: 12345,
      });
    });

    it('returns null for invalid format', () => {
      expect(parseNumber('INVALID')).toBeNull();
      expect(parseNumber('INV-26-001')).toBeNull();
      expect(parseNumber('inv-2026-0001')).toBeNull(); // lowercase prefix
      expect(parseNumber('')).toBeNull();
    });
  });
});
