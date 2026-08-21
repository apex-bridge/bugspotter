// Tests for check-spec-scope.mjs's pure logic, plus a CLI block for the
// hard/soft dispatch in main() (SPEC_SCOPE_HARD), which isn't pure logic
// and can only be exercised by actually running the script. Zero-dependency,
// run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFanOut, resolveCap, DEFAULT_CAP } from './check-spec-scope.mjs';

describe('resolveCap', () => {
  test('parses a valid numeric string', () => {
    assert.equal(resolveCap('10'), 10);
  });

  test('falls back to DEFAULT_CAP when unset', () => {
    assert.equal(resolveCap(undefined), DEFAULT_CAP);
    assert.equal(resolveCap(''), DEFAULT_CAP);
  });

  test('falls back to DEFAULT_CAP for a whitespace-only value', () => {
    // Number('   ') is 0, not NaN — a naive check would silently turn a
    // whitespace-only SPEC_SCOPE_CAP into a zero-file cap instead of
    // treating it as unset.
    assert.equal(resolveCap('   '), DEFAULT_CAP);
    assert.equal(resolveCap('\t\n'), DEFAULT_CAP);
  });

  test('falls back to DEFAULT_CAP for non-numeric input', () => {
    assert.equal(resolveCap('abc'), DEFAULT_CAP);
  });

  test('falls back to DEFAULT_CAP for a negative or fractional value', () => {
    assert.equal(resolveCap('-1'), DEFAULT_CAP);
    assert.equal(resolveCap('2.5'), DEFAULT_CAP);
  });

  test('zero is a valid cap', () => {
    assert.equal(resolveCap('0'), 0);
  });
});

describe('checkFanOut', () => {
  test('returns null when the count is at or below the cap', () => {
    const paths = Array.from({ length: DEFAULT_CAP }, (_, i) => `packages/a/${i}.ts`);
    assert.equal(checkFanOut(paths), null);
  });

  test('returns a warning string when the count exceeds the cap', () => {
    const paths = Array.from({ length: DEFAULT_CAP + 1 }, (_, i) => `packages/a/${i}.ts`);
    const warning = checkFanOut(paths);
    assert.ok(warning);
    assert.match(warning, /declares 7 files touched/);
  });

  test('respects a custom cap', () => {
    const paths = ['a', 'b', 'c'];
    assert.equal(checkFanOut(paths, 3), null);
    assert.ok(checkFanOut(paths, 2));
  });

  test('empty list never warns', () => {
    assert.equal(checkFanOut([]), null);
  });
});

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-spec-scope.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'check-spec-scope-test-'));
after(() => rmSync(DIR, { recursive: true, force: true }));

function writeSpec(name, fileCount) {
  const path = join(DIR, name);
  const files = Array.from({ length: fileCount }, (_, i) => `\`packages/a/${i}.ts\``).join(', ');
  writeFileSync(
    path,
    [
      '# Spec: fixture',
      '',
      `**Files touched:** ${files}`,
      '',
      '## Problem',
      '',
      'Fixture.',
      '',
    ].join('\n'),
    'utf8'
  );
  return path;
}

/** Runs the real CLI with a clean slate for the env vars under test. */
function runCli(env) {
  const base = { ...process.env };
  delete base.SPEC_FILE;
  delete base.SPEC_SCOPE_CAP;
  delete base.SPEC_SCOPE_HARD;
  return spawnSync(process.execPath, [SCRIPT], { env: { ...base, ...env }, encoding: 'utf8' });
}

describe('CLI: SPEC_SCOPE_HARD dispatch', () => {
  test('over cap, SPEC_SCOPE_HARD unset: exits 0, still warns', () => {
    const spec = writeSpec('over-soft.md', DEFAULT_CAP + 1);
    const r = runCli({ SPEC_FILE: spec });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /::warning::/);
    assert.match(r.stderr, /files touched \(cap: 6\)/);
  });

  test('over cap, SPEC_SCOPE_HARD=true: exits 1', () => {
    const spec = writeSpec('over-hard.md', DEFAULT_CAP + 1);
    const r = runCli({ SPEC_FILE: spec, SPEC_SCOPE_HARD: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error::/);
    assert.match(r.stderr, /files touched \(cap: 6\)/);
  });

  test('over cap, SPEC_SCOPE_HARD set to something other than "true": stays soft', () => {
    const spec = writeSpec('over-hard-typo.md', DEFAULT_CAP + 1);
    const r = runCli({ SPEC_FILE: spec, SPEC_SCOPE_HARD: 'yes' });
    assert.equal(r.status, 0, r.stderr);
  });

  test('within cap, SPEC_SCOPE_HARD=true: exits 0, no finding', () => {
    const spec = writeSpec('within-hard.md', DEFAULT_CAP);
    const r = runCli({ SPEC_FILE: spec, SPEC_SCOPE_HARD: 'true' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /within cap/);
  });

  test('unreadable spec file, SPEC_SCOPE_HARD unset: exits 0 (soft waves it through)', () => {
    const r = runCli({ SPEC_FILE: join(DIR, 'does-not-exist.md') });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /could not read spec file/);
  });

  test('unreadable spec file, SPEC_SCOPE_HARD=true: exits 1 (hard gate cannot be bypassed by an I/O error)', () => {
    const r = runCli({ SPEC_FILE: join(DIR, 'does-not-exist.md'), SPEC_SCOPE_HARD: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error::/);
    assert.match(r.stderr, /could not read spec file/);
  });

  test('no parseable "Files touched:" line, SPEC_SCOPE_HARD unset: exits 0 (soft skips)', () => {
    const path = join(DIR, 'no-files-touched-soft.md');
    writeFileSync(path, '# Spec: fixture\n\n## Problem\n\nNo files field.\n', 'utf8');
    const r = runCli({ SPEC_FILE: path });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /no "Files touched:" line found/);
  });

  test('no parseable "Files touched:" line, SPEC_SCOPE_HARD=true: exits 1 (a malformed spec is a real finding, not a skip)', () => {
    const path = join(DIR, 'no-files-touched-hard.md');
    writeFileSync(path, '# Spec: fixture\n\n## Problem\n\nNo files field.\n', 'utf8');
    const r = runCli({ SPEC_FILE: path, SPEC_SCOPE_HARD: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error::/);
    assert.match(r.stderr, /no "Files touched:" line found/);
  });

  test('"Files touched:" marker present but empty, SPEC_SCOPE_HARD=true: exits 1, not "0 files within cap"', () => {
    // extractDeclaredPaths returns [] (not null) for a marker with no
    // parseable backtick path - truthy, so `!declaredPaths` alone would
    // silently pass this as "0 files declared, within cap" in hard mode.
    const path = join(DIR, 'empty-marker-hard.md');
    writeFileSync(
      path,
      '# Spec: fixture\n\n**Files touched:**\n\n## Problem\n\nFixture.\n',
      'utf8'
    );
    const r = runCli({ SPEC_FILE: path, SPEC_SCOPE_HARD: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error::/);
    assert.match(r.stderr, /no "Files touched:" line found/);
    assert.doesNotMatch(r.stdout, /within cap/);
  });

  test('"Files touched:" marker present but empty, SPEC_SCOPE_HARD unset: exits 0 (soft skips, same as no marker at all)', () => {
    const path = join(DIR, 'empty-marker-soft.md');
    writeFileSync(
      path,
      '# Spec: fixture\n\n**Files touched:**\n\n## Problem\n\nFixture.\n',
      'utf8'
    );
    const r = runCli({ SPEC_FILE: path });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /no "Files touched:" line found/);
  });
});
