/**
 * Invoice PDF Generator Tests
 * Verifies that PDF generation produces valid output.
 */

import { describe, it, expect } from 'vitest';
import { generateKzInvoicePdf } from '../src/plugins/kz/invoice-pdf.js';
import { generateKzActPdf } from '../src/plugins/kz/act-pdf.js';

const mockSeller = {
  company_name: 'TOO "Apex Bridge Technology"',
  bin: '230140900001',
  legal_address: 'Astana, Mangilik El 55/20',
  bank_name: 'Halyk Bank',
  iik: 'KZ123456789012345678',
  bik: 'HSBKKZKX',
  director_name: 'Test Director',
  phone: '+7 777 123 4567',
  email: 'test@apexbridge.tech',
};

const mockBuyer = {
  company_name: 'TOO "Test Company"',
  bin: '231040900002',
  legal_address: 'Almaty, Abay 100',
  bank_name: 'Freedom Bank',
  iik: 'KZ987654321098765432',
  bik: 'IRTYKZKA',
  director_name: 'Buyer Director',
};

const mockLines = [
  {
    description: 'BugSpotter Starter plan - March 2025',
    quantity: 1,
    unit_price: 4990,
    amount: 4990,
  },
];

describe('generateKzInvoicePdf', () => {
  it('generates a valid PDF buffer', async () => {
    const result = await generateKzInvoicePdf({
      invoiceNumber: 'INV-2025-0001',
      issuedAt: new Date('2025-03-01'),
      dueAt: new Date('2025-03-15'),
      seller: mockSeller,
      buyer: mockBuyer,
      lines: mockLines,
      totalAmount: 4990,
      currency: 'KZT',
      notes: null,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    // PDF files start with %PDF
    expect(result.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('includes notes when provided', async () => {
    const result = await generateKzInvoicePdf({
      invoiceNumber: 'INV-2025-0002',
      issuedAt: new Date('2025-03-01'),
      dueAt: null,
      seller: mockSeller,
      buyer: mockBuyer,
      lines: mockLines,
      totalAmount: 4990,
      currency: 'KZT',
      notes: 'Astana Hub resident - VAT exempt',
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles multiple line items', async () => {
    const multiLines = [
      { description: 'BugSpotter Starter plan', quantity: 1, unit_price: 4990, amount: 4990 },
      { description: 'Additional storage 10GB', quantity: 2, unit_price: 1000, amount: 2000 },
      { description: 'Premium support', quantity: 1, unit_price: 3000, amount: 3000 },
    ];

    const result = await generateKzInvoicePdf({
      invoiceNumber: 'INV-2025-0003',
      issuedAt: new Date('2025-03-01'),
      dueAt: new Date('2025-03-31'),
      seller: mockSeller,
      buyer: mockBuyer,
      lines: multiLines,
      totalAmount: 9990,
      currency: 'KZT',
      notes: null,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('ascii', 0, 5)).toBe('%PDF-');
  });
});

describe('generateKzActPdf', () => {
  it('generates a valid PDF buffer', async () => {
    const result = await generateKzActPdf({
      actNumber: 'ACT-2025-0001',
      invoiceNumber: 'INV-2025-0001',
      createdAt: new Date('2025-03-15'),
      seller: mockSeller,
      buyer: {
        company_name: mockBuyer.company_name,
        bin: mockBuyer.bin,
        director_name: mockBuyer.director_name,
      },
      lines: mockLines,
      totalAmount: 4990,
      currency: 'KZT',
      periodStart: new Date('2025-03-01'),
      periodEnd: new Date('2025-04-01'),
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(result.toString('ascii', 0, 5)).toBe('%PDF-');
  });

  it('works without period dates', async () => {
    const result = await generateKzActPdf({
      actNumber: 'ACT-2025-0002',
      invoiceNumber: 'INV-2025-0002',
      createdAt: new Date('2025-03-15'),
      seller: mockSeller,
      buyer: {
        company_name: mockBuyer.company_name,
        bin: mockBuyer.bin,
        director_name: mockBuyer.director_name,
      },
      lines: mockLines,
      totalAmount: 4990,
      currency: 'KZT',
      periodStart: null,
      periodEnd: null,
    });

    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('ascii', 0, 5)).toBe('%PDF-');
  });
});
