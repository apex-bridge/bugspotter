#!/usr/bin/env node
// Calls Claude to draft a spec document for a GitHub issue.
// Run from the repo root. Reads TEMPLATE.md; writes docs/specs/<file>.
// Outputs spec_file, spec_slug, padded_number, and model to GITHUB_OUTPUT.
//
// Required env vars: ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, plus either
//   ANTHROPIC_API_KEY (default) or CLAUDE_CODE_OAUTH_TOKEN (LLM_BACKEND=cli)
// Optional:          GITHUB_OUTPUT (set by Actions; falls back to stdout print)

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { callClaude, requireLlmCredentials, CLI_MODEL } from './llm-client.mjs';
import { detectNarratedToolCall } from './detect-narration.mjs';

// Captured before any file reads or BFS repo scanning below so the retry
// budget math (see scriptStartedAt's use further down) measures real elapsed
// step time, not elapsed-time-minus-setup-work.
const scriptStartedAt = Date.now();

const { ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, GITHUB_OUTPUT } = process.env;

requireLlmCredentials();
if (!ISSUE_NUMBER) {
  console.error('Missing ISSUE_NUMBER');
  process.exit(1);
}
if (!ISSUE_TITLE) {
  console.error('Missing ISSUE_TITLE');
  process.exit(1);
}

const template = readFileSync('docs/specs/TEMPLATE.md', 'utf8');

const slug = ISSUE_TITLE.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

const padded = String(ISSUE_NUMBER).padStart(4, '0');
const specFile = `docs/specs/${padded}-${slug}.md`;

// Build a source-file tree so the agent can reference accurate paths and
// spot which files exist before writing the spec. Each root gets its own
// 80-entry budget using true level-order BFS: all entries at depth N are
// collected before any entry at depth N+1 is visited. To prevent a wide
// directory from crowding out peer directories within the same BFS level,
// at most 15 entries per directory are added to results; directories are
// still queued for BFS traversal regardless of the per-dir cap.
const BUDGET_PER_ROOT = 80;
const MAX_ENTRIES_PER_DIR = 15;

function scanDir(rootDir) {
  const results = [];
  let currentLevel = [rootDir];
  while (currentLevel.length > 0 && results.length < BUDGET_PER_ROOT * 5) {
    const nextLevel = [];
    for (const dir of currentLevel) {
      if (results.length >= BUDGET_PER_ROOT * 5) {
        break;
      }
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      let addedFromDir = 0;
      for (const name of entries) {
        if (results.length >= BUDGET_PER_ROOT * 5) {
          break;
        }
        if (name.startsWith('.') || name === 'node_modules' || name === 'dist') {
          continue;
        }
        const full = join(dir, name).replace(/\\/g, '/');
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          nextLevel.push(full);
        }
        if (addedFromDir < MAX_ENTRIES_PER_DIR) {
          results.push(full);
          addedFromDir++;
        }
      }
    }
    currentLevel = nextLevel;
  }
  return results.slice(0, BUDGET_PER_ROOT);
}

const sourceTree = [
  'packages/backend/src',
  'packages/backend/tests',
  'packages/backend-mock',
  'packages/billing/src',
  'packages/billing/tests',
  'packages/message-broker/src',
  'packages/message-broker/tests',
  'packages/payment-service/src',
  'packages/payment-service/tests',
  'packages/types/src',
  'packages/utils/src',
  'apps',
]
  .flatMap((dir) => scanDir(dir))
  .join('\n');

// The ADR index is the canonical cross-repo architecture record (which repo
// owns which component, language, service boundaries — see docs/adr/README.md
// itself). Without this, the spec-agent has only a same-repo file listing to
// go on and will invent plausible-but-wrong architecture facts for anything
// that lives outside this repo — e.g. it once fabricated a TypeScript
// in-monorepo path for `bugspotter-intelligence`, which docs/adr/0007 records
// as a separate Python/FastAPI service in its own repo. That spec got
// ratified and built as real (wrong) files before anyone caught it (#226/#238).
function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
const adrIndex = safeRead('docs/adr/README.md');

const prompt = `\
You are a spec writer for BugSpotter, a SaaS bug-reporting platform (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs).

Draft a spec document for GitHub issue #${ISSUE_NUMBER}. Follow the template below exactly — fill every section, remove comment markers, replace placeholder text with concrete content.

TEMPLATE:
${template}
${
  adrIndex
    ? `\nPROJECT ARCHITECTURE INDEX (docs/adr/README.md — canonical record of which repo owns which component, language, and service boundary; do not state or assume any architecture fact that contradicts it):\n${adrIndex}\n`
    : ''
}
SOURCE FILE TREE (use this to write accurate file paths and verify files exist — this is ONLY the bugspotter-public repo; a component the ADR index attributes to a different repo does NOT have a path here, even if its name looks like it would fit the packages/* convention):
${sourceTree}

ISSUE #${ISSUE_NUMBER}: ${ISSUE_TITLE}

${ISSUE_BODY?.trim() || '(no description provided)'}

Rules:
- You have NO tools available — no Read, no Grep, no Bash. Everything you need is already in this prompt: the source file tree above, the architecture index (if present), and the issue body. Do not attempt a tool call and do not narrate one; use the source tree and architecture index as your source of truth for what exists, and if something you need is genuinely absent from them, make the smallest reasonable assumption and mark it "ASSUMED, not verified" in the spec text (per the method-name rule below) rather than stopping to explore or narrating an exploration you cannot actually perform.
- "Linked issue:" line must say "Refs #${ISSUE_NUMBER}"
- "ADR:" line: write "pending" if an ADR will be needed, "docs/adr/NNNN-slug.md" if the issue names one, or "n/a" if the change is purely additive with no architectural decision
- "Files touched:" must list every file the spec edits or creates, using exact paths from the source tree above — if the issue describes work in a component the ADR index attributes to a different repo, say so explicitly in "Out of scope" instead of inventing a path in this repo
- "Blocking prerequisites:" must list any issue or PR number that must land before this work can be implemented (e.g. "#238 — adds the foo table"), or "none" if there are no dependencies
- In the Changes section, show ONLY new or changed lines — never reproduce the full existing file as if it were new code
- Indicate insertion points precisely ("Append after <function/line>", "Replace <old> with <new>")
- Method names, function signatures, and type names must exist in the source tree above — do not invent them. The source tree is paths only, not file contents, so you cannot actually confirm a method exists on an imported type from it alone — this includes method calls copied from the issue body's own code snippets, which are not guaranteed correct either. When the spec calls a method on a type imported from another package (\`import type { X } from '@bugspotter/other-pkg'\`), name the file where that type is actually DEFINED, not just where it is imported — e.g. "verify \`moveToDelayed\` exists on \`IJobHandle\` in \`packages/message-broker/src/interfaces.ts\`" — so the file that actually matters ends up mentioned in the spec text and gets pulled into the adversarial verification pass that follows. If you cannot name that file with confidence, mark the call "ASSUMED, not verified" in the spec rather than stating it as settled fact
- Acceptance criteria must be testable conditions, not vague goals
- In the Tests section, list any mock/fixture helper changes required BEFORE the new test cases (missing keys on mocks cause TypeErrors at runtime, not type errors at compile time)
- Verification section must contain only runnable shell commands, no pseudocode
- "Rollback:" must describe a concrete undo action for any irreversible step, or "n/a" if all steps are additive
- Return ONLY the filled spec document — no preamble, no explanation, no markdown fences`;

const GENERATE_TIMEOUT_MS = 450_000;
let specContent, stopReason;
try {
  // 450s. Was 420s (originally raised from 180_000, matching
  // verify-spec.mjs's own measured 283.9s for comparable work) - but that
  // number was itself never revisited after the prompt grew twice more
  // since (PR #240's BFS source-tree scanner, PR #260's ~10KB ADR index,
  // which grew again 2026-08-16 when a new ADR era table was added to
  // docs/adr/README.md). Issue #360 (2026-08-18): three consecutive
  // identical 420s timeouts on issue #353's spec, each killed while still
  // actively producing output - not #269's kind of failure (180s below an
  // already-measured duration), a genuinely larger/harder task than this
  // number has ever been checked against. spec-agent.yml's own step cap is
  // 480s; 450s keeps a 30s buffer under it so this timeout's own error
  // message still wins over GitHub's silent step kill, same reasoning as
  // the original 420s-under-the-old-480s-cap gap, just narrower - there is
  // no more headroom to give without also raising the workflow's own step
  // and job caps, which is a bigger change #360 leaves open if this still
  // isn't enough. Note the job also runs verify-spec.mjs (its own 420s,
  // unchanged), so raising either further means re-checking the job's 22m
  // cap still contains both plus setup - see that file's comments.
  ({ text: specContent, stopReason } = await callClaude({
    prompt,
    maxTokens: 4096,
    timeoutMs: GENERATE_TIMEOUT_MS,
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Fail fast if truncated — matches the check in generate-impl.mjs and
// generate-adr.mjs. Without it, a response cut short by the 4096 maxTokens
// cap would silently write a truncated spec to disk instead of erroring;
// verify-spec.mjs runs afterward against whatever is already on disk and
// checks its OWN verifier call's stopReason, not this one, so it would not
// have caught a truncated spec that happens to contain no invented method
// names before the cutoff.
if (stopReason === 'max_tokens') {
  console.error(
    'Claude response truncated (stop_reason=max_tokens). Raise maxTokens in generate-spec.mjs.'
  );
  process.exit(1);
}

// Deterministic safeguard against a narrated (fake) tool-call transcript -
// see detect-narration.mjs's header for the full failure history (#353,
// #355). The prompt's own "you have NO tools" rule above is not guaranteed
// reliable on its own (that is exactly how #355 still hit this after #353
// had already surfaced the same shape) - this is the defense-in-depth check
// that actually stops it from being written to disk as if it were a real
// spec.
//
// One corrective retry with a stronger reminder before failing loudly,
// mirroring generate-impl.mjs's missing-file self-correction (PR #375) -
// time-budgeted the same way, so a retry only fires with real headroom left
// in the step's own timeout rather than guaranteeing a step-level kill.
// Defaults match spec-agent.yml's "Generate spec" step cap (raised alongside
// this change specifically to give a retry room - see that file's comment).
function parsePositiveMs(envValue, fallback) {
  const trimmed = typeof envValue === 'string' ? envValue.trim() : envValue;
  if (trimmed === undefined || trimmed === '') {
    return fallback;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const STEP_BUDGET_MS = parsePositiveMs(process.env.SPEC_STEP_BUDGET_MS, 14 * 60_000);
const SAFETY_BUFFER_MS = parsePositiveMs(process.env.SPEC_SAFETY_BUFFER_MS, 30_000);
const RETRY_MIN_BUDGET_MS = parsePositiveMs(process.env.SPEC_RETRY_MIN_BUDGET_MS, 60_000);

let narrationFinding = detectNarratedToolCall(specContent);
if (narrationFinding) {
  console.warn(
    `Response looks like a narrated tool-call transcript, not a spec: ${narrationFinding}`
  );

  const remainingMs = STEP_BUDGET_MS - SAFETY_BUFFER_MS - (Date.now() - scriptStartedAt);
  if (remainingMs < RETRY_MIN_BUDGET_MS) {
    console.error(
      `::error::generate-spec.mjs: response looks like a narrated tool-call transcript, and ` +
        `only ~${Math.round(remainingMs / 1000)}s remain in the step budget - not enough for a ` +
        `safe corrective retry. Refusing to write it as a spec. ${narrationFinding}`
    );
    process.exit(1);
  }

  const retryTimeoutMs = Math.min(GENERATE_TIMEOUT_MS, remainingMs);
  console.warn(
    `Retrying once with a stronger no-narration reminder (timeout ${Math.round(retryTimeoutMs / 1000)}s)...`
  );
  const correctionPrompt =
    `${prompt}\n\n--- CORRECTIVE REMINDER ---\n` +
    `Your previous response was rejected: it looked like a narrated tool-call transcript ` +
    `(e.g. opening with something like "I'll inspect..." and/or containing "_Tool: ..._", ` +
    `"### Parameters:", or "### Result:" markers, or an "<invoke name=...>" tag) instead of the ` +
    `spec document itself. You have NO tools available — no Read, no Grep, no Bash. Do not ` +
    `attempt a tool call and do not narrate one. Return ONLY the filled spec document, starting ` +
    `with "# Spec: <title>", exactly as instructed above.`;

  let retryStopReason;
  try {
    ({ text: specContent, stopReason: retryStopReason } = await callClaude({
      prompt: correctionPrompt,
      maxTokens: 4096,
      timeoutMs: retryTimeoutMs,
    }));
  } catch (err) {
    console.error(`::error::generate-spec.mjs: corrective retry call failed: ${err.message}`);
    process.exit(1);
  }

  if (retryStopReason === 'max_tokens') {
    console.error(
      '::error::generate-spec.mjs: corrective retry response truncated (stop_reason=max_tokens).'
    );
    process.exit(1);
  }

  narrationFinding = detectNarratedToolCall(specContent);
  if (narrationFinding) {
    console.error(
      `::error::generate-spec.mjs: response still looks like a narrated tool-call transcript ` +
        `after one corrective retry - refusing to write it as a spec. ${narrationFinding}`
    );
    process.exit(1);
  }
  console.log('Corrective retry produced real content — proceeding.');
}

mkdirSync('docs/specs', { recursive: true });
writeFileSync(specFile, specContent, 'utf8');

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `spec_file=${specFile}\n`);
  appendFileSync(GITHUB_OUTPUT, `spec_slug=${slug}\n`);
  appendFileSync(GITHUB_OUTPUT, `padded_number=${padded}\n`);
  // So the workflow's "Assisted-by" commit/PR trailers can name the model
  // that actually generated this spec instead of a second hardcoded literal
  // that would silently go stale the moment LLM_DEFAULT_MODEL is overridden.
  appendFileSync(GITHUB_OUTPUT, `model=${CLI_MODEL}\n`);
} else {
  console.log(`spec_file=${specFile}`);
  console.log(`spec_slug=${slug}`);
}

console.log(`Wrote ${specFile}`);
