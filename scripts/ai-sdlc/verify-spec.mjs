#!/usr/bin/env node
// Adversarial spec verifier: reads the generated spec, reads every file it
// claims to touch, then calls Claude to find and fix factual errors before
// the PR is opened.
//
// Required env vars: ANTHROPIC_API_KEY, SPEC_FILE
// Exits 0 always — verification failure patches the spec, not blocks the run.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const { ANTHROPIC_API_KEY, SPEC_FILE } = process.env;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}
if (!SPEC_FILE) {
  console.error('Missing SPEC_FILE');
  process.exit(1);
}

const spec = readFileSync(SPEC_FILE, 'utf8');

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
    const content = readFileSync(p, 'utf8');
    // Cap at 300 lines to keep prompt size bounded.
    const lines = content.split('\n').slice(0, 300).join('\n');
    const truncated = content.split('\n').length > 300 ? '\n[… truncated at 300 lines]' : '';
    return `### ${p}\n\`\`\`ts\n${lines}${truncated}\n\`\`\``;
  })
  .join('\n\n');

if (!fileSections) {
  console.log('No existing source files referenced in spec — skipping verification.');
  process.exit(0);
}

const prompt = `\
You are an adversarial reviewer for a spec document. Your job is to find and fix ONLY factual errors before the spec reaches an impl-agent.

SPEC TO VERIFY:
${spec}

SOURCE FILES REFERENCED BY THE SPEC:
${fileSections}

Check for:
1. Method or function names called in the spec that don't exist in the source files
2. File paths in the spec that don't match actual paths
3. TypeScript type errors — e.g. accessing a property typed as non-optional with optional chaining, or vice versa
4. Test mock/helper shapes — if the spec proposes calling db.X.findById() but the test helper has no X key, flag it
5. TypeScript closure narrowing — optional function parameters are not narrowed by early-return guards inside nested async closures; a const binding is required
6. Schema constraints that would produce wrong HTTP status codes (e.g. minimum on a schema field that causes Fastify to reject values the caller legally sends, mapped to a worse error code downstream)
7. Code shown as "new code to write" that is actually already present in the source file verbatim (impl-agent would duplicate it)

Do NOT change:
- The spec's intent, scope, or architectural decisions
- Wording or style unless it contains a factual error
- Anything not in the check list above

If you find no factual errors, respond with exactly the word: NO_CHANGES_NEEDED

Otherwise respond with the complete corrected spec document — no preamble, no explanation, no markdown fences around the whole document.`;

console.log(
  `Verifying spec against ${mentioned.filter((p) => existsSync(p)).length} source file(s)…`
);

let res;
try {
  res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
} catch (err) {
  console.warn(`Spec verifier fetch error: ${err.message}`);
  process.exit(0);
}

if (!res.ok) {
  let detail = '';
  try {
    const raw = await res.text();
    try {
      detail = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      detail = raw;
    }
  } catch {
    /* body unreadable */
  }
  // Verification failure is non-fatal — log and continue with unpatched spec.
  console.warn(`Spec verifier API error (${res.status}): ${detail}`);
  process.exit(0);
}

let data;
try {
  data = await res.json();
} catch (err) {
  console.warn(`Failed to parse spec verifier response: ${err.message}`);
  process.exit(0);
}
const result = data?.content?.[0]?.text?.trim() ?? '';

// Strip outer markdown fences the model sometimes adds, then confirm the
// required section headers survived before overwriting the spec.
function sanitize(raw) {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text
      .replace(/^```[a-z]*\n?/, '')
      .replace(/\n?```$/, '')
      .trim();
  }
  // Trim any leading preamble before the first section header.
  const headerIdx = text.indexOf('## ');
  if (headerIdx > 0) text = text.slice(headerIdx);
  const required = ['## Problem', '## Changes', '## Tests'];
  if (!required.every((h) => text.includes(h))) return null;
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
