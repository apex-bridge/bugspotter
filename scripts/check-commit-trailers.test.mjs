// Tests for check-commit-trailers.mjs. Zero-dependency: run with `node --test`.
// Wired into .github/workflows/commit-trailers.yml so the guard cannot silently
// rot. The `misplaced` case relies on `git interpret-trailers` being available
// (it is on CI runners and dev machines).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-commit-trailers.mjs', import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'trailer-test-'));

after(() => rmSync(DIR, { recursive: true, force: true }));

// Run the checker against a commit-message body; return { code, out }.
function run(body) {
  const file = join(DIR, `msg-${Math.random().toString(36).slice(2)}.txt`);
  writeFileSync(file, body);
  try {
    const out = execFileSync('node', [SCRIPT, '--message', file], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

test('valid, well-placed trailer passes', () => {
  assert.equal(run('feat: x\n\nAssisted-by: claude-opus-4-8 (agent)\n').code, 0);
});

test('malformed trailer fails with reason', () => {
  const r = run('feat: x\n\nAssisted-by: claude-opus-4-8\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /malformed/);
});

test('misplaced trailer (not final block) fails with reason', () => {
  const r = run('feat: x\n\nAssisted-by: claude-opus-4-8 (agent)\n\nmore body after it\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /misplaced/);
});

test('double-spaced trailer reports malformed, not misplaced', () => {
  const r = run('feat: x\n\nAssisted-by:  claude-opus-4-8 (agent)\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /malformed/);
  assert.doesNotMatch(r.out, /misplaced/);
});

test('editor comment lines are ignored', () => {
  assert.equal(run('feat: x\n\nAssisted-by: claude-opus-4-8 (agent)\n# a comment\n').code, 0);
});

test('no trailer passes (presence is not forced)', () => {
  assert.equal(run('feat: x\n\njust a human commit\n').code, 0);
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
    execFileSync('node', [SCRIPT, '--message', join(DIR, 'does-not-exist.txt')], { encoding: 'utf8' });
    assert.fail('expected non-zero exit');
  } catch (e) {
    assert.equal(e.status, 1);
    assert.match(`${e.stdout || ''}${e.stderr || ''}`, /cannot read/);
  }
});

// Integration test for the --range path (the CI gate). Builds a throwaway
// repo with a good commit and a malformed one, then checks the range.
test('range mode catches a malformed trailer across commits', () => {
  const repo = mkdtempSync(join(tmpdir(), 'trailer-repo-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'a.txt'), '1');
    git('add', '-A');
    git('commit', '-q', '-m', 'good\n\nAssisted-by: claude-opus-4-8 (agent)');
    const base = git('rev-parse', 'HEAD').trim();
    writeFileSync(join(repo, 'b.txt'), '2');
    git('add', '-A');
    git('commit', '-q', '-m', 'bad\n\nAssisted-by: claude-opus-4-8'); // no (agent)
    const head = git('rev-parse', 'HEAD').trim();
    try {
      execFileSync('node', [SCRIPT, '--range', `${base}..${head}`], { cwd: repo, encoding: 'utf8' });
      assert.fail('expected non-zero exit');
    } catch (e) {
      assert.equal(e.status, 1);
      assert.match(`${e.stdout || ''}${e.stderr || ''}`, /malformed/);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
