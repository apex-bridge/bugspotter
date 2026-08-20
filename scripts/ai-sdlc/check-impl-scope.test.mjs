// Tests for check-impl-scope.mjs. The pure helpers are covered directly;
// main() is covered by spawning the real CLI, because the bug this file's
// last describe() block exists to pin lived entirely in main()'s control
// flow, where a helper-only suite could never have seen it. Zero-dependency,
// run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUndeclaredPaths, findUnwrittenPaths, normalizePath } from './check-impl-scope.mjs';

describe('findUndeclaredPaths', () => {
  test('returns an empty array when every written path was declared', () => {
    const declared = ['packages/a.ts', 'packages/b.ts'];
    assert.deepEqual(findUndeclaredPaths(['packages/a.ts', 'packages/b.ts'], declared), []);
  });

  test('flags a written path absent from the declared list', () => {
    const declared = ['packages/a.ts'];
    assert.deepEqual(findUndeclaredPaths(['packages/a.ts', 'packages/sneaky.ts'], declared), [
      'packages/sneaky.ts',
    ]);
  });

  test('flags multiple undeclared paths independently', () => {
    const declared = ['packages/a.ts'];
    const written = ['packages/a.ts', 'packages/x.ts', 'packages/y.ts'];
    assert.deepEqual(findUndeclaredPaths(written, declared), ['packages/x.ts', 'packages/y.ts']);
  });

  test('a declared path never written is not flagged by THIS function', () => {
    // findUndeclaredPaths only checks the write-side. The declared-but-not-
    // written direction is findUnwrittenPaths's job (see below) - this test
    // pins the split in responsibility, not an "it's fine" verdict.
    const declared = ['packages/a.ts', 'packages/never-written.ts'];
    assert.deepEqual(findUndeclaredPaths(['packages/a.ts'], declared), []);
  });

  test('empty written list is always clean', () => {
    assert.deepEqual(findUndeclaredPaths([], ['packages/a.ts']), []);
  });
});

describe('findUnwrittenPaths', () => {
  test('returns an empty array when every declared path was written', () => {
    const declared = ['packages/a.ts', 'packages/b.ts'];
    assert.deepEqual(findUnwrittenPaths(['packages/a.ts', 'packages/b.ts'], declared), []);
  });

  test('flags a declared path the scaffold never wrote', () => {
    // The exact #237 shape: spec declared 4 files, scaffold wrote 3,
    // silently skipping the worker test suite.
    const declared = [
      'packages/backend/src/api/routes/intelligence.ts',
      'packages/backend/src/queue/workers/intelligence-worker.ts',
      'packages/backend/tests/api/intelligence-routes.test.ts',
      'packages/backend/tests/queue/intelligence-worker.test.ts',
    ];
    const written = declared.slice(0, 3);
    assert.deepEqual(findUnwrittenPaths(written, declared), [
      'packages/backend/tests/queue/intelligence-worker.test.ts',
    ]);
  });

  test('flags multiple unwritten paths independently', () => {
    const declared = ['packages/a.ts', 'packages/b.ts', 'packages/c.ts'];
    assert.deepEqual(findUnwrittenPaths(['packages/b.ts'], declared), [
      'packages/a.ts',
      'packages/c.ts',
    ]);
  });

  test('an extra written path is not flagged by THIS function', () => {
    // Mirror of the split above: over-delivery is findUndeclaredPaths's job.
    const declared = ['packages/a.ts'];
    assert.deepEqual(findUnwrittenPaths(['packages/a.ts', 'packages/extra.ts'], declared), []);
  });

  test('empty written list flags every declared path', () => {
    // main() reaches this case now (it used to exit 0 on an empty
    // FILES_WRITTEN before ever getting here) - see the CLI block below,
    // which pins that end to end.
    assert.deepEqual(findUnwrittenPaths([], ['packages/a.ts', 'packages/b.ts']), [
      'packages/a.ts',
      'packages/b.ts',
    ]);
  });
});

describe('normalizePath', () => {
  test('leaves an already-canonical path untouched', () => {
    assert.equal(normalizePath('packages/backend/src/a.ts'), 'packages/backend/src/a.ts');
  });

  test('strips a leading "./" so the two sides of the comparison agree', () => {
    // generate-impl.mjs emits paths through node's relative(), which never
    // produces a "./" prefix; a spec author (or the model drafting one) can
    // easily write it. Without this they would mismatch in BOTH directions.
    assert.equal(normalizePath('./packages/a.ts'), 'packages/a.ts');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(normalizePath('  packages/a.ts \n'), 'packages/a.ts');
  });

  test('normalizes backslash separators to forward slashes', () => {
    assert.equal(normalizePath('packages\\backend\\src\\a.ts'), 'packages/backend/src/a.ts');
  });
});

// --- CLI-level tests for main() -------------------------------------------
// The escape hatch these pin: an empty FILES_WRITTEN used to exit 0 BEFORE
// the spec was read, so "wrote 0 of N declared files" - the most extreme
// under-delivery there is - passed the very gate built to catch #237.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-impl-scope.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'check-impl-scope-test-'));
after(() => rmSync(DIR, { recursive: true, force: true }));

function writeSpec(name, filesTouched) {
  const path = join(DIR, name);
  writeFileSync(
    path,
    [
      '# Spec: fixture',
      '',
      `**Files touched:** ${filesTouched}`,
      '**Blocking prerequisites:** none',
      '',
      '## Problem',
      '',
      'Fixture spec.',
      '',
    ].join('\n'),
    'utf8'
  );
  return path;
}

/** Runs the real CLI with a clean slate for the two env vars under test. */
function runCli(env) {
  const base = { ...process.env };
  delete base.SPEC_FILE;
  delete base.FILES_WRITTEN;
  delete base.IMPL_SUMMARY;
  return spawnSync(process.execPath, [SCRIPT], { env: { ...base, ...env }, encoding: 'utf8' });
}

describe('CLI', () => {
  const TWO_FILES = '`packages/a.ts`, `packages/b.ts`';

  test('exits 0 when written and declared match exactly', () => {
    const spec = writeSpec('match.md', TWO_FILES);
    const r = runCli({ SPEC_FILE: spec, FILES_WRITTEN: 'packages/a.ts,packages/b.ts' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Impl scope check passed/);
  });

  test('exits 1 when FILES_WRITTEN is empty but the spec declares paths', () => {
    // The regression this whole block exists for: 0-of-N must not pass.
    const spec = writeSpec('empty-written.md', TWO_FILES);
    const r = runCli({ SPEC_FILE: spec, FILES_WRITTEN: '' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Did NOT write files the spec declared/);
    assert.match(r.stderr, /packages\/a\.ts/);
    assert.match(r.stderr, /packages\/b\.ts/);
    assert.match(r.stderr, /wrote NOTHING/);
  });

  test('exits 1 when FILES_WRITTEN is not set at all', () => {
    // Distinct from empty: an unset var means a caller never plumbed it
    // through, which is a configuration error, not a zero-write scaffold.
    const spec = writeSpec('unset-written.md', TWO_FILES);
    const r = runCli({ SPEC_FILE: spec });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Missing FILES_WRITTEN/);
  });

  test('exits 1 on under-delivery, naming only the missing path', () => {
    const spec = writeSpec('under.md', TWO_FILES);
    const r = runCli({ SPEC_FILE: spec, FILES_WRITTEN: 'packages/a.ts' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Did NOT write files the spec declared:\n {2}- packages\/b\.ts/);
    assert.doesNotMatch(r.stderr, /Wrote files the spec never declared/);
  });

  test('under-delivery surfaces IMPL_SUMMARY as an unverified lead when provided', () => {
    const spec = writeSpec('under-with-summary.md', TWO_FILES);
    const r = runCli({
      SPEC_FILE: spec,
      FILES_WRITTEN: 'packages/a.ts',
      IMPL_SUMMARY: 'Wrote both files and the wiring.',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Model's own summary \(unverified/);
    assert.match(r.stderr, /Wrote both files and the wiring\./);
  });

  test('under-delivery omits the summary section when IMPL_SUMMARY is unset', () => {
    const spec = writeSpec('under-no-summary.md', TWO_FILES);
    const r = runCli({ SPEC_FILE: spec, FILES_WRITTEN: 'packages/a.ts' });
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stderr, /Model's own summary/);
  });

  test('a passing run never prints the summary section, even if IMPL_SUMMARY is set', () => {
    const spec = writeSpec('match-with-summary.md', TWO_FILES);
    const r = runCli({
      SPEC_FILE: spec,
      FILES_WRITTEN: 'packages/a.ts,packages/b.ts',
      IMPL_SUMMARY: 'Wrote both files.',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /Model's own summary/);
  });

  test('exits 1 on over-delivery, naming only the undeclared path', () => {
    const spec = writeSpec('over.md', TWO_FILES);
    const r = runCli({
      SPEC_FILE: spec,
      FILES_WRITTEN: 'packages/a.ts,packages/b.ts,packages/sneaky.ts',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Wrote files the spec never declared:\n {2}\+ packages\/sneaky\.ts/);
    assert.doesNotMatch(r.stderr, /Did NOT write files the spec declared/);
  });

  test('reports BOTH directions in a single run', () => {
    const spec = writeSpec('both.md', TWO_FILES);
    const r = runCli({ SPEC_FILE: spec, FILES_WRITTEN: 'packages/a.ts,packages/sneaky.ts' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Wrote files the spec never declared:\n {2}\+ packages\/sneaky\.ts/);
    assert.match(r.stderr, /Did NOT write files the spec declared:\n {2}- packages\/b\.ts/);
  });

  test('a spec that declares "./"-prefixed paths still matches', () => {
    const spec = writeSpec('dot-slash.md', '`./packages/a.ts`, `./packages/b.ts`');
    const r = runCli({ SPEC_FILE: spec, FILES_WRITTEN: 'packages/a.ts,packages/b.ts' });
    assert.equal(r.status, 0, r.stderr);
  });

  test('exits 1 when the spec has no parseable "Files touched" list', () => {
    const path = join(DIR, 'no-files-touched.md');
    writeFileSync(path, '# Spec: fixture\n\n## Problem\n\nNo files field.\n', 'utf8');
    const r = runCli({ SPEC_FILE: path, FILES_WRITTEN: 'packages/a.ts' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no parseable "Files touched:" line/);
  });
});
