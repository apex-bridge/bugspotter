#!/usr/bin/env node
// Calls Claude to draft a spec document for a GitHub issue.
// Run from the repo root. Reads TEMPLATE.md; writes docs/specs/<file>.
// Outputs spec_file and spec_slug to GITHUB_OUTPUT.
//
// Required env vars: ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, plus either
//   ANTHROPIC_API_KEY (default) or CLAUDE_CODE_OAUTH_TOKEN (LLM_BACKEND=cli)
// Optional:          GITHUB_OUTPUT (set by Actions; falls back to stdout print)

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { callClaude, requireLlmCredentials } from './llm-client.mjs';

const { ISSUE_NUMBER, ISSUE_TITLE, ISSUE_BODY, GITHUB_OUTPUT } = process.env;

requireLlmCredentials();
if (!ISSUE_NUMBER) {
  console.error('Missing ISSUE_NUMBER');
  process.exit(1);
}
if (!ISSUE_TITLE) {
  console.error('Missing ISSUE_TITLE');
  process.exit(1);
}

const template = readFileSync('docs/specs/TEMPLATE.md', 'utf8');

const slug = ISSUE_TITLE.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40);

const padded = String(ISSUE_NUMBER).padStart(4, '0');
const specFile = `docs/specs/${padded}-${slug}.md`;

// Build a source-file tree so the agent can reference accurate paths and
// spot which files exist before writing the spec. Each root gets its own
// 80-entry budget using true level-order BFS: all entries at depth N are
// collected before any entry at depth N+1 is visited. To prevent a wide
// directory from crowding out peer directories within the same BFS level,
// at most 15 entries per directory are added to results; directories are
// still queued for BFS traversal regardless of the per-dir cap.
const BUDGET_PER_ROOT = 80;
const MAX_ENTRIES_PER_DIR = 15;

function scanDir(rootDir) {
  const results = [];
  let currentLevel = [rootDir];
  while (currentLevel.length > 0 && results.length < BUDGET_PER_ROOT * 5) {
    const nextLevel = [];
    for (const dir of currentLevel) {
      if (results.length >= BUDGET_PER_ROOT * 5) {
        break;
      }
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      let addedFromDir = 0;
      for (const name of entries) {
        if (results.length >= BUDGET_PER_ROOT * 5) {
          break;
        }
        if (name.startsWith('.') || name === 'node_modules' || name === 'dist') {
          continue;
        }
        const full = join(dir, name).replace(/\\/g, '/');
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch {
          continue;
        }
        if (isDir) {
          nextLevel.push(full);
        }
        if (addedFromDir < MAX_ENTRIES_PER_DIR) {
          results.push(full);
          addedFromDir++;
        }
      }
    }
    currentLevel = nextLevel;
  }
  return results.slice(0, BUDGET_PER_ROOT);
}

const sourceTree = [
  'packages/backend/src',
  'packages/backend/tests',
  'packages/backend-mock',
  'packages/billing/src',
  'packages/billing/tests',
  'packages/message-broker/src',
  'packages/message-broker/tests',
  'packages/payment-service/src',
  'packages/payment-service/tests',
  'packages/types/src',
  'packages/utils/src',
  'apps',
]
  .flatMap((dir) => scanDir(dir))
  .join('\n');

// The ADR index is the canonical cross-repo architecture record (which repo
// owns which component, language, service boundaries — see docs/adr/README.md
// itself). Without this, the spec-agent has only a same-repo file listing to
// go on and will invent plausible-but-wrong architecture facts for anything
// that lives outside this repo — e.g. it once fabricated a TypeScript
// in-monorepo path for `bugspotter-intelligence`, which docs/adr/0007 records
// as a separate Python/FastAPI service in its own repo. That spec got
// ratified and built as real (wrong) files before anyone caught it (#226/#238).
function safeRead(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
const adrIndex = safeRead('docs/adr/README.md');

const prompt = `\
You are a spec writer for BugSpotter, a SaaS bug-reporting platform (Fastify + TypeScript + Postgres + Redis; pnpm monorepo; Docker Compose on VMs).

Draft a spec document for GitHub issue #${ISSUE_NUMBER}. Follow the template below exactly — fill every section, remove comment markers, replace placeholder text with concrete content.

TEMPLATE:
${template}
${
  adrIndex
    ? `\nPROJECT ARCHITECTURE INDEX (docs/adr/README.md — canonical record of which repo owns which component, language, and service boundary; do not state or assume any architecture fact that contradicts it):\n${adrIndex}\n`
    : ''
}
SOURCE FILE TREE (use this to write accurate file paths and verify files exist — this is ONLY the bugspotter-public repo; a component the ADR index attributes to a different repo does NOT have a path here, even if its name looks like it would fit the packages/* convention):
${sourceTree}

ISSUE #${ISSUE_NUMBER}: ${ISSUE_TITLE}

${ISSUE_BODY?.trim() || '(no description provided)'}

Rules:
- "Linked issue:" line must say "Refs #${ISSUE_NUMBER}"
- "ADR:" line: write "pending" if an ADR will be needed, "docs/adr/NNNN-slug.md" if the issue names one, or "n/a" if the change is purely additive with no architectural decision
- "Files touched:" must list every file the spec edits or creates, using exact paths from the source tree above — if the issue describes work in a component the ADR index attributes to a different repo, say so explicitly in "Out of scope" instead of inventing a path in this repo
- "Blocking prerequisites:" must list any issue or PR number that must land before this work can be implemented (e.g. "#238 — adds the foo table"), or "none" if there are no dependencies
- In the Changes section, show ONLY new or changed lines — never reproduce the full existing file as if it were new code
- Indicate insertion points precisely ("Append after <function/line>", "Replace <old> with <new>")
- Method names, function signatures, and type names must exist in the source tree above — do not invent them. The source tree is paths only, not file contents, so you cannot actually confirm a method exists on an imported type from it alone — this includes method calls copied from the issue body's own code snippets, which are not guaranteed correct either. When the spec calls a method on a type imported from another package (\`import type { X } from '@bugspotter/other-pkg'\`), name the file where that type is actually DEFINED, not just where it is imported — e.g. "verify \`moveToDelayed\` exists on \`IJobHandle\` in \`packages/message-broker/src/interfaces.ts\`" — so the file that actually matters ends up mentioned in the spec text and gets pulled into the adversarial verification pass that follows. If you cannot name that file with confidence, mark the call "ASSUMED, not verified" in the spec rather than stating it as settled fact
- Acceptance criteria must be testable conditions, not vague goals
- In the Tests section, list any mock/fixture helper changes required BEFORE the new test cases (missing keys on mocks cause TypeErrors at runtime, not type errors at compile time)
- Verification section must contain only runnable shell commands, no pseudocode
- "Rollback:" must describe a concrete undo action for any irreversible step, or "n/a" if all steps are additive
- Return ONLY the filled spec document — no preamble, no explanation, no markdown fences`;

let specContent;
try {
  // 420s, matching verify-spec.mjs. 180_000 was set when this prompt was
  // just TEMPLATE.md + the issue body; it has grown a lot since and the
  // budget was never revisited: PR #240 added the BFS source-tree scanner
  // and PR #260 added the ~10KB ADR index. Two independent reasons the old
  // number was wrong:
  //   1. verify-spec.mjs measured 283.9s for a comparable call on the CLI
  //      backend and set 420s off that. 180s was below an already-measured
  //      duration for similar work.
  //   2. It failed in practice - run 30752527569 (issue #269) died at
  //      exactly 180000ms having produced nothing.
  // spec-agent.yml caps this step at 8m, above this 420s, so the error above
  // wins over a silent step kill. Note the job also runs verify-spec.mjs
  // (another 420s), so raising either number means re-checking that job's
  // 22m cap still contains both plus setup - see that file's comments.
  ({ text: specContent } = await callClaude({ prompt, maxTokens: 4096, timeoutMs: 420_000 }));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

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
