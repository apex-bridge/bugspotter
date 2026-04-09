/**
 * Legal Entity Repository
 * CRUD operations for saas.legal_entities table
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from '../../db/repositories/base-repository.js';
import type { LegalEntity, LegalEntityInsert, LegalEntityUpdate } from '../../db/types.js';

export class LegalEntityRepository extends BaseRepository<
  LegalEntity,
  LegalEntityInsert,
  LegalEntityUpdate
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'legal_entities', ['details']);
  }

  /**
   * Find legal entity by organization ID (1:1 relationship).
   */
  async findByOrganizationId(organizationId: string): Promise<LegalEntity | null> {
    return this.findBy('organization_id', organizationId);
  }

  /**
   * Upsert legal entity — create or update by organization_id.
   */
  async upsert(data: LegalEntityInsert): Promise<LegalEntity> {
    const result = await this.pool.query<LegalEntity>(
      `INSERT INTO saas.legal_entities (organization_id, company_name, details)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         details = EXCLUDED.details,
         updated_at = NOW()
       RETURNING *`,
      [data.organization_id, data.company_name, JSON.stringify(data.details ?? {})]
    );
    return this.deserialize(result.rows[0]);
  }
}
