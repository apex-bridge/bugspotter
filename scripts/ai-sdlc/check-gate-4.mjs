#!/usr/bin/env node
// Gate 4 guard: decides what to do when a pipeline issue is closed.
//
// The pipeline's label gates end at `needs-deploy`, and Gate 4 (deploy) is a
// human action - the issue is meant to stay open until someone has actually
// deployed and verified. Nothing enforced that. An implementation PR whose body
// said `Closes #NNN` instead of `Refs #NNN` auto-closed the issue on merge, so
// it never reached `needs-deploy` and Gate 4 silently did not happen. No error,
// no warning; it looked exactly like success.
//
// PR #283 was written that way and caught by hand, only because PR #277 (the
// previous feature) happened to use `Refs` and its issue is consequently still
// open at `needs-deploy`. `PR Link` accepts both keywords - it only asks whether
// SOME issue is referenced - so nothing in CI could have caught it.
//
// Why the guard lives here rather than in `check-pr-link.mjs`: a closing keyword
// is only one route to skipping Gate 4. A human clicking "Close issue" does
// identical damage, and no amount of PR-body checking will ever see that. The
// gate is a property of the issue, so the check belongs on the issue. It also
// keeps `PR Link` a pure offline string function with no network failure mode,
// which is why that required check is reliable today.
//
// This module is the decision only - it performs no mutations. The workflow
// (.github/workflows/gate-guard.yml) supplies the facts and carries out the
// action, so the interesting logic stays testable without a live GitHub.

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Gates a pipeline issue passes through BEFORE Gate 4. An issue closing while
// still carrying one of these never reached the deploy gate.
export const PRE_DEPLOY_GATES = ['needs-spec', 'needs-adr', 'agent-working', 'needs-review'];

export const DEPLOY_GATE = 'needs-deploy';

/**
 * Decide what should happen to a freshly-closed issue.
 *
 * @param {object} input
 * @param {string[]} input.labels        - label names on the issue at close time
 * @param {string|null} input.stateReason - GitHub's `completed` | `not_planned` | null
 * @param {boolean} input.closedByMerge  - true if a merged PR closed it, not a person
 * @returns {{action: 'ignore'|'comment'|'restore', gate: string|null, reason: string}}
 */
export function decideGateAction({ labels = [], stateReason = null, closedByMerge = false }) {
  const gate = PRE_DEPLOY_GATES.find((g) => labels.includes(g)) ?? null;

  if (gate === null) {
    // Either not a pipeline issue at all, or it already reached `needs-deploy`
    // and closing it is the expected end of the line.
    return { action: 'ignore', gate: null, reason: 'no pre-deploy gate label' };
  }

  // `not_planned` is a deliberate judgment that the work should not happen -
  // issue #238 was closed exactly this way after its spec turned out to be
  // built on a hallucinated package. Gate 4 does not apply to work that is not
  // being done, and second-guessing that call would make this guard a nuisance.
  if (stateReason === 'not_planned') {
    return { action: 'ignore', gate, reason: 'closed as not planned' };
  }

  // A person closing an issue by hand is making a decision. Say the gate was
  // skipped, then leave it alone - reopening under someone would be fighting
  // the human this pipeline exists to keep in the loop.
  if (!closedByMerge) {
    return { action: 'comment', gate, reason: 'closed by a person, not by a merge' };
  }

  // Closed as a side effect of a merge: nobody decided this, a keyword did.
  // Restoring is the whole point of the guard.
  return { action: 'restore', gate, reason: 'auto-closed by a merged PR' };
}

/**
 * The comment body posted for the `comment` and `restore` actions.
 * Written to be useful to a human reading it cold on the issue.
 */
export function buildComment({ action, gate }) {
  const skipped =
    `This issue closed while still labelled \`${gate}\`, so it never reached ` +
    `\`${DEPLOY_GATE}\` and **Gate 4 (deploy) was skipped**.`;

  if (action === 'restore') {
    return (
      `${skipped}\n\n` +
      `It was closed automatically by a merged PR, which happens when the PR body ` +
      `uses a closing keyword (\`Closes\`/\`Fixes\`/\`Resolves\`) instead of \`Refs\`. ` +
      `Nobody decided to skip the gate - a keyword did.\n\n` +
      `Reopened and moved to \`${DEPLOY_GATE}\`. Close it again once the change is ` +
      `actually deployed and verified.\n\n` +
      `To avoid this, reference the issue with \`Refs #NNN\` in implementation PRs. ` +
      `\`impl-agent.yml\` already does this for agent-generated PRs.`
    );
  }

  return (
    `${skipped}\n\n` +
    `Left as-is because a person closed it rather than a merge. If that was ` +
    `deliberate, nothing to do. If Gate 4 still needs to happen, reopen and set ` +
    `\`${DEPLOY_GATE}\`.`
  );
}

function main() {
  // Labels arrive as the raw JSON array from the event payload
  // (`toJSON(github.event.issue.labels)`). Separator-joined forms are not safe
  // here: label names may legitimately contain commas or spaces, and Actions
  // expressions cannot emit a real newline as a join separator.
  let labels = [];
  const raw = process.env.ISSUE_LABELS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        labels = parsed.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean);
      }
    } catch {
      // Fail open, loudly. This guard must never be the reason an issue-close
      // workflow errors; the worst outcome of a bad parse is no comment.
      console.warn(`gate-4 guard: could not parse ISSUE_LABELS_JSON, treating as no labels`);
    }
  }

  const decision = decideGateAction({
    labels,
    stateReason: process.env.ISSUE_STATE_REASON || null,
    closedByMerge: process.env.CLOSED_BY_MERGE === 'true',
  });

  console.log(`gate-4 guard: ${decision.action} (${decision.reason})`);

  // Consumed by the workflow via $GITHUB_OUTPUT.
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `action=${decision.action}\ngate=${decision.gate ?? ''}\n`);
    if (decision.action !== 'ignore') {
      // Randomised heredoc delimiter, same reason as generate-impl.mjs: the
      // comment body is partly issue-derived, and a fixed delimiter appearing
      // inside it would let the value escape into the output file.
      const delimiter = `EOF_COMMENT_${Math.random().toString(36).slice(2)}`;
      appendFileSync(out, `comment<<${delimiter}\n${buildComment(decision)}\n${delimiter}\n`);
    }
  }
}

// Only run when invoked directly, so the exports above stay importable by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
