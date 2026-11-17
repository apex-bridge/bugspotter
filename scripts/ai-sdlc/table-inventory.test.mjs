// Tests for table-inventory.mjs. Zero-dependency: run with `node --test`
// (ci.yml runs scripts/ai-sdlc/*.test.mjs).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  tableInventory,
  inventoryMarkdown,
  scopeLabel,
  extractGlobalReasons,
  inventoryAppendix,
  DEFAULT_MIGRATIONS_DIR,
} from './table-inventory.mjs';

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
    {
      table: 'a',
      columns: ['organization_id'],
      scope: { kind: 'org-scoped', via: '' },
      file: '001.sql',
    },
    { table: 'b', columns: [], scope: { kind: 'global', via: '' }, file: '002.sql' },
  ]);
  assert.match(md, /^\| Table \| Suggested scope \| Scoping columns \| Created in \|$/m);
  assert.match(md, /^\| a \| org-scoped \| organization_id \| 001\.sql \|$/m);
  assert.match(md, /^\| b \| global \| none \| 002\.sql \|$/m);
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
  assert.match(out, /\| t1 \| org-scoped \| organization_id \| 001\.sql \|/);
  assert.match(out, /1 tables/);
});

test('scope from own columns: organization first, then project paths, else global', () => {
  const dir = migrations({
    '001.sql': `
CREATE TABLE both_cols (organization_id UUID, project_id UUID);
CREATE TABLE proj (project_id UUID);
CREATE TABLE keys (allowed_projects UUID[]);
CREATE TABLE plain (id UUID);
`,
  });
  const t = byName(tableInventory(dir));
  assert.equal(scopeLabel(t.both_cols.scope), 'org-scoped');
  assert.equal(scopeLabel(t.proj.scope), 'project-scoped (via projects)');
  assert.equal(scopeLabel(t.keys.scope), 'project-scoped (via allowed_projects)');
  assert.equal(scopeLabel(t.plain.scope), 'global');
});

test('tenant_id counts as an organization scope (oidc_idp_config)', () => {
  const dir = migrations({
    '027.sql':
      'CREATE TABLE oidc_idp_config (id UUID, tenant_id UUID NOT NULL REFERENCES organizations(id));',
  });
  const [row] = tableInventory(dir);
  assert.deepEqual(row.columns, ['tenant_id']);
  assert.equal(scopeLabel(row.scope), 'org-scoped (via tenant_id)');
  const real = byName(tableInventory(join(REPO_ROOT, DEFAULT_MIGRATIONS_DIR)));
  assert.deepEqual(real.oidc_idp_config.columns, ['tenant_id'], 'real 027 migration');
});

test('schema and table quoted separately are parsed, in CREATE and ALTER', () => {
  const dir = migrations({
    '001.sql': [
      'CREATE TABLE "application"."projects" (id UUID);',
      'CREATE TABLE IF NOT EXISTS application . "api_keys" (id UUID);',
      'ALTER TABLE "application"."api_keys" ADD COLUMN organization_id UUID;',
      'ALTER TABLE ONLY "application".projects ADD COLUMN IF NOT EXISTS project_id UUID;',
    ].join('\n'),
  });
  const t = byName(tableInventory(dir));
  assert.deepEqual(Object.keys(t).sort(), ['api_keys', 'projects']);
  assert.deepEqual(t.api_keys.columns, ['organization_id']);
  assert.deepEqual(t.projects.columns, ['project_id']);
});

test('scope label shows the via-path only when there is one', () => {
  assert.equal(scopeLabel({ kind: 'org-scoped', via: '' }), 'org-scoped');
  assert.equal(
    scopeLabel({ kind: 'project-scoped', via: 'bug_id → bug_reports' }),
    'project-scoped (via bug_id → bug_reports)'
  );
});

test('global reasons are read from the ADR and a model-written inventory is dropped', () => {
  const adr = [
    '# ADR-0001: x',
    '## Decision',
    'body',
    '## Appendix A: Table inventory',
    '### Table inventory',
    '| users | global | model row |',
    '## Global tables',
    '- users: identities span organizations',
    '- `legal_entities` — platform-wide seller records',
    '',
  ].join('\n');
  const { text, reasons } = extractGlobalReasons(adr);
  assert.equal(text, '# ADR-0001: x\n## Decision\nbody');
  assert.deepEqual(reasons.get('users'), {
    kind: 'global',
    reason: 'identities span organizations',
  });
  assert.deepEqual(reasons.get('legal_entities'), {
    kind: 'global',
    reason: 'platform-wide seller records',
  });
});

test('appendix: every table once, spec-check format, missing reason left empty, override applied', () => {
  const org = { kind: 'org-scoped', via: '' };
  const glob = { kind: 'global', via: '' };
  const rows = [
    { table: 'projects', columns: ['organization_id'], scope: org, file: '001.sql' },
    {
      table: 'sync_log',
      columns: [],
      scope: { kind: 'org-scoped', via: 'bug_id → bug_reports' },
      file: '001.sql',
    },
    { table: 'users', columns: [], scope: glob, file: '001.sql' },
    { table: 'permissions', columns: [], scope: glob, file: '001.sql' },
    { table: 'oauth_tokens', columns: [], scope: glob, file: '001.sql' },
  ];
  const reasons = new Map([
    ['users', { kind: 'global', reason: 'cross-org' }],
    ['oauth_tokens', { kind: 'project-scoped', reason: 'tokens belong to a project integration' }],
  ]);
  const { markdown, missing, overridden } = inventoryAppendix(rows, reasons);
  assert.match(markdown, /^### Table inventory$/m);
  assert.match(markdown, /^\| projects \| org-scoped \| has organization_id \|$/m);
  assert.match(markdown, /^\| sync_log \| org-scoped \| via bug_id → bug_reports \|$/m);
  assert.match(markdown, /^\| users \| global \| cross-org \|$/m);
  assert.match(
    markdown,
    /^\| permissions \| global \| {2}\|$/m,
    'empty, so the spec check fails visibly'
  );
  assert.match(
    markdown,
    /^\| oauth_tokens \| project-scoped \| author: tokens belong to a project integration \|$/m
  );
  assert.deepEqual(missing, ['permissions']);
  assert.deepEqual(overridden, ['oauth_tokens']);
});

test('scope is inherited through foreign keys, transitively, ignoring self-references', () => {
  const dir = migrations({
    '001.sql': [
      'CREATE TABLE organizations (id UUID);',
      'CREATE TABLE bug_reports (id UUID, organization_id UUID);',
      'CREATE TABLE sync_log (id UUID, bug_id UUID REFERENCES bug_reports(id));',
      'CREATE TABLE sync_detail (id UUID, log UUID, CONSTRAINT fk FOREIGN KEY (log) REFERENCES sync_log(id));',
      'CREATE TABLE tree (id UUID, parent UUID REFERENCES tree(id));',
      'CREATE TABLE seats (id UUID, owner UUID REFERENCES organizations(id));',
      'CREATE TABLE late (id UUID);',
      'ALTER TABLE late ADD CONSTRAINT late_fk FOREIGN KEY (sid) REFERENCES sync_detail(id);',
    ].join('\n'),
  });
  const t = byName(tableInventory(dir));
  assert.deepEqual(t.sync_log.scope, { kind: 'org-scoped', via: 'bug_id → bug_reports' });
  assert.deepEqual(t.sync_detail.scope, { kind: 'org-scoped', via: 'log → sync_log' });
  assert.deepEqual(
    t.late.scope,
    { kind: 'org-scoped', via: 'sid → sync_detail' },
    'via ALTER, two hops'
  );
  assert.deepEqual(t.seats.scope, { kind: 'org-scoped', via: 'owner → organizations' });
  assert.deepEqual(t.tree.scope, { kind: 'global', via: '' }, 'a self-reference confers nothing');
  assert.deepEqual(t.organizations.scope, { kind: 'global', via: '' });
});

test('real migrations: FK-linked child tables are no longer global', () => {
  const t = byName(tableInventory(join(REPO_ROOT, DEFAULT_MIGRATIONS_DIR)));
  for (const name of [
    'integration_sync_log',
    'notification_history',
    'invoice_lines',
    'api_key_audit_log',
    'api_key_usage',
    'api_key_rate_limits',
    'notification_rule_channels',
  ]) {
    assert.notEqual(t[name].scope.kind, 'global', name);
    assert.match(t[name].scope.via, / → /, `${name} scope comes from a foreign key`);
  }
  assert.equal(t.users.scope.kind, 'global');
});

test('dropping a model-written inventory stops at the next heading of the same level; fences are content', () => {
  const adr = [
    '## Decision',
    '### Table inventory',
    '| x | global | y |',
    '### Self-hosted mode',
    'KEEP_SELF_HOSTED',
    '```md',
    '## Global tables',
    '- not_a_reason: inside a fence',
    '```',
    '## Global tables',
    '- users: shared',
  ].join('\n');
  const { text, reasons } = extractGlobalReasons(adr);
  assert.ok(text.includes('### Self-hosted mode\nKEEP_SELF_HOSTED'));
  assert.ok(!text.includes('| x | global | y |'));
  assert.ok(text.includes('- not_a_reason: inside a fence'), 'fenced lines stay as content');
  assert.equal(reasons.has('not_a_reason'), false);
  assert.deepEqual(reasons.get('users'), { kind: 'global', reason: 'shared' });
});

test('only declared columns count: not JSON defaults, CHECK bodies or REFERENCES targets', () => {
  const dir = migrations({
    '001.sql': [
      `CREATE TABLE audit_events (id UUID, metadata JSONB DEFAULT '{"organization_id": null}'::jsonb);`,
      'CREATE TABLE links (id UUID, parent UUID REFERENCES bug_reports(project_id), CHECK (id <> parent));',
      'CREATE TABLE members (id UUID, org UUID, CONSTRAINT fk FOREIGN KEY (organization_id) REFERENCES x(id));',
      'CREATE TABLE real_scoped (id UUID, "project_id" UUID NOT NULL);',
    ].join('\n'),
  });
  const t = byName(tableInventory(dir));
  assert.deepEqual(t.audit_events.columns, [], 'JSON default is not a column');
  assert.deepEqual(t.links.columns, [], 'REFERENCES target is not a column');
  assert.deepEqual(t.members.columns, [], 'table constraint is not a column');
  assert.deepEqual(t.real_scoped.columns, ['project_id'], 'quoted column name');
});

test('a fenced example inside "## Global tables" does not overwrite a real reason', () => {
  const adr = [
    '## Decision',
    'body',
    '## Global tables',
    '- users: identities span organizations',
    '```md',
    '- users: org-scoped: example override',
    '```',
  ].join('\n');
  const { reasons } = extractGlobalReasons(adr);
  assert.deepEqual(reasons.get('users'), {
    kind: 'global',
    reason: 'identities span organizations',
  });
});

test('children of bug_reports take its scope however they are linked', () => {
  const dir = migrations({
    '001_init.sql': `
CREATE TABLE organizations (id UUID PRIMARY KEY);
CREATE TABLE bug_reports (id UUID PRIMARY KEY, organization_id UUID REFERENCES organizations(id));
CREATE TABLE sessions (id UUID, bug_report_id UUID REFERENCES bug_reports(id));
CREATE TABLE notes (id UUID, bug_report_id UUID);
CREATE TABLE sync_log (id UUID, bug_id UUID REFERENCES bug_reports(id));
`,
  });
  const t = byName(tableInventory(dir));
  for (const name of ['sessions', 'notes', 'sync_log']) {
    assert.equal(t[name].scope.kind, 'org-scoped', name);
  }
  assert.equal(scopeLabel(t.notes.scope), 'org-scoped (via bug_report_id → bug_reports)');
});

test('only an inventory heading is dropped, not a section that mentions one', () => {
  const adr = [
    '## Decision: table inventory and policy shape',
    'KEEP_DECISION',
    '### Why the table inventory is generated',
    'KEEP_WHY',
    '## Appendix B: Table inventory',
    'DROP_ROWS',
    '## Consequences',
    'KEEP_CONSEQUENCES',
  ].join('\n');
  const { text } = extractGlobalReasons(adr);
  for (const k of ['KEEP_DECISION', 'KEEP_WHY', 'KEEP_CONSEQUENCES']) {
    assert.ok(text.includes(k), k);
  }
  assert.ok(!text.includes('DROP_ROWS'));
});

test('Global tables bullets: bold names and a note before the colon are read', () => {
  const adr = [
    '## Global tables',
    '- **users**: identities span organizations',
    '- `permissions` (catalog): fixed list shared by all tenants',
    '- system_config (platform): org-scoped: per-tenant overrides',
  ].join('\n');
  const { reasons } = extractGlobalReasons(adr);
  assert.equal(reasons.get('users').reason, 'identities span organizations');
  assert.equal(reasons.get('permissions').reason, 'fixed list shared by all tenants');
  assert.deepEqual(reasons.get('system_config'), {
    kind: 'org-scoped',
    reason: 'per-tenant overrides',
  });
});

test('a "|" in a reason is escaped so the appendix row keeps three cells', () => {
  const rows = [{ table: 'system_config', scope: { kind: 'global', via: '' } }];
  const reasons = new Map([
    ['system_config', { kind: 'global', reason: 'platform settings | no tenant data' }],
  ]);
  const row = inventoryAppendix(rows, reasons)
    .markdown.split('\n')
    .find((l) => l.startsWith('| system_config'));
  assert.equal(row.split(/(?<!\\)\|/).length - 2, 3);
});

test('Global tables: continuation lines join the reason; prose stays in the ADR', () => {
  const adr = [
    '## Decision',
    'D',
    '## Global tables',
    'These tables hold no tenant data.',
    '- organizations: the tenant root; RLS keys on its id',
    '  and is never filtered',
    '- users: identities span organizations',
    '',
    'Reviewed against the migrations.',
  ].join('\n');
  const { text, reasons } = extractGlobalReasons(adr);
  assert.equal(
    reasons.get('organizations').reason,
    'the tenant root; RLS keys on its id and is never filtered'
  );
  assert.equal(reasons.get('users').reason, 'identities span organizations');
  assert.ok(text.includes('## Global tables'), 'heading kept for the remaining prose');
  assert.ok(text.includes('These tables hold no tenant data.'));
  assert.ok(text.includes('Reviewed against the migrations.'));
  assert.ok(!text.includes('- users:'), 'reason bullets move to the appendix');
  assert.ok(!text.includes('never filtered'), 'continuation moves with its bullet');
});

test('Global tables with only reason bullets leave no empty heading behind', () => {
  const { text } = extractGlobalReasons(
    ['## Decision', 'D', '## Global tables', '- users: x'].join('\n')
  );
  assert.ok(!text.includes('Global tables'));
});

test('Global tables bullets: bold with the colon inside, numbered, schema-qualified', () => {
  const adr = [
    '## Global tables',
    '- **users:** cross-org identities',
    '1. system_config: platform settings',
    '2) `application.oauth_tokens`: per-user, not per-tenant',
  ].join('\n');
  const { reasons } = extractGlobalReasons(adr);
  assert.equal(reasons.get('users').reason, 'cross-org identities');
  assert.equal(reasons.get('system_config').reason, 'platform settings');
  assert.equal(reasons.get('oauth_tokens').reason, 'per-user, not per-tenant');
});

test('a table with its own project_id keeps it; bug_report_id alone takes bug_reports scope', () => {
  const dir = migrations({
    '001_init.sql': `
CREATE TABLE organizations (id UUID PRIMARY KEY);
CREATE TABLE projects (id UUID PRIMARY KEY, organization_id UUID REFERENCES organizations(id));
CREATE TABLE bug_reports (id UUID PRIMARY KEY, organization_id UUID REFERENCES organizations(id));
CREATE TABLE outbox (id UUID, project_id UUID REFERENCES projects(id), bug_report_id UUID REFERENCES bug_reports(id));
CREATE TABLE tickets (id UUID, bug_report_id UUID REFERENCES bug_reports(id));
`,
  });
  const t = byName(tableInventory(dir));
  assert.equal(t.outbox.scope.kind, 'project-scoped');
  assert.equal(t.tickets.scope.kind, 'org-scoped');
});

test('a self-referencing organizations table stays the global tenant root', () => {
  const dir = migrations({
    '001_init.sql': `
CREATE TABLE organizations (id UUID PRIMARY KEY, parent_id UUID REFERENCES organizations(id));
CREATE TABLE projects (id UUID PRIMARY KEY, organization_id UUID REFERENCES organizations(id));
`,
  });
  const t = byName(tableInventory(dir));
  assert.equal(t.organizations.scope.kind, 'global');
  assert.equal(t.projects.scope.kind, 'org-scoped');
});

test('a foreign key dropped later no longer gives a scope (notification_throttle, 023)', () => {
  const dir = migrations({
    '001.sql': `
CREATE TABLE projects (id UUID PRIMARY KEY, organization_id UUID);
CREATE TABLE rules (id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id));
CREATE TABLE throttle (id UUID, rule_id UUID REFERENCES rules(id));
CREATE TABLE named (id UUID, rule_id UUID, CONSTRAINT named_rule FOREIGN KEY (rule_id) REFERENCES rules(id));
CREATE TABLE kept (id UUID, rule_id UUID REFERENCES rules(id));
`,
    '002.sql': `
ALTER TABLE throttle DROP CONSTRAINT IF EXISTS throttle_rule_id_fkey;
ALTER TABLE named DROP CONSTRAINT named_rule;
ALTER TABLE kept DROP CONSTRAINT kept_other_fkey;
`,
  });
  const t = byName(tableInventory(dir));
  assert.equal(t.throttle.scope.kind, 'global');
  assert.equal(t.named.scope.kind, 'global');
  assert.equal(t.kept.scope.kind, 'project-scoped', 'an unrelated constraint name keeps the ref');
  const real = byName(tableInventory(join(REPO_ROOT, DEFAULT_MIGRATIONS_DIR)));
  assert.equal(real.notification_throttle.scope.kind, 'global', 'real 023 migration');
});

test('with the table list, only bullets naming a global table are reasons', () => {
  const adr = [
    '## Global tables',
    '- users: identity spans orgs',
    '- Note: all of these stay readable by the runtime role.',
    '  - Caveat: revisit in slice 6',
  ].join('\n');
  const { text, reasons } = extractGlobalReasons(adr, { tables: ['users', 'system_config'] });
  assert.deepEqual([...reasons.keys()], ['users']);
  assert.ok(text.includes('## Global tables'));
  assert.ok(text.includes('- Note: all of these stay readable by the runtime role.'));
  assert.ok(text.includes('  - Caveat: revisit in slice 6'));
});

test('a table inventory nested in Global tables keeps the prose before it', () => {
  const adr = [
    '## Global tables',
    'These stay outside RLS because they hold no tenant data.',
    '- users: x',
    '### Table inventory',
    '| users | global |',
    '## Consequences',
    'C',
  ].join('\n');
  const { text, reasons } = extractGlobalReasons(adr);
  assert.equal(reasons.get('users').reason, 'x');
  assert.ok(text.includes('## Global tables'));
  assert.ok(text.includes('These stay outside RLS'));
  assert.ok(!text.includes('| users | global |'));
  assert.ok(text.includes('## Consequences'));
});

test('reasons after an inventory nested in Global tables are still read', () => {
  const adr = [
    '## Global tables',
    'Intro.',
    '### Table inventory',
    '| users | global |',
    '### Platform tables',
    '- users: identity spans orgs',
    '- system_config: platform settings',
    '## Next',
    'N',
  ].join('\n');
  const { text, reasons } = extractGlobalReasons(adr);
  assert.equal(reasons.get('users')?.reason, 'identity spans orgs');
  assert.equal(reasons.get('system_config')?.reason, 'platform settings');
  assert.equal(text, '## Global tables\nIntro.\n### Platform tables\n## Next\nN');
});

test('Global tables nested in a dropped inventory: reasons read, the rest still dropped', () => {
  const adr = [
    '## Decision',
    'D',
    '## Appendix: Table inventory',
    '### Global tables',
    '- users: x',
    'stray prose inside the inventory',
    '### Scoped tables',
    '| projects | org-scoped |',
    '## Consequences',
    'C',
  ].join('\n');
  const { text, reasons } = extractGlobalReasons(adr);
  assert.equal(reasons.get('users').reason, 'x');
  for (const gone of [
    'Table inventory',
    'Global tables',
    'stray prose',
    'Scoped tables',
    '| projects',
  ]) {
    assert.ok(!text.includes(gone), gone);
  }
  assert.ok(text.includes('## Decision') && text.includes('## Consequences'));
});

test('Global tables heading variants are recognised', () => {
  for (const h of [
    '## Global tables ##',
    '## Global tables:',
    '## **Global tables**',
    '   ## Global tables',
    '### Global Tables',
  ]) {
    const { text, reasons } = extractGlobalReasons(`# ADR\n${h}\n- users: x\n## Next\nN`);
    assert.equal(reasons.get('users')?.reason, 'x', h);
    assert.ok(!text.includes('- users: x'), h);
  }
});

test('an indented sub-bullet under a reason is neither a reason nor part of one', () => {
  const { text, reasons } = extractGlobalReasons(
    '# ADR\n## Global tables\n- system_config: platform settings\n  - note: applies everywhere\n## Next\nN'
  );
  assert.equal(reasons.get('system_config')?.reason, 'platform settings');
  assert.ok(!reasons.has('note'));
  assert.ok(text.includes('  - note: applies everywhere'));
});

test('a reason list indented 1-3 spaces is read; deeper bullets under it are sub-points', () => {
  const tables = ['users', 'system_config'];
  const indented = extractGlobalReasons(
    '# ADR\n## Global tables\n  - users: identity spans orgs\n  - system_config: platform settings\n    - note: x\n## Next',
    { tables }
  );
  assert.equal(indented.reasons.get('users')?.reason, 'identity spans orgs');
  assert.equal(indented.reasons.get('system_config')?.reason, 'platform settings');
  assert.ok(!indented.text.includes('- users'), indented.text);
  assert.ok(indented.text.includes('    - note: x'), indented.text);

  // Under a group bullet that is not a reason itself.
  const grouped = extractGlobalReasons(
    '# ADR\n## Global tables\n- Platform:\n  - system_config: x\n- Identity:\n  - users: y\n## Next',
    { tables }
  );
  assert.equal(grouped.reasons.get('system_config')?.reason, 'x');
  assert.equal(grouped.reasons.get('users')?.reason, 'y');
  assert.ok(grouped.text.includes('- Platform:') && grouped.text.includes('- Identity:'));
});

test('a subheading inside Global tables does not end it', () => {
  const { text, reasons } = extractGlobalReasons(
    '# ADR\n## Global tables\n### Platform\n- system_config: platform settings\n## Next\nN'
  );
  assert.equal(reasons.get('system_config')?.reason, 'platform settings');
  assert.ok(!text.includes('- system_config'));
});

test('the table list is matched without regard to case', () => {
  const { reasons } = extractGlobalReasons(
    '# ADR\n## Global tables\n- system_config: platform settings\n',
    { tables: ['System_Config'] }
  );
  assert.equal(reasons.get('system_config')?.reason, 'platform settings');
});

test('a named column-level foreign key is removed by its DROP CONSTRAINT', () => {
  const dir = migrations({
    '001.sql': `
CREATE TABLE projects (id UUID PRIMARY KEY, organization_id UUID);
CREATE TABLE rules (id UUID PRIMARY KEY, project_id UUID REFERENCES projects(id));
CREATE TABLE child (id UUID, rule_id UUID CONSTRAINT child_rule REFERENCES rules(id));
`,
    '002.sql': 'ALTER TABLE child DROP CONSTRAINT child_rule;',
  });
  assert.equal(byName(tableInventory(dir)).child.scope.kind, 'global');
});

test('an inventory heading inside an inventory section keeps the outer boundary', () => {
  const adr =
    '# ADR\n## Appendix: Table inventory\n### Table inventory\nX\n### Scoped tables\nLEAK\n## Next\nN';
  const { text } = extractGlobalReasons(adr);
  assert.ok(!text.includes('LEAK'), text);
  assert.ok(text.includes('## Next\nN'), text);
});

test('an indented heading after a reason is section content, not part of the reason', () => {
  const { text, reasons } = extractGlobalReasons(
    '# ADR\n## Global tables\n- users: shared identities\n  ### Platform\n- system_config: x\n## Next'
  );
  assert.equal(reasons.get('users')?.reason, 'shared identities');
  assert.equal(reasons.get('system_config')?.reason, 'x');
  assert.ok(text.includes('### Platform'), text);
});
