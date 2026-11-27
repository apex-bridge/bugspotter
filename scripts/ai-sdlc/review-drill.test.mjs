// Tests for review-drill.mjs: source eligibility, added-line parsing, site
// finding, the seed loop against a real git repo with a fake test command,
// judging, and the reveal CLI. Zero-dependency, run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isEligibleFile,
  isEligibleSource,
  parseAddedLines,
  findSites,
  applySite,
  shuffle,
  judge,
  inspectionRate,
  answerKeyRow,
  outcomeRow,
  revealComment,
  MAX_SOURCE_LINES,
} from './review-drill.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'review-drill.mjs');

describe('isEligibleFile', () => {
  test('source under packages/, apps/ or scripts/, not tests or declarations', () => {
    assert.equal(isEligibleFile('packages/backend/src/a.ts'), true);
    assert.equal(isEligibleFile('apps/admin/src/b.tsx'), true);
    assert.equal(isEligibleFile('packages/backend/tests/a.test.ts'), false);
    assert.equal(isEligibleFile('packages/types/src/x.d.ts'), false);
    assert.equal(isEligibleFile('scripts/ai-sdlc/x.mjs'), true);
    assert.equal(isEligibleFile('scripts/ai-sdlc/x.test.mjs'), false);
    assert.equal(isEligibleFile('docker/entrypoint.js'), false);
    assert.equal(isEligibleFile('docs/specs/0001-x.md'), false);
  });
});

describe('isEligibleSource', () => {
  const now = new Date('2026-11-27T00:00:00Z');
  const pr = {
    merged_at: '2026-11-01T00:00:00Z',
    merge_commit_sha: 'abc',
    head: { ref: 'impl/issue-1-x' },
  };
  const files = [
    { filename: 'packages/backend/src/a.ts', additions: 40, deletions: 5, status: 'modified' },
  ];

  test('a recent, small, code-adding PR qualifies', () => {
    assert.equal(isEligibleSource(pr, files, now), true);
  });

  test('unmerged, old, drill, too large or code-free PRs do not', () => {
    assert.equal(isEligibleSource({ ...pr, merged_at: null }, files, now), false);
    assert.equal(isEligibleSource({ ...pr, merged_at: '2026-01-01T00:00:00Z' }, files, now), false);
    assert.equal(isEligibleSource({ ...pr, head: { ref: 'drill/r1-pr5' } }, files, now), false);
    assert.equal(
      isEligibleSource(pr, [{ ...files[0], additions: MAX_SOURCE_LINES, deletions: 1 }], now),
      false
    );
    assert.equal(
      isEligibleSource(
        pr,
        [{ filename: 'packages/backend/tests/a.test.ts', additions: 10, status: 'added' }],
        now
      ),
      false
    );
  });

  test('workflow, spec or ADR changes disqualify', () => {
    for (const f of ['.github/workflows/ci.yml', 'docs/specs/0001-x.md', 'docs/adr/0001-x.md']) {
      assert.equal(
        isEligibleSource(pr, [...files, { filename: f, additions: 1, status: 'modified' }], now),
        false,
        f
      );
    }
  });

  test('lock-file lines do not count toward the size limit', () => {
    const withLock = [
      ...files,
      { filename: 'pnpm-lock.yaml', additions: 5000, deletions: 0, status: 'modified' },
    ];
    assert.equal(isEligibleSource(pr, withLock, now), true);
  });
});

describe('parseAddedLines', () => {
  test('collects new-side line numbers from -U0 hunks', () => {
    const diff = [
      'diff --git a/packages/a.ts b/packages/a.ts',
      '--- a/packages/a.ts',
      '+++ b/packages/a.ts',
      '@@ -3,0 +4,2 @@ function f() {',
      '+  const x = 1;',
      '+  return x === 1;',
      '@@ -10 +12 @@',
      '-old',
      '+new',
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
    ].join('\n');
    const added = parseAddedLines(diff);
    assert.deepEqual([...added.get('packages/a.ts')], [4, 5, 12]);
    assert.equal(added.has('gone.ts'), false);
  });
});

describe('findSites / applySite', () => {
  const src = [
    'const a = x === y;',
    '// if (a === b)',
    'if (p && q) {',
    '  return true;',
    '}',
  ].join('\n');

  test('restricted to the given lines and skipping comments', () => {
    const ids = findSites('f.ts', src, new Set([1, 2, 4])).map((s) => `${s.line}:${s.op.id}`);
    assert.deepEqual(ids, ['1:eq-negate', '4:return-true']);
  });

  test('nullish coalescing can become a logical OR', () => {
    const ids = findSites('f.ts', '  data.max_retries ?? 3,').map((x) => x.op.id);
    assert.deepEqual(ids, ['nullish-to-or']);
  });

  test('skips strings, template literals and relational ops in .tsx', () => {
    assert.deepEqual(findSites('f.ts', "const s = 'a === b';"), []);
    assert.deepEqual(findSites('f.ts', 'const s = `${a === b}`;'), []);
    assert.deepEqual(findSites('f.tsx', 'const ok = a > b;'), []);
  });

  test('applySite changes exactly one occurrence', () => {
    const line = 'const a = x === y || p === q;';
    const sites = findSites('f.ts', line).filter((s) => s.op.id === 'eq-negate');
    assert.equal(applySite(line, sites[1]).mutated, 'const a = x === y || p !== q;');
  });

  test('shuffle keeps every item', () => {
    assert.deepEqual([...shuffle([1, 2, 3, 4])].sort(), [1, 2, 3, 4]);
  });
});

describe('judge / inspectionRate', () => {
  const seed = { file: 'packages/a.ts', line: 20 };
  const c = (path, line, extra = {}) => ({
    path,
    line,
    side: 'RIGHT',
    user: { type: 'User' },
    ...extra,
  });

  test('a comment within two lines of the seed catches it', () => {
    assert.equal(judge(seed, [c('packages/a.ts', 22)]).outcome, 'caught');
    assert.equal(judge(seed, [c('packages/a.ts', 18)]).outcome, 'caught');
    assert.equal(judge(seed, [c('packages/a.ts', 23)]).outcome, 'missed');
  });

  test('a multi-line comment range covering the seed catches it', () => {
    assert.equal(judge(seed, [c('packages/a.ts', 30, { start_line: 15 })]).outcome, 'caught');
  });

  test('other files, bot comments and left-side comments do not count', () => {
    assert.equal(judge(seed, [c('packages/b.ts', 20)]).outcome, 'missed');
    assert.equal(
      judge(seed, [c('packages/a.ts', 20, { user: { type: 'Bot' } })]).outcome,
      'missed'
    );
    assert.equal(judge(seed, [c('packages/a.ts', 20, { side: 'LEFT' })]).outcome, 'missed');
  });

  test('an outdated comment falls back to original_line', () => {
    assert.equal(judge(seed, [c('packages/a.ts', null, { original_line: 21 })]).outcome, 'caught');
  });

  test('counts human inline comments', () => {
    assert.equal(
      judge(seed, [c('x', 1), c('y', 2), c('z', 3, { user: { type: 'Bot' } })]).comments,
      2
    );
  });

  test('inspectionRate is lines per hour, or null', () => {
    const pr = { additions: 300, deletions: 100, created_at: '2026-11-27T10:00:00Z' };
    assert.equal(inspectionRate(pr, { submitted_at: '2026-11-27T11:00:00Z' }), 400);
    assert.equal(inspectionRate(pr, { submitted_at: '2026-11-27T09:00:00Z' }), null);
    assert.equal(
      inspectionRate(
        { ...pr, additions: 0, deletions: 0 },
        { submitted_at: '2026-11-27T11:00:00Z' }
      ),
      null
    );
  });
});

describe('rows and reveal comment', () => {
  const state = {
    file: 'packages/a.ts',
    line: 7,
    operator: 'eq-negate',
    original: '  if (a === b) {',
    mutated: '  if (a !== b) {',
  };
  const seedRow = answerKeyRow(state, {
    branch: 'drill/r1-pr5',
    sourcePr: '5',
    repo: 'o/r',
    runId: 1,
    now: new Date(0),
  });

  test('answer key carries location and both versions of the line', () => {
    assert.equal(seedRow.source_pr, 5);
    assert.equal(seedRow.line, 7);
    assert.equal(seedRow.original, '  if (a === b) {');
  });

  test('outcome row has no free text', () => {
    const row = outcomeRow({
      seed: seedRow,
      pr: { number: 9, additions: 50, deletions: 10, created_at: '2026-11-27T10:00:00Z' },
      review: { submitted_at: '2026-11-27T10:30:00Z' },
      judgement: { outcome: 'missed', comments: 3 },
      now: new Date(0),
    });
    assert.deepEqual(row, {
      schema: 1,
      recorded_at: '1970-01-01T00:00:00.000Z',
      repo: 'o/r',
      pr: 9,
      branch: 'drill/r1-pr5',
      source_pr: 5,
      outcome: 'missed',
      inline_comments: 3,
      lines_changed: 60,
      review_minutes: 30,
    });
  });

  test('reveal comment shows the diff, the verdict and the pace', () => {
    const body = revealComment(seedRow, { outcome: 'caught', comments: 2 }, 420);
    assert.match(body, /packages\/a\.ts:7/);
    assert.match(body, /- if \(a === b\) \{/);
    assert.match(body, /\+ if \(a !== b\) \{/);
    assert.match(body, /\*\*Caught\.\*\*/);
    assert.match(body, /about 420 changed lines per hour/);
    assert.doesNotMatch(
      revealComment(seedRow, { outcome: 'missed', comments: 0 }, null),
      /per hour/
    );
  });
});

describe('CLI seed / record (real git repo, fake test command)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-drill-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const sh = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  sh(['init', '-q']);
  sh(['config', 'user.email', 't@t']);
  sh(['config', 'user.name', 't']);
  mkdirSync(join(dir, 'packages', 'x'), { recursive: true });
  writeFileSync(join(dir, 'packages/x/a.ts'), 'export const base = 1;\n');
  sh(['add', '-A']);
  sh(['commit', '-q', '-m', 'base']);
  const parent = sh(['rev-parse', 'HEAD']).stdout.trim();
  // The "source PR": adds one comparison on line 2, staged as cherry-pick would.
  writeFileSync(
    join(dir, 'packages/x/a.ts'),
    'export const base = 1;\nexport const same = (a, b) => a === b;\n'
  );
  sh(['add', '-A']);

  const run = (mode, env) =>
    spawnSync(process.execPath, [script, mode], {
      cwd: dir,
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });
  const state = join(dir, '..', `drill-state-${process.pid}.json`);

  test('with failing tests nothing survives: exit 3, file unchanged', () => {
    const r = run('seed', { PARENT: parent, DRILL_STATE: state, SEED_TEST_CMD: 'false' });
    assert.equal(r.status, 3);
    assert.match(readFileSync(join(dir, 'packages/x/a.ts'), 'utf8'), /a === b/);
  });

  test('with passing tests the added line is seeded, and the log does not say where', () => {
    const r = run('seed', { PARENT: parent, DRILL_STATE: state, SEED_TEST_CMD: 'true' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim(), 'Seeded one defect.');
    assert.match(readFileSync(join(dir, 'packages/x/a.ts'), 'utf8'), /a !== b/);
    const s = JSON.parse(readFileSync(state, 'utf8'));
    assert.equal(s.file, 'packages/x/a.ts');
    assert.equal(s.line, 2);
  });

  test('record appends the answer key row', () => {
    const out = join(dir, 'drills.jsonl');
    const r = run('record', {
      DRILL_STATE: state,
      DRILL_OUT: out,
      DRILL_BRANCH: 'drill/r1-pr5',
      SOURCE_PR: '5',
      REPO: 'o/r',
      RUN_ID: '1',
    });
    assert.equal(r.status, 0);
    const row = JSON.parse(readFileSync(out, 'utf8').trim());
    assert.equal(row.branch, 'drill/r1-pr5');
    assert.equal(row.mutated.trim(), 'export const same = (a, b) => a !== b;');
    rmSync(state, { force: true });
  });
});

describe('CLI reveal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-drill-reveal-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const seedRow = {
    repo: 'o/r',
    branch: 'drill/r1-pr5',
    source_pr: 5,
    file: 'packages/a.ts',
    line: 7,
    operator: 'eq-negate',
    original: 'a === b',
    mutated: 'a !== b',
  };
  writeFileSync(join(dir, 'drills.jsonl'), JSON.stringify(seedRow) + '\n');
  writeFileSync(
    join(dir, 'pr.json'),
    JSON.stringify({
      number: 9,
      state: 'open',
      head: { ref: 'drill/r1-pr5' },
      additions: 40,
      deletions: 0,
      created_at: '2026-11-27T10:00:00Z',
    })
  );
  writeFileSync(join(dir, 'review.json'), JSON.stringify({ submitted_at: '2026-11-27T10:20:00Z' }));
  writeFileSync(
    join(dir, 'comments.json'),
    JSON.stringify([{ path: 'packages/a.ts', line: 8, side: 'RIGHT', user: { type: 'User' } }])
  );

  const run = (extra = {}) => {
    const out = join(dir, `out-${Math.random()}.txt`);
    writeFileSync(out, '');
    const r = spawnSync(process.execPath, [script, 'reveal'], {
      env: {
        PATH: process.env.PATH,
        DRILLS_FILE: join(dir, 'drills.jsonl'),
        OUTCOMES_FILE: join(dir, 'outcomes.jsonl'),
        COMMENTS_JSON: join(dir, 'comments.json'),
        PR_JSON: join(dir, 'pr.json'),
        REVIEW_JSON: join(dir, 'review.json'),
        REPO: 'o/r',
        GITHUB_OUTPUT: out,
        ...extra,
      },
      encoding: 'utf8',
    });
    return { r, text: readFileSync(out, 'utf8') };
  };

  test('first review: act, caught, outcome row and comment', () => {
    const { r, text } = run();
    assert.equal(r.status, 0);
    assert.match(text, /^act=true$/m);
    assert.match(text, /^outcome_row=\{.*"outcome":"caught".*\}$/m);
    assert.match(text, /comment_body<<EOF_[0-9a-f]+\n<!-- review-drill:reveal -->/);
  });

  test('already recorded: no action', () => {
    writeFileSync(
      join(dir, 'outcomes.jsonl'),
      JSON.stringify({ repo: 'o/r', branch: 'drill/r1-pr5', outcome: 'caught' }) + '\n'
    );
    const { text } = run();
    assert.match(text, /^act=false$/m);
    rmSync(join(dir, 'outcomes.jsonl'));
  });

  test('no answer key: no action', () => {
    const { text } = run({ DRILLS_FILE: join(dir, 'none.jsonl') });
    assert.match(text, /^act=false$/m);
  });

  test('usage error exits 2', () => {
    assert.equal(spawnSync(process.execPath, [script, 'bogus'], { encoding: 'utf8' }).status, 2);
  });
});
