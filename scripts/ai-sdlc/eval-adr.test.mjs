// Tests for eval-adr.mjs. Zero-dependency: run with `node --test`.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateAdr, splitAdr, checkFileRefs, anyAffirmed } from './eval-adr.mjs';
import { metrics } from './run-adr-eval.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIRS = [];
after(() => DIRS.forEach((d) => rmSync(d, { recursive: true, force: true })));

const GOOD = [
  '# ADR-0001: Fixture decision',
  '',
  '- Status: Proposed',
  '- Area: fixture',
  '',
  '> **Decision:** do the thing.',
  '',
  '## Context',
  'Refers to src/app.ts:2 and the PAYLOAD_FACT.',
  '## Decision',
  'We decide FACT_ONE.',
  '## Consequences',
  '- fine',
  '## Alternatives',
  '| Skip the forbidden thing | rejected |',
  '## Appendix: extra',
  'long appendix text that does not count toward length',
  '',
].join('\n');

const CASE = {
  required: [
    { id: 'fact-one', any: ['FACT_ONE'] },
    { id: 'payload', any: ['payload_fact'] },
  ],
  forbidden: [{ id: 'forbidden-thing', any: ['forbidden thing'] }],
  maxMainLines: 40,
};

const FILES = ['src/app.ts'];
function repoWith(files) {
  const dir = mkdtempSync(join(tmpdir(), 'eval-adr-'));
  DIRS.push(dir);
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

test('a complete ADR passes every check', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\nc\n' });
  const r = evaluateAdr(GOOD, CASE, { repoDir: repo, files: FILES });
  assert.deepEqual(
    r.checks.filter((c) => !c.pass),
    []
  );
  assert.equal(r.passed, r.total);
});

test('forbidden text inside Alternatives is allowed, elsewhere it fails', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\n' });
  const bad = GOOD.replace('We decide FACT_ONE.', 'We decide FACT_ONE and the forbidden thing.');
  const r = evaluateAdr(bad, CASE, { repoDir: repo, files: FILES });
  assert.deepEqual(
    r.checks.filter((c) => !c.pass).map((c) => c.id),
    ['forbidden-thing']
  );
});

test('missing required facts, structure and length are reported by id', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\n' });
  const text = GOOD.replace('- Status: Proposed', '- Status: Accepted')
    .replace('> **Decision:** do the thing.\n', '')
    .replace('## Alternatives\n| Skip the forbidden thing | rejected |\n', '')
    .replace('We decide FACT_ONE.', `We decide.\n${'x\n'.repeat(50)}`);
  const failed = evaluateAdr(text, CASE, { repoDir: repo, files: FILES })
    .checks.filter((c) => !c.pass)
    .map((c) => c.id);
  assert.deepEqual(
    failed.sort(),
    ['decision-summary', 'fact-one', 'length', 'sections-in-order', 'status-proposed'].sort()
  );
});

test('file:line references must exist and be in range', () => {
  const repo = repoWith({ 'packages/x/src/a.ts': '1\n2\n3\n' });
  const files = ['packages/x/src/a.ts'];
  assert.deepEqual(checkFileRefs('see `src/a.ts:3`', repo, files), { total: 1, bad: [] });
  assert.deepEqual(checkFileRefs('see a.ts:99 and routes/.../a.ts:1', repo, files).bad, [
    'a.ts:99',
    'routes/.../a.ts:1',
  ]);
});

test('meta notes about the author tools fail', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\n' });
  const text = GOOD.replace(
    'We decide FACT_ONE.',
    'We decide FACT_ONE. This ADR does not have access to run the grep.'
  );
  const r = evaluateAdr(text, CASE, { repoDir: repo, files: FILES });
  assert.deepEqual(
    r.checks.filter((c) => !c.pass).map((c) => c.id),
    ['no-meta-notes']
  );
});

test('splitAdr: main body stops at the first appendix', () => {
  const { main, sections } = splitAdr(GOOD);
  assert.ok(!main.includes('long appendix text'));
  assert.ok(sections.has('appendix: extra'));
});

test('testing-strategy names and inventory completeness (spec checks)', () => {
  const repo = repoWith({
    'packages/backend/src/db/migrations/001.sql':
      'CREATE TABLE users (id UUID);\nCREATE TABLE projects (id UUID, organization_id UUID);',
  });
  const def = {
    ...CASE,
    required: [],
    forbidden: [],
    testingStrategy: ['fail-closed', 'concurrency'],
    inventory: true,
  };
  const text = `${GOOD}\n## Testing Strategy\n- fail-closed\n- concurrency\n## Appendix: Table inventory\n### Table inventory\n| Table | Scope | Reason |\n| --- | --- | --- |\n| projects | org-scoped | has organization_id |\n| users | global | REASON MISSING - reviewer must add one |\n`;
  const r = evaluateAdr(text, def, { repoDir: repo, files: [] });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(byId['testing-strategy-names'].pass, true);
  assert.equal(byId['inventory-complete'].pass, false, 'a missing reason fails completeness');
  const fixed = evaluateAdr(
    text.replace('REASON MISSING - reviewer must add one', 'shared across orgs'),
    def,
    {
      repoDir: repo,
      files: [],
    }
  );
  assert.equal(fixed.checks.find((c) => c.id === 'inventory-complete').pass, true);
});

test('every case file is valid and its patterns compile', () => {
  const dir = join(HERE, 'eval-adr-cases');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const def = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    assert.ok(def.id && def.issue && def.repoCommit, `${f}: id, issue, repoCommit`);
    for (const r of [...(def.required ?? []), ...(def.forbidden ?? [])]) {
      assert.ok(r.id && Array.isArray(r.any) && r.any.length, `${f}: ${r.id}`);
      r.any.forEach((p) => new RegExp(p, 'i'));
    }
  }
});

test('CLI prints a score line per ADR', () => {
  const repo = repoWith({
    'src/app.ts': 'a\nb\n',
    'adr.md': GOOD,
    'case.json': JSON.stringify(CASE),
  });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '.'], { cwd: repo });
  const out = execFileSync(
    'node',
    [
      join(HERE, 'eval-adr.mjs'),
      '--case',
      join(repo, 'case.json'),
      '--adr',
      join(repo, 'adr.md'),
      '--repo',
      repo,
    ],
    { encoding: 'utf8' }
  );
  assert.match(out, /adr\.md: (\d+)\/\1$/m);
});

// --- code-review fixes (#461) ---

const failedIds = (r) => r.checks.filter((c) => !c.pass).map((c) => c.id);

test('a negated forbidden statement does not count; an affirmed one does', () => {
  const cases = JSON.parse(
    readFileSync(join(HERE, 'eval-adr-cases', '265-sso.json'), 'utf8')
  ).forbidden.find((f) => f.id === 'links-by-email-alone').any;
  assert.equal(anyAffirmed('We never link accounts by email alone.', cases), false);
  assert.equal(anyAffirmed('We link accounts by email alone.', cases), true);
  const rls = JSON.parse(
    readFileSync(join(HERE, 'eval-adr-cases', '451-rls.json'), 'utf8')
  ).forbidden.find((f) => f.id === 'skip-rls-selfhosted').any;
  assert.equal(anyAffirmed("We don't skip RLS in self-hosted mode.", rls), false);
  assert.equal(anyAffirmed('We skip RLS in self-hosted mode.', rls), true);
  // A negation in an earlier sentence does not cover this one.
  assert.equal(anyAffirmed('Not now. We skip RLS in self-hosted mode.', rls), true);
});

test('the decision summary is checked for forbidden statements', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\nc\n' });
  const text = GOOD.replace('do the thing.', 'do the forbidden thing.');
  assert.deepEqual(failedIds(evaluateAdr(text, CASE, { repoDir: repo, files: FILES })), [
    'forbidden-thing',
  ]);
});

test('domain prose about access is not a meta note', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\nc\n' });
  for (const sentence of [
    'Workers do not have access to the request context.',
    'The bugspotter_app role cannot run DDL.',
  ]) {
    const text = GOOD.replace('We decide FACT_ONE.', `We decide FACT_ONE. ${sentence}`);
    assert.deepEqual(
      failedIds(evaluateAdr(text, CASE, { repoDir: repo, files: FILES })),
      [],
      sentence
    );
  }
});

test('a required fact named only under Alternatives is not decided', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\nc\n' });
  const text = GOOD.replace('We decide FACT_ONE.', 'We decide.').replace(
    '| Skip the forbidden thing | rejected |',
    '| FACT_ONE | rejected |'
  );
  assert.deepEqual(failedIds(evaluateAdr(text, CASE, { repoDir: repo, files: FILES })), [
    'fact-one',
  ]);
});

test('testing strategy is found under an appendix heading too', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\nc\n' });
  const text = `${GOOD}## Appendix B: Testing strategy\n- alpha_test\n- beta_test\n`;
  const r = evaluateAdr(
    text,
    { ...CASE, testingStrategy: ['alpha_test', 'beta_test'] },
    {
      repoDir: repo,
      files: FILES,
    }
  );
  assert.deepEqual(failedIds(r), []);
});

test('file refs: trailing newline, deleted files, ambiguous and cited short names', () => {
  const repo = repoWith({
    'a/client.ts': '1\n2\n3\n',
    'b/client.ts': '1\n',
    'src/app.ts': 'a\nb\nc\n',
  });
  const files = ['a/client.ts', 'b/client.ts', 'src/app.ts', 'src/gone.ts'];
  assert.deepEqual(checkFileRefs('src/app.ts:3', repo, files).bad, []);
  assert.deepEqual(
    checkFileRefs('src/app.ts:4', repo, files).bad,
    ['src/app.ts:4'],
    'one past EOF'
  );
  assert.deepEqual(checkFileRefs('src/gone.ts:1', repo, files).bad, ['src/gone.ts:1'], 'no crash');
  assert.deepEqual(checkFileRefs('client.ts:2', repo, files).bad, ['client.ts:2 (ambiguous)']);
  assert.deepEqual(checkFileRefs('See a/client.ts:1, then client.ts:3.', repo, files).bad, []);
});

test('runner metrics sum every model call, so a retry is counted', () => {
  const log = [
    'claude CLI: turns=1 wall=200s api=199s in=2 out=100 thinking=1000 cost=$0.2000',
    'retrying...',
    'claude CLI: turns=1 wall=100s api=99s in=2 out=50 thinking=500 cost=$0.1000',
  ].join('\n');
  assert.deepEqual(metrics(log), { wallS: 300, thinking: 1500, costUsd: 0.3, calls: 2 });
});
