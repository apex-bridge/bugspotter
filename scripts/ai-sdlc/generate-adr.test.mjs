// Tests for generate-adr.mjs's narrated-tool-call detection and corrective
// retry (see detect-narration.mjs). Mirrors generate-spec.test.mjs's
// approach: generate-adr.mjs is a top-level script with no exports, so this
// spawns the real script against a temp dir cwd with a fake `claude` binary
// on PATH under LLM_BACKEND=cli, network-free.
//
// Zero-dependency, run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'generate-adr.mjs');
const BIN_DIR = mkdtempSync(join(tmpdir(), 'generate-adr-bin-'));
const REPO = mkdtempSync(join(tmpdir(), 'generate-adr-repo-'));

after(() => {
  rmSync(BIN_DIR, { recursive: true, force: true });
  rmSync(REPO, { recursive: true, force: true });
});

// --- fake `claude` on PATH (identical shape to generate-spec.test.mjs's) --
const IMPL = join(BIN_DIR, 'fake-claude-adr.cjs');
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

const REAL_ADR_TEXT = [
  '# ADR-0001: Fixture decision',
  '',
  '- Status: Proposed',
  '- Area: fixture',
  '- Date: 2026-08-24',
  '- Refs: #999',
  '',
  '## Context',
  '',
  'Fixture.',
  '',
  '## Options considered',
  '',
  '1. **Option A** - fixture',
  '',
  '## Decision',
  '',
  'Fixture decision.',
  '',
  '## Consequences',
  '',
  '**Positive:** fixture',
  '**Negative / accepted:** fixture',
  '**Neutral:** fixture',
  '',
].join('\n');

// Verbatim capture of the real issue #355 / PR #401 narrated-transcript
// failure (see detect-narration.test.mjs for provenance) - reused here since
// generate-adr.mjs shares generate-spec.mjs's exact generation shape and is
// vulnerable to the identical failure.
const NARRATED_TRANSCRIPT_TEXT = `I'll inspect the relevant admin UI files and backend SSO pieces to write an accurate ADR.

---

_Tool: bash_

### Parameters:

\`\`\`json
{ "command": "ls apps/admin/src/pages/", "description": "List admin pages" }
\`\`\`

### Result:

\`\`\`
admin-organizations.tsx
audit-login.tsx
\`\`\`
`;

let runSeq = 0;
/**
 * Runs the real generate-adr.mjs against the temp repo.
 * @param {{text?: string, retryText?: string, env?: object}} [fakeResponses]
 */
function runGenerateAdr(fakeResponses = {}) {
  const promptDump = join(BIN_DIR, `prompt-${runSeq++}.txt`);
  // All runs in this file target the same fixture issue and the same "next
  // ADR number" (0001, since docs/adr starts empty each time) - clear any
  // ADR a prior run in this file wrote so a stale file can't make a "must
  // not be written" assertion pass for the wrong reason.
  rmSync(join(REPO, 'docs', 'adr'), { recursive: true, force: true });
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

const adrPath = () => join(REPO, 'docs', 'adr', '0001-fixture-issue.md');

describe('generate-adr.mjs prompt', () => {
  test('includes the anti-narration rule', () => {
    const r = runGenerateAdr({ text: REAL_ADR_TEXT });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.firstPrompt, /You have NO tools available/);
    assert.match(r.firstPrompt, /do not narrate one/);
  });
});

describe('generate-adr.mjs narration detection', () => {
  test('a normal response is written as-is with no retry', () => {
    const r = runGenerateAdr({ text: REAL_ADR_TEXT });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.modelCallCount, 1, 'no retry should fire for real content');
    assert.ok(existsSync(adrPath()));
    assert.equal(readFileSync(adrPath(), 'utf8'), REAL_ADR_TEXT);
  });

  test('a narrated transcript triggers exactly one corrective retry, and the retry content is written', () => {
    const r = runGenerateAdr({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: REAL_ADR_TEXT,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.modelCallCount, 2, 'exactly one corrective retry should fire');
    assert.match(r.stderr, /looks like a narrated tool-call transcript/);
    assert.match(r.stdout, /Corrective retry produced real content/);
    assert.match(r.retryPrompt, /was rejected/);
    assert.ok(existsSync(adrPath()));
    assert.equal(readFileSync(adrPath(), 'utf8'), REAL_ADR_TEXT);
  });

  test('a narrated transcript on both calls fails loudly and writes nothing', () => {
    const r = runGenerateAdr({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: NARRATED_TRANSCRIPT_TEXT,
    });
    assert.equal(r.status, 1);
    assert.equal(r.modelCallCount, 2, 'the one allowed corrective retry should still fire');
    assert.match(r.stderr, /::error::generate-adr\.mjs/);
    assert.match(r.stderr, /still looks like a narrated tool-call transcript/);
    assert.match(r.stderr, /after one corrective retry/);
    assert.equal(existsSync(adrPath()), false, 'must never write a detected transcript to disk');
  });

  test('skips the retry and fails immediately when the step budget leaves no safe headroom', () => {
    const r = runGenerateAdr({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: REAL_ADR_TEXT,
      env: { ADR_STEP_BUDGET_MS: '1000' },
    });
    assert.equal(r.status, 1);
    assert.equal(
      r.modelCallCount,
      1,
      'a collapsed budget must prevent the corrective retry entirely'
    );
    assert.match(r.stderr, /not enough for a safe corrective retry/);
    assert.equal(existsSync(adrPath()), false);
  });
});
