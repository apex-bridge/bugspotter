// Tests for eval-adr.mjs. Zero-dependency: run with `node --test`.

import { test, after, describe } from 'node:test';
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

describe('run-adr-eval.mjs generatorFiles', () => {
  test('copies every module the generator imports, directly or not, and the template', async () => {
    const { generatorFiles } = await import('./run-adr-eval.mjs');
    const files = generatorFiles();
    for (const f of [
      'scripts/ai-sdlc/generate-adr.mjs',
      'scripts/ai-sdlc/table-inventory.mjs',
      'scripts/ai-sdlc/markdown-fence.mjs', // imported by table-inventory and spec-sections only
      'scripts/ai-sdlc/llm-client.mjs',
      'docs/adr/TEMPLATE.md',
    ]) {
      assert.ok(files.includes(f), f);
    }
    assert.equal(new Set(files).size, files.length, 'no duplicates');
    assert.ok(!files.some((f) => f.endsWith('.test.mjs')));
  });

  test('follows imports through a temporary module tree', async () => {
    const { generatorFiles } = await import('./run-adr-eval.mjs');
    const root = mkdtempSync(join(tmpdir(), 'gen-files-'));
    mkdirSync(join(root, 'a', 'lib'), { recursive: true });
    writeFileSync(
      join(root, 'a', 'main.mjs'),
      "import { x } from './lib/x.mjs';\nconst y = await import('../b.mjs');\n"
    );
    writeFileSync(join(root, 'a', 'lib', 'x.mjs'), "import './side.mjs';\nexport const x = 1;\n");
    writeFileSync(join(root, 'a', 'lib', 'side.mjs'), "import { x } from './x.mjs';\n");
    writeFileSync(join(root, 'b.mjs'), "import fs from 'node:fs';\n");
    const files = generatorFiles(root, 'a/main.mjs');
    rmSync(root, { recursive: true, force: true });
    assert.deepEqual(files.slice(0, -1).sort(), [
      'a/lib/side.mjs',
      'a/lib/x.mjs',
      'a/main.mjs',
      'b.mjs',
    ]);
  });
});

// --- independent review fixes (#461) ---

const caseFile = (id) =>
  JSON.parse(readFileSync(join(HERE, 'eval-adr-cases', `${id}.json`), 'utf8'));
const forbiddenOf = (id, fid) => caseFile(id).forbidden.find((f) => f.id === fid).any;

test('negation scope ends at a comma or clause conjunction and covers only a few words', () => {
  const rls = [
    ...forbiddenOf('451-rls', 'blanket-worker-bypass'),
    ...forbiddenOf('451-rls', 'skip-rls-selfhosted'),
  ];
  const sso = forbiddenOf('265-sso', 'links-by-email-alone');
  for (const s of [
    'Rather than passing org context in job payloads, all workers run through the audited bypass.',
    'Instead of per-job context, every worker connects via the bypass.',
    'Self-hosted installs have no organizations, so we skip RLS in self-hosted mode.',
    'Without a tenant context available, the app skips RLS for self-hosted deployments.',
    'No new tables are needed and all workers run through the bypass.',
    'Without org context in the job all workers run through the bypass.',
  ]) {
    assert.equal(anyAffirmed(s, rls), true, s);
  }
  for (const s of [
    'Since IdPs do not always send email_verified, we link accounts by email alone.',
    'Not every IdP is trusted, but we link accounts by email alone.',
  ]) {
    assert.equal(anyAffirmed(s, sso), true, s);
  }
  // A "." inside a file name does not end the sentence; a parenthetical
  // between the negation and the match does not break it.
  assert.equal(
    anyAffirmed('We never (see ADR-0007.md for why) link accounts by email alone.', sso),
    false
  );
  assert.equal(anyAffirmed('We do not, per client.ts, skip RLS in self-hosted mode.', rls), false);
  assert.equal(
    anyAffirmed(
      'We pass context in payloads rather than having all workers run through the bypass.',
      rls
    ),
    false
  );
  assert.equal(
    anyAffirmed('Self-hosted mode does not ever skip RLS for self-hosted installs.', rls),
    false
  );
});

test('227: a template-shaped ADR deciding the opposite does not get score, threshold or deferral', () => {
  const adr = [
    '# ADR-0043: Intelligence: show match score + threshold',
    '',
    '- Status: Proposed',
    '- Refs: #227; spec docs/specs/0227-intelligence-show-match-score-threshold-.md',
    '',
    '> **Decision:** Store the match result in a new table and serve it from a new endpoint.',
    '',
    '## Context',
    'Duplicates are auto-closed today.',
    '## Decision',
    '| Storage | new bug_match table | keep it |',
    '## Consequences',
    '**Risks and follow-ups**',
    '- none',
    '## Alternatives',
    '| reuse | no |',
    '',
  ].join('\n');
  const ids = ['shows-threshold', 'shows-score', 'persistence-deferred'];
  const pick = (text) =>
    evaluateAdr(text, caseFile('227-match-score'), { files: [] })
      .checks.filter((c) => ids.includes(c.id))
      .map((c) => [c.id, c.pass]);
  assert.deepEqual(
    pick(adr),
    ids.map((id) => [id, false])
  );
  const decided = adr.replace(
    'Duplicates are auto-closed today.',
    'The widget shows the current match score and the threshold. Persisting the original score is deferred to a separate issue.'
  );
  assert.deepEqual(
    pick(decided),
    ids.map((id) => [id, true])
  );
});

test('required facts need a whole word and must be affirmed', () => {
  const adr = (decision) =>
    `# ADR-0044: SSO\n\n- Status: Proposed\n\n> **Decision:** x\n\n## Context\nx\n## Decision\n${decision}\n## Consequences\nx\n## Alternatives\nx\n`;
  const ids = ['client-secret-encrypted', 'token-nonce', 'token-issuer', 'token-audience'];
  const pick = (text, def, which) =>
    Object.fromEntries(
      evaluateAdr(text, def, { files: [] })
        .checks.filter((c) => which.includes(c.id))
        .map((c) => [c.id, c.pass])
    );
  const sso = caseFile('265-sso');
  const no =
    'The client secret is stored unencrypted. We do not use a nonce. There is no issuer or audience check.';
  assert.deepEqual(pick(adr(no), sso, ids), Object.fromEntries(ids.map((id) => [id, false])));
  const yes =
    'The client secret is encrypted at rest. The ID token nonce, issuer and audience are validated.';
  assert.deepEqual(pick(adr(yes), sso, ids), Object.fromEntries(ids.map((id) => [id, true])));

  const rls = caseFile('451-rls');
  const rlsIds = ['per-slice-rollback', 'bypass-audited', 'worker-payload-context'];
  const incidental =
    'set_config is reset on COMMIT/ROLLBACK. Rows go to the audit_logs table. The request payload is validated.';
  assert.deepEqual(
    pick(adr(incidental), rls, rlsIds),
    Object.fromEntries(rlsIds.map((id) => [id, false]))
  );
  const stated =
    'Each slice can be rolled back on its own. Every bypass is audited. Workers read org_id from the job payload.';
  assert.deepEqual(
    pick(adr(stated), rls, rlsIds),
    Object.fromEntries(rlsIds.map((id) => [id, true]))
  );
});

test('"we reject X" negates X; a prohibition fact is matched as written', () => {
  const sso = caseFile('265-sso');
  const pick = (decision, id) =>
    evaluateAdr(
      `# ADR-0044: SSO\n\n- Status: Proposed\n\n> **Decision:** x\n\n## Context\nx\n## Decision\n${decision}\n## Consequences\nx\n## Alternatives\nx\n`,
      sso,
      { files: [] }
    ).checks.find((c) => c.id === id).pass;
  assert.equal(pick('We reject per-tenant IdP config.', 'tenant-idp-mapping'), false);
  assert.equal(pick('Each tenant configures its own IdP.', 'tenant-idp-mapping'), true);
  assert.equal(pick('We reject cross-tenant linking.', 'cross-tenant-rejected'), true);
});

test('a negation right after the match ("X is not an option") negates it too', () => {
  const rls = forbiddenOf('451-rls', 'skip-rls-selfhosted');
  for (const s of [
    "Per CLAUDE.md's `selfhosted` mode and #450, skipping RLS for self-hosted is not an option.",
    'Backfilling NULL `organization_id` rows in self-hosted installs before the first policy slice is an extra migration step; accepted because skipping RLS for self-hosted is out of scope per #450.',
    'Per #450, skipping RLS in self-hosted is not an option',
    'Skipping RLS in self-hosted mode was rejected.',
    'Skipping RLS for self-hosted installs is not acceptable.',
  ]) {
    assert.equal(anyAffirmed(s, rls), false, s);
  }
  for (const s of [
    'Self-hosted mode skips RLS when the org is not set.',
    'Self-hosted mode skips RLS for tables that are not org-scoped.',
    'We skip RLS in self-hosted mode, which is not ideal.',
  ]) {
    assert.equal(anyAffirmed(s, rls), true, s);
  }
});

test('no-meta-notes: scope statements and domain "I"/"author" are not notes about tooling', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\nc\n' });
  const flagged = (sentence) =>
    failedIds(
      evaluateAdr(GOOD.replace('We decide FACT_ONE.', `We decide FACT_ONE. ${sentence}`), CASE, {
        repoDir: repo,
        files: FILES,
      })
    ).includes('no-meta-notes');
  for (const s of [
    'This ADR does not change access control for API keys.',
    'This ADR does not change who can read bug reports.',
    'Phase I does not touch workers.',
    'If the reporter (the author of the bug) cannot see the project, the widget is hidden.',
  ]) {
    assert.equal(flagged(s), false, s);
  }
  for (const s of [
    'This ADR does not have access to run the grep.',
    'This draft could not read the repository.',
    'Slice 2 runs it. This ADR does not have access to\nrun that grep.',
    "This ADR does not have access to run the issue's\n  `grep` step.",
    'I could not run the tests.',
    "I don't have access to the codebase.",
    'The model was unable to verify the files.',
  ]) {
    assert.equal(flagged(s), true, s);
  }
});

test('runner metrics: every field is optional per call, and progress lines are not calls', () => {
  assert.deepEqual(metrics('claude CLI: turns=1 wall=200s api=199s in=2 out=100 cost=$0.2000'), {
    wallS: 200,
    thinking: 0,
    costUsd: 0.2,
    calls: 1,
  });
  const log = [
    'claude CLI: still running after 60s (no output yet)',
    'claude CLI: turns=1 wall=200s api=199s in=2 out=100 thinking=10 cost=$0.2000',
    'retrying...',
    'claude CLI: turns=1 wall=100s api=99s in=2 out=50 cost=$0.1000',
  ].join('\n');
  assert.deepEqual(metrics(log), { wallS: 300, thinking: 10, costUsd: 0.3, calls: 2 });
  assert.deepEqual(metrics('no model call'), {});
});

test('file refs: an exact path wins over suffix hits; "cited" means a whole path token', () => {
  const repo = repoWith({
    'package.json': '1\n2\n3\n',
    'a/package.json': '1\n2\n3\n4\n5\n',
    'src/a/x.ts': '1\n2\n3\n',
    'lib/src/a/x.ts': '1\n2\n3\n4\n5\n',
  });
  const files = ['package.json', 'a/package.json', 'src/a/x.ts', 'lib/src/a/x.ts'];
  assert.deepEqual(
    checkFileRefs('Root package.json:2; see also a/package.json:5.', repo, files).bad,
    []
  );
  // "src/a/x.ts" appears only inside "lib/src/a/x.ts", so only that one is cited.
  assert.deepEqual(checkFileRefs('lib/src/a/x.ts:5, then a/x.ts:4.', repo, files).bad, []);
});

test('testing strategy: every matching heading counts; a fenced "# comment" is not a heading', () => {
  const ts = (text) =>
    evaluateAdr(text, { testingStrategy: ['alpha', 'beta'] }, { files: [] }).checks.find(
      (c) => c.id === 'testing-strategy-names'
    );
  const pointer = `# ADR-0001: X\n## Context\n## Decision\n### Testing strategy\nSee Appendix B.\n## Consequences\n## Alternatives\n## Appendix B: Testing strategy\n- alpha\n- beta\n`;
  assert.equal(ts(pointer).pass, true, ts(pointer).detail);
  const fenced = `# ADR-0001: X\n## Context\n## Decision\n## Consequences\n## Alternatives\n## Appendix B: Testing strategy\n\`\`\`bash\n# run the suite\nnpm test\n\`\`\`\n- alpha\n- beta\n## Appendix C: Other\n- unrelated\n`;
  assert.equal(ts(fenced).pass, true, ts(fenced).detail);
  const after = fenced.replace('- alpha\n- beta\n', '').replace('- unrelated', '- alpha\n- beta');
  assert.equal(ts(after).pass, false, 'the block still ends at the next real heading');
});

test('splitAdr: a repeated heading appends to the section instead of replacing it', () => {
  const dup = `# ADR-0001: X\n- Status: Proposed\n> **Decision:** x\n## Context\n## Decision\nWe link accounts by email alone.\n## Consequences\n## Decision\nmore\n## Alternatives\n`;
  const r = evaluateAdr(
    dup,
    { forbidden: [{ id: 'f', any: ['link accounts by email alone'] }] },
    { files: [] }
  );
  assert.equal(r.checks.find((c) => c.id === 'f').pass, false);
  assert.match(splitAdr(dup).sections.get('decision'), /email alone[\s\S]*more/);
});

test('splitAdr: main-body length counts lines, not the trailing newline', () => {
  const body = (n) => `# ADR-0001: X\n${'x\n'.repeat(n - 1)}`;
  assert.equal(splitAdr(body(150)).mainLines, 150);
  assert.equal(splitAdr(`${body(150)}## Appendix: A\nfoo\n`).mainLines, 150);
  assert.equal(splitAdr('# ADR-0001: X').mainLines, 1);
});

test('file-refs-exist with no references passes but says so', () => {
  const text = GOOD.replace(
    'Refers to src/app.ts:2 and the PAYLOAD_FACT.',
    'Refers to the PAYLOAD_FACT.'
  );
  const c = evaluateAdr(text, CASE, { files: FILES }).checks.find(
    (x) => x.id === 'file-refs-exist'
  );
  assert.equal(c.pass, true);
  assert.equal(c.detail, 'no file:line references (nothing verified)');
});

describe('run-adr-eval.mjs helpers', () => {
  test('removeWorktree logs a failed remove, prunes, and does not throw', async () => {
    const { removeWorktree } = await import('./run-adr-eval.mjs');
    const calls = [];
    const run = (args) => {
      calls.push(args.join(' '));
      if (args[1] === 'remove') {
        throw new Error('locked');
      }
      return '';
    };
    const errors = [];
    const origError = console.error;
    console.error = (m) => errors.push(m);
    try {
      assert.doesNotThrow(() => removeWorktree('/tmp/wt', run));
    } finally {
      console.error = origError;
    }
    assert.deepEqual(calls, ['worktree remove --force /tmp/wt', 'worktree prune']);
    assert.match(errors.join('\n'), /locked/);
  });

  test('generatorEnv always sets SPEC_CONTENT, so an inherited one never leaks in', async () => {
    const { generatorEnv } = await import('./run-adr-eval.mjs');
    const env = generatorEnv({ issue: 265 }, { title: 'T', body: null }, '', {
      SPEC_CONTENT: 'stale spec',
      PATH: '/bin',
    });
    assert.equal(env.SPEC_CONTENT, '');
    assert.equal(env.PATH, '/bin');
    assert.equal(env.ISSUE_NUMBER, '265');
    assert.equal(env.ISSUE_BODY, '');
  });

  test('the generator budget is set and ends before the runner kills the generator', async () => {
    const { generatorEnv, GENERATOR_BUDGET_MINUTES, GENERATOR_KILL_MS } =
      await import('./run-adr-eval.mjs');
    const env = generatorEnv({ issue: 451 }, { title: 'T', body: '' }, '', {
      ADR_STEP_TIMEOUT_MINUTES: '45',
    });
    assert.equal(env.ADR_STEP_TIMEOUT_MINUTES, String(GENERATOR_BUDGET_MINUTES));
    assert.ok(
      GENERATOR_KILL_MS > Number(env.ADR_STEP_TIMEOUT_MINUTES) * 60_000,
      'the kill must come after the budget'
    );
    // generate-adr.mjs's own default, so the eval measures what the workflow runs.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'generate-adr.mjs'),
      'utf8'
    );
    assert.match(src, new RegExp(`\\|\\|\\s*${GENERATOR_BUDGET_MINUTES} \\* 60_000`));
  });

  test('readSpec throws on a missing spec path instead of running without one', async () => {
    const { readSpec } = await import('./run-adr-eval.mjs');
    const dir = repoWith({ 'docs/specs/a.md': 'spec text' });
    assert.equal(readSpec(dir, { spec: 'docs/specs/a.md' }), 'spec text');
    assert.equal(readSpec(dir, { spec: null }), '');
    assert.throws(() => readSpec(dir, { id: 'x', spec: 'docs/specs/missing.md' }), /missing\.md/);
  });

  test('summary leaves Wall empty for case errors; allFailed when nothing was scored', async () => {
    const { summary, allFailed } = await import('./run-adr-eval.mjs');
    const error = { case: 'x', run: '-', score: 'case error', failed: ['case-setup'] };
    assert.ok(!summary([error]).includes('undefined'));
    const scored = {
      case: 'y',
      run: 1,
      wallS: 10,
      score: '3/4',
      passed: 3,
      total: 4,
      failed: ['a'],
    };
    const noAdr = { case: 'y', run: 2, elapsedS: 5, score: 'no ADR', failed: ['generation'] };
    assert.equal(allFailed([error, noAdr]), true);
    assert.equal(allFailed([error, scored]), false);
  });
});

test('appendices count: their file refs are checked, their facts and forbidden statements too', () => {
  const repo = repoWith({ 'src/app.ts': 'a\nb\nc\n' });
  const run = (appendix, def = CASE) =>
    failedIds(
      evaluateAdr(`${GOOD}## Appendix B: Rollout\n${appendix}\n`, def, {
        repoDir: repo,
        files: FILES,
      })
    );
  assert.deepEqual(run('See src/does-not-exist.ts:1.'), ['file-refs-exist']);
  assert.deepEqual(run('We also do the forbidden thing.'), ['forbidden-thing']);
  const def = { ...CASE, required: [...CASE.required, { id: 'rollback', any: ['ROLLBACK_FACT'] }] };
  assert.deepEqual(run('Each slice has a ROLLBACK_FACT.', def), []);
});

test('prohibition facts need their rejection, and a UI-only change adds no migration', () => {
  const check = (id, decision, cid) =>
    evaluateAdr(
      `# ADR-0001: X\n\n- Status: Proposed\n\n> **Decision:** x\n\n## Context\nx\n## Decision\n${decision}\n## Consequences\nx\n## Alternatives\nx\n`,
      caseFile(id),
      { files: [] }
    ).checks.find((c) => c.id === cid).pass;
  assert.equal(check('265-sso', 'We allow cross-tenant linking.', 'cross-tenant-rejected'), false);
  assert.equal(check('265-sso', 'We reject cross-tenant linking.', 'cross-tenant-rejected'), true);
  assert.equal(
    check('265-sso', 'A login from a different tenant is rejected.', 'cross-tenant-rejected'),
    true
  );
  assert.equal(
    check(
      '451-rls',
      'Malformed tenant context is accepted and grants access.',
      'fail-closed-malformed'
    ),
    false
  );
  assert.equal(
    check('451-rls', 'Malformed tenant context is rejected.', 'fail-closed-malformed'),
    true
  );
  const ui = 'No new endpoint is needed. Add a migration to create the configuration table.';
  assert.equal(check('227-match-score', ui, 'adds-migration-or-endpoint'), false);
  assert.equal(
    check('227-match-score', 'No new endpoints or migrations.', 'adds-migration-or-endpoint'),
    true
  );
});

test('a negated rejection is not a rejection', () => {
  const check = (id, decision, cid) =>
    evaluateAdr(
      `# ADR-0001: X\n\n- Status: Proposed\n\n> **Decision:** x\n\n## Context\nx\n## Decision\n${decision}\n## Consequences\nx\n## Alternatives\nx\n`,
      caseFile(id),
      { files: [] }
    ).checks.find((c) => c.id === cid).pass;
  for (const s of [
    'We do not reject cross-tenant linking.',
    'Cross-tenant linking is not rejected.',
    'We never block cross-tenant linking.',
  ]) {
    assert.equal(check('265-sso', s, 'cross-tenant-rejected'), false, s);
  }
  assert.equal(
    check('265-sso', 'Cross-tenant linking is not allowed.', 'cross-tenant-rejected'),
    true
  );
  for (const s of [
    'Malformed tenant context is not rejected and grants access.',
    'The policy does not deny malformed context.',
  ]) {
    assert.equal(check('451-rls', s, 'fail-closed-malformed'), false, s);
  }
  assert.equal(
    check('227-match-score', 'No migration. Add a new endpoint.', 'adds-migration-or-endpoint'),
    false
  );
});

test('negation carries across a coordinated list, not into a new clause after a comma', () => {
  assert.equal(anyAffirmed('We do not validate nonce, issuer, or audience.', ['issuer']), false);
  assert.equal(anyAffirmed('We do not validate nonce, issuer, or audience.', ['audience']), false);
  assert.equal(anyAffirmed('We do not validate nonce, issuer and audience.', ['audience']), false);
  assert.equal(anyAffirmed('We validate nonce, issuer, or audience.', ['audience']), true);
  const sso265 = caseFile('265-sso');
  const decided = (s) =>
    evaluateAdr(
      `# ADR-0001: X\n- Status: Proposed\n> **Decision:** x\n## Context\nx\n## Decision\n${s}\n## Consequences\n## Alternatives\n`,
      sso265,
      { files: [] }
    ).checks.filter((c) => ['token-nonce', 'token-issuer', 'token-audience'].includes(c.id));
  assert.deepEqual(
    decided('We do not validate nonce, issuer, or audience.').map((c) => c.pass),
    [false, false, false]
  );
  const rls = forbiddenOf('451-rls', 'blanket-worker-bypass');
  assert.equal(
    anyAffirmed('Instead of per-job context, every worker connects via the bypass.', rls),
    true
  );
  const sso = forbiddenOf('265-sso', 'links-by-email-alone');
  assert.equal(
    anyAffirmed(
      'Since IdPs do not always send email_verified, we link accounts by email alone.',
      sso
    ),
    true
  );
});

test('splitAdr: a heading inside a fenced example is not a section boundary', () => {
  const fence = '```';
  const text = [
    '# ADR-0001: X',
    '- Status: Proposed',
    '> **Decision:** x',
    '## Context',
    '## Decision',
    `${fence}markdown`,
    '## Alternatives',
    '| example | row |',
    fence,
    'We link accounts by email alone.',
    '## Consequences',
    '## Alternatives',
    '',
  ].join('\n');
  const r = evaluateAdr(
    text,
    { forbidden: [{ id: 'f', any: ['link accounts by email alone'] }] },
    { files: [] }
  );
  assert.equal(r.checks.find((c) => c.id === 'f').pass, false);
  assert.equal(r.checks.find((c) => c.id === 'sections-in-order').pass, true);
  const appendix = `# ADR-0001: X\n## Context\n${fence}\n## Appendix: example\n${fence}\nreal text\n`;
  assert.equal(splitAdr(appendix).mainLines, 6);
});
