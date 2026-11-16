// Lists every table the backend migrations create, with its tenant scope:
// a scoping column of its own (organization_id, tenant_id, project_id,
// bug_report_id, allowed_projects), or a foreign key, followed transitively, to
// a table that is scoped (e.g. integration_sync_log.bug_id -> bug_reports).
//
// generate-adr.mjs passes this into its prompt for RLS / tenant-isolation
// issues, since the ADR agent has no tools to look tables up (#458).
// Interactive sessions can run it directly:
//
//   node scripts/ai-sdlc/table-inventory.mjs [migrationsDir]
//
// Limits: a textual parser, not SQL. It reads CREATE TABLE and ALTER TABLE ...
// ADD; it does not track DROP TABLE, RENAME, DROP COLUMN, or "--" / "/*" inside
// string literals. The current migrations use none of these in a way that
// changes the result; a reviewer checks the generated appendix either way.
//
// Zero-dependency. Prints a Markdown table.

import { fenceTracker } from './markdown-fence.mjs';
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
const REFERENCES = new RegExp(`\\bREFERENCES\\s+(${IDENT})`, 'i');
const TABLE_FK = new RegExp(
  `\\bFOREIGN\\s+KEY\\s*\\(\\s*("?\\w+"?)\\s*\\)\\s*REFERENCES\\s+(${IDENT})`,
  'i'
);
const TABLE_CONSTRAINT = /^(constraint|primary|foreign|unique|check|exclude|like)\b/i;

// Scans text outside '...' and "..." literals; onChar(ch, depth, i) may return true to stop.
function scan(text, start, onChar) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      quote = ch === quote ? null : quote;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    if (onChar(ch, depth, i)) {
      return i;
    }
  }
  return text.length - 1;
}

// Index of the ")" closing the "(" at `open`.
const closingParen = (sql, open) => scan(sql, open, (ch, depth) => ch === ')' && depth === 0);

// Splits at commas outside parentheses and literals.
function splitTopLevel(text) {
  const parts = [];
  let from = 0;
  scan(text, 0, (ch, depth, i) => {
    if (ch === ',' && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
    return false;
  });
  parts.push(text.slice(from));
  return parts;
}

// One item of a column list or ALTER ... ADD: { column, references } or a table FK.
function parseItem(item) {
  const part = item.trim();
  const fk = part.match(TABLE_FK);
  if (TABLE_CONSTRAINT.test(part)) {
    return fk ? { fk: { column: bareName(fk[1]), table: bareName(fk[2]) } } : null;
  }
  const name = part.match(/^("[^"]+"|\w+)/)?.[1];
  if (!name) {
    return null;
  }
  const ref = part.match(REFERENCES);
  return { column: bareName(name), references: ref ? bareName(ref[1]) : null };
}

function directScope(columns) {
  if (columns.includes('organization_id')) {
    return { kind: 'org-scoped', via: '' };
  }
  if (columns.includes('tenant_id')) {
    return { kind: 'org-scoped', via: 'tenant_id' };
  }
  if (columns.includes('project_id')) {
    return { kind: 'project-scoped', via: 'projects' };
  }
  if (columns.includes('bug_report_id')) {
    return { kind: 'project-scoped', via: 'bug_reports' };
  }
  if (columns.includes('allowed_projects')) {
    return { kind: 'project-scoped', via: 'allowed_projects' };
  }
  return null;
}

/**
 * @param {string} migrationsDir
 * @returns {{table: string, columns: string[], refs: {column: string, table: string}[],
 *            scope: {kind: string, via: string}, file: string}[]}
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
  const record = (row, item) => {
    if (!item) {
      return;
    }
    if (item.fk) {
      row.refs.push(item.fk);
      return;
    }
    if (SCOPING_COLUMNS.includes(item.column)) {
      row.columns.add(item.column);
    }
    if (item.references) {
      row.refs.push({ column: item.column, table: item.references });
    }
  };

  for (const file of files) {
    const sql = stripComments(readFileSync(join(migrationsDir, file), 'utf8'));
    for (const m of sql.matchAll(create)) {
      const name = bareName(m[1]);
      const open = m.index + m[0].length - 1;
      const row = tables.get(name) ?? { table: name, columns: new Set(), refs: [], file };
      for (const item of splitTopLevel(sql.slice(open + 1, closingParen(sql, open)))) {
        record(row, parseItem(item));
      }
      tables.set(name, row);
    }
    for (const m of sql.matchAll(alter)) {
      const row = tables.get(bareName(m[1]));
      if (!row) {
        continue;
      }
      for (const item of splitTopLevel(m[2])) {
        const add = item.trim().match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]*)$/i);
        if (add) {
          record(row, parseItem(add[1]));
        }
      }
    }
  }

  const rows = [...tables.values()].map((r) => {
    const columns = SCOPING_COLUMNS.filter((c) => r.columns.has(c));
    // bug_report_id takes bug_reports' own scope through the foreign key, so
    // children of bug_reports agree however they are linked.
    const refs =
      columns.includes('bug_report_id') && !r.refs.some((x) => x.column === 'bug_report_id')
        ? [...r.refs, { column: 'bug_report_id', table: 'bug_reports' }]
        : r.refs;
    return {
      ...r,
      columns,
      refs,
      scope: directScope(columns.filter((c) => c !== 'bug_report_id')),
    };
  });
  // Inherit scope through foreign keys until nothing changes (organizations and
  // projects are the tenant roots).
  const byName = new Map(rows.map((r) => [r.table, r]));
  const rootScope = { organizations: 'org-scoped', projects: 'project-scoped' };
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rows) {
      if (r.scope) {
        continue;
      }
      for (const ref of r.refs) {
        const kind =
          rootScope[ref.table] ?? (ref.table !== r.table && byName.get(ref.table)?.scope?.kind);
        if (kind) {
          r.scope = { kind, via: `${ref.column} → ${ref.table}` };
          changed = true;
          break;
        }
      }
    }
  }
  return rows
    .map((r) => ({ ...r, scope: r.scope ?? { kind: 'global', via: '' } }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

export const scopeLabel = ({ kind, via }) => (via ? `${kind} (via ${via})` : kind);

// Label from a table's own columns only (no foreign keys). The inventory itself
// resolves bug_report_id through bug_reports, so it may say org-scoped here.
export const suggestedScope = (columns) =>
  scopeLabel(directScope(columns) ?? { kind: 'global', via: '' });

export function inventoryMarkdown(rows) {
  return [
    '| Table | Suggested scope | Scoping columns | Created in |',
    '| ----- | --------------- | --------------- | ---------- |',
    ...rows.map(
      (r) =>
        `| ${r.table} | ${scopeLabel(r.scope)} | ${r.columns.join(', ') || 'none'} | ${r.file} |`
    ),
  ].join('\n');
}

// --- ADR appendix: written by code, so the model only argues the global tables ---

// Pulls the model's "## Global tables" list ("- table: reason") out of the ADR,
// and drops a table-inventory section the model wrote anyway (the appendix
// replaces it): only up to the next heading of the same or a higher level.
// Headings inside code fences are content.
export function extractGlobalReasons(adr) {
  const reasons = new Map();
  const kept = [];
  let mode = null;
  let dropLevel = 0;
  const inCode = fenceTracker();
  for (const line of adr.split(/\r?\n/)) {
    const code = inCode(line);
    const heading = !code && line.match(/^(#{2,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim().toLowerCase();
      if (title === 'global tables') {
        mode = 'reasons';
        dropLevel = level;
        continue;
      }
      // Only an inventory heading ("Table inventory", "Appendix B: Table
      // inventory"), not a section that mentions one.
      if (/^(?:appendix(?:\s+\w+)?\s*[:.\-–—]\s*)?table inventory(?:\s*\(.*\))?$/.test(title)) {
        mode = 'drop';
        dropLevel = level;
        continue;
      }
      if (mode && level <= dropLevel) {
        mode = null;
      }
    }
    if (mode === 'reasons') {
      // Bullets inside a code fence are examples, not reasons.
      // Accepts "- t:", "- `t`:", "- **t**:" and "- t (note):".
      const m =
        !code &&
        line.match(
          /^\s*[-*]\s*(?:\*\*|__)?`?([A-Za-z_]\w*)`?(?:\*\*|__)?\s*(?:\([^)]*\)\s*)?(?::|—|–|-)\s*(.+?)\s*$/
        );
      if (m) {
        // "- table: org-scoped: reason" overrides the computed global scope.
        const o = m[2].match(/^(org-scoped|project-scoped)\s*(?::|—|–|-)\s*(.+)$/i);
        reasons.set(
          m[1].toLowerCase(),
          o ? { kind: o[1].toLowerCase(), reason: o[2] } : { kind: 'global', reason: m[2] }
        );
      }
      continue;
    }
    if (mode !== 'drop') {
      kept.push(line);
    }
  }
  return { text: kept.join('\n').trimEnd(), reasons };
}

// A global table without a reason gets an EMPTY reason cell, so the spec's
// "no global row with an empty reason" check fails visibly; the caller warns.
// The author may override a computed global scope ("- t: org-scoped: why").
export function inventoryAppendix(rows, reasons) {
  const missing = [];
  const overridden = [];
  const body = rows.map((r) => {
    let kind = r.scope.kind;
    let why = r.scope.via ? `via ${r.scope.via}` : 'has organization_id';
    if (kind === 'global') {
      const given = reasons.get(r.table);
      kind = given?.kind ?? 'global';
      why = given?.reason ?? '';
      if (!why) {
        missing.push(r.table);
      }
      if (kind !== 'global') {
        overridden.push(r.table);
        why = `author: ${why}`;
      }
    }
    // A "|" in the model's reason would split the table cell.
    return `| ${r.table} | ${kind} | ${why.replace(/\|/g, '\\|')} |`;
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
  return { markdown, missing, overridden };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = tableInventory(process.argv[2] ?? DEFAULT_MIGRATIONS_DIR);
  console.log(inventoryMarkdown(rows));
  console.log(`\n${rows.length} tables`);
}
