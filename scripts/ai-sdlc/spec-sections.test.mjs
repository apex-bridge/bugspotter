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
