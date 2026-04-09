/**
 * Invoice Line Repository
 * CRUD operations for saas.invoice_lines table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type { InvoiceLine, InvoiceLineInsert } from '../../db/types.js';

export class InvoiceLineRepository extends BaseRepository<InvoiceLine, InvoiceLineInsert> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'invoice_lines');
  }

  /** Convert Postgres NUMERIC strings to numbers for monetary fields. */
  protected override deserialize(row: unknown): InvoiceLine {
    const entity = super.deserialize(row);
    return {
      ...entity,
      unit_price:
        typeof entity.unit_price === 'string' ? Number(entity.unit_price) : entity.unit_price,
      amount: typeof entity.amount === 'string' ? Number(entity.amount) : entity.amount,
    };
  }

  async findByInvoiceId(invoiceId: string): Promise<InvoiceLine[]> {
    return this.findManyBy('invoice_id', invoiceId);
  }
}
