// Tests for check-pr-link.mjs. Zero-dependency: run with `node --test`.
// Wired into .github/workflows/pr-link.yml so the guard cannot silently rot.
//
// The invalid-case block is the point of this file: before #269's fix the
// pattern had no trailing boundary, so "#123abc" and "ADR-1234X" false-passed
// the Tier-1 gate. Those cases are asserted as failures here so the boundary
// cannot regress unnoticed.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-pr-link.mjs');
const DIR = mkdtempSync(join(tmpdir(), 'pr-link-test-'));

after(() => rmSync(DIR, { recursive: true, force: true }));

// Run the checker against a PR body via --message; return { code, out }.
function run(body) {
  const file = join(DIR, `body-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, body);
  try {
    const out = execFileSync('node', [SCRIPT, '--message', file], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

// Same, but through the $PR_BODY path the workflow actually uses.
function runEnv(body) {
  try {
    const out = execFileSync('node', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PR_BODY: body },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const VALID = [
  ['plain Closes', 'Closes #123'],
  ['Refs', 'Refs #1'],
  ['Fixes', 'Fixes #42'],
  ['Tracks', 'Tracks #7'],
  ['Resolves', 'Resolves #7'],
  ['References', 'References #7'],
  ['lowercase keyword', 'closes #123'],
  ['uppercase keyword', 'CLOSES #123'],
  ['cross-repo (the #269 case)', 'Refs apex-bridge/bugspotter-intelligence#48'],
  ['cross-repo with dots', 'Closes apex-bridge/apexbridge.tech.site#3'],
  ['cross-repo with underscore', 'Fixes some_owner/some_repo#12'],
  ['ADR alone', 'ADR-0041'],
  ['ADR mid-sentence', 'Implements ADR-0041 as specced.'],
  ['trailing period', 'Closes #123.'],
  ['trailing comma', 'Refs #123, and more'],
  ['inside a longer body', '## Summary\n\nSome prose here.\n\nCloses #202\n\n- a bullet\n'],
  ['multiple spaces after keyword', 'Closes    #123'],
  ['tab after keyword', 'Closes\t#123'],
];

for (const [name, body] of VALID) {
  test(`valid: ${name}`, () => {
    const r = run(body);
    assert.equal(r.code, 0, `expected pass, got exit ${r.code}: ${r.out}`);
    assert.match(r.out, /^OK:/);
  });
}

const INVALID = [
  ['empty body', ''],
  ['whitespace only', '   \n\n  '],
  ['no reference at all', 'Just a description with no link.'],
  ['bare #NNN without a keyword', 'See #123 for details'],
  ['keyword as a leading substring', 'This discloses #123 publicly'],
  ['keyword with no number', 'Closes the loop on this'],
  ['keyword then non-numeric', 'Closes #abc'],
  // Trailing-boundary regressions - these false-passed before the fix.
  ['partial token #123abc', 'Closes #123abc'],
  ['cross-repo partial token', 'Refs apex-bridge/bugspotter#123abc'],
  ['ADR with a trailing letter', 'ADR-1234X'],
  ['ADR as a trailing substring', 'notADR-1234'],
  ['ADR with too few digits', 'ADR-123'],
  ['ADR with too many digits', 'ADR-12345'],
  // grep was line-oriented; the port must stay line-oriented.
  ['keyword and number on separate lines', 'Closes\n#123'],
];

for (const [name, body] of INVALID) {
  test(`invalid: ${name}`, () => {
    const r = run(body);
    assert.equal(r.code, 1, `expected fail, got exit ${r.code}: ${r.out}`);
    assert.match(r.out, /^FAIL:/m);
  });
}

test('failure output names the cross-repo form', () => {
  const r = run('nothing here');
  assert.match(r.out, /owner\/repo#NNN/);
});

test('failure output lists every accepted keyword', () => {
  const r = run('nothing here');
  for (const kw of ['Closes', 'Refs', 'Fixes', 'Tracks', 'Resolves', 'References', 'ADR-NNNN']) {
    assert.match(r.out, new RegExp(kw), `help text omits ${kw}`);
  }
});

test('PR_BODY env path passes on a valid body', () => {
  assert.equal(runEnv('Closes #123').code, 0);
});

test('PR_BODY env path fails closed when unset', () => {
  try {
    const env = { ...process.env };
    delete env.PR_BODY;
    execFileSync('node', [SCRIPT], { encoding: 'utf8', env });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.equal(e.status, 1);
  }
});

test('CRLF body is handled', () => {
  assert.equal(run('## Summary\r\n\r\nCloses #202\r\n').code, 0);
});

test('missing --message argument exits 2', () => {
  try {
    execFileSync('node', [SCRIPT, '--message'], { encoding: 'utf8' });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.equal(e.status, 2);
  }
});

test('unreadable --message file exits 1 with a clean error', () => {
  try {
    execFileSync('node', [SCRIPT, '--message', join(DIR, 'does-not-exist.txt')], {
      encoding: 'utf8',
    });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(`${e.stdout || ''}${e.stderr || ''}`, /cannot read/);
  }
});
