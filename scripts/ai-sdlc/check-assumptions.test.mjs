// Tests for check-assumptions.mjs: the pure parser/checker, plus a CLI block
// for main()'s env handling (SPEC_IS_NEW, the TEMPLATE.md skip, the
// unreadable-file exit). Zero-dependency, run with `node --test`.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assumptionsSection,
  checkAssumptions,
  parseItem,
  MIN_EVIDENCE_CHARS,
} from './check-assumptions.mjs';

const spec = (assumptions) => `# Spec: thing

Linked issue: Refs #1
ADR: n/a

**Files touched:** \`packages/backend/src/a.ts\`

## Problem

Something.

## Constraints

1. One.

## Assumptions

${assumptions}

## Acceptance criteria

- [ ] unticked AC boxes here must not be read as assumptions
`;

describe('assumptionsSection', () => {
  test('returns null when there is no section', () => {
    assert.equal(assumptionsSection('# Spec\n\n## Problem\n\nx\n'), null);
  });

  test('stops at the next level-2 heading and keeps level-3 content', () => {
    const lines = assumptionsSection(spec('- [ ] **A1** x\n\n### Detail\n\n- [ ] **A2** y'));
    const texts = lines.map((l) => l.text).filter((t) => t.trim());
    assert.deepEqual(texts, ['- [ ] **A1** x', '### Detail', '- [ ] **A2** y']);
  });

  test('ignores a heading inside a code fence', () => {
    const s = '## Problem\n\n```md\n## Assumptions\n- [ ] fake\n```\n';
    assert.equal(assumptionsSection(s), null);
  });

  test('strips multi-line HTML comments but keeps line numbers', () => {
    const s = spec('<!-- guidance\n- [ ] **A9** inside a comment\n-->\n- [ ] **A1** real');
    const lines = assumptionsSection(s);
    const real = lines.find((l) => l.text.includes('A1'));
    assert.ok(!lines.some((l) => l.text.includes('A9')));
    assert.equal(s.split('\n')[real.lineNo - 1], '- [ ] **A1** real');
  });
});

describe('parseItem', () => {
  test('reads label, tick and verdict', () => {
    const it = parseItem(
      '- [x] **A2** Cache is per-tenant — impact if wrong: leak — confirmed: redis.ts:41 keys by tenant_id'
    );
    assert.equal(it.checked, true);
    assert.equal(it.label, 'A2');
    assert.equal(it.verdict, 'confirmed');
    assert.equal(it.evidence, 'redis.ts:41 keys by tenant_id');
  });

  test('the last verdict on the line wins', () => {
    const it = parseItem(
      '- [x] **A1** the flag is confirmed: on in prod — rejected: it is off; spec now gates on it'
    );
    assert.equal(it.verdict, 'rejected');
    assert.equal(it.evidence, 'it is off; spec now gates on it');
  });

  test('a claim containing the word is not a verdict by itself when unticked', () => {
    const it = parseItem('- [ ] **A1** the job is confirmed: idempotent');
    assert.equal(it.checked, false);
  });

  test('returns null for a non-checkbox line', () => {
    assert.equal(parseItem('- plain bullet'), null);
    assert.equal(parseItem('prose'), null);
  });
});

describe('checkAssumptions', () => {
  test('passes when every item has a verdict with evidence', () => {
    const r = checkAssumptions(
      spec(
        '- [x] **A1** a — impact if wrong: b — confirmed: dedup-service.ts:81 checks auto_close\n' +
          '- [x] **A2** c — impact if wrong: d — rejected: column is nullable; spec adds a null guard'
      )
    );
    assert.equal(r.applies, true);
    assert.deepEqual(r.findings, []);
    assert.equal(r.items.length, 2);
  });

  test('an unticked item is a finding (the agent-authored state)', () => {
    const r = checkAssumptions(spec('- [ ] **A1** a — impact if wrong: b'));
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0], /A1.*not reviewed/);
  });

  test('a tick without a verdict is a finding', () => {
    const r = checkAssumptions(spec('- [x] **A1** a — impact if wrong: b'));
    assert.match(r.findings[0], /without a verdict/);
  });

  test('a verdict with too little or placeholder evidence is a finding', () => {
    for (const ev of ['ok', 'yes', '<evidence>', 'x'.repeat(MIN_EVIDENCE_CHARS - 1)]) {
      const r = checkAssumptions(spec(`- [x] **A1** a — confirmed: ${ev}`));
      assert.equal(r.findings.length, 1, `evidence "${ev}" should not pass`);
      assert.match(r.findings[0], /needs evidence/);
    }
  });

  test('a bullet without a checkbox is a finding', () => {
    const r = checkAssumptions(
      spec(
        '- [x] **A1** a — confirmed: checked in routes/intelligence.ts\n- sneaky unboxed assumption'
      )
    );
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0], /without a checkbox/);
  });

  test('an empty section is a finding', () => {
    const r = checkAssumptions(spec('<!-- nothing yet -->'));
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0], /lists no items/);
  });

  test('acceptance-criteria checkboxes outside the section are ignored', () => {
    const r = checkAssumptions(
      spec('- [x] **A1** a — confirmed: read packages/backend/src/a.ts:10')
    );
    assert.deepEqual(r.findings, []);
  });

  test('a missing section fails only for a new spec', () => {
    const legacy = '# Spec: old\n\n## Problem\n\nx\n';
    assert.equal(checkAssumptions(legacy, { isNew: false }).applies, false);
    const fresh = checkAssumptions(legacy, { isNew: true });
    assert.equal(fresh.applies, true);
    assert.match(fresh.findings[0], /No "## Assumptions" section/);
  });

  test('the shipped template carries a well-formed placeholder item', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const template = readFileSync(join(here, '../../docs/specs/TEMPLATE.md'), 'utf8');
    const r = checkAssumptions(template);
    assert.equal(r.applies, true);
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].checked, false);
  });
});

describe('CLI', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = join(here, 'check-assumptions.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'check-assumptions-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (env) =>
    spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });

  test('exits 1 on an unreviewed spec', () => {
    const f = join(dir, '0001-a.md');
    writeFileSync(f, spec('- [ ] **A1** a — impact if wrong: b'));
    const r = run({ SPEC_FILE: f });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not reviewed/);
  });

  test('exits 0 on a reviewed spec', () => {
    const f = join(dir, '0002-b.md');
    writeFileSync(f, spec('- [x] **A1** a — confirmed: checked packages/backend/src/a.ts'));
    assert.equal(run({ SPEC_FILE: f }).status, 0);
  });

  test('legacy spec passes unless SPEC_IS_NEW=true', () => {
    const f = join(dir, '0003-c.md');
    writeFileSync(f, '# Spec: old\n\n## Problem\n\nx\n');
    assert.equal(run({ SPEC_FILE: f }).status, 0);
    assert.equal(run({ SPEC_FILE: f, SPEC_IS_NEW: 'true' }).status, 1);
  });

  test('skips TEMPLATE.md by name', () => {
    const f = join(dir, 'TEMPLATE.md');
    writeFileSync(f, spec('- [ ] **A1** placeholder'));
    assert.equal(run({ SPEC_FILE: f }).status, 0);
  });

  test('exits 1 when the spec cannot be read', () => {
    assert.equal(run({ SPEC_FILE: join(dir, 'missing.md') }).status, 1);
  });

  test('exits 1 without SPEC_FILE', () => {
    assert.equal(run({}).status, 1);
  });
});
