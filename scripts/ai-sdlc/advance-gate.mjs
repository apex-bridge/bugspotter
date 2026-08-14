#!/usr/bin/env node
// Decides how a pipeline issue's gate label should move when one of the
// AI-SDLC stage PRs (spec/, adr/, impl/) merges.
//
// Before this existed, every gate transition in the pipeline was a human
// running `gh issue edit --remove-label X --add-label Y` by hand after
// reading the merged PR - done manually for issues #297 and #227 across an
// entire session each. That is pure mechanical work with an unambiguous
// trigger (a stage PR merging) and, for two of the three stages, an
// unambiguous destination:
//
//   spec/  merge -> needs-adr, OR agent-working directly if the spec itself
//          declares no ADR is warranted (its own "ADR: n/a" line - a field
//          a human/agent already set deliberately while drafting the spec,
//          not a guess this script invents).
//   adr/   merge -> agent-working, always (the branch only exists when an
//          ADR was drafted, so there is no other place for it to go).
//   impl/  merge -> needs-deploy, always (Gate 3 IS the merge - see
//          impl-agent.yml's own header comment - so a merged impl/ PR has
//          already cleared it).
//
// This module never substitutes for the human judgment the gates exist to
// require: it only fires after a human has already merged the PR, and
// merging IS that judgment. It fails closed - skip, not guess - on anything
// it cannot parse confidently: an unrecognized branch prefix, no resolvable
// issue number, an issue not currently sitting at the label this stage
// expects (a person may have already moved it by hand), or a spec file
// missing its ADR line.
//
// This module is the decision only - it performs no mutations and makes no
// network calls. The workflow (.github/workflows/pipeline-advance.yml)
// supplies the facts (branch name, PR body, the issue's current labels, the
// merged spec's ADR field) and carries out the label edit, so the interesting
// logic stays testable without a live GitHub - same split as
// check-gate-4.mjs / gate-guard.yml.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const GATE_LABELS = {
  spec: 'needs-spec',
  adr: 'needs-adr',
  agentWorking: 'agent-working',
  needsReview: 'needs-review',
  needsDeploy: 'needs-deploy',
};

// Same reference pattern as scripts/check-pr-link.mjs's REFERENCE, narrowed
// to capture the issue number: adr/ branches don't carry the issue number in
// their name (they're named after the ADR number instead), so it has to come
// from the agent-authored PR body's "Refs #NNN" instead. Word-bounded on both
// sides for the identical reason check-pr-link.mjs is: reject partial tokens
// like "#123abc", never false-match "discloses #123" as "closes".
const REFERENCE_WITH_NUMBER =
  /(?<!\p{L})(?:Closes|Refs|Fixes|Tracks|Resolves|References)\s+(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#([0-9]+)(?![0-9\p{L}])/iu;

/**
 * @param {string} body
 * @returns {number|null}
 */
export function extractIssueNumber(body) {
  for (const line of (body ?? '').split(/\r?\n/)) {
    const m = REFERENCE_WITH_NUMBER.exec(line);
    if (m) {
      return Number(m[1]);
    }
  }
  return null;
}

/**
 * Which AI-SDLC stage a merged PR belongs to, and its issue number if the
 * branch name carries one. adr/ branches are named after the ADR number
 * (`adr/0043-slug`), not the issue, so their issueNumber is always null here
 * - callers fall back to extractIssueNumber(prBody) for that stage.
 *
 * @param {string} headRef
 * @returns {{stage: 'spec'|'adr'|'impl'|null, issueNumber: number|null}}
 */
export function parseStageAndBranchIssue(headRef) {
  const ref = headRef ?? '';
  let m = /^spec\/issue-(\d+)-/.exec(ref);
  if (m) {
    return { stage: 'spec', issueNumber: Number(m[1]) };
  }
  m = /^impl\/issue-(\d+)-/.exec(ref);
  if (m) {
    return { stage: 'impl', issueNumber: Number(m[1]) };
  }
  if (/^adr\/\d+-/.test(ref)) {
    return { stage: 'adr', issueNumber: null };
  }
  return { stage: null, issueNumber: null };
}

/**
 * Reads the `ADR: pending / docs/adr/NNNN-slug.md / n/a` line a ratified spec
 * carries (see docs/specs/TEMPLATE.md). Returns the trimmed value verbatim
 * (not just a boolean) so the decision below - and the resulting issue
 * comment - can say what the spec actually declared, not just what was
 * inferred from it.
 *
 * @param {string} specContent
 * @returns {string|null} null if the file has no such line at all
 */
export function readAdrField(specContent) {
  // [ \t]* (not \s*) keeps the optional leading whitespace on the ADR line
  // itself - \s matches a newline too, so \s* would happily skip a blank
  // `ADR:` line and capture the next line's text as the value instead of
  // reporting no value at all.
  const m = /^ADR:[ \t]*(\S.*)$/m.exec(specContent ?? '');
  return m ? m[1].trim() : null;
}

/**
 * @param {object} input
 * @param {string} input.headRef
 * @param {string} input.prBody
 * @param {string[]} input.issueLabels - the issue's labels *right now*, so a
 *   label a person already changed by hand is respected rather than clobbered
 * @param {string|null} input.adrField - only meaningful for stage 'spec'
 * @returns {{action: 'advance'|'skip', stage: string|null, issueNumber: number|null,
 *            fromLabels: string[], toLabel: string|null, reason: string}}
 */
export function decideAdvance({ headRef, prBody, issueLabels = [], adrField = null }) {
  const { stage, issueNumber: branchIssueNumber } = parseStageAndBranchIssue(headRef);

  if (!stage) {
    return {
      action: 'skip',
      stage: null,
      issueNumber: null,
      fromLabels: [],
      toLabel: null,
      reason: 'not an AI-SDLC stage branch (spec/, adr/, impl/)',
    };
  }

  const issueNumber = branchIssueNumber ?? extractIssueNumber(prBody);
  if (!issueNumber) {
    return {
      action: 'skip',
      stage,
      issueNumber: null,
      fromLabels: [],
      toLabel: null,
      reason: 'could not determine the linked issue number from the branch name or PR body',
    };
  }

  if (stage === 'spec') {
    if (!issueLabels.includes(GATE_LABELS.spec)) {
      return {
        action: 'skip',
        stage,
        issueNumber,
        fromLabels: [],
        toLabel: null,
        reason: `issue #${issueNumber} is not currently at \`${GATE_LABELS.spec}\` - already advanced, or moved by a person`,
      };
    }
    if (!adrField) {
      return {
        action: 'skip',
        stage,
        issueNumber,
        fromLabels: [],
        toLabel: null,
        reason: 'could not read the ADR field from the merged spec file',
      };
    }
    const toLabel = adrField.toLowerCase() === 'n/a' ? GATE_LABELS.agentWorking : GATE_LABELS.adr;
    return {
      action: 'advance',
      stage,
      issueNumber,
      fromLabels: [GATE_LABELS.spec],
      toLabel,
      reason: `spec merged; its ADR field reads "${adrField}"`,
    };
  }

  if (stage === 'adr') {
    if (!issueLabels.includes(GATE_LABELS.adr)) {
      return {
        action: 'skip',
        stage,
        issueNumber,
        fromLabels: [],
        toLabel: null,
        reason: `issue #${issueNumber} is not currently at \`${GATE_LABELS.adr}\` - already advanced, or moved by a person`,
      };
    }
    return {
      action: 'advance',
      stage,
      issueNumber,
      fromLabels: [GATE_LABELS.adr],
      toLabel: GATE_LABELS.agentWorking,
      reason: 'ADR merged, gate 2 complete',
    };
  }

  // stage === 'impl'. Either `agent-working` or `needs-review` may be
  // present (nothing currently sets `needs-review` before merge, but
  // check-gate-4.mjs's PRE_DEPLOY_GATES treats both as pre-deploy states, so
  // this strips whichever is actually there rather than assuming one).
  const present = [GATE_LABELS.agentWorking, GATE_LABELS.needsReview].filter((l) =>
    issueLabels.includes(l)
  );
  if (present.length === 0) {
    return {
      action: 'skip',
      stage,
      issueNumber,
      fromLabels: [],
      toLabel: null,
      reason: `issue #${issueNumber} carries neither \`${GATE_LABELS.agentWorking}\` nor \`${GATE_LABELS.needsReview}\` - already advanced, or moved by a person`,
    };
  }
  return {
    action: 'advance',
    stage,
    issueNumber,
    fromLabels: present,
    toLabel: GATE_LABELS.needsDeploy,
    reason: 'implementation PR merged, gate 3 (human merge review) complete',
  };
}

function writeOutputs(pairs) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) {
    return;
  }
  const lines = Object.entries(pairs).map(([k, v]) => {
    const value = String(v ?? '');
    if (!/[\r\n]/.test(value)) {
      return `${k}=${value}`;
    }
    // Randomised delimiter, same reason as check-gate-4.mjs's comment output:
    // `reason` carries the spec's own ADR field text today, which the bash
    // step guarantees is single-line - but that guarantee lives outside this
    // file, so the delimiter form is what actually holds if it ever doesn't.
    const delimiter = `EOF_${k.toUpperCase()}_${Math.random().toString(36).slice(2)}`;
    return `${k}<<${delimiter}\n${value}\n${delimiter}`;
  });
  appendFileSync(out, `${lines.join('\n')}\n`);
}

// Two modes because the issue number for adr/ branches is only knowable
// after parsing (branch name alone isn't enough), but fetching the issue's
// current labels - needed for the real decision - requires that number
// first. The workflow runs `resolve-issue` to get it, fetches labels with
// plain `gh issue view`, then runs `decide` with everything assembled. Both
// modes share this one module so the parsing logic is exercised by the same
// tests either way.
function main() {
  const mode = process.argv[2];
  const headRef = process.env.HEAD_REF ?? '';
  const prBody = process.env.PR_BODY ?? '';

  if (mode === 'resolve-issue') {
    const { stage, issueNumber: branchIssueNumber } = parseStageAndBranchIssue(headRef);
    const issueNumber = branchIssueNumber ?? (stage ? extractIssueNumber(prBody) : null);
    console.log(
      `advance-gate resolve-issue: stage=${stage ?? 'none'} issue=${issueNumber ?? 'none'}`
    );
    writeOutputs({ stage, issue_number: issueNumber });
    return;
  }

  if (mode !== 'decide') {
    console.error(`advance-gate: unknown mode "${mode ?? ''}" (expected resolve-issue or decide)`);
    process.exit(2);
  }

  let issueLabels = [];
  const rawLabels = process.env.ISSUE_LABELS_JSON;
  if (rawLabels) {
    try {
      const parsed = JSON.parse(rawLabels);
      if (Array.isArray(parsed)) {
        issueLabels = parsed.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
      }
    } catch {
      // Fail open, loudly - same reasoning as check-gate-4.mjs: a bad parse
      // must never crash this workflow, worst case is a skip.
      console.warn('advance-gate: could not parse ISSUE_LABELS_JSON, treating as no labels');
    }
  }

  const decision = decideAdvance({
    headRef,
    prBody,
    issueLabels,
    adrField: process.env.ADR_FIELD || null,
  });

  console.log(`advance-gate decide: ${decision.action} (${decision.reason})`);

  writeOutputs({
    action: decision.action,
    stage: decision.stage,
    issue_number: decision.issueNumber,
    // Our own label names, never arbitrary text - safe to comma-join, same
    // reasoning as check-gate-4.mjs's remove_labels output.
    from_labels: decision.fromLabels.join(','),
    to_label: decision.toLabel,
    reason: decision.reason,
  });
}

// Only run when invoked directly, so the exports above stay importable by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
