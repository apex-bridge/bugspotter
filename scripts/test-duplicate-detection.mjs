#!/usr/bin/env node
import { findDuplicateKeys } from './shared/duplicate-key-detector.mjs';

/**
 * Test the duplicate key detection logic with edge cases
 * This verifies that character-by-character processing handles compact JSON correctly
 */

// Test cases
const testCases = [
  {
    name: 'Compact JSON with key and braces on same line',
    json: '{"parent": { "key": "value" }}',
    expected: 0
  },
  {
    name: 'Duplicate keys on same line',
    json: '{"key": "v1", "key": "v2"}',
    expected: 1
  },
  {
    name: 'Nested compact with duplicate',
    json: '{"outer": { "inner": "v1", "inner": "v2" }}',
    expected: 1
  },
  {
    name: 'Prettified JSON (no duplicates)',
    json: `{
  "parent": {
    "key1": "value1",
    "key2": "value2"
  }
}`,
    expected: 0
  },
  {
    name: 'Prettified JSON with duplicate',
    json: `{
  "parent": {
    "key": "value1",
    "key": "value2"
  }
}`,
    expected: 1
  },
  {
    name: 'Multiple braces on one line with key',
    json: '{ "key": { "nested": "value" } }',
    expected: 0
  },
  {
    name: 'Opening and closing brace with duplicate',
    json: '{ "key": "v1", "key": "v2" }',
    expected: 1
  },
  {
    name: 'Escaped quotes in key name (no duplicate)',
    json: '{"key with \\"quotes\\"": "v1", "different": "v2"}',
    expected: 0
  },
  {
    name: 'Escaped quotes with duplicate',
    json: '{"key\\"test": "v1", "key\\"test": "v2"}',
    expected: 1
  },
  {
    name: 'Whitespace before colon',
    json: '{"key" : "v1", "key" : "v2"}',
    expected: 1
  },
  {
    name: 'Empty string keys (duplicate)',
    json: '{"": "v1", "": "v2"}',
    expected: 1
  },
  {
    name: 'Mixed escape sequences',
    json: '{"path\\\\to\\\\file": "v1", "normal": "v2"}',
    expected: 0
  }
];

console.log('🧪 Testing duplicate key detection with edge cases...\n');

let passed = 0;
let failed = 0;

testCases.forEach(tc => {
  const result = findDuplicateKeys(tc.json, 'test');
  const success = result.length === tc.expected;
  
  if (success) {
    passed++;
    console.log(`✅ ${tc.name}`);
    console.log(`   Expected ${tc.expected} duplicate(s), found ${result.length}`);
  } else {
    failed++;
    console.log(`❌ ${tc.name}`);
    console.log(`   Expected ${tc.expected} duplicate(s), found ${result.length}`);
    if (result.length > 0) {
      console.log(`   Duplicates: ${result.map(d => `"${d.key}" at line ${d.line}`).join(', ')}`);
    }
  }
  console.log();
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
