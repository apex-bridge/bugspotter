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

  test('extracts every path from a multiline bulleted list (real spec shape)', () => {
    // Matches how generate-spec.mjs and every real ratified spec (e.g.
    // docs/specs/0238-*.md) actually format this field — a bulleted list on
    // the lines FOLLOWING the label, not inline with it. A regression here
    // silently drops every declared path but the first, which is exactly
    // the #238 shape this whole check exists to catch.
    const spec = [
      '**Files touched:**',
      '',
      '- `packages/a/one.ts` (new)',
      '- `packages/a/two.ts`',
      '- `packages/a/three.ts` (new)',
      '',
      '**Blocking prerequisites:** none',
      '',
      '## Problem',
    ].join('\n');
    assert.deepEqual(extractDeclaredPaths(spec), [
      'packages/a/one.ts',
      'packages/a/two.ts',
      'packages/a/three.ts',
    ]);
  });

  test('terminates the block at end of string when Files touched is the last field', () => {
    const spec = '**Files touched:**\n\n- `packages/a/one.ts`';
    assert.deepEqual(extractDeclaredPaths(spec), ['packages/a/one.ts']);
  });

  test('ignores backtick terms in a trailing description and in prose after the list', () => {
    // Real shape from docs/specs/0297-*.md: each bullet's path is followed
    // by " — <prose with its own `backtick` terms>", and the whole list is
    // followed by a scope-explanation paragraph before the next `**` field
    // - both used to leak into the result (19 "paths" instead of 5), because
    // the old regex only knew to stop at the next heading, not at the end
    // of the list itself.
    const spec = [
      '**Files touched:**',
      '',
      '- `packages/a/one.ts`',
      '- `packages/a/two.ts` — `IJobHandle` has no `moveToDelayed` member today; add one.',
      '',
      'The scope grew beyond the original file: `job` is typed `IJobHandle<Data, Result>`,',
      'not the raw `Job`, and it exposes only `id`, `name`, `log()`.',
      '',
      '**Blocking prerequisites:** none',
    ].join('\n');
    assert.deepEqual(extractDeclaredPaths(spec), ['packages/a/one.ts', 'packages/a/two.ts']);
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

  test('extracts the section when it is the last thing in the file with no trailing newline', () => {
    // Ownership check runs BEFORE the "Format generated files" (prettier)
    // step in spec-agent.yml, so freshly-generated content isn't guaranteed
    // to end with a newline yet. A missing match here silently drops a
    // deliberate disclaimer and fails the build on a false positive.
    const spec = '## Out of scope\n\n- The external `bugspotter-intelligence` python service';
    assert.match(
      extractOutOfScopeText(spec),
      /the external `bugspotter-intelligence` python service/
    );
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

  test('checks the apps/ root the same way as packages/', () => {
    const violations = checkOwnership(
      ['apps/bugspotter-sdk/src/index.ts'],
      new Map([['sdk', new Set(['0015'])]]),
      '',
      noPathsExist
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].token, 'sdk');
  });

  test('does not flag a short legitimate component that is merely a substring of a foreign token', () => {
    // "ext" is a real, unrelated component name; "extension" is a foreign
    // token (ADR-0015, the Chrome extension repo). Bidirectional substring
    // matching (`token.includes(component)`) used to flag this as a
    // violation purely because "extension".includes("ext") is true.
    const violations = checkOwnership(
      ['packages/ext/src/index.ts'],
      new Map([['extension', new Set(['0015'])]]),
      '',
      noPathsExist
    );
    assert.equal(violations.length, 0);
  });

  test('still flags a hyphenated variant of a foreign token', () => {
    const violations = checkOwnership(
      ['packages/intelligence-client/src/index.ts'],
      foreignTokens,
      '',
      noPathsExist
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].token, 'intelligence');
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
