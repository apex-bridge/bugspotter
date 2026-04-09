/**
 * Kazakhstan Billing Plugin
 * Implements BillingRegionPlugin for KZ legal entity invoice billing.
 */

import type { Pool, PoolClient } from 'pg';
import type {
  BillingRegionPlugin,
  CreateInvoiceInput,
  InvoicePdfResult,
} from '../../interfaces.js';
import { validateBin } from './bin-validator.js';
import { validateIik, validateBik } from './iik-validator.js';
import { generateKzInvoicePdf } from './invoice-pdf.js';
import { generateKzActPdf } from './act-pdf.js';
import { getKzSellerConfig } from './seller-config.js';

/**
 * Run a callback within a REPEATABLE READ, read-only transaction for snapshot consistency.
 * If db is a Pool, acquires a dedicated client with a transaction.
 * If db is already a PoolClient, runs directly without starting a new transaction
 * (caller is responsible for transaction boundaries to avoid nested BEGIN errors).
 */
async function withReadTransaction<T>(
  db: Pool | PoolClient,
  fn: (client: Pool | PoolClient) => Promise<T>
): Promise<T> {
  const isPoolClient = 'release' in db && typeof (db as PoolClient).release === 'function';
  if (isPoolClient) {
    // Already a client — caller owns the transaction, just run the callback
    return fn(db);
  }
  // It's a Pool — get a dedicated client with snapshot isolation
  const client = await (db as Pool).connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export class KzBillingPlugin implements BillingRegionPlugin {
  readonly regionCode = 'kz';

  async createInvoice(
    _input: CreateInvoiceInput,
    _db: Pool | PoolClient
  ): Promise<{ invoiceId: string }> {
    // TODO: implement in Phase 5 (backend integration)
    throw new Error('KzBillingPlugin.createInvoice not yet implemented');
  }

  async markPaid(_invoiceId: string, _db: Pool | PoolClient): Promise<void> {
    // TODO: implement in Phase 5
    throw new Error('KzBillingPlugin.markPaid not yet implemented');
  }

  async generateInvoicePdf(invoiceId: string, db: Pool | PoolClient): Promise<InvoicePdfResult> {
    return withReadTransaction(db, async (client) => {
      // Fetch invoice + lines + buyer legal entity
      const invoiceResult = await client.query<{
        invoice_number: string;
        organization_id: string;
        amount: number;
        currency: string;
        issued_at: Date;
        due_at: Date | null;
        notes: string | null;
      }>(
        'SELECT invoice_number, organization_id, amount::float8, currency, issued_at, due_at, notes FROM saas.invoices WHERE id = $1',
        [invoiceId]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        throw new Error(`Invoice not found: ${invoiceId}`);
      }

      const linesResult = await client.query<{
        description: string;
        quantity: number;
        unit_price: number;
        amount: number;
      }>(
        'SELECT description, quantity, unit_price::float8, amount::float8 FROM saas.invoice_lines WHERE invoice_id = $1 ORDER BY created_at',
        [invoiceId]
      );

      const entityResult = await client.query<{
        company_name: string;
        details: Record<string, unknown>;
      }>('SELECT company_name, details FROM saas.legal_entities WHERE organization_id = $1', [
        invoice.organization_id,
      ]);
      const entity = entityResult.rows[0];
      if (!entity) {
        throw new Error(`Legal entity not found for org: ${invoice.organization_id}`);
      }

      const details = entity.details;
      const str = (key: string): string =>
        typeof details[key] === 'string' ? (details[key] as string) : '';

      const seller = getKzSellerConfig();

      const pdfBuffer = await generateKzInvoicePdf({
        invoiceNumber: invoice.invoice_number,
        issuedAt: invoice.issued_at,
        dueAt: invoice.due_at,
        seller,
        buyer: {
          company_name: entity.company_name,
          bin: str('bin'),
          legal_address: str('legal_address'),
          bank_name: str('bank_name'),
          iik: str('iik'),
          bik: str('bik'),
          director_name: str('director_name'),
        },
        lines: linesResult.rows.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          amount: Number(l.amount),
        })),
        totalAmount: Number(invoice.amount),
        currency: invoice.currency,
        notes: invoice.notes,
      });

      return {
        pdfBuffer,
        filename: `${invoice.invoice_number}.pdf`,
      };
    }); // end withReadTransaction
  }

  async generateActPdf(actId: string, db: Pool | PoolClient): Promise<InvoicePdfResult> {
    return withReadTransaction(db, async (client) => {
      // Fetch act + invoice + lines + buyer legal entity
      const actResult = await client.query<{
        act_number: string;
        invoice_id: string;
        created_at: Date;
      }>('SELECT act_number, invoice_id, created_at FROM saas.acts WHERE id = $1', [actId]);
      const act = actResult.rows[0];
      if (!act) {
        throw new Error(`Act not found: ${actId}`);
      }

      const invoiceResult = await client.query<{
        invoice_number: string;
        organization_id: string;
        amount: number;
        currency: string;
      }>(
        'SELECT invoice_number, organization_id, amount::float8, currency FROM saas.invoices WHERE id = $1',
        [act.invoice_id]
      );
      const invoice = invoiceResult.rows[0];
      if (!invoice) {
        throw new Error(`Invoice not found: ${act.invoice_id}`);
      }

      const linesResult = await client.query<{
        description: string;
        quantity: number;
        unit_price: number;
        amount: number;
        period_start: Date | null;
        period_end: Date | null;
      }>(
        'SELECT description, quantity, unit_price::float8, amount::float8, period_start, period_end FROM saas.invoice_lines WHERE invoice_id = $1 ORDER BY created_at',
        [act.invoice_id]
      );

      const entityResult = await client.query<{
        company_name: string;
        details: Record<string, unknown>;
      }>('SELECT company_name, details FROM saas.legal_entities WHERE organization_id = $1', [
        invoice.organization_id,
      ]);
      const entity = entityResult.rows[0];
      if (!entity) {
        throw new Error(`Legal entity not found for org: ${invoice.organization_id}`);
      }

      const details = entity.details;
      const str = (key: string): string =>
        typeof details[key] === 'string' ? (details[key] as string) : '';

      const seller = getKzSellerConfig();

      // Compute overall period from min(period_start) to max(period_end) across all lines
      let periodStart: Date | null = null;
      let periodEnd: Date | null = null;
      for (const line of linesResult.rows) {
        if (line.period_start && (!periodStart || line.period_start < periodStart)) {
          periodStart = line.period_start;
        }
        if (line.period_end && (!periodEnd || line.period_end > periodEnd)) {
          periodEnd = line.period_end;
        }
      }

      const pdfBuffer = await generateKzActPdf({
        actNumber: act.act_number,
        invoiceNumber: invoice.invoice_number,
        createdAt: act.created_at,
        seller,
        buyer: {
          company_name: entity.company_name,
          bin: str('bin'),
          director_name: str('director_name'),
        },
        lines: linesResult.rows.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          amount: Number(l.amount),
        })),
        totalAmount: Number(invoice.amount),
        currency: invoice.currency,
        periodStart,
        periodEnd,
      });

      return {
        pdfBuffer,
        filename: `${act.act_number}.pdf`,
      };
    }); // end withReadTransaction
  }

  /**
   * Validate KZ legal entity: company_name + KZ-specific details JSONB.
   * Accepts Record<string, unknown> since input comes from untrusted API JSON.
   * @param companyName - the shared company_name column
   * @param details - the raw JSONB details object
   */
  validateLegalEntity(companyName: string, details: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!companyName?.trim()) {
      errors.push('Company name is required');
    }

    const str = (key: string): string =>
      typeof details[key] === 'string' ? (details[key] as string) : '';

    const binError = validateBin(str('bin'));
    if (binError) {
      errors.push(binError);
    }

    const iikError = validateIik(str('iik'));
    if (iikError) {
      errors.push(iikError);
    }

    const bikError = validateBik(str('bik'));
    if (bikError) {
      errors.push(bikError);
    }

    if (!str('legal_address').trim()) {
      errors.push('Legal address is required');
    }

    if (!str('bank_name').trim()) {
      errors.push('Bank name is required');
    }

    if (!str('director_name').trim()) {
      errors.push('Director name is required');
    }

    return errors;
  }
}
