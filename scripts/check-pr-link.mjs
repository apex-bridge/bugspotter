#!/usr/bin/env node
// Validate that a PR body references a GitHub issue or an ADR.
//
// Tier-1 guard (#202). Accepted forms: "Closes #NNN", "Refs #NNN",
// "Fixes #NNN", "Tracks #NNN", "Resolves #NNN", "References #NNN"
// (case-insensitive), or "ADR-NNNN". The #NNN may carry an "owner/repo#NNN"
// prefix for a cross-repo reference (e.g. "Refs apex-bridge/bugspotter-
// intelligence#48") - added after #269 showed the bare-#NNN-only pattern
// rejects the org's own existing cross-repo cross-link convention.
//
// A bare "#NNN" with no keyword is NOT accepted: a keyword is required so
// HTML comments and prose in the default PR template cannot false-pass.
// Both alternatives are word-bounded on each side, so neither a leading
// substring ("discloses #123") nor a trailing one ("#123abc", "ADR-1234X")
// satisfies the check.
//
// Extracted from the inline grep in .github/workflows/pr-link.yml so the
// pattern is testable - see check-pr-link.test.mjs. Deterministic,
// fail-closed, same shape as check-commit-trailers.mjs.
//
// Usage:
//   node scripts/check-pr-link.mjs --message <path>  # body from a file
//   node scripts/check-pr-link.mjs                   # body from $PR_BODY

import { readFileSync } from 'node:fs';

// Faithful port of the previous `grep -qiE` pattern. \s+ is safe here only
// because the body is matched one line at a time (see hasReference): grep is
// line-oriented, so a keyword and its #NNN on separate lines never matched,
// and must not start matching now.
const REFERENCE =
  /\b(?:Closes|Refs|Fixes|Tracks|Resolves|References)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#[0-9]+\b|\bADR-[0-9]{4}\b/i;

function hasReference(body) {
  return body.split(/\r?\n/).some((line) => REFERENCE.test(line));
}

function fail() {
  console.error('FAIL: PR body must reference a GitHub issue or ADR.');
  console.error('');
  console.error('Add one of:');
  console.error('  Closes #NNN   Refs #NNN   Fixes #NNN   Tracks #NNN');
  console.error('  Resolves #NNN   References #NNN   ADR-NNNN');
  console.error('  Any keyword above also accepts owner/repo#NNN (cross-repo reference).');
  console.error('');
  console.error('If there is no matching issue yet, open one first (use the Spec template).');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const mi = args.indexOf('--message');
  let body;

  if (mi !== -1) {
    const file = args[mi + 1];
    if (!file) {
      console.error('usage: --message <file>');
      process.exit(2);
    }
    try {
      body = readFileSync(file, 'utf8');
    } catch (e) {
      console.error(`Error: cannot read PR body file "${file}": ${e.message}`);
      process.exit(1);
    }
  } else {
    // Absent or empty PR_BODY is a fail, not a pass - fail-closed.
    body = process.env.PR_BODY ?? '';
  }

  if (!hasReference(body)) {
    fail();
  }
  console.log('OK: PR body references a GitHub issue or ADR.');
}

main();
