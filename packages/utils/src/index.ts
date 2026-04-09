/**
 * @bugspotter/utils
 * Shared utilities for BugSpotter SDK and backend
 */

export {
  type RedactionPattern,
  PII_PATTERNS,
  CREDENTIAL_PATTERNS,
  NETWORK_PATTERNS,
  ALL_REDACTION_PATTERNS,
  redactString,
  isSensitiveKey,
  getPatternsByCategory,
} from './redaction-patterns.js';
