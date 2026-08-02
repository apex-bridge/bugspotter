// Tests for check-impl-scope.mjs's pure logic. Zero-dependency, run with
// `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findUndeclaredPaths, findUnwrittenPaths } from './check-impl-scope.mjs';

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

  test('a declared path never written is not flagged by THIS function', () => {
    // findUndeclaredPaths only checks the write-side. The declared-but-not-
    // written direction is findUnwrittenPaths's job (see below) - this test
    // pins the split in responsibility, not an "it's fine" verdict.
    const declared = ['packages/a.ts', 'packages/never-written.ts'];
    assert.deepEqual(findUndeclaredPaths(['packages/a.ts'], declared), []);
  });

  test('empty written list is always clean', () => {
    assert.deepEqual(findUndeclaredPaths([], ['packages/a.ts']), []);
  });
});

describe('findUnwrittenPaths', () => {
  test('returns an empty array when every declared path was written', () => {
    const declared = ['packages/a.ts', 'packages/b.ts'];
    assert.deepEqual(findUnwrittenPaths(['packages/a.ts', 'packages/b.ts'], declared), []);
  });

  test('flags a declared path the scaffold never wrote', () => {
    // The exact #237 shape: spec declared 4 files, scaffold wrote 3,
    // silently skipping the worker test suite.
    const declared = [
      'packages/backend/src/api/routes/intelligence.ts',
      'packages/backend/src/queue/workers/intelligence-worker.ts',
      'packages/backend/tests/api/intelligence-routes.test.ts',
      'packages/backend/tests/queue/intelligence-worker.test.ts',
    ];
    const written = declared.slice(0, 3);
    assert.deepEqual(findUnwrittenPaths(written, declared), [
      'packages/backend/tests/queue/intelligence-worker.test.ts',
    ]);
  });

  test('flags multiple unwritten paths independently', () => {
    const declared = ['packages/a.ts', 'packages/b.ts', 'packages/c.ts'];
    assert.deepEqual(findUnwrittenPaths(['packages/b.ts'], declared), [
      'packages/a.ts',
      'packages/c.ts',
    ]);
  });

  test('an extra written path is not flagged by THIS function', () => {
    // Mirror of the split above: over-delivery is findUndeclaredPaths's job.
    const declared = ['packages/a.ts'];
    assert.deepEqual(findUnwrittenPaths(['packages/a.ts', 'packages/extra.ts'], declared), []);
  });

  test('empty written list flags every declared path', () => {
    // Note main() short-circuits on an empty FILES_WRITTEN before reaching
    // here, so this is the pure-function contract, not the CLI's behavior.
    assert.deepEqual(findUnwrittenPaths([], ['packages/a.ts', 'packages/b.ts']), [
      'packages/a.ts',
      'packages/b.ts',
    ]);
  });
});
