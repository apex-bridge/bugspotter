/**
 * KZ Act PDF Generator
 * Generates an "Act of Completed Works" in standard KZ format.
 */

import PDFDocument from 'pdfkit';
import type { KzSellerConfig } from './seller-config.js';
import { formatDate, TABLE_COLS, renderLineItemsTable } from './pdf-helpers.js';

export interface ActPdfData {
  actNumber: string;
  invoiceNumber: string;
  createdAt: Date;
  seller: KzSellerConfig;
  buyer: {
    company_name: string;
    bin: string;
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
  periodStart: Date | null;
  periodEnd: Date | null;
}

/**
 * Generate a KZ act PDF and return it as a Buffer.
 */
export function generateKzActPdf(data: ActPdfData): Promise<Buffer> {
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
      .text(`Act of Completed Works No. ${data.actNumber}`, { align: 'center' });
    doc
      .fontSize(10)
      .font('Helvetica')
      .text(`from ${formatDate(data.createdAt)}`, { align: 'center' });
    doc.text(`(Invoice No. ${data.invoiceNumber})`, { align: 'center' });
    doc.moveDown(1.5);

    // ── Period ─────────────────────────────────────────────────────────────
    if (data.periodStart && data.periodEnd) {
      doc.fontSize(10).font('Helvetica');
      doc.text(`Service period: ${formatDate(data.periodStart)} - ${formatDate(data.periodEnd)}`, {
        align: 'center',
      });
      doc.moveDown();
    }

    // ── Parties ────────────────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica');
    doc.text(
      `Executor: ${data.seller.company_name}` + (data.seller.bin ? `, BIN ${data.seller.bin}` : '')
    );
    doc.text(
      `Client: ${data.buyer.company_name}` + (data.buyer.bin ? `, BIN ${data.buyer.bin}` : '')
    );
    doc.moveDown();
    doc.text('The Executor has provided, and the Client accepts, the following services:');
    doc.moveDown();

    // ── Line Items Table ───────────────────────────────────────────────────
    const rowY = renderLineItemsTable(doc, data.lines, data.totalAmount, data.currency);

    // ── Closing statement ──────────────────────────────────────────────────
    doc.font('Helvetica').fontSize(10);
    doc.text(
      'The services listed above have been provided in full and on time. ' +
        'The Client has no claims regarding the quality or scope of services.',
      TABLE_COLS.x.num,
      rowY + 5,
      { width: 500 }
    );
    const afterStatement = doc.y + 30;

    // ── Signatures ─────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Executor:', TABLE_COLS.x.num, afterStatement, { width: 200 });
    doc.text('Client:', 320, afterStatement, { width: 200 });

    doc.font('Helvetica').fontSize(10);
    doc.text(
      `_______________ / ${data.seller.director_name} /`,
      TABLE_COLS.x.num,
      afterStatement + 25,
      { width: 250 }
    );
    doc.text(`_______________ / ${data.buyer.director_name} /`, 320, afterStatement + 25, {
      width: 250,
    });

    doc.end();
  });
}
