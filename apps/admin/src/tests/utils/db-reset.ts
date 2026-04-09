/**
 * Database Reset Utility for E2E Tests
 * Provides utilities to truncate tables and reset database to clean state
 */

import pg from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedConnectionString: string | undefined;

/**
 * Get the database connection string from the test environment file
 */
async function getConnectionString(): Promise<string> {
  if (cachedConnectionString) {
    return cachedConnectionString;
  }

  // Try to read from .test-env file created by global-setup
  const envFilePath = path.resolve(__dirname, '../../e2e/.test-env');
  try {
    const envContent = await fs.readFile(envFilePath, 'utf-8');
    const match = envContent.match(/DATABASE_URL=(.+)/);
    if (match) {
      cachedConnectionString = match[1].trim();
      return cachedConnectionString;
    }
  } catch {
    // Fall back to environment variable
  }

  if (process.env.DATABASE_URL) {
    cachedConnectionString = process.env.DATABASE_URL;
    return cachedConnectionString;
  }

  throw new Error('DATABASE_URL not found. Make sure global setup has run.');
}

/**
 * Truncate all tables in the database
 * Resets the database to a clean state for testing
 */
export async function truncateAllTables(): Promise<void> {
  const connectionString = await getConnectionString();
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();

    // Get all table names from application schema
    const result = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'application' 
        AND tablename != 'migrations'
      ORDER BY tablename;
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tables = result.rows.map((row: any) => row.tablename);
    if (tables.length === 0) {
      console.log('No tables to truncate');
      return;
    }

    // Disable triggers temporarily to avoid foreign key issues
    await client.query('SET session_replication_role = replica;');

    // Truncate all tables
    for (const table of tables) {
      await client.query(`TRUNCATE TABLE "application"."${table}" CASCADE;`);
    }

    // Re-enable triggers
    await client.query('SET session_replication_role = DEFAULT;');

    console.log(`✓ Truncated ${tables.length} tables`);
  } finally {
    await client.end();
  }
}

/**
 * Reset sequences to start from 1
 * Useful after truncating tables to ensure consistent IDs
 */
export async function resetSequences(): Promise<void> {
  const connectionString = await getConnectionString();
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();

    // Get all sequences
    const result = await client.query(`
      SELECT sequence_name 
      FROM information_schema.sequences 
      WHERE sequence_schema = 'application';
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sequences = result.rows.map((row: any) => row.sequence_name);
    // Reset each sequence to 1
    for (const sequence of sequences) {
      await client.query(`ALTER SEQUENCE "application"."${sequence}" RESTART WITH 1;`);
    }

    if (sequences.length > 0) {
      console.log(`✓ Reset ${sequences.length} sequences`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Re-seed reference tables that were truncated
 * These tables contain essential data that must exist for the system to function
 */
export async function reseedReferenceTables(): Promise<void> {
  const connectionString = await getConnectionString();
  const client = new pg.Client({ connectionString });

  try {
    await client.connect();

    // Re-seed project_roles table (required for project_members foreign key)
    await client.query(`
      INSERT INTO application.project_roles (name, rank, description) VALUES
        ('owner', 1, 'Project owner with full control and ownership'),
        ('admin', 2, 'Administrative access with project management capabilities'),
        ('member', 3, 'Standard project member with read/write access'),
        ('viewer', 4, 'Read-only access to project data')
      ON CONFLICT (name) DO NOTHING;
    `);

    // Re-seed built-in integrations (seeded by migration 014)
    // These MUST exist for integration tests to pass
    await client.query(`
      INSERT INTO application.integrations (type, name, description, status, config) VALUES
        ('jira', 'Jira', 'Atlassian Jira ticket integration', 'not_configured', '{}')
      ON CONFLICT (type) DO NOTHING;
    `);

    console.log(`✓ Re-seeded reference tables (project_roles, integrations)`);
  } finally {
    await client.end();
  }
}

/**
 * Full database reset - truncate all tables and reset sequences
 * This is the main utility function tests should use
 */
export async function resetDatabase(): Promise<void> {
  await truncateAllTables();
  await resetSequences();
  await reseedReferenceTables();
}
