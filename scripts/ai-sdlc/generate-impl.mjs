#!/usr/bin/env node
// Phase 2 impl agent: reads a ratified spec + codebase context, calls Claude,
// writes a multi-file implementation scaffold.
//
// Model router (label-based via ISSUE_LABELS env):
//   complexity:high  -> claude-opus-4-8   (deep architecture, cross-cutting changes)
//   pii-sensitive    -> claude-haiku-4-5-20251001  (local-floor stand-in; cheapest hosted)
//   default          -> claude-sonnet-5
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
import { normalizePath, findUnwrittenPaths } from './check-impl-scope.mjs';
import { DEFAULT_MODEL, HIGH_MODEL, LOW_MODEL } from './model-defaults.mjs';

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
// in Settings > Secrets and variables > Actions > Variables. Fallback literals
// come from the shared model-defaults.mjs (also used by llm-client.mjs), so a
// version bump only touches one place.
const MODEL_HIGH = process.env.IMPL_MODEL_HIGH || HIGH_MODEL;
const MODEL_DEFAULT = process.env.IMPL_MODEL_DEFAULT || DEFAULT_MODEL;
const MODEL_LOW = process.env.IMPL_MODEL_LOW || LOW_MODEL;

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
const truncatedFiles = [];
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
    // A trailing newline terminates the last line, it does not start a new
    // one: split('\n') on "a\nb\n" yields three entries, the last of them
    // empty. Counting entries raw would read every file written with the
    // usual trailing newline as one line longer than it is, so a file of
    // exactly MAX_LINES_PER_FILE lines would land over the cap. That was
    // merely a mislabel while over-cap files were only annotated TRUNCATED;
    // the preflight below turns over-cap into a hard exit, so the same
    // off-by-one would now reject a spec that sits exactly at the cap and is
    // perfectly satisfiable.
    const lineCount = lines.length - (lines.at(-1) === '' ? 1 : 0);
    const isTruncated = lineCount > MAX_LINES_PER_FILE;
    const body = isTruncated ? lines.slice(0, MAX_LINES_PER_FILE).join('\n') : content;
    const fence = fenceFor(body);
    if (isTruncated) {
      truncatedCount += 1;
      truncatedFiles.push({ path: p, lines: lineCount });
    }
    // A truncated file must be labelled at its own header, not just in the
    // preamble: the repo has source and test files well past this cap
    // (packages/backend/tests/api/storage-urls.test.ts is ~1800 lines), and
    // "reproduce it verbatim" applied to a body missing its tail means the
    // agent silently deletes everything past line 1000.
    const header = isTruncated
      ? `## ${p}\n\nTRUNCATED: showing lines 1-${MAX_LINES_PER_FILE} of ${lineCount}. ` +
        `Reference only — do NOT return this file.`
      : `## ${p}`;
    return `${header}\n${fence}${languageFor(p)}\n${body}\n${fence}`;
  })
  .filter(Boolean);

// Fail BEFORE the model call if the spec is unsatisfiable by construction.
// Two individually-correct rules collide: the prompt above tells the model
// never to return a TRUNCATED file (returning one would silently delete
// everything past the cap), while check-impl-scope.mjs hard-fails when a
// declared file is not written. A spec declaring an over-cap file therefore
// deadlocks - the model correctly refuses, the gate correctly fails, and a
// re-run fails identically. 27 files in packages/backend alone are over the
// cap, so this is reachable, not theoretical. Detecting it here costs
// milliseconds; detecting it downstream costs a full 9-13 minute paid run
// that cannot succeed.
if (truncatedFiles.length > 0) {
  console.error(
    `Refusing to call the model: the spec declares ${truncatedFiles.length} file(s) larger ` +
      `than the ${MAX_LINES_PER_FILE}-line context cap:\n` +
      truncatedFiles.map((f) => `  ${f.path} (${f.lines} lines)`).join('\n') +
      `\n\nThe agent cannot safely return a file it can only partially see, but the impl-scope ` +
      `gate requires every declared file to be written - so this spec cannot succeed as ` +
      `written. Narrow the spec to smaller files, split the change, or make this edit by hand.`
  );
  process.exit(1);
}

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
10. Every generated file must compile without errors given reasonable stub imports.
11. Generated code must also pass ESLint, not just tsc — the commit step runs \`eslint --fix\` in a pre-commit hook and a remaining error hard-fails the run. Auto-fixable issues are handled for you; the ones that are not include \`prefer-const\` on a partially-reassigned destructuring (\`let { a, b }\` where only \`a\` is reassigned — declare \`b\` as a separate \`const\`). If a spec's own sample code would violate such a rule, follow the spec's intent and emit the lint-clean equivalent.`;

// staticContext used to be sent as a separate cache_control-marked content
// block so repeated same-day runs skipped re-sending it; llm-client.mjs's
// callClaude takes a single plain-text prompt, so it's folded in as a plain
// prefix here instead. This drops the token-cache cost saving but not
// correctness — see the header comment above.
const prompt = staticContext ? `${staticContext}\n\n${userPrompt}` : userPrompt;

const scriptStartedAt = Date.now();
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
  // change, and the job cap to 25m so the post-generation steps still fit -
  // both raised again below, so read those as historical, not current).
  //
  // 780_000ms proved too thin too: issue #365 (2026-08-19), three identical
  // timeouts on issue #353's OIDC login/callback task, each killed still
  // producing output. Hand-parsing the raw CLI transcript (see #365 for the
  // full diagnosis) found the model doing one ~420-450s extended-thinking
  // pass, then starting a SECOND one immediately after - all three runs were
  // killed partway through that second pass, having spent nearly the whole
  // budget on thinking twice without ever reaching real output. Raised to
  // 1_140_000ms (19m) - and impl-agent.yml's step/job caps to 21m/28m, up
  // from 18m/25m - to give a second thinking pass of similar length room to
  // actually finish, not just start. Not claimed to be enough - #365
  // isn't closed, this is one measured step against it, same as #360/#362's
  // relationship for generate-spec.mjs's timeout.
  //
  // The deeper cost driver is the response schema: {path, content} means the
  // model re-emits every declared file IN FULL, so editing three ~500-line
  // files costs ~15K output tokens of mostly-unchanged text. A diff/patch-shaped
  // schema would be the structural fix — deliberately not attempted in this
  // change, which is scoped to making the current shape work.
  //
  // MAX_TOKENS below binds on LLM_BACKEND=api only. The live backend is `cli`,
  // which has no per-call output cap, so on the path this actually runs the
  // ceiling is the model's own limit and the real constraint is the timeout.
  // An earlier version of this comment called 16384 "the real scaling limit
  // here"; a run under that nominal cap emitted 50,304 output tokens without
  // truncating, which is what makes #296's 8.5x budget gap look the way it does.
  ({ text, stopReason } = await callClaude({
    prompt,
    maxTokens: MAX_TOKENS,
    timeoutMs: 1_140_000,
    model: MODEL,
  }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Fail fast if truncated — a partial JSON response will always cause a parse error downstream
if (stopReason === 'max_tokens') {
  // Both backends surface this, so the advice has to name a lever that exists
  // on the one in use. Raising MAX_TOKENS does nothing under `cli`: it is never
  // forwarded, and the response was bounded by the model's own limit.
  const remedy =
    (process.env.LLM_BACKEND || 'api') === 'cli'
      ? `LLM_BACKEND=cli ignores MAX_TOKENS, so raising it will not help. The response hit the ` +
        `model's own output limit: narrow the spec's declared file set, or split the issue.`
      : `Raise MAX_TOKENS in generate-impl.mjs (currently ${MAX_TOKENS}).`;
  console.error(`Claude response truncated (stop_reason=max_tokens). ${remedy}`);
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

// Self-correction: compare the response's own declared paths against the
// spec's "Files touched" list BEFORE writing anything, and make ONE
// corrective follow-up call for exactly the missing files if there's a
// gap. check-impl-scope.mjs's hard gate downstream still has the final
// say - this is a pre-emptive attempt to not need it, not a replacement.
// Deliberately asks for ONLY the missing files, not a full re-generation:
// the response schema's cost driver is re-emitting whole files, so a
// broad "try again" risks dropping a *different* file under the same
// pressure that caused this one. Verified against `parsed.files`, never
// against `parsed.summary` - issue #367 (2026-08-20) found a real run
// whose summary claimed all declared files were written while the files
// array itself held only 2 of 7, so the summary cannot be trusted as a
// completeness signal here any more than check-impl-scope.mjs trusts it.
//
// Time-budgeted, not unconditional: STEP_BUDGET_MS mirrors impl-agent.yml's
// "Generate scaffold" step cap (currently 21m). Turn 1 alone can
// legitimately use most of that budget, so a second call only fires with
// a real, bounded amount of time actually left; otherwise this skips
// straight to check-impl-scope.mjs reporting the gap to a human, same as
// before this existed. All three are overridable via env vars specifically
// so a future change to that workflow step's timeout-minutes can't
// silently desync from the number this script assumes - update the env
// var alongside the workflow change rather than relying on remembering to
// edit this file's own hard-coded default too.
function parsePositiveMs(envValue, fallback) {
  // Trim-then-check-empty BEFORE Number(), same reasoning as
  // check-spec-scope.mjs's resolveCap: Number('') is 0, not NaN, and
  // GitHub Actions resolves an unconfigured `vars.*` reference to an empty
  // string rather than leaving the env var unset - so `envValue !==
  // undefined` alone would let an empty override silently collapse the
  // budget to 0 instead of falling back.
  const trimmed = typeof envValue === 'string' ? envValue.trim() : envValue;
  if (trimmed === undefined || trimmed === '') {
    return fallback;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
const STEP_BUDGET_MS = parsePositiveMs(process.env.IMPL_STEP_BUDGET_MS, 21 * 60_000);
// Headroom for validation/write/downstream steps after the model call(s) return.
const SAFETY_BUFFER_MS = parsePositiveMs(process.env.IMPL_SAFETY_BUFFER_MS, 4 * 60_000);
// Not worth attempting a corrective call below this much remaining budget.
const RETRY_MIN_BUDGET_MS = parsePositiveMs(process.env.IMPL_RETRY_MIN_BUDGET_MS, 90_000);
const declaredPathsForRetry = (extractDeclaredPaths(SPEC_CONTENT) ?? [])
  .map(normalizePath)
  .filter(Boolean);
const respondedPaths = parsed.files
  .map((f) => (typeof f?.path === 'string' ? normalizePath(f.path) : null))
  .filter(Boolean);
const missingPaths = findUnwrittenPaths(respondedPaths, declaredPathsForRetry);
let correctionAttempted = false;

if (missingPaths.length > 0 && declaredPathsForRetry.length > 0) {
  const remainingMs = STEP_BUDGET_MS - SAFETY_BUFFER_MS - (Date.now() - scriptStartedAt);
  if (remainingMs < RETRY_MIN_BUDGET_MS) {
    console.log(
      `Response is missing ${missingPaths.length} declared file(s) (${missingPaths.join(', ')}), ` +
        `but only ~${Math.round(remainingMs / 1000)}s remain in the step budget - not enough for ` +
        `a safe corrective call. Proceeding without it; check-impl-scope.mjs will report the gap.`
    );
  } else {
    const retryTimeoutMs = Math.min(300_000, remainingMs);
    console.log(
      `Response covered ${respondedPaths.length}/${declaredPathsForRetry.length} declared files; ` +
        `missing: ${missingPaths.join(', ')}. Requesting exactly the missing file(s) in one ` +
        `corrective follow-up turn (timeout ${Math.round(retryTimeoutMs / 1000)}s).`
    );
    const correctionPrompt =
      `${prompt}\n\n` +
      `--- CORRECTIVE FOLLOW-UP ---\n` +
      `Your previous response's "files" array covered: ${respondedPaths.join(', ') || '(none)'}.\n` +
      `The spec's "Files touched" list also declares these paths, which your response did ` +
      `NOT include: ${missingPaths.join(', ')}.\n` +
      `Return ONLY these missing file(s) now, in the exact same JSON schema ` +
      `({ "files": [...], "summary": "..." }) - do not re-emit files you already provided.`;

    let retryText, retryStopReason;
    try {
      ({ text: retryText, stopReason: retryStopReason } = await callClaude({
        prompt: correctionPrompt,
        maxTokens: MAX_TOKENS,
        timeoutMs: retryTimeoutMs,
        model: MODEL,
      }));
    } catch (err) {
      // Not fatal - fall through with what turn 1 gave us and let
      // check-impl-scope.mjs report the (still-real) gap to a human.
      console.warn(`Corrective follow-up call failed, proceeding without it: ${err.message}`);
      retryText = null;
    }

    if (retryText && retryStopReason !== 'max_tokens') {
      try {
        const retryFenceMatch = retryText.match(/```json\s*([\s\S]*?)\s*```/i);
        const retryRaw = retryFenceMatch ? retryFenceMatch[1].trim() : retryText.trim();
        const retryParsed = JSON.parse(retryRaw);
        if (Array.isArray(retryParsed?.files) && retryParsed.files.length > 0) {
          // Merge the candidate files in, but do NOT claim success here.
          // retryParsed.files is what the retry SAYS it returned, not what
          // survives the write loop below (path-traversal/forbidden-path/
          // control-char rejection, or a duplicate of a turn-1 path) -
          // claiming these specific paths were "added" before that loop
          // has run would repeat the exact confabulation issue #367 is
          // about, just in this script's own log instead of the model's.
          // correctionAttempted + missingPaths (captured above) are what
          // let the post-write-loop block report what ACTUALLY landed.
          parsed.files = [...parsed.files, ...retryParsed.files];
          correctionAttempted = true;
          console.log(
            `Corrective follow-up returned ${retryParsed.files.length} file(s) - verifying ` +
              `after the write loop which of them actually land before updating the summary.`
          );
        }
      } catch (e) {
        console.warn(
          `Corrective follow-up response was not parseable JSON, proceeding without it: ${e.message}`
        );
      }
    }
  }
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

// Now that writtenPaths reflects what actually survived the write loop
// (path-traversal/forbidden-path/control-char rejection and dedup all
// included), report what the corrective follow-up ACTUALLY recovered -
// the intersection of what it was missing and what's now really on disk -
// not what it was asked for or what retryParsed.files claimed. Getting
// this wrong here would be the same confabulation issue #367 flagged in
// the model's own summary, just relocated into this script's log instead
// of fixed.
if (correctionAttempted) {
  const recovered = missingPaths.filter((p) => writtenPaths.includes(p));
  const stillMissing = missingPaths.filter((p) => !writtenPaths.includes(p));
  if (recovered.length > 0) {
    parsed.summary =
      `${parsed.summary ?? ''} [corrective follow-up recovered ${recovered.length} of ` +
      `${missingPaths.length} missing file(s): ${recovered.join(', ')}` +
      (stillMissing.length > 0 ? `; still missing: ${stillMissing.join(', ')}` : '') +
      `]`;
    console.log(
      `Corrective follow-up recovered ${recovered.length}/${missingPaths.length} file(s).`
    );
  } else {
    parsed.summary =
      `${parsed.summary ?? ''} [corrective follow-up attempted but recovered none of the ` +
      `${missingPaths.length} missing file(s): ${missingPaths.join(', ')}]`;
    console.log('Corrective follow-up recovered none of the missing file(s).');
  }
}

// Quality self-review: a second, narrowly-scoped LLM call that reviews ONLY
// the files just written for two specific things — significant duplication
// (3+ near-identical blocks) and extract-worthy complexity (a long inline
// handler that should be a named function). Deliberately NOT security,
// correctness, missing tests, or general style — that stays claude-review.yml's
// and CodeRabbit's job; splitting one reviewer's attention across both axes
// risks it doing both worse (that's why claude-review.yml's own prompt says
// "skip nits, style, theoretical issues"). Motivated by issue #368: impl-agent's
// own generated auth-oidc.ts had 12 copies of `reply.code(401).send({ error:
// 'Authentication failed' })` and two ~50-120 line inline route handlers,
// neither caught until a human noticed by hand afterward.
//
// Runs once per issue (here, inside generation), not once per push against an
// open PR — same cost shape as spec-agent.yml's generate-spec.mjs +
// verify-spec.mjs pair, and the same corrective-follow-up-call pattern above
// for missing files. Time-budgeted against the SAME step budget that call
// already uses: if turn 1 (plus a missing-file retry, if one fired) used most
// of STEP_BUDGET_MS, this is skipped entirely rather than risking the step's
// own timeout — a skipped quality pass costs nothing, but a timed-out step
// loses the whole scaffold.
const QUALITY_MIN_BUDGET_MS = parsePositiveMs(process.env.IMPL_QUALITY_MIN_BUDGET_MS, 90_000);
const qualityRemainingMs = STEP_BUDGET_MS - SAFETY_BUFFER_MS - (Date.now() - scriptStartedAt);

if (qualityRemainingMs < QUALITY_MIN_BUDGET_MS) {
  console.log(
    `Skipping quality self-review: only ~${Math.round(qualityRemainingMs / 1000)}s remain in ` +
      `the step budget, below the ${Math.round(QUALITY_MIN_BUDGET_MS / 1000)}s floor.`
  );
} else {
  const qualityTimeoutMs = Math.min(300_000, qualityRemainingMs);
  // Same MAX_LINES_PER_FILE cap the currentFiles section above applies to
  // pre-existing declared files, for the same reason: LLM_BACKEND=cli enforces
  // no output-token cap (see MAX_TOKENS's comment above), so a file this run
  // just wrote can already be arbitrarily large before it's re-injected here.
  // Uncapped, that risks the same unbounded-prompt cost/truncation exposure
  // this file already guards against on the input side. A truncated file is
  // marked read-only and excluded below if the model tries to revise it
  // anyway, mirroring "you would silently delete the lines you cannot see."
  // Both sets below feed the same "was this file actually shown to the
  // model" check when validating revisions further down: a path missing
  // from writtenFileSections — whether because it was truncated or because
  // it could not be read at all — must not be accepted back, or the quality
  // pass could silently overwrite a file it never saw with fabricated
  // content, same class of issue as the truncation case this already guards.
  const truncatedWrittenPaths = new Set();
  const unreadableWrittenPaths = new Set();
  const writtenFileSections = writtenPaths
    .map((p) => {
      // Same defensive read as the currentFiles block above (line ~236): this
      // script just wrote every one of these paths itself moments ago, so an
      // unreadable path here should be near-impossible, but a quality-review
      // hiccup must never abort a scaffold that otherwise succeeded (see the
      // callClaude try/catch below) — an uncaught readFileSync would do
      // exactly that.
      let content;
      try {
        content = readFileSync(resolve(repoRoot, p), 'utf8');
      } catch (err) {
        console.warn(`Quality self-review: cannot read ${p}, excluding it: ${err.message}`);
        unreadableWrittenPaths.add(p);
        return null;
      }
      const lines = content.split('\n');
      const lineCount = lines.length - (lines.at(-1) === '' ? 1 : 0);
      const isTruncated = lineCount > MAX_LINES_PER_FILE;
      const body = isTruncated ? lines.slice(0, MAX_LINES_PER_FILE).join('\n') : content;
      const fence = fenceFor(body);
      if (isTruncated) {
        truncatedWrittenPaths.add(p);
      }
      const header = isTruncated
        ? `## ${p}\n\nTRUNCATED: showing lines 1-${MAX_LINES_PER_FILE} of ${lineCount}. ` +
          `Reference only — do NOT propose changes to this file.`
        : `## ${p}`;
      return `${header}\n${fence}${languageFor(p)}\n${body}\n${fence}`;
    })
    .filter(Boolean)
    .join('\n\n');

  // Leading marker line, same purpose as the corrective-follow-up prompt's
  // own "--- CORRECTIVE FOLLOW-UP ---" header: lets tests (and, incidentally,
  // anyone reading a CLI transcript) tell the three possible calls apart
  // without guessing from prose.
  const qualityPrompt = `\
--- QUALITY SELF-REVIEW ---
You are a code-quality reviewer. Review ONLY the files below — everything just written for GitHub issue #${ISSUE_NUMBER}: "${ISSUE_TITLE}". Check for exactly two things:

1. Significant duplication — the same or near-identical block (3 or more times) that should collapse into one shared helper. Example: a route handler that returns \`reply.code(401).send({ error: 'Authentication failed' })\` many times inline should extract a single \`function unauthorized(reply) { return reply.code(401).send({ error: 'Authentication failed' }); }\` and call that instead — not just for brevity, but because scattering the literal risks one call site silently drifting from the others.
2. Extract-worthy complexity — an inline anonymous handler or closure long enough (roughly 50+ lines) that a named function would make it more readable and give it a real name in stack traces. Example: an inline \`async (request, reply) => { ...120 lines... }\` passed directly to a route-registration call should become a named function declared alongside the registration (nested there if the surrounding code requires a single registration entry point, not necessarily pulled to module scope).

Do NOT comment on or change:
- Security, correctness, or auth logic — a separate reviewer already covers this
- Missing tests
- General style, formatting, or naming outside the two checks above
- Anything that is not a clear instance of one of the two checks above

If neither issue is present, respond with exactly the word: NO_CHANGES_NEEDED

Otherwise respond with ONLY valid JSON (no prose, no markdown fences around the JSON itself): { "files": [ { "path": "...", "content": "..." } ], "summary": "one sentence" } — include the COMPLETE revised content of every file you changed, reproduced in full except for the specific extraction/deduplication. Do not include a file you did not change, and do not change the file set — only revise the content of files listed below.
${
  truncatedWrittenPaths.size
    ? `\nA file marked TRUNCATED below is shown only in part. Never propose a change to one: you would silently delete the lines you cannot see.\n`
    : ''
}
FILES WRITTEN:
${writtenFileSections}`;

  console.log(
    `Reviewing ${writtenPaths.length} written file(s) for duplication/extraction (timeout ` +
      `${Math.round(qualityTimeoutMs / 1000)}s)…`
  );

  let qualityText, qualityStopReason;
  try {
    ({ text: qualityText, stopReason: qualityStopReason } = await callClaude({
      prompt: qualityPrompt,
      maxTokens: MAX_TOKENS,
      timeoutMs: qualityTimeoutMs,
      model: MODEL,
    }));
  } catch (err) {
    // Non-fatal, same philosophy as verify-spec.mjs: a quality-review hiccup
    // must never block a scaffold that otherwise succeeded.
    console.warn(`Quality self-review call failed, proceeding without it: ${err.message}`);
    qualityText = null;
  }

  if (qualityStopReason === 'max_tokens') {
    console.warn('Quality self-review response truncated (stop_reason=max_tokens) — skipping.');
    qualityText = null;
  }

  const qualityResult = qualityText?.trim() ?? '';
  if (qualityResult === 'NO_CHANGES_NEEDED') {
    console.log(
      'Quality self-review: no significant duplication or extract-worthy complexity found.'
    );
  } else if (qualityResult) {
    let qualityParsed;
    try {
      const fenceMatch = qualityResult.match(/```json\s*([\s\S]*?)\s*```/i);
      const raw = fenceMatch ? fenceMatch[1].trim() : qualityResult;
      qualityParsed = JSON.parse(raw);
    } catch (e) {
      console.warn(`Quality self-review response was not parseable JSON, skipping: ${e.message}`);
      qualityParsed = null;
    }

    if (qualityParsed && Array.isArray(qualityParsed.files) && qualityParsed.files.length > 0) {
      const writtenSet = new Set(writtenPaths);
      let revisedCount = 0;
      for (const { path, content } of qualityParsed.files) {
        if (typeof path !== 'string' || typeof content !== 'string' || !path || !content) {
          continue;
        }
        const relPath = toRepoRelative(path);
        // Only ever revises a file this run already wrote — never adds a new
        // path or touches one outside this run's own output. A quality pass
        // proposing a new path would silently desync check-impl-scope.mjs's
        // exact-match gate against the spec, which the write loop above was
        // already careful to satisfy.
        if (relPath === null || !writtenSet.has(relPath)) {
          console.warn(
            `Quality self-review named a path outside this run's own output, skipping: ${path}`
          );
          continue;
        }
        if (truncatedWrittenPaths.has(relPath) || unreadableWrittenPaths.has(relPath)) {
          // The model was shown only a partial view of this file (or none at
          // all — see unreadableWrittenPaths above) and told not to revise
          // it. Enforce that server-side too: writing back "content" built
          // from a partial or nonexistent view would silently corrupt or
          // fabricate the file, regardless of whether the model followed the
          // instruction.
          console.warn(
            `Quality self-review proposed a change to a file excluded from its view, skipping to avoid data loss: ${relPath}`
          );
          continue;
        }
        try {
          writeFileSync(resolve(repoRoot, relPath), content, 'utf8');
        } catch (err) {
          console.warn(`Quality self-review could not write ${relPath}, skipping: ${err.message}`);
          continue;
        }
        console.log(`Quality self-review revised ${relPath}`);
        revisedCount += 1;
      }
      if (revisedCount > 0) {
        parsed.summary =
          `${parsed.summary ?? ''} [quality self-review revised ${revisedCount} file(s): ` +
          `${qualityParsed.summary ?? 'duplication/extraction cleanup'}]`;
      }
    } else if (qualityParsed) {
      console.warn('Quality self-review response had no files array, skipping.');
    }
  } else {
    console.warn('Quality self-review returned empty response, skipping.');
  }
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
