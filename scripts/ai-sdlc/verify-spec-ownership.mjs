#!/usr/bin/env node
// Deterministic (non-LLM) path-ownership lint for generated specs.
//
// verify-spec.mjs's ADR-index injection is a real fix for #226/#238 (a
// spec-generation agent hallucinated an entire in-repo TypeScript package,
// packages/bugspotter-intelligence, that docs/adr/0007 attributes to a
// SEPARATE Python service in its own repo) — but it's a prompt-attention
// fix: it bets the model will notice a contradiction buried in ~95 lines of
// injected context, which is exactly the reliability class that failed once
// already (the ADR file existed in the repo the whole time; the mistake was
// a model not attending to it, not the fact being unknowable).
//
// This script needs no model to notice anything. It greps the spec's
// declared "Files touched" list against docs/adr/README.md's own
// "Source repo(s)" column and fails the build on a plain string match. It
// cannot catch a purely prose-based architecture error that invents no new
// path — it is a floor, not a replacement for verify-spec.mjs or the ADR-
// ratification gate.
//
// Required env var: SPEC_FILE.
// Exit 1 on a real ownership violation (hard gate — no LLM call, no
// attention/instruction-following failure mode, so unlike verify-spec.mjs
// there's no "hiccup" class of failure to be lenient about).
// Exit 0 if the spec file / ADR index is missing (nothing to check) or
// clean.

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Parse "| [0007](...) | Decision text | public, intelligence |" rows from
 * docs/adr/README.md. Returns a Map of normalized, non-public/all repo
 * token -> Set of ADR numbers that attribute a component to that repo.
 */
export function parseAdrOwnership(adrIndexText) {
  const rowPattern = /\|\s*\[(\d+)\]\([^)]*\)\s*\|[^|]+\|\s*([^|]+?)\s*\|/g;
  const foreignTokens = new Map();
  for (const match of adrIndexText.matchAll(rowPattern)) {
    const [, adrNum, repoCell] = match;
    const repos = repoCell
      .split(',')
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);
    for (const repo of repos) {
      if (repo === 'public' || repo === 'all') {
        continue;
      }
      if (!foreignTokens.has(repo)) {
        foreignTokens.set(repo, new Set());
      }
      foreignTokens.get(repo).add(adrNum);
    }
  }
  return foreignTokens;
}

/**
 * Extract backtick-quoted paths from the spec's "**Files touched:**" field.
 * Real generated specs put the list on the lines FOLLOWING the label (a
 * bulleted list — see docs/specs/0238's own "Files touched" block), not on
 * the same line, so this must capture the whole block up to the next
 * "**"-prefixed field or "##" heading, not just the first line.
 */
export function extractDeclaredPaths(specText) {
  const filesTouchedMatch = specText.match(/\*\*Files touched:\*\*\s*([\s\S]*?)(?=\n\*\*|\n##|$)/);
  if (!filesTouchedMatch) {
    return null;
  }
  return [...filesTouchedMatch[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

/** Extract the lowercased body text of the spec's "## Out of scope" section. */
export function extractOutOfScopeText(specText) {
  const match = specText.match(/## Out of scope\s*\n([\s\S]*?)(?=\n## |$)/);
  return (match?.[1] ?? '').toLowerCase();
}

/**
 * Check declared paths against foreign-repo ownership tokens.
 * `pathExists` is injected (rather than calling fs.existsSync directly) so
 * this stays pure and testable without touching the real filesystem.
 * Returns an array of { path, token, adrNums } violations.
 */
export function checkOwnership(declaredPaths, foreignTokens, outOfScopeText, pathExists) {
  const violations = [];
  for (const path of declaredPaths) {
    const segments = path.split('/');
    const rootIdx = segments.findIndex((s) => s === 'packages' || s === 'apps');
    if (rootIdx === -1 || rootIdx + 1 >= segments.length) {
      continue;
    }
    const component = segments[rootIdx + 1]
      .toLowerCase()
      .replace(/^bugspotter-/, '')
      .replace(/\.[a-z]+$/, '');

    for (const [token, adrNums] of foreignTokens) {
      // Exact match, or the component is a hyphenated variant of the token
      // (e.g. "intelligence-client" for token "intelligence"). Deliberately
      // NOT bidirectional substring matching: `token.includes(component)`
      // would flag a legitimate short component like "ext" just because it
      // is a substring of the foreign token "extension".
      if (component !== token && !component.startsWith(`${token}-`)) {
        continue;
      }

      const packageRoot = `${segments[rootIdx]}/${segments[rootIdx + 1]}`;
      if (pathExists(packageRoot)) {
        continue;
      }
      if (outOfScopeText.includes(token)) {
        continue;
      }

      violations.push({ path, token, adrNums: [...adrNums] });
    }
  }
  return violations;
}

function main() {
  const { SPEC_FILE } = process.env;

  if (!SPEC_FILE) {
    console.error('Missing SPEC_FILE');
    process.exit(1);
  }

  let spec;
  try {
    spec = readFileSync(SPEC_FILE, 'utf8');
  } catch (err) {
    console.warn(`Spec ownership lint: could not read spec file: ${err.message}`);
    process.exit(0);
  }

  const ADR_INDEX_PATH = 'docs/adr/README.md';
  if (!existsSync(ADR_INDEX_PATH)) {
    console.warn('Spec ownership lint: docs/adr/README.md not found — skipping.');
    process.exit(0);
  }
  const foreignTokens = parseAdrOwnership(readFileSync(ADR_INDEX_PATH, 'utf8'));

  if (foreignTokens.size === 0) {
    console.log(
      'Spec ownership lint: no foreign-repo tokens found in ADR index — nothing to check.'
    );
    process.exit(0);
  }

  const declaredPaths = extractDeclaredPaths(spec);
  if (!declaredPaths) {
    console.warn('Spec ownership lint: no "Files touched:" line found — skipping.');
    process.exit(0);
  }

  const outOfScopeText = extractOutOfScopeText(spec);
  const violations = checkOwnership(declaredPaths, foreignTokens, outOfScopeText, existsSync);

  if (violations.length > 0) {
    console.error('Spec ownership lint FAILED:\n');
    for (const v of violations) {
      console.error(
        `  \`${v.path}\` proposes a new path under a component name ("${v.token}") that ` +
          `docs/adr/README.md attributes to a different repo (ADR-${v.adrNums.join(', ADR-')}).`
      );
    }
    console.error(
      '\nIf this is intentional (e.g. a thin client/wrapper that legitimately lives in this ' +
        'repo), add an explicit line under "## Out of scope" naming the external service so ' +
        'this check knows it was a deliberate call, not an invented package.'
    );
    process.exit(1);
  }

  console.log(`Spec ownership lint passed — ${declaredPaths.length} declared path(s) checked.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
