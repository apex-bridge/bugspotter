#!/usr/bin/env node
// Calls Claude API to draft a spec document for a GitHub issue.
// Run from the repo root. Reads TEMPLATE.md; writes docs/specs/<file>.
// Outputs spec_file and spec_slug to GITHUB_OUTPUT.
//
// Required env vars: ANTHROPIC_API_KEY, ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY
// Optional:          GITHUB_OUTPUT (set by Actions; falls back to stdout print)

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';

const { ANTHROPIC_API_KEY, ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, GITHUB_OUTPUT } = process.env;

if (!ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY'); process.exit(1); }
if (!ISSUE_NUMBER)      { console.error('Missing ISSUE_NUMBER');      process.exit(1); }
if (!ISSUE_TITLE)       { console.error('Missing ISSUE_TITLE');       process.exit(1); }

const template = readFileSync('docs/specs/TEMPLATE.md', 'utf8');

const slug = ISSUE_TITLE
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

const padded = String(ISSUE_NUMBER).padStart(4, '0');
const specFile = `docs/specs/${padded}-${slug}.md`;

const prompt = `\
You are a spec writer for BugSpotter, a SaaS bug-reporting platform (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs).

Draft a spec document for GitHub issue #${ISSUE_NUMBER}. Follow the template below exactly — fill every section, keep the comment markers removed, replace placeholder text with concrete content.

TEMPLATE:
${template}

ISSUE #${ISSUE_NUMBER}: ${ISSUE_TITLE}

${ISSUE_BODY?.trim() || '(no description provided)'}

Rules:
- "Linked issue:" line must say "Refs #${ISSUE_NUMBER}"
- "ADR:" line: write "pending" unless the issue text names a specific ADR
- Acceptance criteria must be testable conditions, not vague goals
- "How (runnable steps)" must be concrete bash/TypeScript snippets an implementor can run
- "Rollback:" must describe a concrete undo action for any irreversible step, or "n/a" if all steps are additive
- Return ONLY the filled spec document — no preamble, no explanation, no markdown fences`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  }),
});

if (!res.ok) {
  let detail = '';
  try { detail = JSON.stringify(await res.json(), null, 2); } catch { detail = await res.text().catch(() => ''); }
  console.error(`Claude API error (${res.status}):`, detail);
  process.exit(1);
}
const data = await res.json();
if (data?.content?.[0]?.type !== 'text') {
  console.error('Unexpected API response shape:', JSON.stringify(data, null, 2));
  process.exit(1);
}
const specContent = data.content[0].text;

mkdirSync('docs/specs', { recursive: true });
writeFileSync(specFile, specContent, 'utf8');

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `spec_file=${specFile}\n`);
  appendFileSync(GITHUB_OUTPUT, `spec_slug=${slug}\n`);
  appendFileSync(GITHUB_OUTPUT, `padded_number=${padded}\n`);
} else {
  console.log(`spec_file=${specFile}`);
  console.log(`spec_slug=${slug}`);
}

console.log(`Wrote ${specFile}`);
