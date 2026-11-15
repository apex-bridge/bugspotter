// Lists every table the backend migrations create, with the tenant-scoping
// columns each one has (from its CREATE TABLE, or added later by ALTER TABLE).
//
// generate-adr.mjs passes this into its prompt for database-related issues:
// the ADR agent has no tools, and without the list it either invents tables or
// writes that it "cannot run the grep" (ADR-0045's first draft, PR #457).
// Interactive sessions can run it directly:
//
//   node scripts/ai-sdlc/table-inventory.mjs [migrationsDir]
//
// Zero-dependency. Prints a Markdown table.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIGRATIONS_DIR = 'packages/backend/src/db/migrations';

// Columns that tie a row to a tenant directly (organization_id; tenant_id in
// oidc_idp_config, 027_oidc_idp_config.sql:21) or through a parent row
// (project_id, bug_report_id) or a list of projects (api_keys).
export const SCOPING_COLUMNS = [
  'organization_id',
  'tenant_id',
  'project_id',
  'bug_report_id',
  'allowed_projects',
];

const stripComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
const bareName = (name) => name.replaceAll('"', '').split('.').pop().trim().toLowerCase();
// A table name, optionally schema-qualified, with either part optionally quoted:
// projects, application.projects, "api_keys", "application"."projects".
const IDENT = '(?:"[^"]+"|\\w+)(?:\\s*\\.\\s*(?:"[^"]+"|\\w+))?';
const columnRe = new RegExp(`\\b(${SCOPING_COLUMNS.join('|')})\\b`, 'gi');

// Text of the parenthesised column list that starts at `open` (an index of "(").
function parenBlock(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') {
      depth++;
    } else if (sql[i] === ')') {
      depth--;
      if (depth === 0) {
        return sql.slice(open, i + 1);
      }
    }
  }
  return sql.slice(open);
}

/**
 * @param {string} migrationsDir
 * @returns {{table: string, columns: string[], file: string}[]}
 */
export function tableInventory(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const tables = new Map();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const create = new RegExp(
    `\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})\\s*\\(`,
    'gi'
  );
  const alter = new RegExp(
    `\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(${IDENT})\\s+([^;]*)`,
    'gi'
  );
  const addColumn = new RegExp(
    `\\bADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?(${SCOPING_COLUMNS.join('|')})\\b`,
    'gi'
  );

  for (const file of files) {
    const sql = stripComments(readFileSync(join(migrationsDir, file), 'utf8'));
    for (const m of sql.matchAll(create)) {
      const name = bareName(m[1]);
      const cols = parenBlock(sql, m.index + m[0].length - 1);
      const row = tables.get(name) ?? { table: name, columns: new Set(), file };
      for (const c of cols.matchAll(columnRe)) {
        row.columns.add(c[1].toLowerCase());
      }
      tables.set(name, row);
    }
    for (const m of sql.matchAll(alter)) {
      const row = tables.get(bareName(m[1]));
      if (!row) {
        continue;
      }
      for (const c of m[2].matchAll(addColumn)) {
        row.columns.add(c[1].toLowerCase());
      }
    }
  }
  return [...tables.values()]
    .map((r) => ({ ...r, columns: SCOPING_COLUMNS.filter((c) => r.columns.has(c)) }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

// Mechanical first guess from the columns, so the ADR author confirms a scope
// instead of deriving every one (and only argues the global ones).
export function suggestedScope(columns) {
  if (columns.includes('organization_id')) {
    return 'org-scoped';
  }
  if (columns.includes('tenant_id')) {
    return 'org-scoped (via tenant_id)';
  }
  if (columns.includes('project_id')) {
    return 'project-scoped (via projects)';
  }
  if (columns.includes('bug_report_id')) {
    return 'project-scoped (via bug_reports)';
  }
  if (columns.includes('allowed_projects')) {
    return 'project-scoped (via allowed_projects)';
  }
  return 'global';
}

export function inventoryMarkdown(rows) {
  return [
    '| Table | Suggested scope | Scoping columns | Created in |',
    '| ----- | --------------- | --------------- | ---------- |',
    ...rows.map(
      (r) =>
        `| ${r.table} | ${suggestedScope(r.columns)} | ${r.columns.join(', ') || 'none'} | ${r.file} |`
    ),
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = tableInventory(process.argv[2] ?? DEFAULT_MIGRATIONS_DIR);
  console.log(inventoryMarkdown(rows));
  console.log(`\n${rows.length} tables`);
}
