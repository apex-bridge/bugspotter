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

// Port of the previous `grep -qiE` pattern. \s+ is safe here only because the
// body is matched one line at a time (see hasReference): grep is line-oriented,
// so a keyword and its #NNN on separate lines never matched, and must not start
// matching now.
//
// The boundaries are letter-based lookarounds, not \b, for two reasons:
//   - \b treats "_" as a word character, so markdown emphasis around an
//     otherwise valid reference ("_Closes #123_", "_ADR-0041_") would fail the
//     gate. Those are common in PR bodies and must pass.
//   - JS \b is ASCII-only while GNU grep's is locale-aware, so \b would let
//     the partial tokens this guard exists to reject back in via non-ASCII
//     ("ADR-1234e" with an accent, "Closes #123" with a trailing Cyrillic
//     letter, or "dcloses #123" with a Cyrillic lead).
// Digits are excluded on the trailing side too, so "ADR-12345" stays rejected.
const REFERENCE =
  /(?<!\p{L})(?:Closes|Refs|Fixes|Tracks|Resolves|References)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#[0-9]+(?![0-9\p{L}])|(?<!\p{L})ADR-[0-9]{4}(?![0-9\p{L}])/iu;

function hasReference(body) {
  return body.split(/\r?\n/).some((line) => REFERENCE.test(line));
}

// GitHub's full set of closing keywords, which is wider than this guard's own
// accept-list (it takes `Closes`/`Fixes`/`Resolves` but not `Closed`/`Fixed`/
// `Resolved`). Matched in full here so the warning below is not blind to a
// form that still auto-closes an issue.
const CLOSING =
  /(?<!\p{L})(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#[0-9]+(?![0-9\p{L}])/iu;

/**
 * Warn - never fail - when an implementation PR uses a closing keyword.
 *
 * Merging such a PR auto-closes the linked issue, so it never reaches
 * `needs-deploy` and Gate 4 (deploy) is silently skipped. PR #283 was written
 * this way and was caught by hand, not by CI.
 *
 * This is advisory on purpose. The real guard is `.github/workflows/
 * gate-guard.yml`, which watches the issue itself and therefore also catches a
 * human closing it by hand - something no PR-body check can see. Failing here
 * instead would put a hard gate on a heuristic (a branch-name prefix) and add
 * friction to every ordinary PR that legitimately closes an issue.
 *
 * Deliberately not exported: this module calls main() unconditionally at load,
 * and adding a main-guard to a Tier-1 required check risks the one failure mode
 * that matters here - a wrong guard means main() never runs and every PR passes
 * silently. Exercised through the CLI in check-pr-link.test.mjs instead.
 *
 * @returns {boolean} true when a warning was emitted
 */
function warnOnClosingKeyword(body, headRef, log = console) {
  if (!headRef || !headRef.startsWith('impl/')) {
    return false;
  }
  const line = body.split(/\r?\n/).find((l) => CLOSING.test(l));
  if (!line) {
    return false;
  }
  // ::warning:: surfaces in the Actions UI and the PR's checks tab without
  // affecting the exit code.
  log.log(
    `::warning::This looks like an implementation PR (branch "${headRef}") and its body ` +
      `uses a closing keyword: "${line.trim()}". Merging will auto-close the issue, ` +
      `skipping Gate 4 (needs-deploy). Use "Refs #NNN" unless you mean to close it.`
  );
  return true;
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

  // Advisory only, and deliberately after the pass line so it can never be
  // mistaken for the reason a run failed.
  warnOnClosingKeyword(body, process.env.HEAD_REF ?? '');
}

main();
