/**
 * Shared PDF formatting helpers for KZ billing documents.
 */

import type PDFDocument from 'pdfkit';

/** Format a date as DD.MM.YYYY */
export function formatDate(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}.${m}.${y}`;
}

/** Format a monetary amount with currency (ru-RU locale, 2 decimal places) */
export function formatAmount(amount: number, currency: string): string {
  return `${formatNumber(amount)} ${currency}`;
}

/** Format a number with ru-RU locale (2 decimal places) */
export function formatNumber(value: number): string {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Standard table column positions and widths for A4 invoices/acts */
export const TABLE_COLS = {
  x: { num: 50, desc: 80, qty: 340, price: 400, amount: 470 },
  w: { num: 30, desc: 260, qty: 60, price: 70, amount: 80 },
} as const;

/** Minimum row height in the line items table */
export const MIN_ROW_HEIGHT = 18;

export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

/**
 * Render a line items table with header, rows, and total.
 * Returns the Y position after the total line.
 */
export function renderLineItemsTable(
  doc: InstanceType<typeof PDFDocument>,
  lines: LineItem[],
  totalAmount: number,
  currency: string
): number {
  const { x, w } = TABLE_COLS;
  const tableTop = doc.y;

  // Header row
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('#', x.num, tableTop, { width: w.num });
  doc.text('Description', x.desc, tableTop, { width: w.desc });
  doc.text('Qty', x.qty, tableTop, { width: w.qty, align: 'right' });
  doc.text('Price', x.price, tableTop, { width: w.price, align: 'right' });
  doc.text('Amount', x.amount, tableTop, { width: w.amount, align: 'right' });

  // Header line
  const lineY = tableTop + 15;
  doc
    .moveTo(x.num, lineY)
    .lineTo(x.amount + w.amount, lineY)
    .stroke();

  // Data rows
  doc.font('Helvetica').fontSize(9);
  let rowY = lineY + 5;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const descHeight = doc.heightOfString(line.description, { width: w.desc });
    const rowHeight = Math.max(MIN_ROW_HEIGHT, descHeight + 4);
    doc.text(String(i + 1), x.num, rowY, { width: w.num });
    doc.text(line.description, x.desc, rowY, { width: w.desc });
    doc.text(formatNumber(line.quantity), x.qty, rowY, { width: w.qty, align: 'right' });
    doc.text(formatNumber(line.unit_price), x.price, rowY, { width: w.price, align: 'right' });
    doc.text(formatNumber(line.amount), x.amount, rowY, { width: w.amount, align: 'right' });
    rowY += rowHeight;
  }

  // Total line
  doc
    .moveTo(x.num, rowY)
    .lineTo(x.amount + w.amount, rowY)
    .stroke();
  rowY += 5;
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text('Total:', x.price, rowY, { width: w.price, align: 'right' });
  doc.text(formatAmount(totalAmount, currency), x.amount, rowY, {
    width: w.amount,
    align: 'right',
  });

  return rowY + 25;
}
