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
// Limits: a textual parser, not SQL. It reads CREATE TABLE, ALTER TABLE ...
// ADD and ALTER TABLE ... DROP CONSTRAINT (a foreign key, by its explicit name
// or Postgres's default <table>_<column>_fkey). It does not track DROP TABLE,
// RENAME, DROP COLUMN, composite foreign keys, or "--" / "/*" inside string
// literals; the current migrations use none of these in a way that changes the
// result. A reviewer checks the generated appendix either way.
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
    const named = part.match(/^CONSTRAINT\s+("[^"]+"|\w+)/i);
    return fk
      ? {
          fk: { column: bareName(fk[1]), table: bareName(fk[2]) },
          constraint: named ? bareName(named[1]) : null,
        }
      : null;
  }
  const name = part.match(/^("[^"]+"|\w+)/)?.[1];
  if (!name) {
    return null;
  }
  const ref = part.match(REFERENCES);
  // "rule_id UUID CONSTRAINT child_rule REFERENCES rules(id)": a named
  // column-level foreign key, which a later DROP CONSTRAINT child_rule removes.
  const named = ref && part.match(/\bCONSTRAINT\s+("[^"]+"|\w+)\s+REFERENCES\b/i);
  return {
    column: bareName(name),
    references: ref ? bareName(ref[1]) : null,
    constraint: named ? bareName(named[1]) : null,
  };
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
    // The constraint name lets a later DROP CONSTRAINT remove the reference.
    const fkName = (column) => item.constraint ?? `${row.table}_${column}_fkey`;
    if (item.fk) {
      row.refs.push({ ...item.fk, constraint: fkName(item.fk.column) });
      return;
    }
    if (SCOPING_COLUMNS.includes(item.column)) {
      row.columns.add(item.column);
    }
    if (item.references) {
      row.refs.push({
        column: item.column,
        table: item.references,
        constraint: fkName(item.column),
      });
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
        const drop = item.trim().match(/^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?("[^"]+"|\w+)/i);
        if (drop) {
          const name = bareName(drop[1]);
          row.refs = row.refs.filter((r) => r.constraint !== name);
          continue;
        }
        const add = item.trim().match(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]*)$/i);
        if (add) {
          record(row, parseItem(add[1]));
        }
      }
    }
  }

  const rows = [...tables.values()].map((r) => {
    const columns = SCOPING_COLUMNS.filter((c) => r.columns.has(c));
    // A table whose only scoping column is bug_report_id takes bug_reports'
    // scope, with or without a declared foreign key. A table that also has its
    // own project_id or organization_id keeps that, as the more specific scope.
    const refs =
      columns.includes('bug_report_id') && !r.refs.some((x) => x.column === 'bug_report_id')
        ? [...r.refs, { column: 'bug_report_id', table: 'bug_reports' }]
        : r.refs;
    return {
      ...r,
      columns,
      refs,
      // bug_report_id is resolved through the bug_reports foreign key below.
      scope: directScope(columns),
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
        if (ref.table === r.table) {
          continue;
        }
        const kind = rootScope[ref.table] ?? byName.get(ref.table)?.scope?.kind;
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

// One reason bullet, indented up to 3 spaces: "- t: why", "- `t`: why",
// "- **t**: why", "- **t:** why", "- t (note): why", "1. t: why",
// "- application.t: why" (schema dropped).
const REASON_BULLET =
  /^( {0,3})(?:[-*+]|\d+[.)])\s+(?:\*\*|__)?`?(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)`?(?:\*\*|__)?\s*(?:\([^)]*\)\s*)?(?::|—|–|-)(?:\*\*|__)?\s*(.+?)\s*$/;

// An ATX heading (up to 3 leading spaces, optional closing #s) as
// [level, normalised title]: "## **Global tables:** ##" -> [2, "global tables"].
function atxHeading(line) {
  const h = line.match(/^ {0,3}(#{2,6})\s+(.*?)(?:\s+#+)?\s*$/);
  if (!h) {
    return null;
  }
  const title = h[2].replace(/[*_`]/g, '').trim().replace(/:$/, '').trim().toLowerCase();
  return [h[1].length, title];
}

// Only an inventory heading ("Table inventory", "Appendix B: Table inventory"),
// not a section that mentions one.
const INVENTORY_TITLE = /^(?:appendix(?:\s+\w+)?\s*[:.\-–—]\s*)?table inventory(?:\s*\(.*\))?$/;

// Pulls the model's "## Global tables" list ("- table: reason") out of the ADR,
// and drops a table-inventory section the model wrote anyway (the appendix
// replaces it): only up to the next heading of the same or a higher level.
// Headings inside code fences are content. In "Global tables" only reason
// bullets (and their indented continuation lines) are taken out; any other
// line stays, under the heading, so nothing the model wrote is lost. With
// `tables`, a bullet is a reason only when it names one of them, so a
// "- Note: ..." bullet stays in the ADR.
export function extractGlobalReasons(adr, { tables } = {}) {
  const known = tables ? new Set([...tables].map((t) => t.toLowerCase())) : null;
  const reasons = new Map();
  const kept = [];
  let mode = null; // null | 'reasons' | 'drop'
  let dropLevel = 0;
  let reasonsLevel = 0;
  let outerDrop = 0; // a "Global tables" nested in a dropped inventory section
  let resumeLevel = 0; // an inventory nested in "Global tables": its level
  let heading = null; // the "Global tables" heading, until it is kept
  let leftover = [];
  let lastReason = null;
  // Indent of the section's first reason bullet: the list's own level. A
  // bullet indented deeper is a sub-point of the one above it.
  let baseIndent = null;
  const endReasons = () => {
    // Inside a dropped inventory section the leftovers go with it.
    if (!outerDrop && leftover.some((l) => l.trim())) {
      kept.push(...(heading === null ? [] : [heading]), ...leftover);
      heading = null;
    }
    leftover = [];
    lastReason = null;
  };
  const inCode = fenceTracker();
  for (const line of adr.split(/\r?\n/)) {
    const code = inCode(line);
    const h = !code && atxHeading(line);
    if (h) {
      const [level, title] = h;
      if (mode === 'reasons' && level <= reasonsLevel) {
        endReasons();
        mode = outerDrop && level > outerDrop ? 'drop' : null;
        dropLevel = outerDrop;
        outerDrop = 0;
      }
      if (mode === 'drop' && level <= dropLevel) {
        // A sibling of an inventory nested in "Global tables" is back in
        // Global tables: "### Platform tables" after "### Table inventory".
        mode = resumeLevel && level > resumeLevel ? 'reasons' : null;
        reasonsLevel = resumeLevel || reasonsLevel;
        resumeLevel = 0;
      }
      if (title === 'global tables') {
        // A Global tables nested in another one keeps the outer drop boundary.
        outerDrop = mode === 'drop' ? dropLevel : mode === 'reasons' ? outerDrop : 0;
        mode = 'reasons';
        reasonsLevel = level;
        baseIndent = null;
        heading = line;
        continue;
      }
      if (INVENTORY_TITLE.test(title)) {
        // Inside a section being dropped already (an inventory, or a Global
        // tables nested in one), the outer boundary stays: "### Table
        // inventory" under "## Appendix: Table inventory" must not let a
        // sibling "### Scoped tables" end the drop.
        const outer = mode === 'drop' ? dropLevel : mode === 'reasons' ? outerDrop : 0;
        if (mode === 'reasons') {
          endReasons();
          resumeLevel = outerDrop ? 0 : reasonsLevel;
        } else if (mode !== 'drop') {
          resumeLevel = 0;
        }
        mode = 'drop';
        dropLevel = outer || level;
        outerDrop = 0;
        continue;
      }
    }
    if (mode === 'reasons') {
      // Bullets inside a code fence are examples, not reasons; a bullet
      // indented deeper than the list's first reason is a sub-point, not a table.
      const m = !code && line.match(REASON_BULLET);
      if (
        m &&
        (!known || known.has(m[2].toLowerCase())) &&
        m[1].length <= (baseIndent ?? m[1].length)
      ) {
        baseIndent ??= m[1].length;
        // "- table: org-scoped: reason" overrides the computed global scope.
        const o = m[3].match(/^(org-scoped|project-scoped)\s*(?::|—|–|-)\s*(.+)$/i);
        lastReason = o
          ? { kind: o[1].toLowerCase(), reason: o[2] }
          : { kind: 'global', reason: m[3] };
        reasons.set(m[2].toLowerCase(), lastReason);
      } else if (
        lastReason &&
        !code &&
        !h && // an indented "  ### Platform" is a heading, kept as section content
        /^\s+\S/.test(line) &&
        !/^\s*(?:[-*+]|\d+[.)])\s/.test(line)
      ) {
        // An indented line under a reason bullet continues it.
        lastReason.reason += ` ${line.trim()}`;
      } else {
        lastReason = null;
        leftover.push(line);
      }
      continue;
    }
    if (mode !== 'drop') {
      kept.push(line);
    }
  }
  if (mode === 'reasons') {
    endReasons();
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
