import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';

describe('Migration 027 (oidc_idp_config) idempotency against a real database', () => {
  let db: DatabaseClient;

  beforeAll(() => {
    db = createDatabaseClient();
  });

  afterAll(async () => {
    await db.close();
  });

  it('re-executing the migration file against an already-migrated schema succeeds and leaves exactly one table and one trigger', async () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const migrationPath = join(__dirname, '../../src/db/migrations/027_oidc_idp_config.sql');
    const sql = readFileSync(migrationPath, 'utf8');

    // Second application of this file's SQL against a database that
    // already has the table and trigger from the first (global-setup)
    // migration run. Must not throw — an unguarded CREATE TRIGGER would
    // fail here with a duplicate_object error.
    await db.query(sql);

    const tables = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'saas' AND table_name = 'oidc_idp_config'`
    );
    expect(tables.rows).toHaveLength(1);

    const triggers = await db.query(
      `SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'saas.oidc_idp_config'::regclass
         AND tgname = 'update_oidc_idp_config_updated_at'`
    );
    expect(triggers.rows).toHaveLength(1);
  });
});
