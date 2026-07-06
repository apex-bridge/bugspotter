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
import { execSync } from 'node:child_process';

const IS_TRAILER = /^Assisted-by:/i;
const IS_VALID = /^Assisted-by: .+ \((agent|human)\)$/;

function validate(sha, body) {
  const problems = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (IS_TRAILER.test(line) && !IS_VALID.test(line)) {
      problems.push({ sha, line });
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
    problems.push(...validate('(staged)', readFileSync(args[mi + 1], 'utf8')));
  } else if (ri !== -1) {
    const range = args[ri + 1];
    const shas = execSync(`git rev-list ${range}`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    for (const sha of shas) {
      const body = execSync(`git show -s --format=%B ${sha}`, { encoding: 'utf8' });
      problems.push(...validate(sha.slice(0, 8), body));
    }
  } else {
    console.error('usage: --message <file> | --range <base>..<head>');
    process.exit(2);
  }

  if (problems.length) {
    console.error('Malformed attribution trailer(s). Expected: "Assisted-by: <tool-or-model> (agent)"');
    for (const p of problems) console.error(`  ${p.sha}: ${p.line}`);
    process.exit(1);
  }
  console.log('Commit attribution trailers OK.');
}

main();
