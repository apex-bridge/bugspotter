#!/usr/bin/env node
// Phase 2 impl agent: reads a ratified spec + codebase context, calls Claude,
// writes a multi-file implementation scaffold.
//
// Model router (label-based via ISSUE_LABELS env):
//   complexity:high  -> claude-opus-4-8   (deep architecture, cross-cutting changes)
//   pii-sensitive    -> claude-haiku-4-5-20251001  (local-floor stand-in; cheapest hosted)
//   default          -> claude-sonnet-4-6
// The selected model is passed to callClaude's `model` override on either backend.
//
// Static context (CLAUDE.md files + pattern examples) is prepended to the prompt.
// (Anthropic-native prompt caching via cache_control no longer applies once routed
// through llm-client.mjs's plain-string prompt — see llm-client.mjs.)
//
// Output: writes files listed in Claude's JSON response; outputs file list to GITHUB_OUTPUT.
//
// Required env: ISSUE_NUMBER, ISSUE_TITLE, SPEC_CONTENT, plus either
//   ANTHROPIC_API_KEY (default) or CLAUDE_CODE_OAUTH_TOKEN (LLM_BACKEND=cli)
// Optional:     ISSUE_LABELS (comma-separated), GITHUB_OUTPUT

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { callClaude, requireLlmCredentials } from './llm-client.mjs';
import { extractDeclaredPaths } from './verify-spec-ownership.mjs';

const { ISSUE_NUMBER, ISSUE_TITLE, ISSUE_LABELS = '', SPEC_CONTENT, GITHUB_OUTPUT } = process.env;

requireLlmCredentials();
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
const MODEL_HIGH = process.env.IMPL_MODEL_HIGH || 'claude-opus-4-8';
const MODEL_DEFAULT = process.env.IMPL_MODEL_DEFAULT || 'claude-sonnet-4-6';
const MODEL_LOW = process.env.IMPL_MODEL_LOW || 'claude-haiku-4-5-20251001';

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

// Read static context (CLAUDE.md files + style examples) shared by every issue
function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const rootClaudeMd = safeRead('CLAUDE.md');
const backendClaudeMd = safeRead('packages/backend/CLAUDE.md');
const contributing = safeRead('CONTRIBUTING.md');

// Read one existing route + test as style examples
function findExample(dir, ext) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(ext));
    return files.length ? safeRead(`${dir}/${files[0]}`) : '';
  } catch {
    return '';
  }
}
const routeExample = findExample('packages/backend/src/api/routes', '.ts').slice(0, 1500);
const testExample = findExample('packages/backend/tests/api', '.test.ts').slice(0, 1500);

// Static context block (prepended to every generate-impl prompt)
const staticContext = [
  rootClaudeMd ? `# CLAUDE.md (root)\n${rootClaudeMd}` : '',
  backendClaudeMd ? `# CLAUDE.md (backend)\n${backendClaudeMd}` : '',
  contributing ? `# CONTRIBUTING.md\n${contributing}` : '',
  routeExample
    ? `# Example route (style reference)\n\`\`\`typescript\n${routeExample}\n\`\`\``
    : '',
  testExample ? `# Example test (style reference)\n\`\`\`typescript\n${testExample}\n\`\`\`` : '',
]
  .filter(Boolean)
  .join('\n\n---\n\n');

const specSection = `# Ratified spec\n${SPEC_CONTENT}`;

const repoRoot = process.cwd();

// Paths the agent may never write, and — since the read side below feeds an
// external LLM API — may never read either. `.git/config` in particular holds
// actions/checkout's `http.<url>.extraheader` credential on a runner, so
// injecting it into a prompt would ship GITHUB_TOKEN off-box.
const FORBIDDEN_PATH_PATTERNS = [
  /^\.git(\/|$)/,
  /^\.github\/workflows\//,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)(pnpm-lock\.yaml|yarn\.lock)$/,
];

/**
 * POSIX path of `p` relative to `base`, or null if it escapes `base`.
 * A substring check for '..' is not enough on its own: it lets an absolute
 * path ('/etc/passwd', 'C:\\...') through untouched.
 */
function relativeToBase(base, p) {
  const relPath = relative(base, resolve(base, p));
  if (!relPath || relPath.startsWith('..') || isAbsolute(relPath)) {
    return null;
  }
  return relPath.replaceAll('\\', '/');
}

function toRepoRelative(p) {
  return relativeToBase(repoRoot, p);
}

function isForbidden(relPath) {
  return FORBIDDEN_PATH_PATTERNS.some((re) => re.test(relPath));
}

// Resolved once: the workspace itself can sit behind a symlink (macOS
// /tmp -> /private/tmp), and comparing a realpath against a lexical root
// would then reject every legitimate file.
let realRepoRoot = repoRoot;
try {
  realRepoRoot = realpathSync(repoRoot);
} catch {
  /* keep the lexical root */
}

/** Both directions of the LLM boundary — read and write — use this one rule. */
function isAllowedRepoPath(p) {
  const relPath = toRepoRelative(p);
  if (relPath === null || isForbidden(relPath)) {
    return false;
  }
  // The check above is lexical, so a committed symlink passes it while
  // pointing somewhere else entirely. `.git/config` is the case that makes
  // this worth closing: on a runner it holds actions/checkout's credential,
  // which — unlike ordinary file contents — an attacker cannot obtain just
  // by committing it. Only meaningful for paths that already exist; a path
  // yet to be created cannot be a symlink, so a failed realpath is not an
  // escape.
  let realPath;
  try {
    realPath = realpathSync(p);
  } catch {
    return true;
  }
  const realRel = relativeToBase(realRepoRoot, realPath);
  return realRel !== null && !isForbidden(realRel);
}

const LANGUAGE_BY_EXT = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sql: 'sql',
  md: 'markdown',
};

function languageFor(path) {
  return LANGUAGE_BY_EXT[path.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

/**
 * Pick a fence longer than the longest backtick run in the body, per
 * CommonMark. Escaping the body instead (```  -> `` `) would corrupt content
 * the very next paragraph tells the model to reproduce verbatim.
 */
function fenceFor(body) {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

// Current content of every file the spec declares under "Files touched" that
// already exists. Without this, the agent is asked to emit COMPLETE file
// contents ({path, content}) for files it has never seen — it can only
// reconstruct the untouched 95% from imagination, which is exactly how
// issue #237's second attempt drifted `intelligenceRoutes`'s and
// `createIntelligenceWorker`'s signatures and broke the build in two files
// the spec never listed. The third attempt then failed differently: the spec
// (correctly tightened to demand byte-for-byte fidelity to `main`) made the
// model try to Read the files, but tools are disabled on this path
// (llm-client.mjs's `--tools=`), so it emitted prose narration instead of
// JSON and the parse failed. Both failures share this one root cause.
//
// verify-spec.mjs already does exactly this for its own prompt; this mirrors
// that, including the same 1000-line-per-file cap.
const MAX_LINES_PER_FILE = 1000;
const declaredPaths = extractDeclaredPaths(SPEC_CONTENT) ?? [];
let truncatedCount = 0;
const currentFiles = declaredPaths
  .filter((p) => isAllowedRepoPath(p) && existsSync(p))
  .map((p) => {
    // Read directly rather than via safeRead: safeRead collapses "unreadable"
    // and "genuinely empty" into the same '' and would drop a real empty file.
    // The catch also covers a declared path that resolves to a directory.
    let content;
    try {
      content = readFileSync(p, 'utf8');
    } catch {
      return null;
    }
    const lines = content.split('\n');
    const isTruncated = lines.length > MAX_LINES_PER_FILE;
    const body = isTruncated ? lines.slice(0, MAX_LINES_PER_FILE).join('\n') : content;
    const fence = fenceFor(body);
    if (isTruncated) {
      truncatedCount += 1;
    }
    // A truncated file must be labelled at its own header, not just in the
    // preamble: the repo has source and test files well past this cap
    // (packages/backend/tests/api/storage-urls.test.ts is ~1800 lines), and
    // "reproduce it verbatim" applied to a body missing its tail means the
    // agent silently deletes everything past line 1000.
    const header = isTruncated
      ? `## ${p}\n\nTRUNCATED: showing lines 1-${MAX_LINES_PER_FILE} of ${lines.length}. ` +
        `Reference only — do NOT return this file.`
      : `## ${p}`;
    return `${header}\n${fence}${languageFor(p)}\n${body}\n${fence}`;
  })
  .filter(Boolean);

const currentFilesSection = currentFiles.length
  ? `# Current content of the files you must edit\n\nThese are the current contents of these ` +
    `files in this checkout. For each one you return, reproduce it verbatim except for the ` +
    `specific changes the spec calls for. Do not rewrite, reformat, reorder, or "improve" ` +
    `anything the spec does not explicitly ask you to change.` +
    (truncatedCount
      ? `\n\nA file marked TRUNCATED is shown only in part. Never return one: you would ` +
        `silently delete the lines you cannot see. Treat it as read-only reference, and if ` +
        `the spec requires changing it, say so in your summary instead of returning it.`
      : '') +
    `\n\n${currentFiles.join('\n\n')}`
  : '';

console.log(
  currentFiles.length
    ? `Injecting current content of ${currentFiles.length} existing declared file(s) into the ` +
        `prompt${truncatedCount ? ` (${truncatedCount} truncated, marked read-only)` : ''}.`
    : 'No existing declared files to inject (all-new-files spec, or no parseable "Files touched" line).'
);

// Output-budget visibility. The {path, content} schema means every declared
// file the agent edits is re-emitted IN FULL, so the OUTPUT side binds long
// before the input context does — issue #237's three declared files are
// ~49KB, roughly 13.6K tokens of mostly-unchanged text.
//
// MAX_TOKENS only actually caps anything on the API backend: callViaCli
// ignores it because `claude` has no per-call output-token flag (see
// llm-client.mjs's header). So the warning below is backend-aware rather
// than asserting a cap that isn't in force — LLM_BACKEND is `cli` today.
// No preflight hard-stop: it would have to guess which declared files the
// agent will actually return, and a wrong guess blocks a run that would
// have succeeded. A diff-shaped response schema is the structural fix; see
// this PR's description.
const MAX_TOKENS = 16384;
const declaredBytes = currentFiles.reduce((n, s) => n + s.length, 0);
const estimatedOutputTokens = Math.round(declaredBytes / 3.6);
if (currentFiles.length) {
  const base =
    `Output budget: re-emitting all ${currentFiles.length} declared file(s) in full is ` +
    `~${estimatedOutputTokens} tokens.`;
  if (process.env.LLM_BACKEND === 'cli') {
    console.log(`${base} No per-call output cap on the CLI backend.`);
  } else if (estimatedOutputTokens > MAX_TOKENS * 0.8) {
    console.warn(
      `${base} That is over 80% of this backend's ${MAX_TOKENS}-token max_tokens — expect a ` +
        `max_tokens truncation if the agent returns every declared file.`
    );
  } else {
    console.log(`${base} Cap is ${MAX_TOKENS} tokens on this backend.`);
  }
}

const userPrompt = `\
You are an implementation agent for BugSpotter, a SaaS bug-reporting platform (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs).

Generate a **minimal, compilable implementation scaffold** for GitHub issue #${ISSUE_NUMBER}: "${ISSUE_TITLE}".

Read the spec and acceptance criteria carefully. Generate exactly the files needed — no more.
Match the style of the examples in the static context above exactly (same import style, error classes, Fastify plugin pattern, test helpers).

${specSection}
${currentFilesSection ? `\n${currentFilesSection}\n` : ''}
RULES:
0. You have NO tools available — no Read, no Grep, no Bash. Everything you need is already in this prompt. Do not attempt a tool call and do not narrate one; if a file you must edit is shown above, use that content as the source of truth, and if something you need is genuinely absent, make the smallest reasonable assumption and note it in a TODO comment rather than stopping to ask for it.
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

// staticContext used to be sent as a separate cache_control-marked content
// block so repeated same-day runs skipped re-sending it; llm-client.mjs's
// callClaude takes a single plain-text prompt, so it's folded in as a plain
// prefix here instead. This drops the token-cache cost saving but not
// correctness — see the header comment above.
const prompt = staticContext ? `${staticContext}\n\n${userPrompt}` : userPrompt;

let text, stopReason;
try {
  // 600s: this is the largest of the four ai-sdlc Claude calls — max_tokens
  // (16384) is 2x verify-spec.mjs's (8192), and the prompt (static
  // CLAUDE.md/CONTRIBUTING.md/style-example context plus the full ratified
  // spec) is comparable in size to verify-spec's (spec + up to 15 source
  // files). verify-spec.mjs measured 283.9s for its 8192-token generation
  // via the CLI backend and set 420s (~1.5x margin). Scaling that budget for
  // roughly double the output tokens suggests ~600-800s.
  //
  // 600_000ms proved too thin against real measurements on issue #237: one
  // run timed out at exactly 600s, and the run that did complete took 9m08s
  // (548s) — a 9% margin. Raised to 780_000ms (13m), which still sits under
  // impl-agent.yml's "Generate scaffold" step timeout with room for node
  // startup and file I/O (that step's budget was raised to 18m in the same
  // change, and the job cap to 25m so the post-generation steps still fit).
  //
  // The deeper cost driver is the response schema: {path, content} means the
  // model re-emits every declared file IN FULL, so editing three ~500-line
  // files costs ~15K output tokens of mostly-unchanged text against a 16384
  // cap. That's the real scaling limit here, and a diff/patch-shaped schema
  // would be the structural fix — deliberately not attempted in this change,
  // which is scoped to making the current shape work.
  ({ text, stopReason } = await callClaude({
    prompt,
    maxTokens: MAX_TOKENS,
    timeoutMs: 780_000,
    model: MODEL,
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Fail fast if truncated — a partial JSON response will always cause a parse error downstream
if (stopReason === 'max_tokens') {
  console.error(
    `Claude response truncated (stop_reason=max_tokens). Raise max_tokens in generate-impl.mjs.`
  );
  process.exit(1);
}

// Parse JSON response
let parsed;
try {
  // Extract JSON — handle leading prose + fenced block, or bare JSON
  const fenceMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const raw = fenceMatch ? fenceMatch[1].trim() : text.trim();
  parsed = JSON.parse(raw);
} catch (e) {
  console.error('Failed to parse JSON from Claude response:', e.message);
  console.error('Raw response:', text.slice(0, 500));
  process.exit(1);
}

if (!parsed || !Array.isArray(parsed.files) || parsed.files.length === 0) {
  console.error('No files in response:', JSON.stringify(parsed, null, 2));
  process.exit(1);
}

// Write files (repoRoot + FORBIDDEN_PATH_PATTERNS are declared above, shared
// with the read side of the prompt-injection boundary)
const writtenPaths = [];
const seenPaths = new Set();
for (const { path, content } of parsed.files) {
  if (typeof path !== 'string' || typeof content !== 'string' || !path || !content) {
    continue;
  }
  // eslint-disable-next-line no-control-regex -- deliberate: rejects paths containing raw control characters
  if (/[\x00-\x1f]/.test(path)) {
    console.error(`Rejected path with control characters: ${JSON.stringify(path)}`);
    continue;
  }
  const resolvedPath = resolve(repoRoot, path);
  const relPath = toRepoRelative(path);
  if (relPath === null) {
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
    `impl_summary<<${delimiter}\n${String(parsed.summary ?? '')}\n${delimiter}\n`
  );
}
