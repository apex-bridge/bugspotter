#!/usr/bin/env node
// Calls Claude to draft an ADR for a GitHub issue.
// Run from the repo root. Reads docs/adr/TEMPLATE.md for the format, existing
// ADRs for numbering, and (for database-related issues) the migrations for a
// computed table inventory.
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
import { tableInventory, inventoryMarkdown, DEFAULT_MIGRATIONS_DIR } from './table-inventory.mjs';
import { detectNarratedToolCall } from './detect-narration.mjs';
import {
  parsePositiveMs,
  computeRemainingBudgetMs,
  runWithCorrectiveRetry,
} from './generation-retry.mjs';

// Captured before any file reads (ADR numbering, example ADR, ADR index)
// below so the retry budget math (see scriptStartedAt's use further down)
// measures real elapsed step time, not elapsed-time-minus-setup-work.
const scriptStartedAt = Date.now();

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

// The format comes from docs/adr/TEMPLATE.md, not from "the newest ADR": each
// ADR used to be the style example for the next, so length compounded (0042:
// 75 lines, 0043: 108, 0044: 287, 0045's first draft: 336) and the template
// in this prompt drifted from docs/adr/README.md's section order.
const TEMPLATE_PATH = 'docs/adr/TEMPLATE.md';
if (!existsSync(TEMPLATE_PATH)) {
  console.error(`Missing ${TEMPLATE_PATH} - the ADR format is defined there.`);
  process.exit(1);
}
const template = readFileSync(TEMPLATE_PATH, 'utf8');

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

// The whole spec, not its first 1,500 characters: ADR-0045's first draft
// (PR #457) contradicted every constraint past that cut-off. The cap only
// guards against a runaway input; real specs are well under it.
const MAX_SPEC_CHARS = 60_000;
const specText = SPEC_CONTENT?.trim() ?? '';
const specForPrompt =
  specText.length > MAX_SPEC_CHARS
    ? `${specText.slice(0, MAX_SPEC_CHARS)}\n\n[spec truncated at ${MAX_SPEC_CHARS} characters]`
    : specText;

// File name: the spec's own "ADR: docs/adr/NNNN-slug.md" field when it names
// the next free number, so the ADR lands where the spec (and its checks)
// expect it; otherwise the next number plus a slug from the issue title.
const titleSlug = ISSUE_TITLE.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);
const specAdr = specText.match(/^ADR:\s*docs\/adr\/(\d{4})-([a-z0-9][a-z0-9-]*)\.md\s*$/m);
const specSlugUsable = Boolean(specAdr) && parseInt(specAdr[1], 10) === nextNum;
const slug = specSlugUsable ? specAdr[2] : titleSlug;
if (specAdr && !specSlugUsable) {
  console.warn(
    `Spec names docs/adr/${specAdr[1]}-${specAdr[2]}.md but the next free ADR number is ${padded}; using the issue title for the slug.`
  );
}

const adrFile = `docs/adr/${padded}-${slug}.md`;

// Database-related issues get the real table list: the agent has no tools, and
// without it ADR-0045's first draft wrote that it "does not have access to run
// that grep" instead of an inventory.
const dbRelated = /\b(tables?|migrations?|row[- ]level security|RLS|schema)\b/i.test(
  `${ISSUE_TITLE}\n${ISSUE_BODY ?? ''}\n${specText}`
);
let inventory = '';
if (dbRelated && existsSync(DEFAULT_MIGRATIONS_DIR)) {
  const rows = tableInventory(DEFAULT_MIGRATIONS_DIR);
  if (rows.length) {
    inventory = `${inventoryMarkdown(rows)}\n(${rows.length} tables, computed from ${DEFAULT_MIGRATIONS_DIR}/*.sql)`;
  }
}

const prompt = `\
You are an architecture decision writer for BugSpotter, a SaaS bug-reporting platform (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs).

Draft ADR-${padded} for GitHub issue #${ISSUE_NUMBER}, following the TEMPLATE below: its structure, its section order, and the rules in its comment block. Remove the template's HTML comments from your output.

TEMPLATE (docs/adr/TEMPLATE.md):
${template}
${
  adrIndex
    ? `\nPROJECT ARCHITECTURE INDEX (docs/adr/README.md — canonical record of which repo owns which component, language, and service boundary; do not state or assume any architecture fact that contradicts it):\n${adrIndex}\n`
    : ''
}
Use these values in the header: title line "# ADR-${padded}: <title>", "- Status: Proposed", "- Date: ${new Date().toISOString().slice(0, 10)}", and Refs starting with #${ISSUE_NUMBER}.

ISSUE #${ISSUE_NUMBER}: ${ISSUE_TITLE}

${ISSUE_BODY?.trim() || '(no description)'}
${specForPrompt ? `\nLINKED SPEC (full text; the ADR must not contradict any of its constraints or acceptance criteria):\n${specForPrompt}\n` : ''}${inventory ? `\nTABLE INVENTORY (computed from the migrations; authoritative - classify from this list, do not invent tables):\n${inventory}\n` : ''}
Rules:
- You have NO tools available — no Read, no Grep, no Bash. Everything you need is already in this prompt: the template, the architecture index (if present), the issue body, the linked spec (if any) and the table inventory (if any). Do not attempt a tool call and do not narrate one; if something you need is genuinely absent from them, make the smallest reasonable assumption and list it under "Risks and follow-ups" rather than stopping to explore or narrating an exploration you cannot actually perform.
- Status must be "Proposed" (human ratifies and changes it to "Accepted")
- Where the spec requires specific content in the ADR (headings, lists, a table inventory, test categories), include it exactly as required, in an appendix if it is long
- Do not state or imply that a component lives in this repo, in a particular language, or behind a particular service boundary if the architecture index above attributes it to a different repo — if the issue concerns such a component, say so explicitly rather than inventing an in-repo shape for it
- Return ONLY the ADR document — no preamble, no explanation, no markdown fences around the whole document`;

const GENERATE_TIMEOUT_MS = 420_000;
let adrContent, stopReason;
try {
  // 420s, the same as generate-spec.mjs. History: 120s assumed this prompt
  // was much smaller than generate-spec's; PR #273 added the ~10KB ADR index,
  // and generate-spec's own 180s failed in practice (run 30752527569), so it
  // went to 300s. The prompt now also carries the full linked spec and, for
  // database issues, the table inventory: a local end-to-end run on #451
  // (22KB spec, 49-table inventory) took 270s, too close to 300s.
  // max_tokens matches generate-spec's 4096 now that the prompt asks for
  // spec-required appendices (on LLM_BACKEND=cli it is advisory only).
  // adr-agent.yml caps this step at 10m, above this 420s, inside a 19m job.
  ({ text: adrContent, stopReason } = await callClaude({
    prompt,
    maxTokens: 4096,
    timeoutMs: GENERATE_TIMEOUT_MS,
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Fail fast if truncated — matches the check in generate-impl.mjs. Without
// it, a response cut short by the 4096 maxTokens cap would silently write a
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
// generate-spec.mjs's own copy of this same guard - time-budgeted the same
// way (see generation-retry.mjs). Defaults match adr-agent.yml's "Generate
// ADR" step cap (raised alongside this change specifically to give a retry
// room - see that file's comment).
const STEP_BUDGET_MS = parsePositiveMs(process.env.ADR_STEP_BUDGET_MS, 10 * 60_000);
const SAFETY_BUFFER_MS = parsePositiveMs(process.env.ADR_SAFETY_BUFFER_MS, 30_000);
const RETRY_MIN_BUDGET_MS = parsePositiveMs(process.env.ADR_RETRY_MIN_BUDGET_MS, 45_000);

let narrationFinding = detectNarratedToolCall(adrContent);
if (narrationFinding) {
  console.warn(
    `Response looks like a narrated tool-call transcript, not an ADR: ${narrationFinding}`
  );

  const remainingMs = computeRemainingBudgetMs({
    stepBudgetMs: STEP_BUDGET_MS,
    safetyBufferMs: SAFETY_BUFFER_MS,
    scriptStartedAt,
  });

  await runWithCorrectiveRetry({
    remainingMs,
    retryMinBudgetMs: RETRY_MIN_BUDGET_MS,
    maxTimeoutMs: GENERATE_TIMEOUT_MS,
    buildPrompt: () =>
      `${prompt}\n\n--- CORRECTIVE REMINDER ---\n` +
      `Your previous response was rejected: it looked like a narrated tool-call transcript ` +
      `(e.g. opening with something like "I'll inspect..." and/or containing "_Tool: ..._", ` +
      `"### Parameters:", or "### Result:" markers, or an "<invoke name=...>" tag) instead of the ` +
      `ADR document itself. You have NO tools available — no Read, no Grep, no Bash. Do not ` +
      `attempt a tool call and do not narrate one. Return ONLY the ADR document, starting with ` +
      `"# ADR-${padded}: <title>", exactly as instructed above.`,
    callFn: (retryPrompt, timeoutMs) =>
      callClaude({ prompt: retryPrompt, maxTokens: 4096, timeoutMs }),
    onNoBudget: (remaining) => {
      console.error(
        `::error::generate-adr.mjs: response looks like a narrated tool-call transcript, and only ` +
          `~${Math.round(remaining / 1000)}s remain in the step budget - not enough for a safe ` +
          `corrective retry. Refusing to write it as an ADR. ${narrationFinding}`
      );
      process.exit(1);
    },
    onAttempt: (timeoutMs) => {
      console.warn(
        `Retrying once with a stronger no-narration reminder (timeout ${Math.round(timeoutMs / 1000)}s)...`
      );
    },
    onCallError: (err) => {
      console.error(`::error::generate-adr.mjs: corrective retry call failed: ${err.message}`);
      process.exit(1);
    },
    onTruncated: () => {
      console.error(
        '::error::generate-adr.mjs: corrective retry response truncated (stop_reason=max_tokens).'
      );
      process.exit(1);
    },
    onSuccess: (text) => {
      adrContent = text;
      const finding = detectNarratedToolCall(adrContent);
      if (finding) {
        console.error(
          `::error::generate-adr.mjs: response still looks like a narrated tool-call transcript ` +
            `after one corrective retry - refusing to write it as an ADR. ${finding}`
        );
        process.exit(1);
      }
      console.log('Corrective retry produced real content — proceeding.');
    },
  });
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
