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
//
// Configurable via env vars so the same fake can play both turns of a
// self-correction round-trip:
//   FAKE_CLAUDE_FILES            - JSON array of {path, content} for a normal
//                                  (first-turn) call. Defaults to the single
//                                  packages/generated.ts fixture the original
//                                  over-cap tests depend on.
//   FAKE_CLAUDE_RETRY_FILES      - JSON array of {path, content} returned ONLY
//                                  when the received prompt contains the literal
//                                  "--- CORRECTIVE FOLLOW-UP ---" marker
//                                  generate-impl.mjs's own retry prompt always
//                                  includes - this is what lets the fake tell
//                                  the calls apart without any shared state
//                                  across separate child-process spawns.
//                                  Defaults to an empty files array (a corrective
//                                  call that still can't produce the files) when
//                                  unset.
//   FAKE_CLAUDE_QUALITY_RESPONSE - raw response text for a call whose prompt
//                                  contains the "--- QUALITY SELF-REVIEW ---"
//                                  marker. Unlike the two above, this is NOT
//                                  JSON-encoded into a {files, summary}
//                                  envelope by the fake — it's returned
//                                  verbatim as the model's `result`, since a
//                                  real quality-review response is either the
//                                  literal string NO_CHANGES_NEEDED or a
//                                  {files, summary} JSON string, and tests
//                                  need to exercise both. Defaults to
//                                  NO_CHANGES_NEEDED when unset.
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
    // Appended, not overwritten: a self-correction round-trip spawns this
    // fake twice in one generate-impl.mjs run, and both prompts need to
    // reach the test, in order, separated so neither can be mistaken for
    // a substring of the other.
    "  if (dump) fs.appendFileSync(dump, input + '\\n===FAKE_CLAUDE_CALL_BOUNDARY===\\n');",
    "  const isQuality = input.includes('--- QUALITY SELF-REVIEW ---');",
    "  const isRetry = !isQuality && input.includes('--- CORRECTIVE FOLLOW-UP ---');",
    '  let result;',
    '  if (isQuality) {',
    "    result = process.env.FAKE_CLAUDE_QUALITY_RESPONSE || 'NO_CHANGES_NEEDED';",
    '  } else {',
    '    const files = isRetry',
    "      ? JSON.parse(process.env.FAKE_CLAUDE_RETRY_FILES || '[]')",
    '      : JSON.parse(',
    '          process.env.FAKE_CLAUDE_FILES ||',
    '            \'[{"path":"packages/generated.ts","content":"export const generated = true;\\\\n"}]\'',
    '        );',
    "    result = JSON.stringify({ files, summary: isRetry ? 'fake retry' : 'fake impl' });",
    '  }',
    "  process.stdout.write(JSON.stringify({ type: 'result', result, stop_reason: 'end_turn' }) + '\\n');",
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
/**
 * Runs the real generate-impl.mjs against the temp repo.
 * @param {string} specContent
 * @param {{files?: object[], retryFiles?: object[], qualityResponse?: string, env?: object}} [fakeResponses] -
 *   what the fake `claude` returns on the first call, the corrective
 *   follow-up call (if a self-correction round-trip fires), and the quality
 *   self-review call, plus any extra env vars to set on the child (e.g. the
 *   IMPL_*_MS overrides).
 */
function runImpl(specContent, fakeResponses = {}) {
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
      ...(fakeResponses.files ? { FAKE_CLAUDE_FILES: JSON.stringify(fakeResponses.files) } : {}),
      ...(fakeResponses.retryFiles
        ? { FAKE_CLAUDE_RETRY_FILES: JSON.stringify(fakeResponses.retryFiles) }
        : {}),
      ...(fakeResponses.qualityResponse !== undefined
        ? { FAKE_CLAUDE_QUALITY_RESPONSE: fakeResponses.qualityResponse }
        : {}),
      ...(fakeResponses.env ?? {}),
    },
  });
  const dump = existsSync(promptDump) ? readFileSync(promptDump, 'utf8') : null;
  const calls = dump ? dump.split('===FAKE_CLAUDE_CALL_BOUNDARY===').filter((s) => s.trim()) : [];
  return {
    ...result,
    modelWasCalled: calls.length > 0,
    modelCallCount: calls.length,
    prompt: calls[0] ?? null,
    // Marker-based, not positional: whether the retry fires or not shifts
    // the quality call's position (calls[1] or calls[2]), and asserting the
    // wrong index would silently read null instead of failing loudly.
    retryPrompt: calls.find((c) => c.includes('--- CORRECTIVE FOLLOW-UP ---')) ?? null,
    qualityPrompt: calls.find((c) => c.includes('--- QUALITY SELF-REVIEW ---')) ?? null,
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

describe('self-correction on a missing declared file', () => {
  test('makes one corrective follow-up call and writes the recovered file', () => {
    const r = runImpl(spec('packages/a.ts', 'packages/b.ts'), {
      files: [{ path: 'packages/a.ts', content: 'export const a = 1;\n' }],
      retryFiles: [{ path: 'packages/b.ts', content: 'export const b = 2;\n' }],
    });
    assert.equal(r.status, 0, r.stderr);
    // turn 1 + one corrective follow-up + the quality self-review pass.
    assert.equal(r.modelCallCount, 3, 'expected exactly one corrective follow-up call');
    assert.match(r.stdout, /missing: packages\/b\.ts/);
    assert.match(r.stdout, /corrective follow-up turn/);
    assert.match(r.stdout, /Wrote packages\/a\.ts/);
    assert.match(r.stdout, /Wrote packages\/b\.ts/);
    assert.match(r.stdout, /Corrective follow-up recovered 1\/1 file\(s\)/);
    assert.match(
      r.stdout,
      /corrective follow-up recovered 1 of 1 missing file\(s\): packages\/b\.ts/
    );
    // The retry prompt must actually tell the model what's missing and
    // what was already covered - not just repeat the original prompt blind.
    assert.match(r.retryPrompt, /packages\/b\.ts/);
    assert.match(r.retryPrompt, /packages\/a\.ts/);
  });

  test('does not retry when the first response already covers every declared file', () => {
    const r = runImpl(spec('packages/a.ts'), {
      files: [{ path: 'packages/a.ts', content: 'export const a = 1;\n' }],
    });
    assert.equal(r.status, 0, r.stderr);
    // turn 1 + the quality self-review pass; no retry, since nothing was missing.
    assert.equal(r.modelCallCount, 2, 'no declared file was missing, so no retry should fire');
    assert.doesNotMatch(r.stdout, /corrective follow-up/);
  });

  test('falls through cleanly when the corrective call also fails to produce the file', () => {
    // FAKE_CLAUDE_RETRY_FILES left unset -> the fake's corrective-turn
    // default is an empty files array, simulating a retry that still
    // doesn't recover the gap.
    const r = runImpl(spec('packages/a.ts', 'packages/b.ts'), {
      files: [{ path: 'packages/a.ts', content: 'export const a = 1;\n' }],
    });
    assert.equal(r.status, 0, r.stderr);
    // turn 1 + the corrective follow-up + the quality self-review pass.
    assert.equal(r.modelCallCount, 3);
    assert.match(r.stdout, /Wrote packages\/a\.ts/);
    assert.doesNotMatch(r.stdout, /Wrote packages\/b\.ts/);
    // Turn 1 still succeeded and wrote what it had - the remaining gap is
    // check-impl-scope.mjs's job to report, not this script's to loop on.
  });

  test('does not claim a file was recovered when the retry returns the wrong path', () => {
    // The confabulation this whole self-correction feature must not repeat:
    // the retry DOES return a file (so it looks superficially successful),
    // but it's not the path that was actually missing. The summary must
    // report reality (nothing recovered), not the retry's own claim.
    const r = runImpl(spec('packages/a.ts', 'packages/b.ts'), {
      files: [{ path: 'packages/a.ts', content: 'export const a = 1;\n' }],
      retryFiles: [{ path: 'packages/wrong-file.ts', content: 'export const w = 1;\n' }],
    });
    assert.equal(r.status, 0, r.stderr);
    // turn 1 + the corrective follow-up + the quality self-review pass.
    assert.equal(r.modelCallCount, 3);
    assert.match(r.stdout, /Wrote packages\/a\.ts/);
    assert.match(r.stdout, /Wrote packages\/wrong-file\.ts/);
    assert.doesNotMatch(r.stdout, /Wrote packages\/b\.ts/);
    assert.match(r.stdout, /Corrective follow-up recovered none of the missing file\(s\)/);
    assert.match(r.stdout, /recovered none of the.*missing file\(s\): packages\/b\.ts/);
  });

  test('over-delivery (an undeclared extra file) does not trigger a retry', () => {
    // Self-correction targets under-delivery specifically; an extra file
    // is a different problem (drift, not a gap) that check-impl-scope.mjs
    // already reports on its own.
    const r = runImpl(spec('packages/a.ts'), {
      files: [
        { path: 'packages/a.ts', content: 'export const a = 1;\n' },
        { path: 'packages/sneaky.ts', content: 'export const sneaky = 1;\n' },
      ],
    });
    assert.equal(r.status, 0, r.stderr);
    // turn 1 + the quality self-review pass; no retry (nothing was missing).
    assert.equal(r.modelCallCount, 2);
  });

  test('skips the retry when IMPL_STEP_BUDGET_MS leaves no safe headroom', () => {
    // A file's worth of headroom is missing but the env override collapses
    // the step budget to less than the safety buffer alone, so remainingMs
    // goes negative - the retry must not fire even though it otherwise
    // would for this exact spec/response pair (see the first test above).
    const r = runImpl(spec('packages/a.ts', 'packages/b.ts'), {
      files: [{ path: 'packages/a.ts', content: 'export const a = 1;\n' }],
      retryFiles: [{ path: 'packages/b.ts', content: 'export const b = 2;\n' }],
      env: { IMPL_STEP_BUDGET_MS: '1000' },
    });
    assert.equal(r.status, 0, r.stderr);
    // Same collapsed budget also starves the quality self-review pass below
    // it, so this stays at 1 - the only test in this file where it does.
    assert.equal(
      r.modelCallCount,
      1,
      'a collapsed budget must prevent the corrective call entirely'
    );
    assert.match(r.stdout, /not enough for a safe corrective call/);
    assert.match(r.stdout, /Skipping quality self-review/);
    assert.doesNotMatch(r.stdout, /Wrote packages\/b\.ts/);
  });

  test('an empty-string IMPL_STEP_BUDGET_MS falls back to the default, not a collapsed 0 budget', () => {
    // GitHub Actions resolves an unconfigured `vars.*` reference to an
    // empty string, not an unset env var - Number('') is 0, not NaN, so a
    // naive `envValue !== undefined` check would silently disable every
    // future corrective call the moment this ever gets wired to a repo
    // variable that isn't configured yet.
    const r = runImpl(spec('packages/a.ts', 'packages/b.ts'), {
      files: [{ path: 'packages/a.ts', content: 'export const a = 1;\n' }],
      retryFiles: [{ path: 'packages/b.ts', content: 'export const b = 2;\n' }],
      env: { IMPL_STEP_BUDGET_MS: '' },
    });
    assert.equal(r.status, 0, r.stderr);
    // turn 1 + the corrective follow-up + the quality self-review pass.
    assert.equal(r.modelCallCount, 3, 'an empty override must not collapse the budget to 0');
    assert.match(r.stdout, /Wrote packages\/b\.ts/);
  });
});

describe('quality self-review pass', () => {
  test('applies a revision when the model finds duplication or extract-worthy complexity', () => {
    const original = 'function h() {\n  return 1;\n}\n';
    const revised = 'function helper() {\n  return 1;\n}\nfunction h() {\n  return helper();\n}\n';
    const r = runImpl(spec('packages/a.ts'), {
      files: [{ path: 'packages/a.ts', content: original }],
      qualityResponse: JSON.stringify({
        files: [{ path: 'packages/a.ts', content: revised }],
        summary: 'extracted a shared helper',
      }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.modelCallCount, 2, 'turn 1 + the quality self-review pass');
    assert.match(r.stdout, /Quality self-review revised packages\/a\.ts/);
    assert.match(r.stdout, /quality self-review revised 1 file\(s\): extracted a shared helper/);
    const onDisk = readFileSync(join(REPO, 'packages/a.ts'), 'utf8');
    assert.equal(onDisk, revised, 'the revised content must actually land on disk');
    assert.ok(r.qualityPrompt.includes('packages/a.ts'));
    assert.ok(r.qualityPrompt.includes(original.trim()), 'prompt must include the written content');
  });

  test('leaves already-clean output untouched when the model finds nothing', () => {
    const original = 'export const a = 1;\n';
    const r = runImpl(spec('packages/a.ts'), {
      files: [{ path: 'packages/a.ts', content: original }],
      qualityResponse: 'NO_CHANGES_NEEDED',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.modelCallCount, 2);
    assert.match(r.stdout, /no significant duplication or extract-worthy complexity found/);
    assert.doesNotMatch(r.stdout, /Quality self-review revised/);
    const onDisk = readFileSync(join(REPO, 'packages/a.ts'), 'utf8');
    assert.equal(onDisk, original, 'a no-op response must not touch the file at all');
  });

  test("ignores a revision naming a path outside this run's own output", () => {
    const original = 'export const a = 1;\n';
    const r = runImpl(spec('packages/a.ts'), {
      files: [{ path: 'packages/a.ts', content: original }],
      qualityResponse: JSON.stringify({
        files: [{ path: 'packages/not-written.ts', content: 'export const sneaky = 1;\n' }],
        summary: 'should be rejected',
      }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /named a path outside this run's own output/);
    assert.doesNotMatch(r.stdout, /Quality self-review revised/);
    assert.equal(
      existsSync(join(REPO, 'packages/not-written.ts')),
      false,
      'must not create a file outside what turn 1 actually wrote'
    );
    const onDisk = readFileSync(join(REPO, 'packages/a.ts'), 'utf8');
    assert.equal(onDisk, original);
  });

  test('skips gracefully when the quality response is not parseable JSON', () => {
    const original = 'export const a = 1;\n';
    const r = runImpl(spec('packages/a.ts'), {
      files: [{ path: 'packages/a.ts', content: original }],
      qualityResponse: 'not json and not NO_CHANGES_NEEDED either',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /Quality self-review response was not parseable JSON/);
    const onDisk = readFileSync(join(REPO, 'packages/a.ts'), 'utf8');
    assert.equal(onDisk, original);
  });

  test('is skipped entirely below its own budget floor, independent of the corrective-retry one', () => {
    const r = runImpl(spec('packages/a.ts'), {
      files: [{ path: 'packages/a.ts', content: 'export const a = 1;\n' }],
      qualityResponse: JSON.stringify({
        files: [{ path: 'packages/a.ts', content: 'export const a = 2;\n' }],
        summary: 'should never be applied',
      }),
      // Default STEP_BUDGET_MS (21m) minus SAFETY_BUFFER_MS (4m) leaves far
      // less than this 30m floor in any real test run, so the pass must
      // skip even though STEP_BUDGET_MS itself is untouched and would have
      // let the corrective retry (if one were needed) fire normally.
      env: { IMPL_QUALITY_MIN_BUDGET_MS: String(30 * 60_000) },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.modelCallCount, 1, 'quality pass must not fire below its own budget floor');
    assert.match(r.stdout, /Skipping quality self-review/);
    const onDisk = readFileSync(join(REPO, 'packages/a.ts'), 'utf8');
    assert.equal(onDisk, 'export const a = 1;\n');
  });

  test('rejects a revision targeting a written file the model only saw truncated', () => {
    const overCapContent = `${Array.from(
      { length: MAX_LINES_PER_FILE + 1 },
      (_, i) => `const l${i} = ${i};`
    ).join('\n')}\n`;
    const r = runImpl(spec('packages/big.ts'), {
      files: [{ path: 'packages/big.ts', content: overCapContent }],
      qualityResponse: JSON.stringify({
        files: [{ path: 'packages/big.ts', content: 'export const shortened = true;\n' }],
        summary: 'should be rejected',
      }),
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stderr,
      /proposed a change to a file excluded from its view, skipping to avoid data loss/
    );
    assert.doesNotMatch(r.stdout, /Quality self-review revised/);
    const onDisk = readFileSync(join(REPO, 'packages/big.ts'), 'utf8');
    assert.equal(
      onDisk,
      overCapContent,
      'the file must keep its full content, not be replaced by a revision built from a truncated view'
    );
  });
});
