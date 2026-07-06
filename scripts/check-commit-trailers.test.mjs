// Tests for check-commit-trailers.mjs. Zero-dependency: run with `node --test`.
// Wired into .github/workflows/commit-trailers.yml so the guard cannot silently
// rot. The `misplaced` case relies on `git interpret-trailers` being available
// (it is on CI runners and dev machines).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-commit-trailers.mjs', import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), 'trailer-test-'));

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
