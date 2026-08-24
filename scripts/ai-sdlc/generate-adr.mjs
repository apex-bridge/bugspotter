#!/usr/bin/env node
// Calls Claude to draft an ADR for a GitHub issue.
// Run from the repo root. Reads existing ADRs for numbering + style.
// Outputs adr_file, adr_number, adr_slug, and model to GITHUB_OUTPUT.
//
// Required env vars: ISSUE_NUMBER, ISSUE_TITLE, plus either
//   ANTHROPIC_API_KEY (default) or CLAUDE_CODE_OAUTH_TOKEN (LLM_BACKEND=cli)
// Optional:          ISSUE_BODY (falls back to "(no description)" if unset)
//                    SPEC_CONTENT (contents of a linked spec, if any)
//                    GITHUB_OUTPUT (set by Actions; falls back to stdout print)

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  appendFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { callClaude, requireLlmCredentials, CLI_MODEL } from './llm-client.mjs';
import { detectNarratedToolCall } from './detect-narration.mjs';

const { ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, SPEC_CONTENT, GITHUB_OUTPUT } = process.env;

requireLlmCredentials();
if (!ISSUE_NUMBER) {
  console.error('Missing ISSUE_NUMBER');
  process.exit(1);
}
if (!ISSUE_TITLE) {
  console.error('Missing ISSUE_TITLE');
  process.exit(1);
}

// Find next ADR number
if (!existsSync('docs/adr')) {
  mkdirSync('docs/adr', { recursive: true });
}
const existing = readdirSync('docs/adr').filter((f) => /^\d{4}-/.test(f));
const maxNum = existing.reduce((m, f) => Math.max(m, parseInt(f.slice(0, 4), 10)), 0);
const nextNum = maxNum + 1;
const padded = String(nextNum).padStart(4, '0');

// Read one recent ADR as style example
const exampleFile = existing.sort().slice(-1)[0];
const exampleAdr = exampleFile
  ? readFileSync(`docs/adr/${exampleFile}`, 'utf8').slice(0, 1200)
  : '';

// generate-spec.mjs and verify-spec.mjs both inject docs/adr/README.md (the
// cross-repo architecture index) into their prompts; this script did not,
// despite ADR ratification being the human judgment gate that's supposed to
// catch exactly the failure the index exists to prevent — a component
// attributed to a fabricated in-repo path instead of its real, separate
// repo (docs/adr/0007 records bugspotter-intelligence as a Python/FastAPI
// service in its own repo; #226/#238 hallucinated a TypeScript package for
// it here, and the human ratification gate that should have caught it had
// no index to check against either). Without this, the artifact a human is
// actually asked to ratify is the least-grounded of the three generation
// steps, not the best-grounded one.
function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
const adrIndex = safeRead('docs/adr/README.md');

const slug = ISSUE_TITLE.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

const adrFile = `docs/adr/${padded}-${slug}.md`;

const prompt = `\
You are an architecture decision writer for BugSpotter, a SaaS bug-reporting platform (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs).

Draft ADR-${padded} for GitHub issue #${ISSUE_NUMBER}. Match the style of the example below exactly.

EXAMPLE ADR (for style reference only — do not copy its content):
${exampleAdr}
${
  adrIndex
    ? `\nPROJECT ARCHITECTURE INDEX (docs/adr/README.md — canonical record of which repo owns which component, language, and service boundary; do not state or assume any architecture fact that contradicts it):\n${adrIndex}\n`
    : ''
}
Required sections (use this exact structure):
# ADR-${padded}: <title>

- Status: Proposed
- Area: <area>
- Date: ${new Date().toISOString().slice(0, 10)}
- Refs: #${ISSUE_NUMBER}${SPEC_CONTENT ? '; linked spec' : ''}

## Context

<why this decision is needed; what problem it solves>

## Options considered

1. **Option A** — description; tradeoffs
2. **Option B** — description; tradeoffs
(add more if genuinely distinct)

## Decision

<which option is chosen and why; constraints it satisfies>

## Consequences

**Positive:** ...
**Negative / accepted:** ...
**Neutral:** ...

ISSUE #${ISSUE_NUMBER}: ${ISSUE_TITLE}

${ISSUE_BODY?.trim() || '(no description)'}
${SPEC_CONTENT ? `\nLINKED SPEC:\n${SPEC_CONTENT.slice(0, 1500)}` : ''}

Rules:
- You have NO tools available — no Read, no Grep, no Bash. Everything you need is already in this prompt: the example ADR, the architecture index (if present), the issue body, and the linked spec (if any). Do not attempt a tool call and do not narrate one; if something you need is genuinely absent from them, make the smallest reasonable assumption and note it as a residual risk under Consequences rather than stopping to explore or narrating an exploration you cannot actually perform.
- Status must be "Proposed" (human ratifies and changes it to "Accepted")
- Be concrete about consequences; call out residual risks explicitly
- Do not state or imply that a component lives in this repo, in a particular language, or behind a particular service boundary if the architecture index above attributes it to a different repo — if the issue concerns such a component, say so explicitly rather than inventing an in-repo shape for it
- Return ONLY the ADR document — no preamble, no explanation, no markdown fences`;

const GENERATE_TIMEOUT_MS = 300_000;
const scriptStartedAt = Date.now();
let adrContent, stopReason;
try {
  // 300s. The previous 120s rested on a premise that is no longer true: it
  // argued this prompt is "much smaller than generate-spec.mjs's (no
  // TEMPLATE.md, no source-file tree)" and so needs less than that script's
  // 180s. Both halves broke:
  //   1. PR #273 added the same ~10KB ADR index here, so the input is no
  //      longer in a different size class.
  //   2. generate-spec's 180s was itself below its own measured runtime and
  //      failed in practice (run 30752527569); it is now 420s, so "less
  //      than generate-spec" is no longer a small number either.
  // max_tokens here is still half of generate-spec's (2048 vs 4096), and
  // output tokens dominate wall time, so ~300s is the proportionate budget
  // rather than a flat copy of 420s. adr-agent.yml caps this step at 6m,
  // above this 300s, inside a 15m job cap that holds only this one LLM call.
  ({ text: adrContent, stopReason } = await callClaude({
    prompt,
    maxTokens: 2048,
    timeoutMs: GENERATE_TIMEOUT_MS,
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Fail fast if truncated — matches the check in generate-impl.mjs. Without
// it, a response cut short by the 2048 maxTokens cap would silently write a
// truncated ADR to disk instead of erroring.
if (stopReason === 'max_tokens') {
  console.error(
    'Claude response truncated (stop_reason=max_tokens). Raise maxTokens in generate-adr.mjs.'
  );
  process.exit(1);
}

// Deterministic safeguard against a narrated (fake) tool-call transcript -
// see detect-narration.mjs's header for the full failure history (#353,
// #355) and generate-spec.mjs's identical guard (this script shares the
// same generation shape: one plain-text document, LLM_BACKEND=cli with
// --tools=). The prompt's own "you have NO tools" rule above is not
// guaranteed reliable on its own - this is the defense-in-depth check that
// actually stops it from being written to disk as if it were a real ADR.
//
// One corrective retry with a stronger reminder before failing loudly,
// mirroring generate-impl.mjs's missing-file self-correction (PR #375) and
// generate-spec.mjs's own copy of this same guard. Defaults match
// adr-agent.yml's "Generate ADR" step cap (raised alongside this change
// specifically to give a retry room - see that file's comment).
function parsePositiveMs(envValue, fallback) {
  const trimmed = typeof envValue === 'string' ? envValue.trim() : envValue;
  if (trimmed === undefined || trimmed === '') {
    return fallback;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const STEP_BUDGET_MS = parsePositiveMs(process.env.ADR_STEP_BUDGET_MS, 10 * 60_000);
const SAFETY_BUFFER_MS = parsePositiveMs(process.env.ADR_SAFETY_BUFFER_MS, 30_000);
const RETRY_MIN_BUDGET_MS = parsePositiveMs(process.env.ADR_RETRY_MIN_BUDGET_MS, 45_000);

let narrationFinding = detectNarratedToolCall(adrContent);
if (narrationFinding) {
  console.warn(
    `Response looks like a narrated tool-call transcript, not an ADR: ${narrationFinding}`
  );

  const remainingMs = STEP_BUDGET_MS - SAFETY_BUFFER_MS - (Date.now() - scriptStartedAt);
  if (remainingMs < RETRY_MIN_BUDGET_MS) {
    console.error(
      `::error::generate-adr.mjs: response looks like a narrated tool-call transcript, and only ` +
        `~${Math.round(remainingMs / 1000)}s remain in the step budget - not enough for a safe ` +
        `corrective retry. Refusing to write it as an ADR. ${narrationFinding}`
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
    `ADR document itself. You have NO tools available — no Read, no Grep, no Bash. Do not ` +
    `attempt a tool call and do not narrate one. Return ONLY the ADR document, starting with ` +
    `"# ADR-${padded}: <title>", exactly as instructed above.`;

  let retryStopReason;
  try {
    ({ text: adrContent, stopReason: retryStopReason } = await callClaude({
      prompt: correctionPrompt,
      maxTokens: 2048,
      timeoutMs: retryTimeoutMs,
    }));
  } catch (err) {
    console.error(`::error::generate-adr.mjs: corrective retry call failed: ${err.message}`);
    process.exit(1);
  }

  if (retryStopReason === 'max_tokens') {
    console.error(
      '::error::generate-adr.mjs: corrective retry response truncated (stop_reason=max_tokens).'
    );
    process.exit(1);
  }

  narrationFinding = detectNarratedToolCall(adrContent);
  if (narrationFinding) {
    console.error(
      `::error::generate-adr.mjs: response still looks like a narrated tool-call transcript ` +
        `after one corrective retry - refusing to write it as an ADR. ${narrationFinding}`
    );
    process.exit(1);
  }
  console.log('Corrective retry produced real content — proceeding.');
}

writeFileSync(adrFile, adrContent, 'utf8');

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `adr_file=${adrFile}\n`);
  appendFileSync(GITHUB_OUTPUT, `adr_slug=${slug}\n`);
  appendFileSync(GITHUB_OUTPUT, `adr_number=${padded}\n`);
  // So the workflow's "Assisted-by" commit/PR trailers can name the model
  // that actually generated this ADR instead of a second hardcoded literal
  // that would silently go stale the moment LLM_DEFAULT_MODEL is overridden.
  appendFileSync(GITHUB_OUTPUT, `model=${CLI_MODEL}\n`);
} else {
  console.log(`adr_file=${adrFile}`);
  console.log(`adr_slug=${slug}`);
}

console.log(`Wrote ${adrFile} (ADR-${padded})`);
