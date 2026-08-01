// Tests for verify-spec-ownership.mjs's pure logic. Zero-dependency,
// run with `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAdrOwnership,
  extractDeclaredPaths,
  extractOutOfScopeText,
  checkOwnership,
} from './verify-spec-ownership.mjs';

const SAMPLE_ADR_INDEX = `
# Architecture Decision Records

| #                                                     | Decision                                                                   | Source repo(s)       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------- |
| [0001](0001-pnpm-typescript-monorepo.md)          | pnpm + TypeScript workspace monorepo                           | public         |
| [0003](0003-dual-licensing-fsl-and-mit.md)        | Dual licensing: FSL-1.1-Apache-2.0 platform, MIT SDK           | all            |
| [0007](0007-polyglot-python-intelligence-service.md)   | Polyglot: separate Python intelligence service over HTTP + circuit breaker | public, intelligence |
| [0015](0015-dual-capture-screenshot-and-replay.md)      | Dual capture: screenshot + rrweb session replay                   | sdk, extension         |
`;

describe('parseAdrOwnership', () => {
  test('collects foreign (non-public, non-all) repo tokens with their ADR numbers', () => {
    const result = parseAdrOwnership(SAMPLE_ADR_INDEX);
    assert.deepEqual([...result.get('intelligence')], ['0007']);
    assert.deepEqual([...result.get('sdk')], ['0015']);
    assert.deepEqual([...result.get('extension')], ['0015']);
  });

  test('excludes public and all tokens', () => {
    const result = parseAdrOwnership(SAMPLE_ADR_INDEX);
    assert.equal(result.has('public'), false);
    assert.equal(result.has('all'), false);
  });

  test('empty index yields an empty map', () => {
    assert.equal(parseAdrOwnership('no table here').size, 0);
  });
});

describe('extractDeclaredPaths', () => {
  test('extracts backtick-quoted paths from the Files touched line', () => {
    const spec = '**Files touched:** `packages/a/b.ts`, `packages/c/d.ts`\n**Blocking:** none';
    assert.deepEqual(extractDeclaredPaths(spec), ['packages/a/b.ts', 'packages/c/d.ts']);
  });

  test('returns null when there is no Files touched line', () => {
    assert.equal(extractDeclaredPaths('# Spec: no such field here'), null);
  });

  test('returns an empty array when the line has no backtick paths', () => {
    assert.deepEqual(extractDeclaredPaths('**Files touched:** none yet'), []);
  });
});

describe('extractOutOfScopeText', () => {
  test('extracts and lowercases the Out of scope section body', () => {
    const spec =
      '## Out of scope\n\n- The external `bugspotter-intelligence` Python SERVICE\n\n## Constraints\nx';
    assert.match(
      extractOutOfScopeText(spec),
      /the external `bugspotter-intelligence` python service/
    );
  });

  test('returns empty string when there is no Out of scope section', () => {
    assert.equal(extractOutOfScopeText('# Spec: no such section'), '');
  });
});

describe('checkOwnership', () => {
  const foreignTokens = new Map([
    ['intelligence', new Set(['0007'])],
    ['sdk', new Set(['0015'])],
  ]);
  const noPathsExist = () => false;

  test('flags a new top-level package colliding with a foreign-repo token', () => {
    const violations = checkOwnership(
      ['packages/bugspotter-intelligence/src/routes/bugs/similar.ts'],
      foreignTokens,
      '',
      noPathsExist
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].token, 'intelligence');
    assert.deepEqual(violations[0].adrNums, ['0007']);
  });

  test('does not flag a path whose package root already exists', () => {
    const violations = checkOwnership(
      ['packages/bugspotter-intelligence/src/routes/bugs/similar.ts'],
      foreignTokens,
      '',
      (p) => p === 'packages/bugspotter-intelligence'
    );
    assert.equal(violations.length, 0);
  });

  test('does not flag a path explicitly disclaimed in Out of scope', () => {
    const violations = checkOwnership(
      ['packages/bugspotter-intelligence/src/routes/bugs/similar.ts'],
      foreignTokens,
      'the external `bugspotter-intelligence` python service is out of scope',
      noPathsExist
    );
    assert.equal(violations.length, 0);
  });

  test('does not flag a legitimate nested path that merely mentions the token', () => {
    // packages/backend/src/services/intelligence/intelligence-client.ts —
    // the first segment after packages/ is "backend", an existing real
    // package, not a new "intelligence"-named top-level package.
    const violations = checkOwnership(
      ['packages/backend/src/services/intelligence/intelligence-client.ts'],
      foreignTokens,
      '',
      (p) => p === 'packages/backend'
    );
    assert.equal(violations.length, 0);
  });

  test('does not flag paths with no packages/ or apps/ root', () => {
    const violations = checkOwnership(['docs/specs/0001-foo.md'], foreignTokens, '', noPathsExist);
    assert.equal(violations.length, 0);
  });

  test('flags multiple declared paths independently', () => {
    const violations = checkOwnership(
      [
        'packages/bugspotter-intelligence/package.json',
        'packages/bugspotter-intelligence/src/x.ts',
        'packages/backend/src/x.ts',
      ],
      foreignTokens,
      '',
      (p) => p === 'packages/backend'
    );
    assert.equal(violations.length, 2);
  });
});
