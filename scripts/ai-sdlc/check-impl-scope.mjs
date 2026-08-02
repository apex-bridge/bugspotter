#!/usr/bin/env node
// Hard gate: fails if the impl-agent's generated scaffold and the linked
// spec's "Files touched" list disagree IN EITHER DIRECTION - a file written
// but not declared, or declared but not written. Unlike check-spec-scope.mjs's
// cap (which needs a judgment call about "how big is too big"), this is an
// unambiguous comparison between two already-concrete lists - there is no
// legitimate reason for a freshly-generated scaffold to silently diverge from
// the spec a human already ratified.
//
// The declared-but-not-written direction was missing until 2026-08-02, which
// made this gate asymmetric in the dangerous direction: it blocked the agent
// from doing MORE than the spec allowed, but let it silently do LESS. Issue
// #237's successful run wrote 3 of 4 declared files, skipping a whole test
// suite, so four acceptance criteria shipped unverified behind a green check.
// Over-delivery is loud (unexpected files in the diff); under-delivery is
// invisible, which is exactly why it needs the machine to catch it.
//
// Scope, stated honestly: this only checks the scaffold at generation time
// (comparing generate-impl.mjs's own `files_written` output against the
// spec). It does not re-check later commits a human pushes to the same PR
// before merge - that's a different, PR-diff-level check this script does
// not attempt.
//
// Required env vars: SPEC_FILE, FILES_WRITTEN (comma-separated, matching
// generate-impl.mjs's GITHUB_OUTPUT format). FILES_WRITTEN must be SET, but
// may be empty — an empty value means the scaffold wrote nothing, which is
// under-delivery of EVERY declared path rather than a reason to skip the
// check. It short-circuited to exit 0 until 2026-08-02, which left the most
// extreme version of the #237 bug (zero of N declared files) passing green
// through the gate built to catch it.
// Exit 1 if the two lists disagree in either direction, OR if the ratified
// spec can't be read or has no parseable "Files touched" line — a hard gate
// that no-ops on a malformed baseline isn't a gate, it's a trap door.
// Exit 0 only when the comparison actually ran and came back clean.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractDeclaredPaths } from './verify-spec-ownership.mjs';

/**
 * Canonicalize a repo-relative path for set comparison.
 *
 * The two sides of this comparison are produced very differently: written
 * paths come from generate-impl.mjs, already normalized by node's
 * `relative()` (no `./`, forward slashes); declared paths are lifted
 * verbatim out of backticks in human-ratified, LLM-drafted markdown. A
 * stray `./` or a stray space on the spec side would otherwise make the
 * SAME file show up in BOTH failure lists at once - reported as written-but-
 * undeclared and declared-but-unwritten simultaneously - which is a
 * confusing false failure that costs a full generation run.
 */
export function normalizePath(p) {
  return p.trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

/** Returns the subset of writtenPaths not present in declaredPaths. */
export function findUndeclaredPaths(writtenPaths, declaredPaths) {
  const declared = new Set(declaredPaths);
  return writtenPaths.filter((p) => !declared.has(p));
}

/**
 * Returns the subset of declaredPaths the scaffold never wrote.
 *
 * The mirror of findUndeclaredPaths, and just as load-bearing. Without it
 * this gate was asymmetric: it caught the agent writing MORE than the
 * ratified spec allowed, but not LESS. Issue #237's successful run wrote 3
 * of 4 declared files, silently skipping the worker test suite - so four
 * acceptance criteria shipped unverified while the gate reported green, and
 * it was only caught by diffing the two lists by hand afterwards.
 */
export function findUnwrittenPaths(writtenPaths, declaredPaths) {
  const written = new Set(writtenPaths);
  return declaredPaths.filter((p) => !written.has(p));
}

function main() {
  const { SPEC_FILE, FILES_WRITTEN } = process.env;
  if (!SPEC_FILE) {
    console.error('Missing SPEC_FILE');
    process.exit(1);
  }
  // Deliberately `=== undefined`, not falsy. An EMPTY FILES_WRITTEN must
  // fall through to the comparison below: "wrote nothing" is the maximal
  // under-delivery, not an absence of work to check. Only an env var that
  // was never plumbed through at all is a caller error, and it is treated
  // like a missing SPEC_FILE rather than waved through.
  if (FILES_WRITTEN === undefined) {
    console.error(
      "Missing FILES_WRITTEN. Set it to generate-impl.mjs's files_written output; " +
        'an empty string is valid and means the scaffold wrote nothing.'
    );
    process.exit(1);
  }

  let spec;
  try {
    spec = readFileSync(SPEC_FILE, 'utf8');
  } catch (err) {
    console.error(`Impl scope check: could not read spec file: ${err.message}`);
    process.exit(1);
  }

  const declaredPaths = (extractDeclaredPaths(spec) ?? []).map(normalizePath).filter(Boolean);
  if (declaredPaths.length === 0) {
    console.error(
      'Impl scope check FAILED: spec has no parseable "Files touched:" line, so the ' +
        'scaffold cannot be checked against it. Fix the ratified spec\'s "Files touched" ' +
        'field rather than skip the check silently.'
    );
    process.exit(1);
  }

  const writtenPaths = FILES_WRITTEN.split(',').map(normalizePath).filter(Boolean);
  const undeclared = findUndeclaredPaths(writtenPaths, declaredPaths);
  const unwritten = findUnwrittenPaths(writtenPaths, declaredPaths);

  if (undeclared.length > 0 || unwritten.length > 0) {
    console.error('Impl scope check FAILED - the scaffold does not match the ratified spec.\n');

    if (undeclared.length > 0) {
      console.error('Wrote files the spec never declared:');
      for (const p of undeclared) {
        console.error(`  + ${p}`);
      }
      console.error(
        '\n  Either the spec is missing these paths, or the scaffold drifted from what was\n' +
          '  ratified. Fix the spec and re-run, or investigate the drift.\n'
      );
    }

    if (unwritten.length > 0) {
      console.error('Did NOT write files the spec declared:');
      for (const p of unwritten) {
        console.error(`  - ${p}`);
      }
      if (writtenPaths.length === 0) {
        console.error(
          '\n  The scaffold wrote NOTHING - every declared path is missing. generate-impl.mjs\n' +
            '  already aborts on zero writes, so an empty FILES_WRITTEN arriving here usually\n' +
            '  means the env plumbing between the two steps broke, not that the model produced\n' +
            "  nothing. Check the generate step's files_written output before re-running."
        );
      }

      console.error(
        '\n  A ratified spec is a contract: silently delivering less than it promises is how\n' +
          '  acceptance criteria ship unverified (see issue #237, where a skipped test file\n' +
          '  left four ACs unchecked behind a green gate). Two possible causes, both needing\n' +
          '  a human:\n' +
          '    1. The agent dropped work         -> re-run, or write the missing file by hand.\n' +
          '    2. The spec over-declared a file  -> amend the spec, then re-run. Re-running\n' +
          '       without amending will fail identically, since the agent will keep\n' +
          '       (correctly) deciding that file needs no change.\n'
      );
    }

    console.error(`Declared in ${SPEC_FILE}:\n${declaredPaths.map((p) => `  ${p}`).join('\n')}`);
    process.exit(1);
  }

  console.log(
    `Impl scope check passed - ${writtenPaths.length} written file(s) exactly match the ` +
      `${declaredPaths.length} declared in the spec.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
