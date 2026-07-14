#!/usr/bin/env node
// Phase 2 impl agent: reads a ratified spec + codebase context, calls Claude API,
// writes a multi-file implementation scaffold.
//
// Model router (label-based via ISSUE_LABELS env):
//   complexity:high  -> claude-opus-4-8   (deep architecture, cross-cutting changes)
//   pii-sensitive    -> claude-haiku-4-5-20251001  (local-floor stand-in; cheapest hosted)
//   default          -> claude-sonnet-4-6
//
// Prompt caching: static context (CLAUDE.md files + pattern examples) marked with
// cache_control so repeated runs on the same day skip re-sending that payload.
//
// Output: writes files listed in Claude's JSON response; outputs file list to GITHUB_OUTPUT.
//
// Required env: ANTHROPIC_API_KEY, ISSUE_NUMBER, ISSUE_TITLE, SPEC_CONTENT
// Optional:     ISSUE_LABELS (comma-separated), GITHUB_OUTPUT

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const {
  ANTHROPIC_API_KEY,
  ISSUE_NUMBER,
  ISSUE_TITLE,
  ISSUE_LABELS = '',
  SPEC_CONTENT,
  GITHUB_OUTPUT,
} = process.env;

if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}
if (!ISSUE_NUMBER) {
  console.error('Missing ISSUE_NUMBER');
  process.exit(1);
}
if (!ISSUE_TITLE) {
  console.error('Missing ISSUE_TITLE');
  process.exit(1);
}
if (!SPEC_CONTENT) {
  console.error('Missing SPEC_CONTENT — ratify a spec (Gate 1) before running the impl agent.');
  process.exit(1);
}

// Model router — label-based with per-tier overrides via GitHub repo variables.
// Change without a code edit: set IMPL_MODEL_HIGH / IMPL_MODEL_DEFAULT / IMPL_MODEL_LOW
// in Settings > Secrets and variables > Actions > Variables.
const MODEL_HIGH    = process.env.IMPL_MODEL_HIGH    || 'claude-opus-4-8';
const MODEL_DEFAULT = process.env.IMPL_MODEL_DEFAULT || 'claude-sonnet-4-6';
const MODEL_LOW     = process.env.IMPL_MODEL_LOW     || 'claude-haiku-4-5-20251001';

function selectModel(labels) {
  const set = new Set(labels.split(',').map((l) => l.trim().toLowerCase()));
  if (set.has('complexity:high')) {
    return MODEL_HIGH;
  }
  if (set.has('pii-sensitive')) {
    return MODEL_LOW;
  }
  return MODEL_DEFAULT;
}
const MODEL = selectModel(ISSUE_LABELS);
console.log(`Model router selected: ${MODEL} (labels: "${ISSUE_LABELS || 'none'}")`);

// Read static context for prompt caching
function safeRead(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

const rootClaudeMd    = safeRead('CLAUDE.md');
const backendClaudeMd = safeRead('packages/backend/CLAUDE.md');
const contributing    = safeRead('CONTRIBUTING.md');

// Read one existing route + test as style examples
function findExample(dir, ext) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(ext));
    return files.length ? safeRead(`${dir}/${files[0]}`) : '';
  } catch { return ''; }
}
const routeExample = findExample('packages/backend/src/api/routes', '.ts').slice(0, 1500);
const testExample  = findExample('packages/backend/tests/api', '.test.ts').slice(0, 1500);

// Static context block (cached)
const staticContext = [
  rootClaudeMd    ? `# CLAUDE.md (root)\n${rootClaudeMd}`    : '',
  backendClaudeMd ? `# CLAUDE.md (backend)\n${backendClaudeMd}` : '',
  contributing    ? `# CONTRIBUTING.md\n${contributing}`     : '',
  routeExample    ? `# Example route (style reference)\n\`\`\`typescript\n${routeExample}\n\`\`\`` : '',
  testExample     ? `# Example test (style reference)\n\`\`\`typescript\n${testExample}\n\`\`\`` : '',
].filter(Boolean).join('\n\n---\n\n');

const specSection = `# Ratified spec\n${SPEC_CONTENT}`;

const userPrompt = `\
You are an implementation agent for BugSpotter, a SaaS bug-reporting platform (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs).

Generate a **minimal, compilable implementation scaffold** for GitHub issue #${ISSUE_NUMBER}: "${ISSUE_TITLE}".

Read the spec and acceptance criteria carefully. Generate exactly the files needed — no more.
Match the style of the examples in the static context above exactly (same import style, error classes, Fastify plugin pattern, test helpers).

${specSection}

RULES:
1. Return ONLY valid JSON — no prose, no markdown fences around the JSON itself.
2. Schema: { "files": [ { "path": "...", "content": "..." } ], "summary": "one sentence" }
3. Paths are relative to the repo root (e.g. "packages/backend/src/api/routes/foo.ts").
4. Include a route file AND a test file at minimum if the spec mentions an API endpoint.
5. Include a migration file if the spec mentions a DB schema change.
6. Leave TODO comments for logic that requires business context only a human can supply.
7. Do NOT generate package.json, pnpm-lock.yaml, or any config file changes.
8. Do NOT generate more than 6 files total.
9. Scaffold tests must use the same test helpers as the example (do not invent new ones).
10. Every generated file must compile without errors given reasonable stub imports.`;

// Build messages with prompt caching on static context
const messages = [
  {
    role: 'user',
    content: [
      {
        type: 'text',
        text: staticContext,
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: userPrompt,
      },
    ],
  },
];

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  signal: AbortSignal.timeout(120_000),
  headers: {
    'content-type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 16384,
    messages,
  }),
});

if (!res.ok) {
  const text = await res.text().catch(() => '');
  let detail = text;
  try { detail = JSON.stringify(JSON.parse(text), null, 2); } catch { /* use raw text */ }
  console.error(`Claude API error (${res.status}):`, detail);
  process.exit(1);
}

const data = await res.json();
if (data?.content?.[0]?.type !== 'text') {
  console.error('Unexpected API response shape:', JSON.stringify(data, null, 2));
  process.exit(1);
}

// Log cache stats if available
const usage = data.usage ?? {};
if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
  console.log(
    `Cache: created=${usage.cache_creation_input_tokens ?? 0} read=${usage.cache_read_input_tokens ?? 0} uncached=${usage.input_tokens ?? 0}`,
  );
}

// Fail fast if truncated — a partial JSON response will always cause a parse error downstream
if (data.stop_reason === 'max_tokens') {
  console.error(`Claude response truncated (stop_reason=max_tokens). Raise max_tokens in generate-impl.mjs.`);
  process.exit(1);
}

// Parse JSON response
let parsed;
try {
  // Extract JSON — handle leading prose + fenced block, or bare JSON
  const fenceMatch = data.content[0].text.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = fenceMatch ? fenceMatch[1].trim() : data.content[0].text.trim();
  parsed = JSON.parse(raw);
} catch (e) {
  console.error('Failed to parse JSON from Claude response:', e.message);
  console.error('Raw response:', data.content[0].text.slice(0, 500));
  process.exit(1);
}

if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
  console.error('No files in response:', JSON.stringify(parsed, null, 2));
  process.exit(1);
}

// Write files
const writtenPaths = [];
const repoRoot = process.cwd();
const FORBIDDEN_PATH_PATTERNS = [
  /^\.git(\/|$)/,
  /^\.github\/workflows\//,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)(pnpm-lock\.yaml|yarn\.lock)$/,
];

const seenPaths = new Set();
for (const { path, content } of parsed.files) {
  if (typeof path !== 'string' || typeof content !== 'string' || !path || !content) {
    continue;
  }
  if (/[\x00-\x1f]/.test(path)) {
    console.error(`Rejected path with control characters: ${JSON.stringify(path)}`);
    continue;
  }
  const resolvedPath = resolve(repoRoot, path);
  const relPath = relative(repoRoot, resolvedPath);
  if (relPath.startsWith('..') || isAbsolute(relPath)) {
    console.error(`Path traversal detected and blocked: ${path}`);
    continue;
  }
  if (FORBIDDEN_PATH_PATTERNS.some((re) => re.test(relPath)) || seenPaths.has(relPath)) {
    console.error(`Rejected forbidden/duplicate target path: ${relPath}`);
    continue;
  }
  seenPaths.add(relPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, content, 'utf8');
  console.log(`Wrote ${relPath}`);
  writtenPaths.push(relPath);
}

if (writtenPaths.length === 0) {
  console.error('No valid files were written after validation - aborting.');
  process.exit(1);
}

console.log(`\nSummary: ${parsed.summary}`);

if (GITHUB_OUTPUT) {
  const delimiter = `IMPL_SUMMARY_${randomUUID()}`;
  appendFileSync(GITHUB_OUTPUT, `files_written=${writtenPaths.join(',')}\n`);
  appendFileSync(GITHUB_OUTPUT, `model_used=${MODEL}\n`);
  appendFileSync(
    GITHUB_OUTPUT,
    `impl_summary<<${delimiter}\n${String(parsed.summary ?? '')}\n${delimiter}\n`,
  );
}
