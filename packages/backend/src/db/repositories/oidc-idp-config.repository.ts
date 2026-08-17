/**
 * OIDC IdP Config Repository
 * Per-tenant OpenID Connect identity-provider configuration (ADR-0044).
 * client_secret is encrypted at rest; findByTenantId/upsert always return
 * the decrypted plaintext to callers, never the cipher envelope.
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';
import { getEncryptionService } from '../../utils/encryption.js';

export interface OidcIdpConfig {
  id: string;
  tenantId: string;
  issuerUrl: string;
  clientId: string;
  /** Decrypted on every read. Never the raw ciphertext. */
  clientSecret: string;
  allowedDomains: string[];
  enforceSso: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OidcIdpConfigUpsertInput {
  tenantId: string;
  issuerUrl: string;
  clientId: string;
  /** Plaintext. Encrypted before the INSERT/UPDATE executes. */
  clientSecret: string;
  allowedDomains: string[];
  enforceSso: boolean;
}

interface OidcIdpConfigRow {
  id: string;
  tenant_id: string;
  issuer_url: string;
  client_id: string;
  encrypted_client_secret: string;
  allowed_domains: string[];
  enforce_sso: boolean;
  created_at: Date;
  updated_at: Date;
}

export class OidcIdpConfigRepository extends BaseRepository<OidcIdpConfig> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'saas', 'oidc_idp_config');
  }

  async findByTenantId(tenantId: string): Promise<OidcIdpConfig | null> {
    const result = await this.pool.query<OidcIdpConfigRow>(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE tenant_id = $1`,
      [tenantId]
    );

    return result.rows[0] ? this.fromRow(result.rows[0]) : null;
  }

  async upsert(input: OidcIdpConfigUpsertInput): Promise<OidcIdpConfig> {
    const enc = getEncryptionService();
    const encryptedClientSecret = enc.encrypt(input.clientSecret);

    const result = await this.pool.query<OidcIdpConfigRow>(
      `INSERT INTO ${this.schema}.${this.tableName}
         (tenant_id, issuer_url, client_id, encrypted_client_secret, allowed_domains, enforce_sso, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id) DO UPDATE
       SET issuer_url = EXCLUDED.issuer_url,
           client_id = EXCLUDED.client_id,
           encrypted_client_secret = EXCLUDED.encrypted_client_secret,
           allowed_domains = EXCLUDED.allowed_domains,
           enforce_sso = EXCLUDED.enforce_sso,
           updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        input.tenantId,
        input.issuerUrl,
        input.clientId,
        encryptedClientSecret,
        input.allowedDomains,
        input.enforceSso,
      ]
    );

    return this.fromRow(result.rows[0]);
  }

  private fromRow(row: OidcIdpConfigRow): OidcIdpConfig {
    const enc = getEncryptionService();
    return {
      id: row.id,
      tenantId: row.tenant_id,
      issuerUrl: row.issuer_url,
      clientId: row.client_id,
      clientSecret: enc.decrypt(row.encrypted_client_secret),
      allowedDomains: row.allowed_domains,
      enforceSso: row.enforce_sso,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
