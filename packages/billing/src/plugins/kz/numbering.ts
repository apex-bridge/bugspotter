/**
 * Invoice & Act Sequential Numbering
 *
 * Format: PREFIX-YYYY-NNNN
 * Examples: INV-2026-0001, ACT-2026-0001
 *
 * Uses PostgreSQL sequences for unique, monotonically increasing numbers.
 * Note: sequences are NOT gapless — rolled-back transactions consume numbers.
 * For true gapless numbering, use a transactional counter table instead.
 */

import type { Pool, PoolClient } from 'pg';

const INVOICE_PREFIX = 'INV';
const ACT_PREFIX = 'ACT';

/**
 * Generate the next invoice number using the database sequence.
 * Should be called within a transaction alongside the invoice INSERT
 * to keep the number and row creation atomic.
 * Note: the sequence itself is NOT rolled back on transaction abort.
 */
export async function nextInvoiceNumber(db: Pool | PoolClient): Promise<string> {
  return nextNumber(db, 'saas.invoice_number_seq', INVOICE_PREFIX);
}

/**
 * Generate the next act number using the database sequence.
 * Should be called within a transaction alongside the act INSERT.
 * Note: the sequence itself is NOT rolled back on transaction abort.
 */
export async function nextActNumber(db: Pool | PoolClient): Promise<string> {
  return nextNumber(db, 'saas.act_number_seq', ACT_PREFIX);
}

async function nextNumber(
  db: Pool | PoolClient,
  sequenceName: string,
  prefix: string
): Promise<string> {
  const result = await db.query<{ nextval: string }>(`SELECT nextval($1::regclass)`, [
    sequenceName,
  ]);
  const seq = parseInt(result.rows[0].nextval, 10);
  const year = new Date().getFullYear();
  return formatNumber(prefix, year, seq);
}

/**
 * Format a document number from its components.
 */
export function formatNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Parse a document number into its components.
 * Returns null if the format is invalid.
 */
export function parseNumber(number: string): { prefix: string; year: number; seq: number } | null {
  const match = number.match(/^([A-Z]+)-(\d{4})-(\d{4,})$/);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    year: parseInt(match[2], 10),
    seq: parseInt(match[3], 10),
  };
}
