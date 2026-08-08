// Tests for check-gate-4.mjs. Zero-dependency: run with `node --test`.
//
// The four-way split is the point of this file. A guard that reopens too
// eagerly is worse than no guard, because it fights the human it exists to
// protect - so "closed by a person" and "closed as not planned" are asserted
// as hands-off just as firmly as the auto-close case is asserted as restored.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideGateAction, buildComment, PRE_DEPLOY_GATES, DEPLOY_GATE } from './check-gate-4.mjs';

test('restores an issue auto-closed by a merged PR while still at a pre-deploy gate', () => {
  // The #283 scenario: PR body said `Closes #269` rather than `Refs #269`.
  const d = decideGateAction({
    labels: ['agent-working', 'enhancement'],
    stateReason: 'completed',
    closedByMerge: true,
  });

  assert.equal(d.action, 'restore');
  assert.equal(d.gate, 'agent-working');
});

test('leaves an issue closed by a person alone, but says the gate was skipped', () => {
  const d = decideGateAction({
    labels: ['needs-review'],
    stateReason: 'completed',
    closedByMerge: false,
  });

  // Comment, not restore: a person closing an issue is a decision, and
  // reopening under them would make this guard a nuisance.
  assert.equal(d.action, 'comment');
  assert.equal(d.gate, 'needs-review');
});

test('ignores an issue closed as not planned', () => {
  // Issue #238 was closed exactly this way, after its spec turned out to rest
  // on a hallucinated package. Gate 4 does not apply to work nobody is doing.
  const d = decideGateAction({
    labels: ['agent-working'],
    stateReason: 'not_planned',
    closedByMerge: true,
  });

  assert.equal(d.action, 'ignore');
});

test('ignores an issue that already reached needs-deploy', () => {
  const d = decideGateAction({
    labels: [DEPLOY_GATE, 'enhancement'],
    stateReason: 'completed',
    closedByMerge: true,
  });

  assert.equal(d.action, 'ignore');
  assert.equal(d.gate, null);
});

test('ignores an issue carrying no gate label at all', () => {
  // Ordinary bugs and chores are not on the pipeline spine and must not be
  // touched - this guard has `issues: write`, so over-reach is the main risk.
  const d = decideGateAction({
    labels: ['bug', 'good first issue'],
    stateReason: 'completed',
    closedByMerge: true,
  });

  assert.equal(d.action, 'ignore');
});

test('ignores an issue with no labels and no state reason', () => {
  assert.equal(decideGateAction({}).action, 'ignore');
});

test('every pre-deploy gate label is recognised', () => {
  // Guards against a label being added to the pipeline and silently not
  // covered here.
  for (const gate of PRE_DEPLOY_GATES) {
    const d = decideGateAction({ labels: [gate], stateReason: 'completed', closedByMerge: true });
    assert.equal(d.action, 'restore', `${gate} must be treated as pre-deploy`);
    assert.equal(d.gate, gate);
  }
});

test('picks the earliest gate when an issue somehow carries two', () => {
  const d = decideGateAction({
    labels: ['needs-review', 'needs-spec'],
    stateReason: 'completed',
    closedByMerge: true,
  });

  // PRE_DEPLOY_GATES is in pipeline order, so `find` reports the earlier one.
  assert.equal(d.gate, 'needs-spec');
});

test('the restore comment explains the cause and names the fix', () => {
  const body = buildComment({ action: 'restore', gate: 'agent-working' });

  assert.match(body, /Gate 4 \(deploy\) was skipped/);
  assert.match(body, /agent-working/);
  assert.match(body, /Reopened and moved to `needs-deploy`/);
  assert.match(body, /Refs #NNN/, 'must tell the reader how to avoid it next time');
});

test('the comment-only body does not claim the issue was reopened', () => {
  const body = buildComment({ action: 'comment', gate: 'needs-review' });

  assert.match(body, /Left as-is/);
  assert.doesNotMatch(body, /Reopened/);
});
