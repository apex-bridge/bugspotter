#!/usr/bin/env node
// Calls Claude to draft an ADR for a GitHub issue.
// Run from the repo root. Reads existing ADRs for numbering + style.
// Outputs adr_file, adr_number, adr_slug to GITHUB_OUTPUT.
//
// Required env vars: ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, plus either
//   ANTHROPIC_API_KEY (default) or CLAUDE_CODE_OAUTH_TOKEN (LLM_BACKEND=cli)
// Optional:          SPEC_CONTENT (contents of a linked spec, if any)
//                    GITHUB_OUTPUT (set by Actions; falls back to stdout print)

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  appendFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { callClaude, requireLlmCredentials } from './llm-client.mjs';

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
- Status must be "Proposed" (human ratifies and changes it to "Accepted")
- Be concrete about consequences; call out residual risks explicitly
- Return ONLY the ADR document — no preamble, no explanation, no markdown fences`;

let adrContent;
try {
  // 120s: this prompt is much smaller than generate-spec.mjs's (no
  // TEMPLATE.md, no source-file tree — just one ~1200-char example ADR plus
  // the issue body and an optional ~1500-char spec excerpt) and max_tokens
  // (2048) is half of generate-spec's (4096), so it needs less time than
  // generate-spec's 180s. It still needs more than the old API-only 60s
  // budget to cover the CLI backend's subprocess startup overhead.
  ({ text: adrContent } = await callClaude({ prompt, maxTokens: 2048, timeoutMs: 120_000 }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

writeFileSync(adrFile, adrContent, 'utf8');

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `adr_file=${adrFile}\n`);
  appendFileSync(GITHUB_OUTPUT, `adr_slug=${slug}\n`);
  appendFileSync(GITHUB_OUTPUT, `adr_number=${padded}\n`);
} else {
  console.log(`adr_file=${adrFile}`);
  console.log(`adr_slug=${slug}`);
}

console.log(`Wrote ${adrFile} (ADR-${padded})`);
