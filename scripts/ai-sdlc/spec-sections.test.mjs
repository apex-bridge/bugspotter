// Tests for spec-sections.mjs. Zero-dependency: run with `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { specForAdr } from './spec-sections.mjs';

const ADR = 'docs/adr/0001-fixture.md';
const FENCE = '```';
const SPEC = [
  '# Spec: fixture',
  '',
  'Linked issue: Refs #1',
  `ADR: ${ADR}`,
  '',
  '## Problem',
  'PROBLEM_TEXT',
  '## Out of scope',
  'SCOPE_TEXT',
  '## Constraints',
  '1. CONSTRAINT_TEXT',
  '### A constraint subsection',
  'CONSTRAINT_SUB_TEXT',
  '## Acceptance criteria',
  '- [ ] AC_TEXT',
  '## Changes',
  `### \`${ADR}\``,
  'ADR_OUTLINE_TEXT',
  `${FENCE}md`,
  '## Testing Strategy',
  'OUTLINE_HEADING_INSIDE_FENCE',
  FENCE,
  '### `docs/adr/README.md`',
  'OTHER_FILE_TEXT',
  '## Tests',
  'TESTS_TEXT',
  '## Verification',
  'VERIFY_TEXT',
  '',
].join('\n');

test('keeps the decision sections and the ADR file subsection', () => {
  const out = specForAdr(SPEC, ADR);
  for (const keep of [
    'Linked issue: Refs #1',
    `ADR: ${ADR}`,
    'PROBLEM_TEXT',
    'SCOPE_TEXT',
    'CONSTRAINT_TEXT',
    'CONSTRAINT_SUB_TEXT',
    'AC_TEXT',
    'ADR_OUTLINE_TEXT',
  ]) {
    assert.ok(out.includes(keep), `missing ${keep}`);
  }
});

test('a heading inside a code fence stays with its section', () => {
  const out = specForAdr(SPEC, ADR);
  assert.ok(out.includes('## Testing Strategy\nOUTLINE_HEADING_INSIDE_FENCE'));
});

test('drops Tests, Verification and other files under Changes', () => {
  const out = specForAdr(SPEC, ADR);
  for (const drop of ['TESTS_TEXT', 'VERIFY_TEXT', 'OTHER_FILE_TEXT']) {
    assert.ok(!out.includes(drop), `should drop ${drop}`);
  }
});

test('returns null for text without the expected sections', () => {
  assert.equal(specForAdr('# Notes\n\nJust prose, no template sections.\n', ADR), null);
});

test('real spec for #451: keeps every constraint and AC, drops the test scripts', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const spec = readFileSync(
    join(here, '..', '..', 'docs', 'specs', '0451-rls-slice-1-adr-spec-for-postgres-row-le.md'),
    'utf8'
  );
  const out = specForAdr(spec, 'docs/adr/0045-postgres-row-level-security.md');
  assert.ok(
    out.length < spec.length * 0.75,
    `expected a real reduction, got ${out.length}/${spec.length}`
  );
  const count = (s, re) => (s.match(re) || []).length;
  // Every numbered constraint (lines "1. **...") and every AC checkbox survives.
  assert.equal(count(out, /^\d+\. \*\*/gm), count(spec, /^\d+\. \*\*/gm));
  assert.equal(count(out, /^- \[ \]/gm), count(spec, /^- \[ \]/gm));
  assert.ok(out.includes('### Table inventory'), 'ADR outline kept');
  assert.ok(!out.includes('**Test case A'), 'Tests section dropped');
});

test('a fence line with text after the marker does not close the fence', () => {
  const spec = [
    '## Problem',
    'P',
    '## Constraints',
    'C',
    '## Changes',
    `### \`${ADR}\``,
    '```md',
    '```example',
    '## Decision',
    'INSIDE_OUTLINE_MARKER',
    '```',
    '## Tests',
    'T',
  ].join('\n');
  const out = specForAdr(spec, ADR);
  assert.ok(out.includes('INSIDE_OUTLINE_MARKER'), 'outline content after ```example is kept');
  assert.ok(!out.includes('\nT'), 'Tests still dropped');
});

test('two ADR subsections under Changes: the exact path wins; without one the choice is ambiguous', () => {
  const spec = [
    '## Problem',
    'P',
    '## Constraints',
    'C',
    '## Changes',
    '### `docs/adr/0001-security.md`',
    'OUTLINE_SECURITY',
    '### `docs/adr/0002-storage.md`',
    'OUTLINE_STORAGE',
    '### `docs/adr/README.md`',
    'INDEX_ROW',
  ].join('\n');
  const exact = specForAdr(spec, 'docs/adr/0001-security.md');
  assert.ok(exact.includes('OUTLINE_SECURITY'));
  assert.ok(!exact.includes('OUTLINE_STORAGE'), 'the other ADR outline is not sent');
  assert.equal(
    specForAdr(spec, 'docs/adr/0009-other.md'),
    null,
    'ambiguous: caller sends the full spec'
  );
  const one = specForAdr(spec, 'docs/adr/0009-other.md', { existingAdrs: ['0001-security.md'] });
  assert.ok(one.includes('OUTLINE_STORAGE'), 'the one new numbered ADR is used');
  assert.ok(!one.includes('OUTLINE_SECURITY'), 'an existing ADR is not the new one');
  assert.ok(!one.includes('INDEX_ROW'), 'README.md is not a numbered ADR');
});

test('"ADR: pending" with an edit to an existing ADR: that ADR is not taken as the new one', () => {
  const spec = [
    '## Problem',
    'P',
    '## Constraints',
    'C',
    '## Changes',
    '### `docs/adr/0012-old.md` (mark Superseded)',
    'SUPERSEDE_NOTE',
  ].join('\n');
  const out = specForAdr(spec, 'docs/adr/0046-new.md', { existingAdrs: ['0012-old.md'] });
  assert.ok(!out.includes('SUPERSEDE_NOTE'));
});

test('two subsections for the same ADR file share one Changes heading', () => {
  const spec = [
    '## Problem',
    'P',
    '## Constraints',
    'C',
    '## Changes',
    '### `docs/adr/0045-x.md`',
    'OUTLINE',
    '### `docs/adr/0045-x.md` index row',
    'ROW',
  ].join('\n');
  const out = specForAdr(spec, 'docs/adr/0045-x.md');
  assert.equal(out.match(/^## Changes \(ADR file only\)$/gm).length, 1);
  assert.ok(out.includes('OUTLINE') && out.includes('ROW'));
});

test('a prose line starting with ```code``` does not open a fence', () => {
  const spec = [
    '## Problem',
    '```fetch()``` returns stale data',
    '## Constraints',
    'C',
    '## Tests',
    'TEST_DETAILS',
  ].join('\n');
  assert.ok(!specForAdr(spec, 'docs/adr/0001-x.md').includes('TEST_DETAILS'));
});

test('an older spec with "Problem / motivation" and "Scope and constraints" keeps both (0226)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const spec = readFileSync(
    join(here, '..', '..', 'docs', 'specs', '0226-intelligence-wire-per-org-similarity-thr.md'),
    'utf8'
  );
  const out = specForAdr(spec, 'docs/adr/0099-x.md');
  assert.match(out, /^## Problem \/ motivation$/m);
  assert.match(out, /^## Scope and constraints$/m);
  assert.match(out, /^## Acceptance criteria$/m);
  assert.doesNotMatch(out, /^## How \(runnable steps\)$/m);
});

test('a spec missing Problem or Constraints gets the full-spec fallback', () => {
  const noConstraints = ['## Problem', 'P', '## Acceptance criteria', 'AC', '## Tests', 'T'];
  assert.equal(specForAdr(noConstraints.join('\n'), 'docs/adr/0001-x.md'), null);
  const noProblem = ['## Constraints', 'C', '## Acceptance criteria', 'AC'];
  assert.equal(specForAdr(noProblem.join('\n'), 'docs/adr/0001-x.md'), null);
});

test('only Problem and Constraints headings count, not headings that merely mention them', () => {
  const spec = [
    '## Problem',
    'P',
    '## Constraints',
    'C',
    '## Tests (one per constraint)',
    'TESTS_PER_CONSTRAINT',
    '### Test case A',
    'TEST_CASE_A',
    '## Verification of constraints',
    'VERIFY_CONSTRAINTS',
    '## Problems found by the verifier',
    'VERIFIER_PROBLEMS',
  ].join('\n');
  const out = specForAdr(spec, 'docs/adr/0001-x.md');
  for (const drop of [
    'TESTS_PER_CONSTRAINT',
    'TEST_CASE_A',
    'VERIFY_CONSTRAINTS',
    'VERIFIER_PROBLEMS',
  ]) {
    assert.ok(!out.includes(drop), `should drop ${drop}`);
  }
  const nonConstraints = ['## Problem', 'P', '## Non-constraints', 'N', '## Tests', 'T'];
  assert.equal(
    specForAdr(nonConstraints.join('\n'), 'docs/adr/0001-x.md'),
    null,
    '"Non-constraints" is not a Constraints section'
  );
  const problemsOnly = ['## Problems found by the verifier', 'X', '## Constraints', 'C'];
  assert.equal(
    specForAdr(problemsOnly.join('\n'), 'docs/adr/0001-x.md'),
    null,
    '"Problems found ..." is not a Problem section'
  );
});

test('a Changes heading with a suffix still yields the ADR outline', () => {
  for (const heading of ['## Changes (per file)', '## Changes:']) {
    const spec = [
      '## Problem',
      'P',
      '## Constraints',
      'C',
      heading,
      `### \`${ADR}\``,
      'OUTLINE_UNDER_VARIANT',
      '### `src/a.ts`',
      'OTHER_FILE',
      '## Tests',
      'T',
    ].join('\n');
    const out = specForAdr(spec, ADR);
    assert.ok(out.includes('OUTLINE_UNDER_VARIANT'), `outline kept under "${heading}"`);
    assert.ok(!out.includes('OTHER_FILE'), `other files dropped under "${heading}"`);
  }
});

test('the ADR file named under Changes without its own subsection gets the full-spec fallback', () => {
  const spec = [
    '## Problem',
    'P',
    '## Constraints',
    'C',
    '## Changes',
    `- \`${ADR}\`: new ADR with sections Context, Decision, Consequences`,
    '### `src/a.ts`',
    'A',
  ].join('\n');
  assert.equal(specForAdr(spec, ADR), null);
  // An existing ADR mentioned in a code comment under Changes (0352 cites
  // docs/adr/0044 that way) has no outline to lose: the selection stands.
  const existing = spec.replace(`- \`${ADR}\`: new ADR`, `-- see ${ADR} for the`);
  assert.ok(specForAdr(existing, ADR, { existingAdrs: ['0001-fixture.md'] }).includes('P'));
});
