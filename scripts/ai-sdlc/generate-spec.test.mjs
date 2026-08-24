// Tests for generate-spec.mjs's narrated-tool-call detection and corrective
// retry (see detect-narration.mjs). generate-spec.mjs is a top-level script
// with no exports — importing it runs it — so this exercises the real
// script the way generate-impl.test.mjs exercises generate-impl.mjs: by
// spawning it with a temp dir as cwd (generate-spec.mjs reads/writes paths
// relative to process.cwd()) and a fake `claude` binary ahead of everything
// on PATH under LLM_BACKEND=cli, network-free.
//
// The fake dumps every prompt it receives, separated by a boundary marker,
// so a test can assert how many model calls actually happened and inspect
// each prompt's content - the same technique generate-impl.test.mjs uses to
// prove its own corrective-retry feature actually fires (or doesn't).
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

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'generate-spec.mjs');
const BIN_DIR = mkdtempSync(join(tmpdir(), 'generate-spec-bin-'));
const REPO = mkdtempSync(join(tmpdir(), 'generate-spec-repo-'));

after(() => {
  rmSync(BIN_DIR, { recursive: true, force: true });
  rmSync(REPO, { recursive: true, force: true });
});

// generate-spec.mjs reads docs/specs/TEMPLATE.md unconditionally (no
// try/catch) - the fixture repo needs a minimal but real one.
mkdirSync(join(REPO, 'docs', 'specs'), { recursive: true });
writeFileSync(
  join(REPO, 'docs', 'specs', 'TEMPLATE.md'),
  [
    '# Spec: <title>',
    '',
    'Linked issue: Refs #NNN',
    'ADR: pending / docs/adr/NNNN-slug.md / n/a',
    '',
    '**Files touched:** <!-- list -->',
    '**Blocking prerequisites:** <!-- #NNN or none -->',
    '',
    '## Problem',
    '',
    '## Out of scope',
    '',
    '## Constraints',
    '',
    '## Acceptance criteria',
    '',
    '## Changes',
    '',
    '## Tests',
    '',
    '## Verification',
    '',
    'Rollback:',
    '',
  ].join('\n'),
  'utf8'
);

// --- fake `claude` on PATH -------------------------------------------------
// FAKE_CLAUDE_TEXT       - raw text returned on a normal (first-turn) call.
// FAKE_CLAUDE_RETRY_TEXT - raw text returned ONLY when the received prompt
//                          contains "--- CORRECTIVE REMINDER ---" -
//                          generate-spec.mjs's own retry prompt always
//                          includes this, which is what lets the fake tell
//                          the two calls apart across separate spawns.
const IMPL = join(BIN_DIR, 'fake-claude-spec.cjs');
writeFileSync(
  IMPL,
  [
    "const fs = require('node:fs');",
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (d) => { input += d; });",
    "process.stdin.on('end', () => {",
    '  const dump = process.env.FAKE_CLAUDE_PROMPT_DUMP;',
    "  if (dump) fs.appendFileSync(dump, input + '\\n===FAKE_CLAUDE_CALL_BOUNDARY===\\n');",
    "  const isRetry = input.includes('--- CORRECTIVE REMINDER ---');",
    '  const result = isRetry',
    "    ? (process.env.FAKE_CLAUDE_RETRY_TEXT ?? '')",
    "    : (process.env.FAKE_CLAUDE_TEXT ?? '');",
    "  process.stdout.write(JSON.stringify({ type: 'result', result, stop_reason: 'end_turn' }) + '\\n');",
    '});',
    '',
  ].join('\n')
);

const POSIX_BIN = join(BIN_DIR, 'claude');
writeFileSync(POSIX_BIN, `#!/usr/bin/env node\nrequire(${JSON.stringify(IMPL)});\n`);
chmodSync(POSIX_BIN, 0o755);
writeFileSync(join(BIN_DIR, 'claude.cmd'), `@echo off\r\nnode "${IMPL}" %*\r\n`);

const REAL_SPEC_TEXT = [
  '# Spec: Fixture change',
  '',
  'Linked issue: Refs #999',
  'ADR: n/a',
  '',
  '**Files touched:** `packages/backend/src/fixture.ts`',
  '**Blocking prerequisites:** none',
  '',
  '## Problem',
  '',
  'Fixture.',
  '',
  '## Out of scope',
  '',
  '- n/a',
  '',
  '## Constraints',
  '',
  '1. n/a',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] works',
  '',
  '## Changes',
  '',
  '### `packages/backend/src/fixture.ts`',
  '',
  '```ts',
  '// fixture',
  '```',
  '',
  '## Tests',
  '',
  '### `packages/backend/tests/fixture.test.ts`',
  '',
  '**Mock/fixture updates required:**',
  '',
  'none',
  '',
  '**Test case A - fixture (AC #1):**',
  '',
  '```ts',
  'test("x", () => {});',
  '```',
  '',
  '## Verification',
  '',
  '```bash',
  'pnpm test',
  '```',
  '',
  'Rollback: n/a',
  '',
].join('\n');

// Verbatim capture of the real issue #355 / PR #401 failure (see
// detect-narration.test.mjs for provenance).
const NARRATED_TRANSCRIPT_TEXT = `I'll inspect the relevant admin UI files and backend SSO pieces to write an accurate spec.

---

_Tool: bash_

### Parameters:

\`\`\`json
{
  "command": "ls apps/admin/src/pages/ && echo --- && cat apps/admin/src/App.tsx",
  "description": "List admin pages and view App.tsx routing"
}
\`\`\`

### Result:

\`\`\`
admin-organizations.tsx
audit-login.tsx
\`\`\`
`;

let runSeq = 0;
/**
 * Runs the real generate-spec.mjs against the temp repo.
 * @param {{text?: string, retryText?: string, env?: object}} [fakeResponses]
 */
function runGenerateSpec(fakeResponses = {}) {
  const promptDump = join(BIN_DIR, `prompt-${runSeq++}.txt`);
  // Every run in this file targets the same fixture issue (#999), so the
  // same spec path would otherwise survive from one test into the next -
  // e.g. a prior test proving successful content gets written would make a
  // later "must not be written" assertion pass for the wrong reason (a
  // stale file from an earlier run, not this run's own output).
  rmSync(join(REPO, 'docs', 'specs', '0999-fixture-issue.md'), { force: true });
  const env = { ...process.env };
  delete env.GITHUB_OUTPUT;
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
      ISSUE_BODY: 'fixture body',
      FAKE_CLAUDE_PROMPT_DUMP: promptDump,
      ...(fakeResponses.text !== undefined ? { FAKE_CLAUDE_TEXT: fakeResponses.text } : {}),
      ...(fakeResponses.retryText !== undefined
        ? { FAKE_CLAUDE_RETRY_TEXT: fakeResponses.retryText }
        : {}),
      ...(fakeResponses.env ?? {}),
    },
  });
  const dump = existsSync(promptDump) ? readFileSync(promptDump, 'utf8') : null;
  const calls = dump ? dump.split('===FAKE_CLAUDE_CALL_BOUNDARY===').filter((s) => s.trim()) : [];
  return {
    ...result,
    modelCallCount: calls.length,
    firstPrompt: calls[0] ?? null,
    retryPrompt: calls.find((c) => c.includes('--- CORRECTIVE REMINDER ---')) ?? null,
  };
}

describe('generate-spec.mjs prompt', () => {
  test('includes the anti-narration rule', () => {
    const r = runGenerateSpec({ text: REAL_SPEC_TEXT });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.firstPrompt, /You have NO tools available/);
    assert.match(r.firstPrompt, /do not narrate one/);
  });
});

describe('generate-spec.mjs narration detection', () => {
  test('a normal response is written as-is with no retry', () => {
    const r = runGenerateSpec({ text: REAL_SPEC_TEXT });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.modelCallCount, 1, 'no retry should fire for real content');
    const specPath = join(REPO, 'docs', 'specs', '0999-fixture-issue.md');
    assert.ok(existsSync(specPath));
    assert.equal(readFileSync(specPath, 'utf8'), REAL_SPEC_TEXT);
  });

  test('a narrated transcript triggers exactly one corrective retry, and the retry content is written', () => {
    const r = runGenerateSpec({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: REAL_SPEC_TEXT,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.modelCallCount, 2, 'exactly one corrective retry should fire');
    assert.match(r.stderr, /looks like a narrated tool-call transcript/);
    assert.match(r.stdout, /Corrective retry produced real content/);
    // The retry prompt must actually name the rejection reason, not just
    // repeat the original prompt blind.
    assert.match(r.retryPrompt, /was rejected/);
    assert.match(r.retryPrompt, /I'll inspect/);
    const specPath = join(REPO, 'docs', 'specs', '0999-fixture-issue.md');
    assert.ok(existsSync(specPath));
    assert.equal(readFileSync(specPath, 'utf8'), REAL_SPEC_TEXT);
  });

  test('a narrated transcript on both calls fails loudly and writes nothing', () => {
    const r = runGenerateSpec({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: NARRATED_TRANSCRIPT_TEXT,
    });
    assert.equal(r.status, 1);
    assert.equal(r.modelCallCount, 2, 'the one allowed corrective retry should still fire');
    assert.match(r.stderr, /::error::generate-spec\.mjs/);
    assert.match(r.stderr, /still looks like a narrated tool-call transcript/);
    assert.match(r.stderr, /after one corrective retry/);
    const specPath = join(REPO, 'docs', 'specs', '0999-fixture-issue.md');
    assert.equal(existsSync(specPath), false, 'must never write a detected transcript to disk');
  });

  test('the ACTUAL captured issue #355 content is detected and, with no fix-up retry text configured, fails loudly on both turns', () => {
    // Reproduces the real #355/#401 incident end-to-end through the actual
    // script: given the exact text that shipped as the broken spec, and a
    // (still broken) fake retry response, the pipeline must refuse to write
    // it - the opposite of what actually happened in production.
    const r = runGenerateSpec({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: NARRATED_TRANSCRIPT_TEXT,
    });
    assert.equal(r.status, 1);
    const specPath = join(REPO, 'docs', 'specs', '0999-fixture-issue.md');
    assert.equal(existsSync(specPath), false);
  });

  test('skips the retry and fails immediately when the step budget leaves no safe headroom', () => {
    const r = runGenerateSpec({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: REAL_SPEC_TEXT,
      env: { SPEC_STEP_BUDGET_MS: '1000' },
    });
    assert.equal(r.status, 1);
    assert.equal(
      r.modelCallCount,
      1,
      'a collapsed budget must prevent the corrective retry entirely'
    );
    assert.match(r.stderr, /not enough for a safe corrective retry/);
    const specPath = join(REPO, 'docs', 'specs', '0999-fixture-issue.md');
    assert.equal(existsSync(specPath), false);
  });
});
