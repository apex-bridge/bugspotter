// Gate 1 forcing function: a spec PR cannot go green until a human has given
// every assumption in the spec's "## Assumptions" section a written verdict.
//
// Why this exists. Gate 1 (spec ratification) is a human reviewing a plan an
// AI wrote. Merging the spec PR is the whole of that judgment, and nothing in
// the pipeline asked what the reviewer actually checked: a spec could be
// ratified on a skim. The research on over-reliance on AI output points the
// same way as this repo's own incidents (#226/#238: a spec hallucinated a whole
// package and was ratified): people review AI output by heuristic, not item by
// item, and simply adding explanations does not change that. What does change
// it is a "cognitive forcing function" - something the reviewer cannot get
// past without engaging. In an experiment on reviewing AI-generated execution
// plans (Ghosh, Sarkar, Lindley, Poelitz, arXiv:2601.18033, 2026), the variant
// that asked people to analyse the plan's assumptions reduced over-reliance
// the most without raising cognitive load. That is this check.
//
// Why a written verdict and not just a ticked box. A tick is one click and
// becomes a ritual. The verdict has to name evidence ("confirmed: <file:line
// or command>") or the spec change a wrong assumption forced ("rejected:
// <what changed>"), which cannot be written without looking. A written
// justification on its own is known to turn into boilerplate too (an AIES
// 2026 experiment found people wrote them and still followed the AI), so the
// value here is that each line is about one concrete claim the reviewer must
// check, not a free-form "why I approved" box.
//
// Contract, matching docs/specs/TEMPLATE.md:
//
//   ## Assumptions
//   - [ ] **A1** <claim> — impact if wrong: <what breaks>          (author)
//   - [x] **A1** <claim> — ... — confirmed: <evidence>             (reviewer)
//   - [x] **A2** <claim> — ... — rejected: <what changed in spec>  (reviewer)
//
// The spec agent writes the boxes unticked, so the agent's own spec PR is red
// until a human edits the file. Editing the file (not ticking boxes in the PR
// description) is deliberate: it pushes a commit, which re-runs this check,
// and it leaves the verdicts in the ratified spec where impl-agent and the
// ADR agent read them.
//
// Scope, stated honestly:
//   - It checks that every item has a verdict with some evidence text. It
//     cannot check that the evidence is true. That is the reviewer's job; this
//     makes skipping it a deliberate act instead of a default.
//   - Specs written before this section existed have no "## Assumptions".
//     A missing section fails only for a spec ADDED by the PR (SPEC_IS_NEW=
//     true); a modified legacy spec passes with a notice, so touching an old
//     spec does not force a retroactive review.
//   - docs/specs/TEMPLATE.md itself is skipped: its placeholder item is
//     unticked by design.
//
// Required env var: SPEC_FILE. Optional: SPEC_IS_NEW ('true' when the PR adds
// the file). Exit 1 on any finding, or when the spec cannot be read (a gate
// that no-ops on an unreadable file is a trap door - same reasoning as
// check-impl-scope.mjs). Exit 0 when the check ran clean or legitimately did
// not apply.

import { readFileSync, appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fenceTracker } from './markdown-fence.mjs';

/** Shortest evidence text accepted after "confirmed:"/"rejected:". */
export const MIN_EVIDENCE_CHARS = 12;

const CHECKBOX = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/;
const BULLET = /^\s*[-*+]\s+\S/;
// The verdict is the LAST "confirmed:"/"rejected:" on the line, so a claim
// that itself mentions the word ("the cache is confirmed: warm on boot") does
// not count as the reviewer's verdict unless the reviewer adds one after it.
const VERDICT = /(?:^|[\s—–-])(confirmed|rejected)\s*:\s*(.*)$/i;
const LABEL = /\*\*(A\d+)\*\*/;

/**
 * Returns the lines of the first level-2 "Assumptions" section, outside code
 * fences, with HTML comments removed, or null when there is no such section.
 * Each entry is { text, lineNo } with a 1-based line number into the spec.
 */
export function assumptionsSection(spec) {
  const inCode = fenceTracker();
  const lines = spec.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const code = inCode(lines[i]);
    if (code) {
      continue;
    }
    const h = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (!h) {
      continue;
    }
    if (start === -1) {
      if (h[1].length === 2 && /^assumptions\b/i.test(h[2].trim())) {
        start = i + 1;
      }
    } else if (h[1].length <= 2) {
      end = i;
      break;
    }
  }
  if (start === -1) {
    return null;
  }
  // Strip comments over the section as a whole (they can span lines), then
  // map back to line numbers by keeping the line structure intact.
  const raw = lines.slice(start, end).join('\n');
  const stripped = raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
  return stripped.split('\n').map((text, k) => ({ text, lineNo: start + k + 1 }));
}

/** Parses one checkbox item's text into its verdict parts. */
export function parseItem(text) {
  const m = text.match(CHECKBOX);
  if (!m) {
    return null;
  }
  const body = m[2].trim();
  const label = body.match(LABEL)?.[1] ?? (body.slice(0, 60) || '(empty item)');
  let verdict = null;
  let evidence = '';
  // Find the last verdict on the line.
  let rest = body;
  let found;
  while ((found = rest.match(VERDICT))) {
    verdict = found[1].toLowerCase();
    evidence = found[2].trim();
    rest = found[2];
  }
  return { checked: m[1] !== ' ', label, verdict, evidence, body };
}

function isPlaceholder(evidence) {
  return /^<[^>]*>$/.test(evidence) || /^(todo|tbd|n\/?a|ok|yes|done|-+|\.+)$/i.test(evidence);
}

/**
 * @param {string} spec  full spec text
 * @param {{isNew?: boolean}} [opts]
 * @returns {{applies: boolean, findings: string[], items: object[], notice?: string}}
 */
export function checkAssumptions(spec, { isNew = false } = {}) {
  const section = assumptionsSection(spec);
  if (!section) {
    if (isNew) {
      return {
        applies: true,
        items: [],
        findings: [
          'No "## Assumptions" section. New specs must list the facts they rely on but did not ' +
            'verify (see docs/specs/TEMPLATE.md), so the Gate 1 reviewer can check each one.',
        ],
      };
    }
    return {
      applies: false,
      items: [],
      findings: [],
      notice: 'No "## Assumptions" section; legacy spec modified by this PR, not checked.',
    };
  }

  const items = [];
  const findings = [];
  for (const { text, lineNo } of section) {
    if (!text.trim()) {
      continue;
    }
    const item = parseItem(text);
    if (!item) {
      if (BULLET.test(text)) {
        findings.push(
          `line ${lineNo}: bullet without a checkbox. Write each assumption as "- [ ] **A<n>** ..." ` +
            'so it gets a verdict.'
        );
      }
      continue;
    }
    items.push({ ...item, lineNo });
    const where = `line ${lineNo} (${item.label})`;
    if (!item.checked) {
      findings.push(
        `${where}: not reviewed. Tick it and append "— confirmed: <evidence>" or "— rejected: <what changed>".`
      );
      continue;
    }
    if (!item.verdict) {
      findings.push(
        `${where}: ticked without a verdict. Append "— confirmed: <evidence>" or "— rejected: <what changed>".`
      );
      continue;
    }
    if (item.evidence.length < MIN_EVIDENCE_CHARS || isPlaceholder(item.evidence)) {
      findings.push(
        `${where}: "${item.verdict}:" needs evidence (at least ${MIN_EVIDENCE_CHARS} characters): ` +
          'the file:line or command you checked, or what you changed in the spec.'
      );
    }
  }

  if (items.length === 0) {
    findings.push(
      'The "## Assumptions" section lists no items. List at least one, or state that there are none ' +
        'and why: "- [x] **A1** No assumptions beyond the issue text — confirmed: <why>".'
    );
  }

  return { applies: true, items, findings };
}

function main() {
  const { SPEC_FILE, SPEC_IS_NEW } = process.env;
  if (!SPEC_FILE) {
    console.error('Missing SPEC_FILE');
    process.exit(1);
  }
  if (basename(SPEC_FILE) === 'TEMPLATE.md') {
    console.log(`Assumptions check: ${SPEC_FILE} is the template, skipped.`);
    process.exit(0);
  }

  let spec;
  try {
    spec = readFileSync(SPEC_FILE, 'utf8');
  } catch (err) {
    console.error(`::error::Assumptions check: could not read ${SPEC_FILE}: ${err.message}`);
    process.exit(1);
  }

  const result = checkAssumptions(spec, { isNew: SPEC_IS_NEW === 'true' });
  if (!result.applies) {
    console.log(`Assumptions check: ${SPEC_FILE}: ${result.notice}`);
    process.exit(0);
  }
  if (result.findings.length === 0) {
    const n = result.items.length;
    const rejected = result.items.filter((i) => i.verdict === 'rejected').length;
    console.log(
      `Assumptions check passed: ${SPEC_FILE}: ${n} assumption(s) reviewed` +
        (rejected ? `, ${rejected} rejected.` : '.')
    );
    process.exit(0);
  }

  for (const f of result.findings) {
    console.error(`::error file=${SPEC_FILE}::${f}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n**Assumptions not reviewed in \`${SPEC_FILE}\`:**\n\n` +
        result.findings.map((f) => `- ${f}`).join('\n') +
        '\n'
    );
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
