/**
 * Database migration runner
 * Applies SQL migrations in order and tracks applied migrations
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config, validateConfig } from '../../config.js';
import { buildSslConfig } from '../ssl.js';
import { executeWithRetry } from '../retry.js';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Migration {
  name: string;
  path: string;
}

/**
 * Get all migration files sorted by name
 */
function getMigrationFiles(): Migration[] {
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir);

  return files
    .filter((file) => {
      return file.endsWith('.sql') && file !== 'schema.sql';
    })
    .sort()
    .map((file) => {
      return {
        name: file,
        path: path.join(migrationsDir, file),
      };
    });
}

/**
 * Create migrations_history table if it doesn't exist
 */
async function ensureMigrationsTable(pool: pg.Pool): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS public.migrations_history (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await pool.query(query);
}

/**
 * Get list of applied migrations
 */
async function getAppliedMigrations(pool: pg.Pool): Promise<Set<string>> {
  const result = await pool.query<{ migration_name: string }>(
    'SELECT migration_name FROM public.migrations_history'
  );
  return new Set(
    result.rows.map((row) => {
      return row.migration_name;
    })
  );
}

/**
 * Apply a single migration
 */
async function applyMigration(pool: pg.Pool, migration: Migration): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Read and execute migration SQL
    const sql = fs.readFileSync(migration.path, 'utf-8');
    await client.query(sql);

    // Record migration as applied
    await client.query('INSERT INTO public.migrations_history (migration_name) VALUES ($1)', [
      migration.name,
    ]);

    await client.query('COMMIT');
    console.log(`✓ Applied migration: ${migration.name}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`✗ Failed to apply migration: ${migration.name}`);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run all pending migrations
 */
async function runMigrations(): Promise<void> {
  console.log('Starting database migrations...\n');

  // Validate configuration (migrations only need database config)
  validateConfig('migration');

  const sslOverride = buildSslConfig(config.database.url);
  const pool = new Pool({
    connectionString: sslOverride?.connectionString ?? config.database.url,
    ...(sslOverride !== undefined && { ssl: sslOverride.ssl }),
  });

  try {
    // Test connection with retry (DB may not be query-ready even if TCP port is open)
    await executeWithRetry(() => pool.query('SELECT NOW()'), {
      maxAttempts: config.database.retryAttempts,
      baseDelay: config.database.retryDelayMs,
    });
    console.log('✓ Database connection established\n');

    // Set search_path to match the application schema configuration
    // This ensures migrations are executed in the correct schema context
    await pool.query('SET search_path TO application, saas, public');
    console.log('✓ Schema search_path set to: application, saas, public\n');

    // Ensure migrations table exists
    await ensureMigrationsTable(pool);

    // Get migrations
    const allMigrations = getMigrationFiles();
    const appliedMigrations = await getAppliedMigrations(pool);

    const pendingMigrations = allMigrations.filter((m) => {
      return !appliedMigrations.has(m.name);
    });

    if (pendingMigrations.length === 0) {
      console.log('No pending migrations. Database is up to date.');
      return;
    }

    console.log(`Found ${pendingMigrations.length} pending migration(s):\n`);

    // Apply each pending migration
    for (const migration of pendingMigrations) {
      await applyMigration(pool, migration);
    }

    console.log('\n✓ All migrations completed successfully!');
  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations if this file is executed directly
const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] === modulePath) {
  runMigrations().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runMigrations };
