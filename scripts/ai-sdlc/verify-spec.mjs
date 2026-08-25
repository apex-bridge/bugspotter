#!/usr/bin/env node
// Adversarial spec verifier: reads the generated spec, reads every file it
// claims to touch, then calls Claude to find and fix factual errors before
// the PR is opened.
//
// Required env vars: SPEC_FILE, plus either ANTHROPIC_API_KEY (default) or
//   CLAUDE_CODE_OAUTH_TOKEN (LLM_BACKEND=cli)
// Configuration errors (missing env vars) exit 1. All other failures
// (missing spec file, API errors, bad model response) exit 0 so a
// verification hiccup never blocks the CI run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { callClaude, requireLlmCredentials } from './llm-client.mjs';

const { SPEC_FILE } = process.env;

requireLlmCredentials();
if (!SPEC_FILE) {
  console.error('Missing SPEC_FILE');
  process.exit(1);
}

let spec;
try {
  spec = readFileSync(SPEC_FILE, 'utf8');
} catch (err) {
  console.warn(`Spec verifier: could not read spec file: ${err.message}`);
  process.exit(0);
}

// Extract every packages/… or apps/… path mentioned in the spec.
const pathPattern = /(?:packages|apps)\/[\w\-./@]+\.(?:ts|mjs|js|json|yml|yaml)(?![\w\-./@])/g;
const mentioned = [...new Set(spec.match(pathPattern) ?? [])];

// Read files that actually exist (new files won't exist yet — skip them).
// Cap at 15 files to keep the verify prompt bounded.
const MAX_VERIFY_FILES = 15;
const fileSections = mentioned
  .filter((p) => !p.includes('..') && existsSync(p))
  .slice(0, MAX_VERIFY_FILES)
  .map((p) => {
    let content;
    try {
      content = readFileSync(p, 'utf8');
    } catch {
      return null;
    }
    // Cap at 1000 lines — 300 caused false positives when a referenced method
    // appeared past the cutoff in a larger source file.
    const lines = content.split('\n').slice(0, 1000).join('\n');
    const truncated = content.split('\n').length > 1000 ? '\n[… truncated at 1000 lines]' : '';
    return `### ${p}\n\`\`\`ts\n${lines}${truncated}\n\`\`\``;
  })
  .filter(Boolean)
  .join('\n\n');

if (!fileSections) {
  console.log('No existing source files referenced in spec — skipping verification.');
  process.exit(0);
}

// Same rationale as generate-spec.mjs: without the ADR index, the verifier
// has no way to catch an architecture claim that's internally consistent
// with the rest of the spec but factually wrong (e.g. "bugspotter-intelligence
// is a TypeScript package in this repo" — docs/adr/0007 says it's a separate
// Python service). That exact miss let spec #226 reach the impl-agent.
const adrIndex = existsSync('docs/adr/README.md') ? readFileSync('docs/adr/README.md', 'utf8') : '';

const prompt = `\
You are an adversarial reviewer for a spec document. Your job is to find and fix ONLY factual errors before the spec reaches an impl-agent.

SPEC TO VERIFY:
${spec}

SOURCE FILES REFERENCED BY THE SPEC:
${fileSections}
${
  adrIndex
    ? `\nPROJECT ARCHITECTURE INDEX (docs/adr/README.md — canonical record of which repo owns which component, language, and service boundary):\n${adrIndex}\n`
    : ''
}
You have NO tools available — no Read, no Grep, no Bash. Everything you need (the spec, the source files it references, and the architecture index) is already shown above. Do not attempt a tool call and do not narrate one; if a file you would need is not among those shown above, flag it under check 0 below as unverified rather than trying to fetch it.

Check for:
0. A method called on a type imported from another package (\`import type { X } from '@bugspotter/other-pkg'\`) where that package's defining file is NOT among the source files above. You cannot confirm or deny the method exists without that file - flag this explicitly as "unverified: <package>'s defining file for <type> was not available to check" rather than assuming it's correct because nothing else looks wrong. This is not the same failure as item 1 below: item 1 is a check you can actually perform; this is a check you structurally cannot perform yet, and saying so is the correct output, not a cop-out. The same applies when that file IS listed above but is marked "[… truncated at 1000 lines]" and the method does not appear before the cutoff - the untruncated file may still define it beyond that point, so report it as unverified rather than as missing under item 1.
1. Method or function names called in the spec that don't exist in the source files
2. File paths in the spec that don't match actual paths
3. TypeScript type errors — e.g. accessing a property typed as non-optional with optional chaining, or vice versa
4. Test mock/helper shapes — if the spec proposes calling db.X.findById() but the test helper has no X key, flag it
5. TypeScript closure narrowing — optional function parameters are not narrowed by early-return guards inside nested async closures; a const binding is required
6. Schema constraints that would produce wrong HTTP status codes (e.g. minimum on a schema field that causes Fastify to reject values the caller legally sends, mapped to a worse error code downstream)
7. Code shown as "new code to write" that is actually already present in the source file verbatim (impl-agent would duplicate it)
8. Architecture claims (language, service location, which repo owns a component) that contradict the ADR index above — e.g. proposing to create or edit a package in THIS repo for something the ADR index attributes to a different repo

Do NOT change:
- The spec's intent, scope, or architectural decisions
- Wording or style unless it contains a factual error
- Anything not in the check list above

If you find no factual errors, respond with exactly the word: NO_CHANGES_NEEDED

Otherwise respond with the complete corrected spec document — no preamble, no explanation, no markdown fences around the whole document.`;

console.log(
  `Verifying spec against ${mentioned.filter((p) => existsSync(p)).length} source file(s)…`
);

let text, stopReason;
try {
  // 420s: this prompt (spec + up to 15 source files) is larger than
  // generate-spec's, which is also 420s now (it was 180s when this comment
  // was first written, and that number turned out to be too small). Measured
  // empirically on the CLI backend with a ~60K-char verify prompt (spec +
  // 4 source files): 283.9s to complete via callClaude's fixed --tools=
  // path (single turn, real corrected output, not a truncation). 420s
  // keeps roughly 1.5x margin over that measurement rather than guessing.
  ({ text, stopReason } = await callClaude({ prompt, maxTokens: 8192, timeoutMs: 420_000 }));
} catch (err) {
  // Verification failure is non-fatal — log and continue with unpatched spec.
  console.warn(`Spec verifier error: ${err.message}`);
  process.exit(0);
}
// Truncated responses pass header checks because the missing content is at
// the tail — stop_reason is the authoritative signal (mirrors generate-impl.mjs).
if (stopReason === 'max_tokens') {
  console.warn('Spec verifier response truncated (stop_reason=max_tokens) — skipping patch.');
  process.exit(0);
}

const result = text?.trim() ?? '';

// Strip outer markdown fences the model sometimes adds, then confirm all
// required section headers survived — tail sections (Verification, Rollback)
// are what truncation cuts first.
function sanitize(raw) {
  let text = raw.trim();
  // Discard conversational preamble preceding an opening code fence so that
  // startsWith('```') fires correctly and the closing fence is also stripped.
  const tickIdx = text.indexOf('```');
  const titleIdxEarly = text.indexOf('# Spec:');
  if (tickIdx !== -1 && (titleIdxEarly === -1 || tickIdx < titleIdxEarly)) {
    text = text.slice(tickIdx);
  }
  if (text.startsWith('```')) {
    text = text
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
  }
  // Require the spec title line — if the model dropped it entirely, reject.
  // Trim any preamble that precedes it so frontmatter (Linked issue, ADR,
  // Files touched) is not stripped along with stray prose.
  const titleIdx = text.indexOf('# Spec:');
  if (titleIdx === -1) {
    return null;
  }
  if (titleIdx > 0) {
    text = text.slice(titleIdx);
  }
  const required = [
    '## Problem',
    '## Out of scope',
    '## Constraints',
    '## Acceptance criteria',
    '## Changes',
    '## Tests',
    '## Verification',
  ];
  if (!required.every((h) => text.includes(h))) {
    return null;
  }
  return text;
}

if (result === 'NO_CHANGES_NEEDED') {
  console.log('Spec verification passed — no factual errors found.');
} else if (result) {
  const patched = sanitize(result);
  if (patched) {
    writeFileSync(SPEC_FILE, patched, 'utf8');
    console.log('Spec patched by verifier — factual errors corrected.');
  } else {
    console.warn('Spec verifier response failed sanity check — skipping patch.');
  }
} else {
  console.warn('Spec verifier returned empty response — skipping patch.');
}
