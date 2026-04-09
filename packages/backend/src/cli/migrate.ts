#!/usr/bin/env node
/**
 * Migration CLI runner
 * Simple entry point for running migrations in Docker
 */

import { runMigrations } from '../db/migrations/migrate.js';

async function main() {
  try {
    console.log('Starting database migrations...');
    await runMigrations();
    console.log('Migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
