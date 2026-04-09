#!/usr/bin/env node
/**
 * Copy SQL migration files to dist directory after TypeScript compilation
 */
import { mkdirSync, readdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const SRC_MIGRATIONS = 'src/db/migrations';
const DIST_MIGRATIONS = 'dist/db/migrations';

// Create destination directory
mkdirSync(DIST_MIGRATIONS, { recursive: true });

// Copy all .sql files
const files = readdirSync(SRC_MIGRATIONS).filter((f) => f.endsWith('.sql'));

files.forEach((file) => {
  const src = join(SRC_MIGRATIONS, file);
  const dest = join(DIST_MIGRATIONS, file);
  copyFileSync(src, dest);
});

console.log(`✓ Copied ${files.length} migration files to ${DIST_MIGRATIONS}`);
