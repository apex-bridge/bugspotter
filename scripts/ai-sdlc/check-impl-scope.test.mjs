// Tests for check-impl-scope.mjs's pure logic. Zero-dependency, run with
// `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findUndeclaredPaths } from './check-impl-scope.mjs';

describe('findUndeclaredPaths', () => {
  test('returns an empty array when every written path was declared', () => {
    const declared = ['packages/a.ts', 'packages/b.ts'];
    assert.deepEqual(findUndeclaredPaths(['packages/a.ts', 'packages/b.ts'], declared), []);
  });

  test('flags a written path absent from the declared list', () => {
    const declared = ['packages/a.ts'];
    assert.deepEqual(findUndeclaredPaths(['packages/a.ts', 'packages/sneaky.ts'], declared), [
      'packages/sneaky.ts',
    ]);
  });

  test('flags multiple undeclared paths independently', () => {
    const declared = ['packages/a.ts'];
    const written = ['packages/a.ts', 'packages/x.ts', 'packages/y.ts'];
    assert.deepEqual(findUndeclaredPaths(written, declared), ['packages/x.ts', 'packages/y.ts']);
  });

  test('a declared path never written is not itself a violation', () => {
    // findUndeclaredPaths only checks the write-side; a spec declaring a
    // file that ends up unwritten is a different (unhandled) concern.
    const declared = ['packages/a.ts', 'packages/never-written.ts'];
    assert.deepEqual(findUndeclaredPaths(['packages/a.ts'], declared), []);
  });

  test('empty written list is always clean', () => {
    assert.deepEqual(findUndeclaredPaths([], ['packages/a.ts']), []);
  });
});
