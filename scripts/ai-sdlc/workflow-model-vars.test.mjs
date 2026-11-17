// Regression guard for a real, previously-silent bug (2026-08-21): an
// env-var-driven default in an .mjs script (LLM_DEFAULT_MODEL, IMPL_MODEL_*)
// is NOT automatically populated from a same-named GitHub Actions repo
// variable. Each consuming workflow STEP needs its own explicit
// `env: KEY: ${{ vars.KEY }}` mapping, or setting the repo variable in
// Settings silently does nothing - the script always falls back to its
// hardcoded default. `LLM_DEFAULT_MODEL` shipped in llm-client.mjs without
// that mapping ever being added to spec-agent.yml/adr-agent.yml; nothing
// caught it until it was asked about directly. This file asserts the
// mapping exists in the specific step that runs the consuming script, not
// just somewhere in the file - a full YAML-semantics engine is overkill,
// but a plain "is this file present" substring check would pass even if the
// mapping were on the wrong step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Returns the YAML lines for the step that runs `scriptName`, from that
 * step's `- name:` line through its `run:` line (inclusive) - enough to
 * regex-match against that step's own `env:` block without matching a
 * same-named var mapped on a different, unrelated step in the same file.
 *
 * Matches only an actual `run:` line, not `.includes(scriptName)` anywhere -
 * these workflow files have header comments mentioning a script by name
 * (e.g. "generate-spec.mjs (450s)") well before the real step, which a bare
 * substring search would match instead of the step itself.
 */
function stepBlockForRun(yamlText, scriptName) {
  const lines = yamlText.split('\n');
  const runPattern = new RegExp(`run:\\s*node\\s+scripts/ai-sdlc/${scriptName}\\b`);
  const runIdx = lines.findIndex((l) => runPattern.test(l));
  assert.notEqual(runIdx, -1, `no "run: node scripts/ai-sdlc/${scriptName}" line found`);
  let startIdx = runIdx;
  while (startIdx > 0 && !/^\s*- name:/.test(lines[startIdx])) {
    startIdx--;
  }
  assert.match(
    lines[startIdx],
    /^\s*- name:/,
    `no "- name:" boundary found scanning back from the "run: node scripts/ai-sdlc/${scriptName}" line - would silently return an over-broad block spanning earlier steps`
  );
  return lines.slice(startIdx, runIdx + 1).join('\n');
}

function readWorkflow(name) {
  return readFileSync(join(REPO_ROOT, '.github/workflows', name), 'utf8');
}

test('spec-agent.yml wires LLM_DEFAULT_MODEL into the generate-spec.mjs step', () => {
  const block = stepBlockForRun(readWorkflow('spec-agent.yml'), 'generate-spec.mjs');
  assert.match(block, /LLM_DEFAULT_MODEL:\s*\$\{\{\s*vars\.LLM_DEFAULT_MODEL\s*\}\}/);
});

test('spec-agent.yml wires LLM_DEFAULT_MODEL into the verify-spec.mjs step', () => {
  const block = stepBlockForRun(readWorkflow('spec-agent.yml'), 'verify-spec.mjs');
  assert.match(block, /LLM_DEFAULT_MODEL:\s*\$\{\{\s*vars\.LLM_DEFAULT_MODEL\s*\}\}/);
});

test('adr-agent.yml wires LLM_DEFAULT_MODEL into the generate-adr.mjs step', () => {
  const block = stepBlockForRun(readWorkflow('adr-agent.yml'), 'generate-adr.mjs');
  assert.match(block, /LLM_DEFAULT_MODEL:\s*\$\{\{\s*vars\.LLM_DEFAULT_MODEL\s*\}\}/);
});

test('impl-agent.yml wires IMPL_MODEL_HIGH/_DEFAULT/_LOW into the generate-impl.mjs step', () => {
  const block = stepBlockForRun(readWorkflow('impl-agent.yml'), 'generate-impl.mjs');
  assert.match(block, /IMPL_MODEL_HIGH:\s*\$\{\{\s*vars\.IMPL_MODEL_HIGH\s*\}\}/);
  assert.match(block, /IMPL_MODEL_DEFAULT:\s*\$\{\{\s*vars\.IMPL_MODEL_DEFAULT\s*\}\}/);
  assert.match(block, /IMPL_MODEL_LOW:\s*\$\{\{\s*vars\.IMPL_MODEL_LOW\s*\}\}/);
});

// claude-review.yml's model selection is referenced directly inside the
// `${{ }}` expression on the --model line itself, not via a step `env:`
// mapping - `vars.*` is available in any `${{ }}` context in the file, so
// there's no separate mapping step to check. A plain presence check is the
// right level of rigor here.
test('claude-review.yml references CLAUDE_REVIEW_MODEL_AUTO and _HUMAN repo variables', () => {
  const yaml = readWorkflow('claude-review.yml');
  assert.match(yaml, /vars\.CLAUDE_REVIEW_MODEL_AUTO/);
  assert.match(yaml, /vars\.CLAUDE_REVIEW_MODEL_HUMAN/);
});

// adr-agent.yml: the step limit and the script's budget come from one checked
// value (review of #459: '12m' broke fromJSON, 0 and 25 drifted from the script
// or the job's 30 minutes).
function resolveStepTimeoutScript() {
  const lines = readWorkflow('adr-agent.yml').split('\n');
  const start = lines.findIndex((l) => /- name: Resolve step timeout/.test(l));
  assert.notEqual(start, -1, 'no "Resolve step timeout" step');
  const run = lines.findIndex((l, i) => i > start && /^\s*run: \|\s*$/.test(l));
  const indent = lines[run + 1].match(/^\s*/)[0];
  const body = [];
  for (
    let i = run + 1;
    i < lines.length && (lines[i].startsWith(indent) || !lines[i].trim());
    i++
  ) {
    body.push(lines[i].slice(indent.length));
  }
  return body.join('\n');
}

test('adr-agent.yml: Generate ADR takes its limit and budget from the checked value', () => {
  const block = stepBlockForRun(readWorkflow('adr-agent.yml'), 'generate-adr.mjs');
  assert.match(
    block,
    /timeout-minutes:\s*\$\{\{\s*fromJSON\(steps\.budget\.outputs\.minutes\)\s*\}\}/
  );
  assert.match(
    block,
    /ADR_STEP_TIMEOUT_MINUTES:\s*\$\{\{\s*steps\.budget\.outputs\.minutes\s*\}\}/
  );
  assert.doesNotMatch(block, /vars\.ADR_STEP_TIMEOUT_MINUTES/);
});

test('adr-agent.yml: the step timeout accepts whole minutes 1-20 and uses 20 otherwise', (t) => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  if (process.platform === 'win32' && !existsSync(bash)) {
    t.skip('no Git Bash');
    return;
  }
  const script = resolveStepTimeoutScript();
  const dir = mkdtempSync(join(tmpdir(), 'adr-budget-'));
  try {
    const cases = {
      '': '20',
      20: '20',
      1: '1',
      '08': '8',
      0: '20',
      25: '20',
      '12m': '20',
      0.5: '20',
    };
    for (const [raw, want] of Object.entries(cases)) {
      const out = join(dir, `out-${want}-${raw || 'unset'}`);
      writeFileSync(out, '');
      execFileSync(bash, ['-c', script], { env: { ...process.env, RAW: raw, GITHUB_OUTPUT: out } });
      assert.equal(readFileSync(out, 'utf8').trim(), `minutes=${want}`, `RAW=${raw}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
