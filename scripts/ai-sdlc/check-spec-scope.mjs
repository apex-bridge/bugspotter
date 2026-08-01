#!/usr/bin/env node
// Advisory fan-out check for generated specs: warns (does not fail the
// build) when a spec's declared "Files touched" list is large enough to be
// a structural tell that a new package/subsystem is being born rather than
// a scoped change - spec #238 declared 10 files, 7 of them new, including a
// from-scratch package.json/tsconfig.json/vitest.config.ts trio.
//
// This is deliberately SOFT, unlike verify-spec-ownership.mjs's hard gate:
// there is no real historical distribution to calibrate a hard cap against
// yet (bugspotter-metrics did not track files_changed until schema 4).
// Flip DEFAULT_CAP's enforcement to a hard exit(1) once enough real spec
// PRs have shipped through it to know what "large" actually means for this
// repo, rather than guessing a number now and blocking legitimate work on
// a guess.
//
// Required env var: SPEC_FILE. Optional: SPEC_SCOPE_CAP (default 6).
// Always exits 0 - this is advisory only.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractDeclaredPaths } from './verify-spec-ownership.mjs';

export const DEFAULT_CAP = 6;

/** Returns a warning string if declaredPaths.length exceeds cap, else null. */
export function checkFanOut(declaredPaths, cap = DEFAULT_CAP) {
  if (declaredPaths.length <= cap) {
    return null;
  }
  return (
    `Spec declares ${declaredPaths.length} files touched (advisory cap: ${cap}). ` +
    `A spec this large is worth a second look before ratifying - it's the same shape ` +
    `spec #238 had (10 files, 7 new, including a from-scratch package scaffold) right ` +
    `before it turned out to be hallucinating an entire package. Not a hard block: a ` +
    `genuinely large, coherent change is sometimes correct - but if this is several ` +
    `unrelated things stapled together, splitting it into multiple issues/specs is ` +
    `usually the better call.`
  );
}

function main() {
  const { SPEC_FILE, SPEC_SCOPE_CAP } = process.env;
  if (!SPEC_FILE) {
    console.error('Missing SPEC_FILE');
    process.exit(1);
  }

  let spec;
  try {
    spec = readFileSync(SPEC_FILE, 'utf8');
  } catch (err) {
    console.warn(`Spec scope check: could not read spec file: ${err.message}`);
    process.exit(0);
  }

  const declaredPaths = extractDeclaredPaths(spec);
  if (!declaredPaths) {
    console.warn('Spec scope check: no "Files touched:" line found — skipping.');
    process.exit(0);
  }

  const cap = SPEC_SCOPE_CAP ? Number(SPEC_SCOPE_CAP) : DEFAULT_CAP;
  const warning = checkFanOut(declaredPaths, cap);
  if (warning) {
    console.warn(`::warning::${warning}`);
  } else {
    console.log(`Spec scope check: ${declaredPaths.length} file(s) declared, within cap (${cap}).`);
  }
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
