import { describe, it, expect } from 'vitest';
import * as utils from './index.js';

describe('index exports', () => {
  it('should export all redaction pattern types and functions', () => {
    // Types (can't test directly, but ensure functions exist)
    expect(utils.PII_PATTERNS).toBeDefined();
    expect(utils.CREDENTIAL_PATTERNS).toBeDefined();
    expect(utils.NETWORK_PATTERNS).toBeDefined();
    expect(utils.ALL_REDACTION_PATTERNS).toBeDefined();

    // Functions
    expect(typeof utils.redactString).toBe('function');
    expect(typeof utils.isSensitiveKey).toBe('function');
    expect(typeof utils.getPatternsByCategory).toBe('function');
  });

  it('should have correct pattern array lengths', () => {
    expect(Array.isArray(utils.PII_PATTERNS)).toBe(true);
    expect(Array.isArray(utils.CREDENTIAL_PATTERNS)).toBe(true);
    expect(Array.isArray(utils.NETWORK_PATTERNS)).toBe(true);
    expect(Array.isArray(utils.ALL_REDACTION_PATTERNS)).toBe(true);

    expect(utils.PII_PATTERNS.length).toBeGreaterThan(0);
    expect(utils.CREDENTIAL_PATTERNS.length).toBeGreaterThan(0);
    expect(utils.NETWORK_PATTERNS.length).toBeGreaterThan(0);

    // ALL should be sum of all categories
    const totalPatterns =
      utils.PII_PATTERNS.length + utils.CREDENTIAL_PATTERNS.length + utils.NETWORK_PATTERNS.length;
    expect(utils.ALL_REDACTION_PATTERNS.length).toBe(totalPatterns);
  });
});
