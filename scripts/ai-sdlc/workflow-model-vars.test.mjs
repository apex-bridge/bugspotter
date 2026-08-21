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
import { readFileSync } from 'node:fs';
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
