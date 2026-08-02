// Tests for generate-impl.mjs's over-cap preflight (the MAX_LINES_PER_FILE
// guard that refuses to call the model when the spec declares a file too big
// to show the model in full).
//
// generate-impl.mjs is a top-level script with no exports — importing it runs
// it — so the guard is exercised the way check-impl-scope.test.mjs exercises
// its main(): by spawning the real CLI. Two things make that safe and
// network-free here:
//   - a temp dir is passed as cwd, and generate-impl.mjs takes `repoRoot` from
//     process.cwd(), so fixtures of an exact line count can stand in for real
//     repo files;
//   - LLM_BACKEND=cli plus a fake `claude` ahead of everything on PATH (the
//     same harness llm-client.test.mjs uses), so a run that gets *past* the
//     guard talks to the fake instead of the API.
//
// The fake dumps the prompt it received. That is what makes the pass-side
// assertions non-vacuous: absence of the dump proves the guard fired before
// the model call, and its contents prove an at-cap file was injected whole
// rather than silently labelled TRUNCATED.
//
// Zero-dependency, run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Must match MAX_LINES_PER_FILE in generate-impl.mjs.
const MAX_LINES_PER_FILE = 1000;

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'generate-impl.mjs');
const BIN_DIR = mkdtempSync(join(tmpdir(), 'generate-impl-bin-'));
const REPO = mkdtempSync(join(tmpdir(), 'generate-impl-repo-'));

after(() => {
  rmSync(BIN_DIR, { recursive: true, force: true });
  rmSync(REPO, { recursive: true, force: true });
});

// --- fake `claude` on PATH -------------------------------------------------
// Drains stdin before answering: callViaCli writes the whole prompt to the
// child's stdin, and the prompt here carries a ~1000-line fixture.
const IMPL = join(BIN_DIR, 'fake-claude-impl.cjs');
writeFileSync(
  IMPL,
  [
    "const fs = require('node:fs');",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (d) => { input += d; });",
    "process.stdin.on('end', () => {",
    '  const dump = process.env.FAKE_CLAUDE_PROMPT_DUMP;',
    '  if (dump) fs.writeFileSync(dump, input);',
    '  const payload = {',
    "    files: [{ path: 'packages/generated.ts', content: 'export const generated = true;\\n' }],",
    "    summary: 'fake impl',",
    '  };',
    "  process.stdout.write(JSON.stringify({ result: JSON.stringify(payload), stop_reason: 'end_turn' }));",
    '});',
    '',
  ].join('\n')
);

const POSIX_BIN = join(BIN_DIR, 'claude');
writeFileSync(POSIX_BIN, `#!/usr/bin/env node\nrequire(${JSON.stringify(IMPL)});\n`);
chmodSync(POSIX_BIN, 0o755);
writeFileSync(join(BIN_DIR, 'claude.cmd'), `@echo off\r\nnode "${IMPL}" %*\r\n`);

// --- fixtures --------------------------------------------------------------
/** Writes `count` numbered lines plus the trailing newline every real file has. */
function writeFixture(relPath, count) {
  const abs = join(REPO, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    `${Array.from({ length: count }, (_, i) => `const l${i} = ${i};`).join('\n')}\n`,
    'utf8'
  );
  return relPath;
}

const AT_CAP = writeFixture('packages/at-cap.ts', MAX_LINES_PER_FILE);
const OVER_CAP = writeFixture('packages/over-cap.ts', MAX_LINES_PER_FILE + 1);
const SMALL = writeFixture('packages/small.ts', 12);

function spec(...paths) {
  return [
    '# Spec: fixture',
    '',
    `**Files touched:** ${paths.map((p) => `\`${p}\``).join(', ')}`,
    '**Blocking prerequisites:** none',
    '',
    '## Problem',
    '',
    'Fixture spec.',
    '',
  ].join('\n');
}

let runSeq = 0;
/** Runs the real generate-impl.mjs against the temp repo. */
function runImpl(specContent) {
  const promptDump = join(BIN_DIR, `prompt-${runSeq++}.txt`);
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
  delete env.ISSUE_LABELS;
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO,
    encoding: 'utf8',
    env: {
      ...env,
      PATH: `${BIN_DIR}${process.platform === 'win32' ? ';' : ':'}${env.PATH}`,
      LLM_BACKEND: 'cli',
      CLAUDE_CODE_OAUTH_TOKEN: 'test-oauth-token',
      ISSUE_NUMBER: '999',
      ISSUE_TITLE: 'fixture issue',
      SPEC_CONTENT: specContent,
      FAKE_CLAUDE_PROMPT_DUMP: promptDump,
    },
  });
  return {
    ...result,
    modelWasCalled: existsSync(promptDump),
    prompt: existsSync(promptDump) ? readFileSync(promptDump, 'utf8') : null,
  };
}

describe('over-cap preflight', () => {
  test('refuses before the model call when a declared file is over the cap', () => {
    const r = runImpl(spec(OVER_CAP));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /Refusing to call the model/);
    assert.match(r.stderr, /packages\/over-cap\.ts/);
    // The reported count is the file's real line count, not split('\n').length.
    assert.match(r.stderr, new RegExp(`\\(${MAX_LINES_PER_FILE + 1} lines\\)`));
    // The whole point of the guard: no paid run happened.
    assert.equal(r.modelWasCalled, false, 'guard must fire before the model call');
  });

  test('a file of exactly MAX_LINES_PER_FILE lines is at the cap, not over it', () => {
    // The trailing newline every real file carries makes split('\n') return
    // MAX_LINES_PER_FILE + 1 entries. Counting those raw would fail this run
    // with "larger than the cap" for a file that is exactly at it.
    const r = runImpl(spec(AT_CAP));
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /Refusing to call the model/);
    assert.equal(r.modelWasCalled, true);
    assert.match(r.stdout, /Injecting current content of 1 existing declared file/);
    assert.doesNotMatch(r.stdout, /truncated/);
    // Injected whole: both the first and the last line reach the model, and
    // no TRUNCATED banner tells the model to treat it as read-only.
    assert.ok(r.prompt.includes('const l0 = 0;'));
    assert.ok(r.prompt.includes(`const l${MAX_LINES_PER_FILE - 1} = ${MAX_LINES_PER_FILE - 1};`));
    assert.doesNotMatch(r.prompt, /TRUNCATED/);
  });

  test('a declared file that does not exist yet does not trip the guard', () => {
    // New-file specs are the common case; existsSync filters them out before
    // the line count is ever taken, and they must not read as over-cap.
    const r = runImpl(spec('packages/brand-new.ts', SMALL));
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /Refusing to call the model/);
    assert.equal(r.modelWasCalled, true);
    assert.match(r.stdout, /Injecting current content of 1 existing declared file/);
  });

  test('names every over-cap file, not just the first', () => {
    const r = runImpl(spec(SMALL, OVER_CAP, AT_CAP));
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /declares 1 file\(s\) larger/);
    assert.match(r.stderr, /packages\/over-cap\.ts/);
    // At-cap and under-cap siblings must not be listed as offenders.
    assert.doesNotMatch(r.stderr, /packages\/at-cap\.ts/);
    assert.doesNotMatch(r.stderr, /packages\/small\.ts/);
  });
});
