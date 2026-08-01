#!/usr/bin/env node
// Hard gate: fails if the impl-agent's generated scaffold wrote a file the
// linked spec never declared under "Files touched". Unlike
// check-spec-scope.mjs's cap (which needs a judgment call about "how big is
// too big"), this is an unambiguous comparison between two already-concrete
// lists - there is no legitimate reason for a freshly-generated scaffold to
// silently diverge from the spec a human already ratified.
//
// Scope, stated honestly: this only checks the scaffold at generation time
// (comparing generate-impl.mjs's own `files_written` output against the
// spec). It does not re-check later commits a human pushes to the same PR
// before merge - that's a different, PR-diff-level check this script does
// not attempt.
//
// Required env vars: SPEC_FILE, FILES_WRITTEN (comma-separated, matching
// generate-impl.mjs's GITHUB_OUTPUT format).
// Exit 1 if any written file is undeclared. Exit 0 if the spec has no
// parseable "Files touched" line (nothing to check against) or is clean.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractDeclaredPaths } from './verify-spec-ownership.mjs';

/** Returns the subset of writtenPaths not present in declaredPaths. */
export function findUndeclaredPaths(writtenPaths, declaredPaths) {
  const declared = new Set(declaredPaths);
  return writtenPaths.filter((p) => !declared.has(p));
}

function main() {
  const { SPEC_FILE, FILES_WRITTEN } = process.env;
  if (!SPEC_FILE) {
    console.error('Missing SPEC_FILE');
    process.exit(1);
  }
  if (!FILES_WRITTEN) {
    console.warn('Impl scope check: FILES_WRITTEN is empty — nothing to check.');
    process.exit(0);
  }

  let spec;
  try {
    spec = readFileSync(SPEC_FILE, 'utf8');
  } catch (err) {
    console.warn(`Impl scope check: could not read spec file: ${err.message}`);
    process.exit(0);
  }

  const declaredPaths = extractDeclaredPaths(spec);
  if (!declaredPaths || declaredPaths.length === 0) {
    console.warn('Impl scope check: spec has no parseable "Files touched:" line — skipping.');
    process.exit(0);
  }

  const writtenPaths = FILES_WRITTEN.split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const undeclared = findUndeclaredPaths(writtenPaths, declaredPaths);

  if (undeclared.length > 0) {
    console.error('Impl scope check FAILED - the scaffold wrote files the spec never declared:\n');
    for (const p of undeclared) {
      console.error(`  ${p}`);
    }
    console.error(
      `\nDeclared in ${SPEC_FILE}:\n${declaredPaths.map((p) => `  ${p}`).join('\n')}\n\n` +
        'Either the spec is missing these paths (fix the spec first, re-run) or the scaffold ' +
        'drifted from what was ratified - either way this needs a human look before it ships ' +
        'as a draft PR.'
    );
    process.exit(1);
  }

  console.log(`Impl scope check passed — ${writtenPaths.length} written file(s) all declared.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
