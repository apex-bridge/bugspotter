/**
 * OAuth Token Repository
 * Manages OAuth access and refresh tokens for integrations
 * Note: Tokens should be encrypted at rest
 */

import type { Pool, PoolClient } from 'pg';
import { BaseRepository } from './base-repository.js';

export interface OAuthToken {
  id: string;
  integration_type: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | null;
  scope: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateOAuthTokenInput {
  integration_type: string;
  access_token: string;
  refresh_token?: string;
  expires_at?: Date;
  scope?: string;
}

export interface UpdateOAuthTokenInput {
  access_token?: string;
  refresh_token?: string;
  expires_at?: Date;
  scope?: string;
}

export class OAuthTokenRepository extends BaseRepository<
  OAuthToken,
  CreateOAuthTokenInput,
  UpdateOAuthTokenInput
> {
  constructor(pool: Pool | PoolClient) {
    super(pool, 'application', 'oauth_tokens', []);
  }

  /**
   * Find token by integration type (unique constraint)
   */
  async findByIntegrationType(type: string): Promise<OAuthToken | null> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE integration_type = $1`,
      [type]
    );
    return result.rows.length > 0 ? this.deserialize(result.rows[0]) : null;
  }

  /**
   * Upsert (insert or update) OAuth token for an integration
   */
  async upsert(data: CreateOAuthTokenInput): Promise<OAuthToken> {
    const query = `
      INSERT INTO ${this.schema}.${this.tableName} 
        (integration_type, access_token, refresh_token, expires_at, scope)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (integration_type) 
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        scope = EXCLUDED.scope,
        updated_at = NOW()
      RETURNING *
    `;

    const result = await this.getClient().query(query, [
      data.integration_type,
      data.access_token,
      data.refresh_token || null,
      data.expires_at || null,
      data.scope || null,
    ]);

    return this.deserialize(result.rows[0]);
  }

  /**
   * Get tokens that are about to expire (within threshold)
   */
  async getExpiringSoon(thresholdMinutes: number = 30): Promise<OAuthToken[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} 
       WHERE expires_at IS NOT NULL 
       AND expires_at <= NOW() + make_interval(mins => $1::int)
       AND expires_at > NOW()`,
      [thresholdMinutes]
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Get expired tokens
   */
  async getExpired(): Promise<OAuthToken[]> {
    const result = await this.getClient().query(
      `SELECT * FROM ${this.schema}.${this.tableName} WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
      []
    );
    return result.rows.map((row) => this.deserialize(row));
  }

  /**
   * Delete token for integration type
   */
  async deleteByIntegrationType(type: string): Promise<boolean> {
    const result = await this.getClient().query(
      `DELETE FROM ${this.schema}.${this.tableName} WHERE integration_type = $1`,
      [type]
    );
    return (result.rowCount || 0) > 0;
  }

  /**
   * Update access token (refresh flow)
   * @param type - Integration type
   * @param accessToken - New access token
   * @param expiresAt - Optional expiration date
   * @param refreshToken - Optional new refresh token
   * @returns Updated token if found, null otherwise
   */
  async refreshToken(
    type: string,
    accessToken: string,
    expiresAt?: Date,
    refreshToken?: string
  ): Promise<OAuthToken | null> {
    const updates: string[] = ['access_token = $2', 'updated_at = NOW()'];
    const values: unknown[] = [type, accessToken];
    let paramCount = 3;

    if (expiresAt) {
      updates.push(`expires_at = $${paramCount}::timestamptz`);
      values.push(expiresAt.toISOString());
      paramCount++;
    }

    if (refreshToken) {
      updates.push(`refresh_token = $${paramCount}`);
      values.push(refreshToken);
      paramCount++;
    }

    const query = `
      UPDATE ${this.schema}.${this.tableName} 
      SET ${updates.join(', ')}
      WHERE integration_type = $1
      RETURNING *
    `;

    const result = await this.getClient().query(query, values);
    return result.rows.length > 0 ? this.deserialize(result.rows[0]) : null;
  }
}
