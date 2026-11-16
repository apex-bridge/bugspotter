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

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'generate-adr.mjs');
const BIN_DIR = mkdtempSync(join(tmpdir(), 'generate-adr-bin-'));
const REPO = mkdtempSync(join(tmpdir(), 'generate-adr-repo-'));

after(() => {
  rmSync(BIN_DIR, { recursive: true, force: true });
  rmSync(REPO, { recursive: true, force: true });
});

// --- fake `claude` on PATH (identical shape to generate-spec.test.mjs's,
// including FAKE_CLAUDE_RETRY_STOP_REASON for exercising a truncated retry) -
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
    '  if (process.env.FAKE_CLAUDE_ARGV_DUMP) fs.writeFileSync(process.env.FAKE_CLAUDE_ARGV_DUMP, JSON.stringify(process.argv.slice(2)));',
    "  if (dump) fs.appendFileSync(dump, input + '\\n===FAKE_CLAUDE_CALL_BOUNDARY===\\n');",
    "  const isRetry = input.includes('--- CORRECTIVE REMINDER ---');",
    '  const result = isRetry',
    "    ? (process.env.FAKE_CLAUDE_RETRY_TEXT ?? '')",
    "    : (process.env.FAKE_CLAUDE_TEXT ?? '');",
    '  const stop_reason =',
    '    isRetry && process.env.FAKE_CLAUDE_RETRY_STOP_REASON',
    '      ? process.env.FAKE_CLAUDE_RETRY_STOP_REASON',
    "      : 'end_turn';",
    "  process.stdout.write(JSON.stringify({ type: 'result', result, stop_reason }) + '\\n');",
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

// A fixture template with a unique marker, so tests can tell whether the
// prompt was built from TEMPLATE.md.
const TEMPLATE_TEXT = [
  '# ADR-NNNN: <short decision title>',
  '',
  '<!-- TEMPLATE_MARKER_7f3a: fixture rules -->',
  '',
  '## Context',
  '## Decision',
  '## Consequences',
  '## Alternatives',
  '',
].join('\n');

function writeRepoFile(path, body) {
  const full = join(REPO, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

let runSeq = 0;
/**
 * Runs the real generate-adr.mjs against the temp repo.
 * @param {{text?: string, retryText?: string, env?: object, files?: object, noTemplate?: boolean}} [fakeResponses]
 */
function runGenerateAdr(fakeResponses = {}) {
  const promptDump = join(BIN_DIR, `prompt-${runSeq++}.txt`);
  // All runs in this file target the same fixture issue and the same "next
  // ADR number" (0001, since docs/adr starts empty each time) - clear any
  // ADR a prior run in this file wrote so a stale file can't make a "must
  // not be written" assertion pass for the wrong reason.
  rmSync(join(REPO, 'docs', 'adr'), { recursive: true, force: true });
  rmSync(join(REPO, 'packages'), { recursive: true, force: true });
  if (!fakeResponses.noTemplate) {
    writeRepoFile('docs/adr/TEMPLATE.md', TEMPLATE_TEXT);
  }
  for (const [path, body] of Object.entries(fakeResponses.files ?? {})) {
    writeRepoFile(path, body);
  }
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

  test('a corrective retry truncated by max_tokens is rejected even with no narration markers left in it', () => {
    // The retry content below deliberately contains none of the STRONG/WEAK
    // markers detectNarratedToolCall looks for and does not open with a
    // narration opener - without the stopReason check, this would pass
    // narration detection and get written verbatim as a truncated ADR.
    const r = runGenerateAdr({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: '# ADR-0001: Fixture decision\n\n- Status: Proposed\n- Area: fixture',
      env: { FAKE_CLAUDE_RETRY_STOP_REASON: 'max_tokens' },
    });
    assert.equal(r.status, 1);
    assert.equal(r.modelCallCount, 2, 'the one allowed corrective retry should still fire');
    assert.match(r.stderr, /::error::generate-adr\.mjs/);
    assert.match(r.stderr, /corrective retry response truncated/);
    assert.equal(
      existsSync(adrPath()),
      false,
      'a truncated corrective retry must never be written, marker-free or not'
    );
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

// --- TEMPLATE.md, full spec, file name, table inventory (PR for ADR format) ---

const DB_MIGRATION = [
  'CREATE TABLE IF NOT EXISTS fixture_projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid());',
  'CREATE TABLE fixture_users (id UUID, email TEXT);',
  'ALTER TABLE fixture_projects ADD COLUMN organization_id UUID;',
  '',
].join('\n');
const MIGRATION_FILES = {
  'packages/backend/src/db/migrations/001_fixture.sql': DB_MIGRATION,
};

describe('generate-adr.mjs uses docs/adr/TEMPLATE.md', () => {
  test('T1: the prompt carries the template and not the newest existing ADR', () => {
    const r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      files: {
        'docs/adr/0001-older-decision.md':
          '# ADR-0001: Older\n\nNEWEST_ADR_MARKER_91c2 long prose\n',
      },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.firstPrompt, /TEMPLATE_MARKER_7f3a/);
    assert.doesNotMatch(r.firstPrompt, /NEWEST_ADR_MARKER_91c2/);
    assert.doesNotMatch(r.firstPrompt, /## Options considered/, 'old inline template is gone');
    assert.match(r.firstPrompt, /# ADR-0002: <title>/, 'numbering still skips existing ADRs');
    assert.doesNotMatch(r.firstPrompt, /LINKED SPEC/, 'no spec, so no spec rule');
  });

  test('T2: a missing template fails before any model call and writes nothing', () => {
    const r = runGenerateAdr({ text: REAL_ADR_TEXT, noTemplate: true });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Missing docs\/adr\/TEMPLATE\.md/);
    assert.equal(r.modelCallCount, 0);
    assert.equal(existsSync(adrPath()), false);
  });
});

describe('generate-adr.mjs passes the whole spec', () => {
  test('T3a: text far past the old 1,500-character cut reaches the prompt', () => {
    const spec = `# Spec: fixture\n\nADR: pending\n\n${'x'.repeat(20_000)}\nSPEC_TAIL_MARKER_5d0e\n`;
    const r = runGenerateAdr({ text: REAL_ADR_TEXT, env: { SPEC_CONTENT: spec } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.firstPrompt, /SPEC_TAIL_MARKER_5d0e/);
    assert.match(
      r.firstPrompt,
      /- Do not contradict the LINKED SPEC\./,
      'spec rule appears with a spec'
    );
  });

  test('T3b: a runaway spec is cut at 60,000 characters with a visible note', () => {
    const spec = `# Spec: fixture\n${'y'.repeat(70_000)}\nBEYOND_CAP_MARKER_aa11\n`;
    const r = runGenerateAdr({ text: REAL_ADR_TEXT, env: { SPEC_CONTENT: spec } });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.firstPrompt, /BEYOND_CAP_MARKER_aa11/);
    assert.match(r.firstPrompt, /\[spec truncated at 60000 characters\]/);
  });
});

describe('generate-adr.mjs file name', () => {
  test("T4a: the spec's ADR field sets the file name when its number is the next free one", () => {
    const spec = '# Spec: fixture\n\nADR: docs/adr/0001-postgres-row-level-security.md\n';
    const r = runGenerateAdr({ text: REAL_ADR_TEXT, env: { SPEC_CONTENT: spec } });
    assert.equal(r.status, 0, r.stderr);
    const expected = join(REPO, 'docs', 'adr', '0001-postgres-row-level-security.md');
    assert.ok(existsSync(expected), 'ADR written under the spec-declared name');
    assert.equal(existsSync(adrPath()), false, 'not under the title slug');
    assert.match(r.stdout, /adr_slug=postgres-row-level-security/);
  });

  test('T4b: a spec naming a taken number falls back to the title slug with a warning', () => {
    const spec = '# Spec: fixture\n\nADR: docs/adr/0007-something-else.md\n';
    const r = runGenerateAdr({ text: REAL_ADR_TEXT, env: { SPEC_CONTENT: spec } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(adrPath()), 'falls back to 0001-fixture-issue.md');
    assert.match(r.stderr, /next free ADR number is 0001/);
  });
});

describe('generate-adr.mjs table inventory', () => {
  test('T5a: a database-related issue gets the computed inventory', () => {
    const r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      files: MIGRATION_FILES,
      env: { ISSUE_TITLE: 'Row-level security for tenant tables' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.firstPrompt, /TABLE INVENTORY/);
    assert.match(
      r.firstPrompt,
      /\| fixture_projects \| org-scoped \| organization_id \| 001_fixture\.sql \|/
    );
    assert.match(r.firstPrompt, /\| fixture_users \| global \| none \| 001_fixture\.sql \|/);
    assert.match(r.firstPrompt, /\(2 tables, computed from/);
  });

  test('T5b: an unrelated issue gets no inventory even when migrations exist', () => {
    const r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      files: MIGRATION_FILES,
      env: { ISSUE_TITLE: 'Admin sidebar icon colours', ISSUE_BODY: 'Make icons match the brand.' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.firstPrompt, /TABLE INVENTORY/);
    assert.doesNotMatch(r.firstPrompt, /fixture_projects/);
  });
});

describe('generate-adr.mjs sends the decision sections of a templated spec', () => {
  test('T3c: constraints reach the prompt; the spec tests and verification do not', () => {
    const spec = [
      '# Spec: fixture',
      '',
      'ADR: docs/adr/0001-fixture-issue.md',
      '',
      '## Problem',
      'PROBLEM_MARKER_e1',
      '## Constraints',
      '1. CONSTRAINT_MARKER_e2',
      '## Acceptance criteria',
      '- [ ] AC_MARKER_e3',
      '## Tests',
      'TESTS_MARKER_e4',
      '## Verification',
      'VERIFY_MARKER_e5',
      '',
    ].join('\n');
    const r = runGenerateAdr({ text: REAL_ADR_TEXT, env: { SPEC_CONTENT: spec } });
    assert.equal(r.status, 0, r.stderr);
    for (const m of ['PROBLEM_MARKER_e1', 'CONSTRAINT_MARKER_e2', 'AC_MARKER_e3']) {
      assert.ok(r.firstPrompt.includes(m), `missing ${m}`);
    }
    assert.doesNotMatch(r.firstPrompt, /TESTS_MARKER_e4|VERIFY_MARKER_e5/);
  });
});

const rlsAdrPath = () => join(REPO, 'docs', 'adr', '0001-row-level-security-for-tenant-tables.md');

describe('generate-adr.mjs appends the table inventory itself', () => {
  test('T5c: appendix built from the migrations plus the model global-table reasons', () => {
    const modelText = [
      REAL_ADR_TEXT.trimEnd(),
      '',
      '### Table inventory',
      '| fixture_users | org-scoped | wrong model row |',
      '',
      '## Global tables',
      '- fixture_users: users belong to several organizations',
      '',
    ].join('\n');
    const r = runGenerateAdr({
      text: modelText,
      files: MIGRATION_FILES,
      env: { ISSUE_TITLE: 'Row-level security for tenant tables' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.firstPrompt, /end your document with a section "## Global tables"/);
    const out = readFileSync(rlsAdrPath(), 'utf8');
    assert.match(out, /^## Appendix: Table inventory$/m);
    assert.match(out, /^\| fixture_projects \| org-scoped \| has organization_id \|$/m);
    assert.match(out, /^\| fixture_users \| global \| users belong to several organizations \|$/m);
    assert.doesNotMatch(out, /wrong model row/);
    assert.doesNotMatch(out, /^## Global tables$/m);
    assert.equal((out.match(/^### Table inventory$/gm) || []).length, 1);
  });

  test('T5d: a global table without a reason is marked and warned about', () => {
    const r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      files: MIGRATION_FILES,
      env: { ISSUE_TITLE: 'Row-level security for tenant tables' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(rlsAdrPath(), 'utf8'), /^\| fixture_users \| global \| {2}\|$/m);
    assert.match(r.stderr, /No reason given for global table\(s\): fixture_users/);
  });
});

describe('generate-adr.mjs review fixes', () => {
  test('T4c: when the spec number is taken, its ADR outline is still selected by the spec path', () => {
    const spec = [
      '# Spec: fixture',
      '',
      'ADR: docs/adr/0007-security.md',
      '',
      '## Problem',
      'P',
      '## Changes',
      '### `docs/adr/0007-security.md`',
      'OUTLINE_FOR_SPEC_PATH_c4',
      '## Tests',
      'T',
      '',
    ].join('\n');
    const r = runGenerateAdr({ text: REAL_ADR_TEXT, env: { SPEC_CONTENT: spec } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(adrPath()), 'output renumbered to 0001 with the title slug');
    assert.match(r.firstPrompt, /OUTLINE_FOR_SPEC_PATH_c4/);
  });

  test('T5e: "PostgreSQL" / "database" issues get the inventory', () => {
    const r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      files: MIGRATION_FILES,
      env: {
        ISSUE_TITLE: 'PostgreSQL tenant isolation',
        ISSUE_BODY: 'Restrict database access by organization.',
      },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.firstPrompt, /TABLE INVENTORY/);
  });
});

describe('generate-adr.mjs inventory trigger', () => {
  test('T5f: a spec that merely mentions tables or a schema gets no inventory', () => {
    const spec =
      '# Spec: fixture\n\n## Problem\nThe retry table in the worker schema is slow.\n## Constraints\n1. Keep the database migration additive.\n';
    const r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      files: MIGRATION_FILES,
      env: { ISSUE_TITLE: 'Worker retry policy', SPEC_CONTENT: spec },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.firstPrompt, /TABLE INVENTORY/);
    const out = readFileSync(join(REPO, 'docs', 'adr', '0001-worker-retry-policy.md'), 'utf8');
    assert.doesNotMatch(out, /Table inventory/);
  });
});

describe('generate-adr.mjs settings', () => {
  test('S1: ADR_EFFORT reaches the CLI as --effort; unset adds nothing', () => {
    const argvDump = join(BIN_DIR, 'argv-settings.json');
    let r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      env: { ADR_EFFORT: 'medium', FAKE_CLAUDE_ARGV_DUMP: argvDump },
    });
    assert.equal(r.status, 0, r.stderr);
    let argv = JSON.parse(readFileSync(argvDump, 'utf8'));
    assert.equal(argv[argv.indexOf('--effort') + 1], 'medium');

    r = runGenerateAdr({ text: REAL_ADR_TEXT, env: { FAKE_CLAUDE_ARGV_DUMP: argvDump } });
    assert.equal(r.status, 0, r.stderr);
    argv = JSON.parse(readFileSync(argvDump, 'utf8'));
    assert.equal(argv.includes('--effort'), false);
  });

  test('S2: ADR_MAX_SPEC_CHARS caps the spec input', () => {
    const spec = `# Spec: fixture\n${'z'.repeat(500)}\nAFTER_CAP_MARKER_s2\n`;
    const r = runGenerateAdr({
      text: REAL_ADR_TEXT,
      env: { SPEC_CONTENT: spec, ADR_MAX_SPEC_CHARS: '200' },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.firstPrompt, /AFTER_CAP_MARKER_s2/);
    assert.match(r.firstPrompt, /\[spec truncated at 200 characters\]/);
  });

  test('S3: ADR_STEP_TIMEOUT_MINUTES sets the time budget the retry checks', () => {
    const r = runGenerateAdr({
      text: NARRATED_TRANSCRIPT_TEXT,
      retryText: REAL_ADR_TEXT,
      env: { ADR_STEP_TIMEOUT_MINUTES: '0.01' },
    });
    assert.equal(r.status, 1);
    assert.equal(r.modelCallCount, 1, 'a 0.6s budget leaves no room for a retry');
    assert.match(r.stderr, /not enough for a safe corrective retry/);
  });
});
