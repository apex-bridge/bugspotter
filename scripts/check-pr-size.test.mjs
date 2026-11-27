// Tests for check-pr-size.mjs. Zero-dependency, run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isExcluded,
  isTest,
  resolveThreshold,
  measure,
  commentBody,
  MARKER,
  DEFAULT_WARN,
} from './check-pr-size.mjs';

describe('isExcluded / isTest', () => {
  test('lock files and generated output are excluded', () => {
    for (const f of [
      'pnpm-lock.yaml',
      'apps/admin/package-lock.json',
      'packages/types/dist/index.js',
      'apps/admin/coverage/lcov.info',
      'packages/backend/src/__snapshots__/a.snap',
      'apps/demo/vendor.min.js',
      'apps/admin/build/x.js.map',
      'packages/types/src/api.generated.ts',
    ]) {
      assert.equal(isExcluded(f), true, f);
    }
  });

  test('source, tests, specs and locale files count', () => {
    for (const f of [
      'packages/backend/src/a.ts',
      'packages/backend/tests/a.test.ts',
      'docs/specs/0475-x.md',
      'apps/admin/src/i18n/locales/en.json',
      'packages/backend/src/builders/report.ts',
    ]) {
      assert.equal(isExcluded(f), false, f);
    }
  });

  test('isTest recognises test files and folders', () => {
    assert.equal(isTest('packages/backend/tests/x.ts'), true);
    assert.equal(isTest('apps/admin/src/a.spec.tsx'), true);
    assert.equal(isTest('scripts/check-pr-size.test.mjs'), true);
    assert.equal(isTest('packages/backend/src/testing-utils.ts'), false);
  });
});

describe('resolveThreshold', () => {
  test('defaults on unset or invalid input', () => {
    for (const raw of [undefined, '', '  ', 'abc', '0', '-5', '2.5']) {
      assert.equal(resolveThreshold(raw), DEFAULT_WARN, String(raw));
    }
    assert.equal(resolveThreshold(' 250 '), 250);
  });
});

describe('measure', () => {
  const files = [
    { filename: 'packages/backend/src/a.ts', additions: 200, deletions: 50 },
    { filename: 'packages/backend/tests/a.test.ts', additions: 180, deletions: 0 },
    { filename: 'pnpm-lock.yaml', additions: 900, deletions: 300 },
    { filename: 'docs/specs/0001-x.md', additions: 30 },
  ];

  test('counts additions and deletions, leaving excluded files out', () => {
    const m = measure(files, 400);
    assert.equal(m.changed, 460);
    assert.equal(m.tests, 180);
    assert.equal(m.excluded, 1200);
    assert.equal(m.over, true);
    assert.deepEqual(
      m.largest.map((f) => f.filename),
      ['packages/backend/src/a.ts', 'packages/backend/tests/a.test.ts', 'docs/specs/0001-x.md']
    );
  });

  test('exactly at the threshold is not over', () => {
    assert.equal(measure([{ filename: 'a.ts', additions: 400 }], 400).over, false);
    assert.equal(measure([{ filename: 'a.ts', additions: 401 }], 400).over, true);
  });

  test('a lock-file-only PR is small', () => {
    assert.equal(measure([{ filename: 'pnpm-lock.yaml', additions: 5000 }]).over, false);
  });
});

describe('commentBody', () => {
  test('over: marker, totals, tests share and largest files', () => {
    const body = commentBody(
      measure([
        { filename: 'src/a.ts', additions: 300 },
        { filename: 'tests/a.test.ts', additions: 200 },
        { filename: 'pnpm-lock.yaml', additions: 10 },
      ])
    );
    assert.ok(body.startsWith(MARKER));
    assert.match(body, /500 changed lines, 200 of them in tests \(10 more in lock files/);
    assert.match(body, /\| `src\/a\.ts` \| 300 \|/);
    assert.match(body, /never blocks/);
  });

  test('within: a short all-clear that keeps the marker', () => {
    const body = commentBody(measure([{ filename: 'src/a.ts', additions: 10 }]));
    assert.ok(body.startsWith(MARKER));
    assert.match(body, /within the 400-line/);
  });
});

describe('CLI', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = join(here, 'check-pr-size.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'check-pr-size-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env) =>
    spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });

  test('exits 0 and warns when over, writing outputs', () => {
    const files = join(dir, 'files.json');
    const out = join(dir, 'out.txt');
    writeFileSync(files, JSON.stringify([{ filename: 'src/a.ts', additions: 450, deletions: 0 }]));
    writeFileSync(out, '');
    const r = run({ PR_FILES_JSON: files, GITHUB_OUTPUT: out });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /::warning::PR size: 450 changed lines/);
    const text = readFileSync(out, 'utf8');
    assert.match(text, /^over=true$/m);
    assert.match(text, /^changed=450$/m);
    assert.match(text, /comment_body<<EOF_PR_SIZE_[0-9a-f]+\n<!-- pr-size -->/);
  });

  test('honours PR_SIZE_WARN', () => {
    const files = join(dir, 'files2.json');
    writeFileSync(files, JSON.stringify([{ filename: 'src/a.ts', additions: 450 }]));
    const r = run({ PR_FILES_JSON: files, PR_SIZE_WARN: '500' });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /::warning::/);
  });

  test('exits 1 on a missing or malformed input', () => {
    assert.equal(run({}).status, 1);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"not":"an array"}');
    assert.equal(run({ PR_FILES_JSON: bad }).status, 1);
  });
});
