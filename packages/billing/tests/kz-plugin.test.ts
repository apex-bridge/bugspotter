import { describe, it, expect } from 'vitest';
import { KzBillingPlugin } from '../src/plugins/kz/index.js';

describe('KzBillingPlugin', () => {
  const plugin = new KzBillingPlugin();

  describe('regionCode', () => {
    it('is kz', () => {
      expect(plugin.regionCode).toBe('kz');
    });
  });

  describe('validateLegalEntity', () => {
    const validDetails = {
      bin: '160105400019',
      legal_address: 'г. Астана, ул. Кабанбай батыра 53',
      bank_name: 'АО "Халык Банк"',
      iik: 'KZ971234567890123456',
      bik: 'HSBKKZKX',
      director_name: 'Иванов Иван Иванович',
      phone: '+7 777 123 4567',
      email: 'info@example.kz',
    };

    it('returns empty array for valid data', () => {
      const errors = plugin.validateLegalEntity('ТОО "Apex Bridge Technology"', validDetails);
      expect(errors).toEqual([]);
    });

    it('requires company_name', () => {
      const errors = plugin.validateLegalEntity('', validDetails);
      expect(errors).toContain('Company name is required');
    });

    it('requires company_name (whitespace only)', () => {
      const errors = plugin.validateLegalEntity('   ', validDetails);
      expect(errors).toContain('Company name is required');
    });

    it('validates BIN', () => {
      const errors = plugin.validateLegalEntity('Test', { ...validDetails, bin: '123' });
      expect(errors).toContain('BIN must be exactly 12 digits');
    });

    it('validates IIK', () => {
      const errors = plugin.validateLegalEntity('Test', { ...validDetails, iik: 'INVALID' });
      expect(errors.some((e) => e.includes('IIK'))).toBe(true);
    });

    it('validates BIK', () => {
      const errors = plugin.validateLegalEntity('Test', { ...validDetails, bik: 'X' });
      expect(errors.some((e) => e.includes('BIK'))).toBe(true);
    });

    it('requires legal_address', () => {
      const errors = plugin.validateLegalEntity('Test', { ...validDetails, legal_address: '' });
      expect(errors).toContain('Legal address is required');
    });

    it('requires bank_name', () => {
      const errors = plugin.validateLegalEntity('Test', { ...validDetails, bank_name: '' });
      expect(errors).toContain('Bank name is required');
    });

    it('requires director_name', () => {
      const errors = plugin.validateLegalEntity('Test', { ...validDetails, director_name: '' });
      expect(errors).toContain('Director name is required');
    });

    it('phone and email are optional', () => {
      const { phone: _phone, email: _email, ...requiredOnly } = validDetails;
      const errors = plugin.validateLegalEntity('Test', requiredOnly);
      expect(errors).toEqual([]);
    });

    it('returns multiple errors at once', () => {
      const errors = plugin.validateLegalEntity('', {});
      expect(errors.length).toBeGreaterThanOrEqual(6);
      expect(errors).toContain('Company name is required');
      expect(errors.some((e) => e.includes('BIN'))).toBe(true);
      expect(errors.some((e) => e.includes('IIK'))).toBe(true);
      expect(errors.some((e) => e.includes('BIK'))).toBe(true);
      expect(errors).toContain('Legal address is required');
      expect(errors).toContain('Bank name is required');
      expect(errors).toContain('Director name is required');
    });

    it('handles undefined values gracefully', () => {
      const errors = plugin.validateLegalEntity('Test', {
        bin: undefined,
        iik: undefined,
        bik: undefined,
      });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('handles non-string values without crashing', () => {
      const errors = plugin.validateLegalEntity('Test', {
        bin: 12345,
        iik: null,
        bik: { nested: true },
        legal_address: 0,
        bank_name: false,
        director_name: [],
      });
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
