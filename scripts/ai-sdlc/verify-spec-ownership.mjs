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
// First backtick-quoted span in `text`, or null if there isn't a complete
// pair. Pure string scanning, no regex - a lookahead-based section boundary
// is exactly what let #297's real spec leak 14 extra "paths" (IJobHandle,
// moveToDelayed, id, name, log()...) out of a prose paragraph sitting
// between the bullet list and the next `**` field, because the boundary
// pattern only knew to stop at the next heading, not at the end of the list.
function firstBacktickSpan(text) {
  const start = text.indexOf('`');
  if (start === -1) {
    return null;
  }
  const end = text.indexOf('`', start + 1);
  if (end === -1) {
    return null;
  }
  return text.slice(start + 1, end);
}

// Every backtick-quoted span in `text`, left to right.
function allBacktickSpans(text) {
  const spans = [];
  let i = 0;
  for (;;) {
    const start = text.indexOf('`', i);
    if (start === -1) {
      break;
    }
    const end = text.indexOf('`', start + 1);
    if (end === -1) {
      break;
    }
    spans.push(text.slice(start + 1, end));
    i = end + 1;
  }
  return spans;
}

// Expands a single {a,b,c} brace-alternation group into multiple concrete
// paths - shorthand a spec can reach for when several files get the same
// one-line edit (e.g. i18n locale bundles:
// `apps/admin/src/i18n/locales/{en,ru,kk}.json`). Without this,
// extractDeclaredPaths returned that string as one literal, unexpanded path -
// which check-impl-scope.mjs then compared byte-for-byte against the three
// real files the model correctly wrote, and failed a scaffold that was
// actually right (issue #227, 2026-08-15: three genuinely-declared locale
// edits flagged as "not declared", plus a phantom "declared but never
// written" file for the literal brace string itself).
//
// Only one group per path, no nesting - that covers every real spec seen so
// far. A path with more than one brace group, or a `{...}` that turns out not
// to be a >=2-way alternation (no comma), is returned unexpanded rather than
// guessing at a shape this hasn't seen.
export function expandBraceGroup(path) {
  const open = path.indexOf('{');
  if (open === -1) {
    return [path];
  }
  const close = path.indexOf('}', open + 1);
  if (close === -1) {
    return [path];
  }
  // A second `{` anywhere after the first one — not just after its close —
  // catches both a separate second group ("{a,b}/{c,d}") AND a nested one
  // ("{en,{ru,kk}}"). The latter matters because `close` above is the FIRST
  // `}`, which for a nested group is the inner one: checking only after
  // `close` would miss the nested `{` sitting between `open` and `close`,
  // slice a malformed alternative list, and silently emit garbled paths
  // instead of failing closed on a shape this function doesn't handle.
  if (path.indexOf('{', open + 1) !== -1) {
    return [path];
  }
  const alternatives = path
    .slice(open + 1, close)
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  if (alternatives.length < 2) {
    return [path];
  }
  const prefix = path.slice(0, open);
  const suffix = path.slice(close + 1);
  return alternatives.map((alt) => `${prefix}${alt}${suffix}`);
}

export function extractDeclaredPaths(specText) {
  const marker = '**Files touched:**';
  const markerIdx = specText.indexOf(marker);
  if (markerIdx === -1) {
    return null;
  }

  const lines = specText.slice(markerIdx + marker.length).split('\n');
  const paths = [];
  let sawBullet = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (i === 0) {
      // The inline form puts every path on the marker's own line, comma-
      // separated ("**Files touched:** `a.ts`, `b.ts`") - nothing precedes
      // them to be a trailing description, so every span here is a path.
      for (const span of allBacktickSpans(line)) {
        paths.push(...expandBraceGroup(span));
      }
      continue;
    }

    if (line.startsWith('**') || line.startsWith('##')) {
      break; // the next field or section heading - the list is over
    }
    if (line === '') {
      if (sawBullet) {
        break; // a blank line after the list ends it
      }
      continue; // a blank line before the list starts - keep scanning
    }
    if (!line.startsWith('- ') && !line.startsWith('* ')) {
      if (sawBullet) {
        break; // prose after the list (e.g. a scope-explanation paragraph)
      }
      continue;
    }

    // A bullet line: only the FIRST backtick span is the declared path.
    // Anything after it - " — `IJobHandle` has no `moveToDelayed`..." - is
    // a trailing description, not another declared file, even though it
    // has its own backtick-quoted terms.
    const path = firstBacktickSpan(line);
    if (path !== null) {
      paths.push(...expandBraceGroup(path));
      sawBullet = true;
    }
  }

  return paths;
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
