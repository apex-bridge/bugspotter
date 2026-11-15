// Tests for table-inventory.mjs. Zero-dependency: run with `node --test`
// (ci.yml runs scripts/ai-sdlc/*.test.mjs).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableInventory, inventoryMarkdown, DEFAULT_MIGRATIONS_DIR } from './table-inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'table-inventory.mjs');
const REPO_ROOT = join(HERE, '..', '..');
const DIRS = [];
after(() => DIRS.forEach((d) => rmSync(d, { recursive: true, force: true })));

function migrations(files) {
  const dir = mkdtempSync(join(tmpdir(), 'table-inventory-'));
  DIRS.push(dir);
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.table, r]));

test('reads scoping columns from CREATE TABLE, including nested parentheses', () => {
  const dir = migrations({
    '001_init.sql': `
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT CHECK (length(name) > 0)
);
CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  meta JSONB DEFAULT '{}'::jsonb
);
CREATE TABLE sessions (id UUID, bug_report_id UUID REFERENCES bug_reports(id));
CREATE TABLE users (id UUID, email TEXT);
`,
  });
  const t = byName(tableInventory(dir));
  assert.deepEqual(Object.keys(t).sort(), ['bug_reports', 'projects', 'sessions', 'users']);
  assert.deepEqual(t.bug_reports.columns, ['project_id']);
  assert.deepEqual(t.sessions.columns, ['bug_report_id']);
  assert.deepEqual(t.users.columns, []);
  assert.deepEqual(t.projects.columns, [], 'project_id must not leak in from the next table');
});

test('picks up columns added later by ALTER TABLE, several per statement', () => {
  const dir = migrations({
    '001_init.sql':
      'CREATE TABLE application.projects (id UUID);\nCREATE TABLE "api_keys" (id UUID);',
    '002_org.sql': `
ALTER TABLE application.projects
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES saas.organizations(id);
ALTER TABLE api_keys ADD COLUMN name TEXT, ADD allowed_projects UUID[], ADD COLUMN project_id UUID;
ALTER TABLE unknown_table ADD COLUMN organization_id UUID;
`,
  });
  const t = byName(tableInventory(dir));
  assert.deepEqual(t.projects.columns, ['organization_id'], 'schema prefix is stripped');
  assert.deepEqual(t.api_keys.columns, ['project_id', 'allowed_projects'], 'quotes are stripped');
  assert.equal(t.unknown_table, undefined, 'ALTER on a table never created is ignored');
  assert.equal(t.projects.file, '001_init.sql', 'file is where the table was created');
});

test('ignores CREATE TABLE and columns inside comments', () => {
  const dir = migrations({
    '001_init.sql': `
-- CREATE TABLE above was dropped; organization_id lives elsewhere
/* CREATE TABLE ghost (organization_id UUID); */
CREATE TABLE real_table (
  id UUID -- , organization_id UUID  (commented-out column)
);
`,
  });
  const rows = tableInventory(dir);
  assert.deepEqual(
    rows.map((r) => r.table),
    ['real_table']
  );
  assert.deepEqual(rows[0].columns, []);
});

test('markdown lists every table, "none" for unscoped ones', () => {
  const md = inventoryMarkdown([
    { table: 'a', columns: ['organization_id'], file: '001.sql' },
    { table: 'b', columns: [], file: '002.sql' },
  ]);
  assert.match(md, /^\| Table \| Scoping columns \| Created in \|$/m);
  assert.match(md, /^\| a \| organization_id \| 001\.sql \|$/m);
  assert.match(md, /^\| b \| none \| 002\.sql \|$/m);
});

test('real migrations: one row per CREATE TABLE, known scoping facts hold', () => {
  const dir = join(REPO_ROOT, DEFAULT_MIGRATIONS_DIR);
  const rows = tableInventory(dir);
  // Independent count: distinct CREATE TABLE names at line start in the SQL files.
  const names = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(
      /^\s*CREATE TABLE (?:IF NOT EXISTS )?([\w.]+)/gim
    )) {
      names.add(m[1].split('.').pop().toLowerCase());
    }
  }
  assert.equal(rows.length, names.size);
  const t = byName(rows);
  assert.ok(t.projects.columns.includes('organization_id'), 'added by ALTER TABLE in 001');
  assert.ok(t.bug_reports.columns.includes('organization_id'));
  assert.ok(t.bug_reports.columns.includes('project_id'));
  assert.deepEqual(t.api_keys.columns, ['allowed_projects']);
  assert.deepEqual(t.sessions.columns, ['bug_report_id']);
  assert.deepEqual(t.users.columns, []);
  assert.deepEqual(t.email_verification_tokens.columns, [], 'global table from 019');
});

test('CLI prints the table and a count', () => {
  const dir = migrations({ '001.sql': 'CREATE TABLE t1 (organization_id UUID);' });
  const out = execFileSync('node', [SCRIPT, dir], { encoding: 'utf8' });
  assert.match(out, /\| t1 \| organization_id \| 001\.sql \|/);
  assert.match(out, /1 tables/);
});
