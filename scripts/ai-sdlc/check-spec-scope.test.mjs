// Tests for check-spec-scope.mjs's pure logic. Zero-dependency, run with
// `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkFanOut, DEFAULT_CAP } from './check-spec-scope.mjs';

describe('checkFanOut', () => {
  test('returns null when the count is at or below the cap', () => {
    const paths = Array.from({ length: DEFAULT_CAP }, (_, i) => `packages/a/${i}.ts`);
    assert.equal(checkFanOut(paths), null);
  });

  test('returns a warning string when the count exceeds the cap', () => {
    const paths = Array.from({ length: DEFAULT_CAP + 1 }, (_, i) => `packages/a/${i}.ts`);
    const warning = checkFanOut(paths);
    assert.ok(warning);
    assert.match(warning, /declares 7 files touched/);
  });

  test('respects a custom cap', () => {
    const paths = ['a', 'b', 'c'];
    assert.equal(checkFanOut(paths, 3), null);
    assert.ok(checkFanOut(paths, 2));
  });

  test('empty list never warns', () => {
    assert.equal(checkFanOut([]), null);
  });
});
