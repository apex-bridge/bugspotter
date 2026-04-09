/**
 * Act Repository
 * CRUD operations for saas.acts table (Акт выполненных работ)
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type { Act, ActInsert, ActUpdate } from '../../db/types.js';

export class ActRepository extends BaseRepository<Act, ActInsert, ActUpdate> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'acts');
  }

  async findByInvoiceId(invoiceId: string): Promise<Act | null> {
    return this.findBy('invoice_id', invoiceId);
  }

  async findByActNumber(actNumber: string): Promise<Act | null> {
    return this.findBy('act_number', actNumber);
  }

  /**
   * Find act by ID, verifying it belongs to the given organization via invoice JOIN.
   * Returns null if act doesn't exist or doesn't belong to the org.
   */
  async findByIdForOrganization(actId: string, organizationId: string): Promise<Act | null> {
    const result = await this.pool.query<Act>(
      `SELECT a.* FROM saas.acts a
       JOIN saas.invoices i ON i.id = a.invoice_id
       WHERE a.id = $1 AND i.organization_id = $2`,
      [actId, organizationId]
    );
    return result.rows[0] ? this.deserialize(result.rows[0]) : null;
  }
}
