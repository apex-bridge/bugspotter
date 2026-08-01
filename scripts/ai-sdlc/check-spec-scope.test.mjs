// Tests for check-spec-scope.mjs's pure logic. Zero-dependency, run with
// `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkFanOut, resolveCap, DEFAULT_CAP } from './check-spec-scope.mjs';

describe('resolveCap', () => {
  test('parses a valid numeric string', () => {
    assert.equal(resolveCap('10'), 10);
  });

  test('falls back to DEFAULT_CAP when unset', () => {
    assert.equal(resolveCap(undefined), DEFAULT_CAP);
    assert.equal(resolveCap(''), DEFAULT_CAP);
  });

  test('falls back to DEFAULT_CAP for a whitespace-only value', () => {
    // Number('   ') is 0, not NaN — a naive check would silently turn a
    // whitespace-only SPEC_SCOPE_CAP into a zero-file cap instead of
    // treating it as unset.
    assert.equal(resolveCap('   '), DEFAULT_CAP);
    assert.equal(resolveCap('\t\n'), DEFAULT_CAP);
  });

  test('falls back to DEFAULT_CAP for non-numeric input', () => {
    assert.equal(resolveCap('abc'), DEFAULT_CAP);
  });

  test('falls back to DEFAULT_CAP for a negative or fractional value', () => {
    assert.equal(resolveCap('-1'), DEFAULT_CAP);
    assert.equal(resolveCap('2.5'), DEFAULT_CAP);
  });

  test('zero is a valid cap', () => {
    assert.equal(resolveCap('0'), 0);
  });
});

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
