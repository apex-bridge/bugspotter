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
import {
  tableInventory,
  inventoryMarkdown,
  extractGlobalReasons,
  inventoryAppendix,
  DEFAULT_MIGRATIONS_DIR,
} from './table-inventory.mjs';
import { specForAdr } from './spec-sections.mjs';
import { detectNarratedToolCall } from './detect-narration.mjs';
import {
  parsePositiveMs,
  computeRemainingBudgetMs,
  runWithCorrectiveRetry,
} from './generation-retry.mjs';

// Captured before any file reads (ADR numbering, template, ADR index)
// below so the retry budget math (see scriptStartedAt's use further down)
// measures real elapsed step time, not elapsed-time-minus-setup-work.
const scriptStartedAt = Date.now();

const { ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, SPEC_CONTENT, GITHUB_OUTPUT } = process.env;

// Settings: repo variables mapped to env in adr-agent.yml; the defaults are the
// tuned values, so an unset variable changes nothing.
//   ADR_LLM_TIMEOUT_MS        one LLM call in ms, at least 10000 (default 540000)
//   ADR_STEP_TIMEOUT_MINUTES  the workflow step's timeout-minutes; the script's
//                             time budget (default 12)
//   ADR_MAX_TOKENS            output cap, enforced on the API backend only,
//                             where thinking counts toward it (64000; runs used
//                             14K-28K thinking tokens plus the ADR, #458)
//   ADR_MAX_SPEC_CHARS        runaway guard for the spec input (60000)
//   ADR_EFFORT                low | medium | high | xhigh | max (model default);
//                             not every model supports every level - an
//                             unsupported one fails the API call (400)
// An unset or blank value means the default; any other invalid value (0, a
// negative, "16k", a timeout given in seconds) falls back with a warning.
const setting = (name, fallback, valid, need) => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const n = Number(raw);
  if (Number.isFinite(n) && valid(n)) {
    return n;
  }
  console.warn(`Ignoring ${name}=${raw}: not ${need}; using ${fallback ?? 'the default'}.`);
  return fallback;
};
const positiveInt = (n) => Number.isInteger(n) && n > 0;
const SETTINGS = {
  timeoutMs: setting(
    'ADR_LLM_TIMEOUT_MS',
    540_000,
    (n) => Number.isInteger(n) && n >= 10_000,
    'a whole number of milliseconds, at least 10000'
  ),
  stepBudgetMs:
    (setting('ADR_STEP_TIMEOUT_MINUTES', null, (n) => n > 0, 'a positive number of minutes') ?? 0) *
      60_000 || parsePositiveMs(process.env.ADR_STEP_BUDGET_MS, 12 * 60_000),
  maxTokens: setting('ADR_MAX_TOKENS', 64_000, positiveInt, 'a positive integer'),
  maxSpecChars: setting('ADR_MAX_SPEC_CHARS', 60_000, positiveInt, 'a positive integer'),
  effort: process.env.ADR_EFFORT || undefined,
};

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

// Format from the template, not the newest ADR (copying one compounds its length; #458).
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

const specText = SPEC_CONTENT?.trim() ?? '';

// File name from the spec's "ADR:" field if it names the next free number, else the issue title.
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

// The spec's decision sections: enough to not contradict it, small enough to stay
// inside the timeout. The cap only guards against a runaway input.
const MAX_SPEC_CHARS = SETTINGS.maxSpecChars;
// Select the ADR's Changes subsection by the path the spec declares, even when
// the output is renumbered because that number is taken.
const specAdrPath = specAdr ? `docs/adr/${specAdr[1]}-${specAdr[2]}.md` : adrFile;
const specSections = specText
  ? specForAdr(specText, specAdrPath, { existingAdrs: existing })
  : null;
const specInput = specSections ?? specText;
// The prompt says which one it got, so the model is not told sections are left
// out when the full spec is sent.
const specLabel = specSections
  ? "sections relevant to the ADR; its tests, verification and other files' changes are left out"
  : 'the full spec: its ADR-relevant sections could not be picked out';
const specForPrompt =
  specInput.length > MAX_SPEC_CHARS
    ? `${specInput.slice(0, MAX_SPEC_CHARS)}\n\n[spec truncated at ${MAX_SPEC_CHARS} characters]`
    : specInput;

// The agent has no tools, so tenant-isolation issues get the computed table list.
// Explicit signals only: words like "table" or "schema" appear in most specs.
const dbRelated = /\b(table inventory|row[- ]level security|RLS|tenant isolation)\b/i.test(
  `${ISSUE_TITLE}\n${ISSUE_BODY ?? ''}\n${specText}`
);
let inventory = '';
let inventoryRows = [];
if (dbRelated && existsSync(DEFAULT_MIGRATIONS_DIR)) {
  inventoryRows = tableInventory(DEFAULT_MIGRATIONS_DIR);
  if (inventoryRows.length) {
    inventory = `${inventoryMarkdown(inventoryRows)}\n(${inventoryRows.length} tables, computed from ${DEFAULT_MIGRATIONS_DIR}/*.sql)`;
  }
}

// Each rule is listed only when its input is in the prompt.
const rules = [
  'Follow the TEMPLATE: its structure, its section order and the rules in its comment block. Leave out its HTML comments.',
  `Header: "# ADR-${padded}: <title>", "- Status: Proposed", "- Date: ${new Date().toISOString().slice(0, 10)}", Refs starting with #${ISSUE_NUMBER}. A human sets Accepted.`,
  specForPrompt &&
    'Do not contradict the LINKED SPEC. Content it requires inside the ADR goes in exactly as required; long material goes in an appendix.',
  inventory &&
    'Do not write a table inventory: it is generated from the TABLE INVENTORY and appended to your document. Instead, end your document with a section "## Global tables" listing every table whose suggested scope is global, one per line as "- <table>: <one-line reason>". If such a table actually holds tenant data, write "- <table>: org-scoped: <reason>" or "- <table>: project-scoped: <reason>" instead.',
  adrIndex &&
    'Architecture facts must match the ARCHITECTURE INDEX. If a component lives in another repo, say so instead of inventing an in-repo shape.',
  'You have NO tools available. Do not attempt a tool call and do not narrate one. If something is missing, make the smallest reasonable assumption and list it under "Risks and follow-ups".',
  'Output only the ADR document, without a code fence around it.',
].filter(Boolean);

const prompt = `\
You are writing ADR-${padded} for BugSpotter (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs), from GitHub issue #${ISSUE_NUMBER}. The inputs come first; the rules are at the end.

TEMPLATE (docs/adr/TEMPLATE.md):
${template}
${adrIndex ? `\nARCHITECTURE INDEX (docs/adr/README.md):\n${adrIndex}\n` : ''}
ISSUE #${ISSUE_NUMBER}: ${ISSUE_TITLE}

${ISSUE_BODY?.trim() || '(no description)'}
${specForPrompt ? `\nLINKED SPEC (${specLabel}):\n${specForPrompt}\n` : ''}${inventory ? `\nTABLE INVENTORY (computed from the migrations):\n${inventory}\n` : ''}
Rules:
${rules.map((r) => `- ${r}`).join('\n')}`;

const STEP_BUDGET_MS = SETTINGS.stepBudgetMs;
const SAFETY_BUFFER_MS = parsePositiveMs(process.env.ADR_SAFETY_BUFFER_MS, 30_000);
// One call's time is mostly extended thinking, which varies a lot between runs
// (#458). The call is capped at what is left of the step budget
// (ADR_STEP_TIMEOUT_MINUTES, the step's own timeout-minutes), so a long
// ADR_LLM_TIMEOUT_MS ends in a handled timeout, not a GitHub kill.
const GENERATE_TIMEOUT_MS = Math.max(
  1_000,
  Math.min(
    SETTINGS.timeoutMs,
    computeRemainingBudgetMs({
      stepBudgetMs: STEP_BUDGET_MS,
      safetyBufferMs: SAFETY_BUFFER_MS,
      scriptStartedAt,
    })
  )
);
let adrContent, stopReason;
try {
  // max_tokens is advisory on LLM_BACKEND=cli.
  ({ text: adrContent, stopReason } = await callClaude({
    prompt,
    maxTokens: SETTINGS.maxTokens,
    timeoutMs: GENERATE_TIMEOUT_MS,
    effort: SETTINGS.effort,
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Fail fast if truncated — matches the check in generate-impl.mjs. Without
// it, a response cut short by the maxTokens cap would silently write a
// truncated ADR to disk instead of erroring.
if (stopReason === 'max_tokens') {
  console.error(
    (process.env.LLM_BACKEND || 'api') === 'cli'
      ? "Claude response truncated (stop_reason=max_tokens): the model's own output limit was reached. ADR_MAX_TOKENS does not apply on LLM_BACKEND=cli; a lower ADR_EFFORT means less thinking."
      : `Claude response truncated (stop_reason=max_tokens at ${SETTINGS.maxTokens}). Raise the ADR_MAX_TOKENS repo variable.`
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
// A retry needs about as long as a first run; with less left it would only
// time out, so fail fast instead.
const RETRY_MIN_BUDGET_MS = parsePositiveMs(process.env.ADR_RETRY_MIN_BUDGET_MS, 300_000);

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
      callClaude({
        prompt: retryPrompt,
        maxTokens: SETTINGS.maxTokens,
        timeoutMs,
        effort: SETTINGS.effort,
      }),
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

if (inventoryRows.length) {
  const { text, reasons } = extractGlobalReasons(adrContent, {
    tables: inventoryRows.filter((r) => r.scope.kind === 'global').map((r) => r.table),
  });
  const { markdown, missing, overridden } = inventoryAppendix(inventoryRows, reasons);
  if (overridden.length) {
    console.log(`Scope overridden by the ADR author: ${overridden.join(', ')}`);
  }
  adrContent = `${text}\n\n${markdown}\n`;
  if (missing.length) {
    console.warn(
      `::warning::No reason given for global table(s): ${missing.join(', ')} - reason cells left empty for the reviewer.`
    );
  }
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
