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
  // Markdown emphasis. "_" is a word character, so a \b-based boundary would
  // reject these even though the body plainly reads as a reference.
  ['italic underscores', '_Closes #123_'],
  ['bold underscores', '__Closes #123__'],
  ['italic underscores around an ADR', '_ADR-0041_'],
  ['italic asterisks', '*Closes #123*'],
  ['bold asterisks', '**Closes #123**'],
  ['inline code', '`Closes #123`'],
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
  // Non-ASCII partial tokens. A \b-based boundary is ASCII-only in JS and
  // would let these through, reopening the class of bug the boundary exists
  // to close.
  ['ADR with a trailing accented letter', 'ADR-1234é'],
  ['ADR with a trailing CJK character', 'ADR-1234你'],
  ['trailing Cyrillic after the number', 'Closes #123д'],
  ['leading Cyrillic before the keyword', 'дcloses #123'],
  // A separator between keyword and reference is required (\s+, not \s*).
  ['keyword glued to the number', 'Closes#123'],
  ['keyword glued to a cross-repo ref', 'Closes' + 'owner/repo#1'],
  // The owner/repo prefix is constrained: real path characters only, and the
  // slash is not optional.
  ['prefix with colons', 'Closes a:b/c:d#1'],
  ['prefix with no slash', 'Closes foo#123'],
  ['prefix with a space in it', 'Closes own er/repo#1'],
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

// Named for what it actually asserts. The \r? in the split is defensive only:
// a trailing \r is neither a digit nor a letter, so the boundary lookaheads
// hold with or without it, and no input distinguishes /\r?\n/ from /\n/ here.
// Do not read this as coverage of the split itself.
test('a CRLF body still passes', () => {
  assert.equal(run('## Summary\r\n\r\nCloses #202\r\n').code, 0);
});

test('a CRLF body with no reference still fails', () => {
  assert.equal(run('## Summary\r\n\r\nno link here\r\n').code, 1);
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

// --- Gate-4 advisory warning ---
//
// An implementation PR using a closing keyword auto-closes its issue on merge,
// so the issue never reaches `needs-deploy` and Gate 4 is silently skipped
// (PR #283, caught by hand). These assert the warning fires without ever
// changing the exit code - the hard guard is gate-guard.yml, on the issue.

// Same as runEnv, but with a branch name, which is what selects impl PRs.
function runBranch(body, headRef) {
  try {
    const out = execFileSync('node', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, PR_BODY: body, HEAD_REF: headRef },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('warns, but still passes, when an impl PR uses a closing keyword', () => {
  const r = runBranch('Closes #269', 'impl/issue-269-llm-unavailable');
  assert.equal(r.code, 0, 'the warning must never fail the required check');
  assert.match(r.out, /::warning::/);
  assert.match(r.out, /Gate 4/);
  assert.match(r.out, /Refs #NNN/);
});

test('does not warn when an impl PR uses Refs', () => {
  const r = runBranch('Refs #269', 'impl/issue-269-llm-unavailable');
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /::warning::/);
});

test('does not warn on a non-impl branch, even with a closing keyword', () => {
  // Ordinary PRs legitimately close issues; only the pipeline's impl PRs are
  // subject to Gate 4.
  const r = runBranch('Closes #123', 'fix/some-bug');
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /::warning::/);
});

test('warns on closing keyword forms the accept-list itself does not take', () => {
  // "Fixed"/"Closed"/"Resolved" still auto-close on GitHub but are not in
  // REFERENCE, so the body needs a separate valid reference to pass at all.
  for (const kw of ['Fixed', 'Closed', 'Resolved']) {
    const r = runBranch(`Refs #1\n${kw} #269`, 'impl/x');
    assert.equal(r.code, 0);
    assert.match(r.out, /::warning::/, `${kw} must be recognised as closing`);
  }
});

test('no branch name means no warning', () => {
  const r = runBranch('Closes #269', '');
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /::warning::/);
});
