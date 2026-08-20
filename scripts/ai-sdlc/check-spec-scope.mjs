#!/usr/bin/env node
// Fan-out check for generated specs: fires when a spec's declared "Files
// touched" list is larger than DEFAULT_CAP (6). Two independent reasons the
// same number matters:
//
//   1. A structural tell that a new package/subsystem is being born rather
//      than a scoped change - spec #238 declared 10 files, 7 of them new,
//      including a from-scratch package.json/tsconfig.json/vitest.config.ts
//      trio. This half stayed a judgment call for a long time (see below).
//   2. generate-impl.mjs's own prompt hard-codes "Do NOT generate more than
//      6 files total" - a spec over that isn't just "worth a second look",
//      it is asking impl-agent to violate its own instructions. Issue #367
//      (2026-08-20) is the real data point this was missing: a spec grew
//      from 4 to 7 files during legitimate review fixes, nobody re-checked
//      it against this cap, and impl-agent silently dropped 5 of 7 files
//      rather than erroring - twice, at two different declared counts,
//      before the spec was manually reduced back under 6.
//
// Two call sites, two enforcement modes, same script:
//   - spec-agent.yml's own inline step runs SOFT (SPEC_SCOPE_HARD unset):
//     an over-scoped agent-generated spec still produces a visible PR with
//     a warning, rather than failing the whole generation job with nothing
//     to show - a silently-vanished run is worse than a PR a human has to
//     react to (see ai-sdlc-guards.yml's own comment on why it runs the
//     hard copy of this check where a reviewer will actually see it).
//   - ai-sdlc-guards.yml runs HARD (SPEC_SCOPE_HARD=true): this is the copy
//     that runs against the actual PR content a human reviews and merges,
//     agent-authored or hand-written either way, so it's the one that
//     should actually block ratifying an over-scoped spec.
//
// Required env var: SPEC_FILE. Optional: SPEC_SCOPE_CAP (default 6),
// SPEC_SCOPE_HARD ('true' to exit 1 on a finding; anything else, including
// unset, stays soft and always exits 0).

import { readFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractDeclaredPaths } from './verify-spec-ownership.mjs';

export const DEFAULT_CAP = 6;

/**
 * Parses SPEC_SCOPE_CAP into a non-negative integer, falling back to
 * DEFAULT_CAP for anything unset, whitespace-only, non-numeric, negative,
 * or fractional. `Number('')` and `Number(undefined)` both fall through
 * cleanly since `Number.isInteger` rejects NaN — but `Number('   ')` is 0,
 * not NaN, so whitespace must be trimmed away BEFORE the emptiness check
 * or a whitespace-only value silently becomes a zero-file cap.
 */
export function resolveCap(rawCap, defaultCap = DEFAULT_CAP) {
  const trimmed = typeof rawCap === 'string' ? rawCap.trim() : rawCap;
  if (!trimmed) {
    // Covers "unset" (undefined), whitespace-only, and GitHub Actions'
    // habit of resolving an unconfigured `vars.*` reference to an empty
    // string rather than leaving the env var absent.
    return defaultCap;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : defaultCap;
}

/** Returns a finding string if declaredPaths.length exceeds cap, else null. */
export function checkFanOut(declaredPaths, cap = DEFAULT_CAP) {
  if (declaredPaths.length <= cap) {
    return null;
  }
  return (
    `Spec declares ${declaredPaths.length} files touched (cap: ${cap}). Two independent ` +
    `reasons this matters: it's the same shape spec #238 had (10 files, 7 new, including ` +
    `a from-scratch package scaffold) right before it turned out to be hallucinating an ` +
    `entire package - AND generate-impl.mjs's own prompt hard-codes "do not generate more ` +
    `than 6 files total", so a spec over that cap is asking impl-agent to violate its own ` +
    `instructions, not just "worth a second look". Issue #367 hit this for real: impl-agent ` +
    `silently dropped 5 of 7 declared files rather than erroring. A genuinely large, ` +
    `coherent change is sometimes still correct - but the fix is splitting it into ` +
    `multiple issues/specs (see #367/#368 for a worked example), not ratifying it as-is.`
  );
}

function main() {
  const { SPEC_FILE, SPEC_SCOPE_CAP, SPEC_SCOPE_HARD } = process.env;
  const hard = SPEC_SCOPE_HARD === 'true';
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

  const trimmedCap = SPEC_SCOPE_CAP?.trim();
  const parsedCap = Number(trimmedCap);
  const capIsValid = !trimmedCap || (Number.isInteger(parsedCap) && parsedCap >= 0);
  if (!capIsValid) {
    console.warn(`Spec scope check: ignoring invalid SPEC_SCOPE_CAP="${SPEC_SCOPE_CAP}".`);
  }
  const cap = resolveCap(SPEC_SCOPE_CAP);
  const finding = checkFanOut(declaredPaths, cap);
  if (finding) {
    const label = hard ? 'Spec scope check FAILED' : 'Spec scope warning';
    console[hard ? 'error' : 'warn'](`::${hard ? 'error' : 'warning'}::${finding}`);
    // Run-log annotations are easy for a spec reviewer to miss — they see
    // the PR, not the Action run. Surface it in the job summary too, when
    // running under GitHub Actions.
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n**${label}:** ${finding}\n`);
    }
    process.exit(hard ? 1 : 0);
  }
  console.log(`Spec scope check: ${declaredPaths.length} file(s) declared, within cap (${cap}).`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
