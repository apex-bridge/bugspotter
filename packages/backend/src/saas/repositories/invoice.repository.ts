/**
 * Invoice Repository
 * CRUD operations for saas.invoices table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type { Invoice, InvoiceInsert, InvoiceUpdate } from '../../db/types.js';

export class InvoiceRepository extends BaseRepository<Invoice, InvoiceInsert, InvoiceUpdate> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'invoices');
  }

  /** Convert Postgres NUMERIC string to number for monetary fields. */
  protected override deserialize(row: unknown): Invoice {
    const entity = super.deserialize(row);
    return {
      ...entity,
      amount: typeof entity.amount === 'string' ? Number(entity.amount) : entity.amount,
    };
  }

  async findByOrganizationId(organizationId: string): Promise<Invoice[]> {
    return this.findManyBy('organization_id', organizationId);
  }

  async findByInvoiceNumber(invoiceNumber: string): Promise<Invoice | null> {
    return this.findBy('invoice_number', invoiceNumber);
  }

  /**
   * List invoices for an organization with pagination, ordered by created_at DESC.
   */
  async listByOrganization(
    organizationId: string,
    pagination: { page: number; limit: number }
  ): Promise<{
    data: Invoice[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    return this.listWithPagination(
      { organization_id: organizationId },
      'created_at DESC',
      pagination
    );
  }

  /**
   * Find overdue invoices (status='sent' and due_at < now).
   */
  async findOverdue(): Promise<Invoice[]> {
    const result = await this.pool.query<Invoice>(
      `SELECT * FROM saas.invoices
       WHERE status = 'sent' AND due_at < NOW()
       ORDER BY due_at ASC`
    );
    return result.rows.map((row) => this.deserialize(row));
  }
}
