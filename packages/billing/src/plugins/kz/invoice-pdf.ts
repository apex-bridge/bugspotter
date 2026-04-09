/**
 * KZ Invoice PDF Generator
 * Generates a "Счёт на оплату" (Payment Invoice) in standard KZ format.
 */

import PDFDocument from 'pdfkit';
import type { KzSellerConfig } from './seller-config.js';
import { formatDate, TABLE_COLS, renderLineItemsTable } from './pdf-helpers.js';

export interface InvoicePdfData {
  invoiceNumber: string;
  issuedAt: Date;
  dueAt: Date | null;
  seller: KzSellerConfig;
  buyer: {
    company_name: string;
    bin: string;
    legal_address: string;
    bank_name: string;
    iik: string;
    bik: string;
    director_name: string;
  };
  lines: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  totalAmount: number;
  currency: string;
  notes: string | null;
}

/**
 * Generate a KZ invoice PDF and return it as a Buffer.
 */
export function generateKzInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Title ──────────────────────────────────────────────────────────────
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .text(`Invoice / No. ${data.invoiceNumber}`, { align: 'center' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`from ${formatDate(data.issuedAt)}`, { align: 'center' });
    if (data.dueAt) {
      doc.text(`Due: ${formatDate(data.dueAt)}`, { align: 'center' });
    }
    doc.moveDown(1.5);

    // ── Seller ─────────────────────────────────────────────────────────────
    doc.fontSize(11).font('Helvetica-Bold').text('Seller:');
    doc.fontSize(10).font('Helvetica');
    doc.text(data.seller.company_name);
    if (data.seller.bin) {
      doc.text(`BIN: ${data.seller.bin}`);
    }
    if (data.seller.legal_address) {
      doc.text(`Address: ${data.seller.legal_address}`);
    }
    if (data.seller.bank_name) {
      doc.text(`Bank: ${data.seller.bank_name}`);
    }
    if (data.seller.iik) {
      doc.text(`IIK: ${data.seller.iik}`);
    }
    if (data.seller.bik) {
      doc.text(`BIK: ${data.seller.bik}`);
    }
    doc.moveDown();

    // ── Buyer ──────────────────────────────────────────────────────────────
    doc.fontSize(11).font('Helvetica-Bold').text('Buyer:');
    doc.fontSize(10).font('Helvetica');
    doc.text(data.buyer.company_name);
    if (data.buyer.bin) {
      doc.text(`BIN: ${data.buyer.bin}`);
    }
    if (data.buyer.legal_address) {
      doc.text(`Address: ${data.buyer.legal_address}`);
    }
    if (data.buyer.bank_name) {
      doc.text(`Bank: ${data.buyer.bank_name}`);
    }
    if (data.buyer.iik) {
      doc.text(`IIK: ${data.buyer.iik}`);
    }
    if (data.buyer.bik) {
      doc.text(`BIK: ${data.buyer.bik}`);
    }
    doc.moveDown(1.5);

    // ── Line Items Table ───────────────────────────────────────────────────
    let rowY = renderLineItemsTable(doc, data.lines, data.totalAmount, data.currency);

    // ── Notes ──────────────────────────────────────────────────────────────
    if (data.notes) {
      doc.font('Helvetica').fontSize(9);
      doc.text(`Notes: ${data.notes}`, TABLE_COLS.x.num, rowY);
      rowY += 20;
    }

    // ── Signature ──────────────────────────────────────────────────────────
    doc.y = rowY + 40;
    doc.font('Helvetica').fontSize(10);
    doc.text(`Director: _______________ / ${data.seller.director_name} /`, TABLE_COLS.x.num);

    doc.end();
  });
}
