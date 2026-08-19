// Tests for advance-gate.mjs. Zero-dependency: run with `node --test`.
//
// The point of this file is the fail-closed behavior: a gate advanced on a
// wrong guess is worse than one left for a human to flip by hand, because it
// silently moves an issue through a state nobody actually reviewed. Every
// "skip" branch below is asserted as firmly as the three real advances are.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStageAndBranchIssue,
  extractIssueNumber,
  readAdrField,
  decideAdvance,
  GATE_LABELS,
} from './advance-gate.mjs';

test('parses the issue number out of a spec/ branch name', () => {
  const r = parseStageAndBranchIssue('spec/issue-227-intelligence-show-match-score-threshold-');
  assert.equal(r.stage, 'spec');
  assert.equal(r.issueNumber, 227);
});

test('parses the issue number out of an impl/ branch name', () => {
  const r = parseStageAndBranchIssue('impl/issue-297-intelligence-worker-honour-retry-after');
  assert.equal(r.stage, 'impl');
  assert.equal(r.issueNumber, 297);
});

test('recognizes an adr/ branch but cannot get the issue number from its name', () => {
  const r = parseStageAndBranchIssue('adr/0043-intelligence-show-match-score-threshold-');
  assert.equal(r.stage, 'adr');
  assert.equal(r.issueNumber, null);
});

test('does not treat an unrelated branch as an AI-SDLC stage', () => {
  const r = parseStageAndBranchIssue('chore/bump-deps');
  assert.equal(r.stage, null);
});

test('extracts the issue number from a "Refs #NNN" PR body', () => {
  assert.equal(extractIssueNumber('Agent-drafted ADR-0043 for issue #227.\n\nRefs #227'), 227);
});

test('does not match a bare #NNN with no keyword', () => {
  // Same reasoning as check-pr-link.mjs's REFERENCE: a bare number in prose
  // (e.g. quoting an issue while describing something) must not count.
  assert.equal(extractIssueNumber('See #227 for background.'), null);
});

test('accepts an owner/repo-qualified reference and keeps the number', () => {
  assert.equal(extractIssueNumber('Refs some-org/some-repo#227'), 227);
});

test('reads the ADR field from a spec file', () => {
  assert.equal(readAdrField('Linked issue: Refs #227\nADR: n/a\n\n## Problem'), 'n/a');
  assert.equal(readAdrField('ADR: docs/adr/0043-slug.md\n'), 'docs/adr/0043-slug.md');
  assert.equal(readAdrField('no ADR line here'), null);
});

test('a blank ADR line reports no value, not the next line', () => {
  // Regression: \s* in the old pattern matched the newline too, so a blank
  // `ADR:` line captured whatever text followed it on the next line.
  assert.equal(readAdrField('ADR:\n\n## Problem'), null);
  assert.equal(readAdrField('ADR: \nSome unrelated text'), null);
});

test('spec merge with ADR: n/a advances straight to agent-working', () => {
  const d = decideAdvance({
    headRef: 'spec/issue-227-intelligence-show-match-score-threshold-',
    prBody: 'Refs #227',
    issueLabels: ['enhancement', GATE_LABELS.spec],
    adrField: 'n/a',
  });
  assert.equal(d.action, 'advance');
  assert.equal(d.issueNumber, 227);
  assert.deepEqual(d.fromLabels, [GATE_LABELS.spec]);
  assert.equal(d.toLabel, GATE_LABELS.agentWorking);
});

test('treats an uppercase ADR: N/A the same as n/a', () => {
  const d = decideAdvance({
    headRef: 'spec/issue-227-intelligence-show-match-score-threshold-',
    prBody: 'Refs #227',
    issueLabels: [GATE_LABELS.spec],
    adrField: 'N/A',
  });
  assert.equal(d.action, 'advance');
  assert.equal(d.toLabel, GATE_LABELS.agentWorking);
});

test('spec merge whose ADR field names an already-ratified ADR advances straight to agent-working (#359)', () => {
  const d = decideAdvance({
    headRef: 'spec/issue-353-sso-2-4-oidc-login-callback-path-',
    prBody: 'Refs #353',
    issueLabels: [GATE_LABELS.spec],
    adrField: 'docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md',
    adrAlreadyRatified: true,
  });
  assert.equal(d.action, 'advance');
  assert.equal(d.issueNumber, 353);
  assert.deepEqual(d.fromLabels, [GATE_LABELS.spec]);
  assert.equal(d.toLabel, GATE_LABELS.agentWorking);
  assert.match(d.reason, /already exists and is Accepted/);
});

test('a spec ADR field naming a real path still routes to needs-adr when the workflow did not confirm it is ratified', () => {
  // adrAlreadyRatified defaults to false - the workflow only sets it true
  // after actually checking the file exists AND is Accepted, so a stale or
  // mistaken path (or a Proposed/Draft ADR) still gets its own gate.
  const d = decideAdvance({
    headRef: 'spec/issue-354-sso-3-4-enforce-sso-guards-',
    prBody: 'Refs #354',
    issueLabels: [GATE_LABELS.spec],
    adrField: 'docs/adr/0044-sso-oidc-account-linking-and-tenant-boundary.md',
  });
  assert.equal(d.action, 'advance');
  assert.equal(d.toLabel, GATE_LABELS.adr);
});

test('spec merge with an ADR still pending advances to needs-adr', () => {
  const d = decideAdvance({
    headRef: 'spec/issue-226-intelligence-wire-per-org-similarity-thr',
    prBody: 'Refs #226',
    issueLabels: [GATE_LABELS.spec],
    adrField: 'pending',
  });
  assert.equal(d.action, 'advance');
  assert.equal(d.toLabel, GATE_LABELS.adr);
});

test('spec merge is skipped, not guessed, when the ADR field could not be read', () => {
  const d = decideAdvance({
    headRef: 'spec/issue-227-intelligence-show-match-score-threshold-',
    prBody: 'Refs #227',
    issueLabels: [GATE_LABELS.spec],
    adrField: null,
  });
  assert.equal(d.action, 'skip');
});

test('spec merge is skipped when the issue is no longer at needs-spec', () => {
  // A person already moved it by hand - do not fight them.
  const d = decideAdvance({
    headRef: 'spec/issue-227-intelligence-show-match-score-threshold-',
    prBody: 'Refs #227',
    issueLabels: [GATE_LABELS.adr],
    adrField: 'n/a',
  });
  assert.equal(d.action, 'skip');
});

test('adr merge advances to agent-working using the issue number from the PR body', () => {
  const d = decideAdvance({
    headRef: 'adr/0043-intelligence-show-match-score-threshold-',
    prBody: 'Agent-drafted ADR-0043 for issue #227.\n\nRefs #227',
    issueLabels: [GATE_LABELS.adr],
    adrField: null,
  });
  assert.equal(d.action, 'advance');
  assert.equal(d.issueNumber, 227);
  assert.deepEqual(d.fromLabels, [GATE_LABELS.adr]);
  assert.equal(d.toLabel, GATE_LABELS.agentWorking);
});

test('adr merge is skipped when the PR body has no resolvable issue reference', () => {
  const d = decideAdvance({
    headRef: 'adr/0043-intelligence-show-match-score-threshold-',
    prBody: 'No reference in this body.',
    issueLabels: [GATE_LABELS.adr],
    adrField: null,
  });
  assert.equal(d.action, 'skip');
  assert.equal(d.issueNumber, null);
});

test('impl merge advances agent-working to needs-deploy', () => {
  const d = decideAdvance({
    headRef: 'impl/issue-297-intelligence-worker-honour-retry-after',
    prBody: 'Refs #297',
    issueLabels: [GATE_LABELS.agentWorking],
    adrField: null,
  });
  assert.equal(d.action, 'advance');
  assert.deepEqual(d.fromLabels, [GATE_LABELS.agentWorking]);
  assert.equal(d.toLabel, GATE_LABELS.needsDeploy);
});

test('impl merge strips needs-review too if present alongside agent-working', () => {
  // Defensive: nothing sets needs-review today, but check-gate-4.mjs already
  // treats it as a pre-deploy state a human could apply by hand.
  const d = decideAdvance({
    headRef: 'impl/issue-297-intelligence-worker-honour-retry-after',
    prBody: 'Refs #297',
    issueLabels: [GATE_LABELS.agentWorking, GATE_LABELS.needsReview],
    adrField: null,
  });
  assert.equal(d.action, 'advance');
  assert.deepEqual(d.fromLabels, [GATE_LABELS.agentWorking, GATE_LABELS.needsReview]);
});

test('impl merge is skipped when the issue already reached needs-deploy', () => {
  const d = decideAdvance({
    headRef: 'impl/issue-297-intelligence-worker-honour-retry-after',
    prBody: 'Refs #297',
    issueLabels: [GATE_LABELS.needsDeploy],
    adrField: null,
  });
  assert.equal(d.action, 'skip');
});

test('an ordinary PR merge on an unrelated branch is skipped entirely', () => {
  const d = decideAdvance({
    headRef: 'chore/bump-deps',
    prBody: 'Refs #227',
    issueLabels: [GATE_LABELS.spec],
    adrField: 'n/a',
  });
  assert.equal(d.action, 'skip');
  assert.equal(d.stage, null);
});
