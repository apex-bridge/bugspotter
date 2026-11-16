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
    '## Changes',
    '### `docs/adr/0012-old.md` (mark Superseded)',
    'SUPERSEDE_NOTE',
  ].join('\n');
  const out = specForAdr(spec, 'docs/adr/0046-new.md', { existingAdrs: ['0012-old.md'] });
  assert.ok(!out.includes('SUPERSEDE_NOTE'));
});
