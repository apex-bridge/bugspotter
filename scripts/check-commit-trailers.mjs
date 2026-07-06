#!/usr/bin/env node
// Validate the agent-attribution commit trailer FORMAT.
//
// Convention (see CONTRIBUTING.md "Commit attribution trailer"): an
// agent-assisted commit carries a git trailer
//
//     Assisted-by: <tool-or-model> (agent)
//
// A human may optionally mark their own with `(human)`. Presence is
// convention-driven - agents add it; this check does NOT force it onto
// every commit (there is no deterministic human-vs-agent signal to key
// on). It only validates that a trailer, WHEN present, is well-formed, so
// the code-metrics attribution layer can parse it reliably. Deterministic,
// fail-closed (Tier-1). See sdlc-migration-plan.md 0.2.
//
// Usage:
//   node scripts/check-commit-trailers.mjs --message <path>        # one commit-msg file (commit-msg hook)
//   node scripts/check-commit-trailers.mjs --range <base>..<head>  # a commit range (CI)

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const IS_TRAILER = /^Assisted-by:/i;
const IS_VALID = /^Assisted-by: \S.* \((agent|human)\)$/;
const IS_COMMENT = /^\s*#/;

// Drop comment lines so the local commit-msg path (editor template comments)
// matches git's own cleanup before it looks for trailers.
function stripComments(body) {
  return body
    .split(/\r?\n/)
    .filter((l) => !IS_COMMENT.test(l))
    .join('\n');
}

// Git's own view of the trailer block - authoritative for "will this be
// recognized as a trailer at all?" (i.e. is it in the final, blank-line-
// separated block). Returns null if git is unavailable, so we degrade to a
// format-only scan rather than failing open.
function gitTrailers(body) {
  try {
    return execFileSync('git', ['interpret-trailers', '--parse'], {
      input: body,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function validate(sha, rawBody) {
  const body = stripComments(rawBody);
  const parsed = gitTrailers(body);
  const problems = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!IS_TRAILER.test(line)) continue;
    // Format first: a malformed trailer (e.g. double-spaced) must not be
    // mislabeled "misplaced" just because git's normalized parse won't match
    // it. Only a well-formed trailer is then checked for placement.
    if (!IS_VALID.test(line)) {
      problems.push({ sha, line, reason: 'malformed - expected "Assisted-by: <tool-or-model> (agent)"' });
      continue;
    }
    const recognized =
      parsed === null || parsed.some((p) => p.toLowerCase() === line.toLowerCase());
    if (!recognized) {
      problems.push({ sha, line, reason: 'misplaced - must be in the final block, separated by a blank line' });
    }
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const mi = args.indexOf('--message');
  const ri = args.indexOf('--range');
  const problems = [];

  if (mi !== -1) {
    const file = args[mi + 1];
    if (!file) {
      console.error('usage: --message <file>');
      process.exit(2);
    }
    problems.push(...validate('(staged)', readFileSync(file, 'utf8')));
  } else if (ri !== -1) {
    const range = args[ri + 1];
    if (!range) {
      console.error('usage: --range <base>..<head>');
      process.exit(2);
    }
    // One `git log` call (execFileSync, no shell) instead of a `git show`
    // per commit: full hash + raw body per commit, NUL-delimited. git ends
    // each commit's output with a newline, so hash entries after a split on
    // NUL carry a leading newline - the sha.trim() below absorbs it.
    let out;
    try {
      out = execFileSync('git', ['log', '--format=%H%x00%B%x00', range], { encoding: 'utf8' });
    } catch (e) {
      console.error(`Error: cannot resolve commit range "${range}": ${e.message}`);
      process.exit(1);
    }
    const parts = out.split('\0');
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const sha = parts[i].trim();
      if (sha) problems.push(...validate(sha.slice(0, 8), parts[i + 1]));
    }
  } else {
    console.error('usage: --message <file> | --range <base>..<head>');
    process.exit(2);
  }

  if (problems.length) {
    console.error('Invalid commit attribution trailer(s):');
    for (const p of problems) console.error(`  ${p.sha}: "${p.line}" -> ${p.reason}`);
    process.exit(1);
  }
  console.log('Commit attribution trailers OK.');
}

main();
