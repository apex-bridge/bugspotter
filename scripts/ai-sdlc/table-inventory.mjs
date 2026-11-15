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
// Index of the ")" closing the "(" at `open`, ignoring parentheses inside
// '...' and "..." literals (e.g. a JSON default).
function closingParen(sql, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      quote = ch === quote ? null : quote;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && --depth === 0) {
      return i;
    }
  }
  return sql.length - 1;
}

// Splits a column list at commas outside parentheses and literals.
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      quote = ch === quote ? null : quote;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

// Names declared in a CREATE TABLE column list: the first identifier of each
// top-level item, skipping table constraints. Defaults, CHECK bodies and
// REFERENCES targets are not column declarations.
const TABLE_CONSTRAINT = /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;
export function declaredColumns(columnList) {
  return splitTopLevel(columnList)
    .map((part) => part.trim())
    .filter((part) => part && !TABLE_CONSTRAINT.test(part))
    .map((part) =>
      part
        .match(/^("[^"]+"|\w+)/)?.[1]
        .replaceAll('"', '')
        .toLowerCase()
    )
    .filter(Boolean);
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
      const open = m.index + m[0].length - 1;
      const columnList = sql.slice(open + 1, closingParen(sql, open));
      const row = tables.get(name) ?? { table: name, columns: new Set(), file };
      for (const c of declaredColumns(columnList)) {
        if (SCOPING_COLUMNS.includes(c)) {
          row.columns.add(c);
        }
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

// --- ADR appendix: written by code, so the model only argues the global tables ---

// Scope cell exactly as the spec checks expect (org-scoped / project-scoped /
// global); the "via ..." part becomes the reason.
export function scopeAndReason(columns) {
  const [, scope, via] = suggestedScope(columns).match(/^(\S+)(?: \((.+)\))?$/);
  const reason = via ?? (scope === 'org-scoped' ? 'has organization_id' : '');
  return { scope, reason };
}

// Pulls the model's "## Global tables" list ("- table: reason") out of the ADR,
// and drops any table inventory the model wrote anyway (the appendix replaces it).
export function extractGlobalReasons(adr) {
  const reasons = new Map();
  const kept = [];
  let skipping = false;
  for (const line of adr.split(/\r?\n/)) {
    const heading = line.match(/^(#{2,3})\s+(.*)$/);
    if (heading) {
      const title = heading[2].trim().toLowerCase();
      if (title === 'global tables' || /table inventory/.test(title)) {
        skipping = title === 'global tables' ? 'reasons' : 'drop';
        continue;
      }
      if (heading[1] === '##') {
        skipping = false;
      }
    }
    if (skipping === 'reasons') {
      const m = line.match(/^\s*[-*]\s*`?([A-Za-z_]\w*)`?\s*(?::|—|–|-)\s*(.+?)\s*$/);
      if (m) {
        reasons.set(m[1].toLowerCase(), m[2]);
      }
      continue;
    }
    if (!skipping) {
      kept.push(line);
    }
  }
  return { text: kept.join('\n').trimEnd(), reasons };
}

export function inventoryAppendix(rows, reasons) {
  const missing = [];
  const body = rows.map((r) => {
    const { scope, reason } = scopeAndReason(r.columns);
    let why = reason;
    if (scope === 'global') {
      why = reasons.get(r.table);
      if (!why) {
        missing.push(r.table);
        why = 'REASON MISSING - reviewer must add one';
      }
    }
    return `| ${r.table} | ${scope} | ${why} |`;
  });
  const markdown = [
    '## Appendix: Table inventory',
    '',
    `Generated from the migrations by \`scripts/ai-sdlc/table-inventory.mjs\` (${rows.length} tables); reasons for global tables from the ADR author.`,
    '',
    '### Table inventory',
    '',
    '| Table | Scope | Reason |',
    '| ----- | ----- | ------ |',
    ...body,
  ].join('\n');
  return { markdown, missing };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = tableInventory(process.argv[2] ?? DEFAULT_MIGRATIONS_DIR);
  console.log(inventoryMarkdown(rows));
  console.log(`\n${rows.length} tables`);
}
