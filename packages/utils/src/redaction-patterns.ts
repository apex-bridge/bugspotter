/**
 * Shared Redaction Patterns
 * Used by both SDK (browser) and backend (Node.js) for consistent PII/credential redaction
 */

export interface RedactionPattern {
  /** Regular expression for matching sensitive data */
  pattern: RegExp;
  /** Replacement string (e.g., '[REDACTED]', 'Bearer [REDACTED]') */
  replacement: string;
  /** Pattern category */
  category: 'pii' | 'credential' | 'network';
  /** Human-readable description */
  description: string;
}

/**
 * Standard redaction patterns for PII (Personally Identifiable Information)
 */
export const PII_PATTERNS: RedactionPattern[] = [
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    replacement: '[REDACTED-EMAIL]',
    category: 'pii',
    description: 'Email addresses',
  },
  {
    pattern: /\+\d{1,3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: '[REDACTED-PHONE]',
    category: 'pii',
    description: 'International phone numbers (short format)',
  },
  {
    pattern: /\+\d{1,3}[-.\s]\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: '[REDACTED-PHONE]',
    category: 'pii',
    description: 'International phone numbers (long format)',
  },
  {
    pattern: /\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b/g,
    replacement: '[REDACTED-PHONE]',
    category: 'pii',
    description: 'US phone numbers with parentheses',
  },
  {
    pattern: /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: '[REDACTED-PHONE]',
    category: 'pii',
    description: 'US phone numbers',
  },
  {
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: '[REDACTED-CREDITCARD]',
    category: 'pii',
    description: 'Credit card numbers (Visa, MC, Discover)',
  },
  {
    pattern: /\b\d{4}[-\s]\d{6}[-\s]\d{5}\b/g,
    replacement: '[REDACTED-CREDITCARD]',
    category: 'pii',
    description: 'Credit card numbers (Amex)',
  },
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[REDACTED-SSN]',
    category: 'pii',
    description: 'US Social Security Numbers',
  },
  {
    pattern: /\b[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])\d{6}\b/g,
    replacement: '[REDACTED-IIN]',
    category: 'pii',
    description: 'Kazakhstan IIN/BIN numbers',
  },
];

/**
 * Standard redaction patterns for credentials (API keys, tokens, passwords)
 */
export const CREDENTIAL_PATTERNS: RedactionPattern[] = [
  {
    pattern: /\b(?:Bearer\s+)?[a-zA-Z0-9_-]{32,}\b/gi,
    replacement: 'Bearer [REDACTED]',
    category: 'credential',
    description: 'Bearer tokens and long tokens',
  },
  {
    pattern: /\b(?:sk|pk)_(?:live|test)_[a-zA-Z0-9]{24,}\b/gi,
    replacement: 'api_key=[REDACTED]',
    category: 'credential',
    description: 'Stripe API keys',
  },
  {
    pattern: /AKIA[0-9A-Z]{16}\b/g,
    replacement: 'AKIA[REDACTED]',
    category: 'credential',
    description: 'AWS access keys',
  },
  {
    pattern: /AIza[a-zA-Z0-9_-]{35}/g,
    replacement: 'api_key=[REDACTED]',
    category: 'credential',
    description: 'Google API keys',
  },
  {
    pattern: /api[_-]?key[=:]\s*['"]?[A-Za-z0-9_-]{20,}['"]?/gi,
    replacement: 'api_key=[REDACTED]',
    category: 'credential',
    description: 'Generic API keys',
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    replacement: 'token=[REDACTED]',
    category: 'credential',
    description: 'GitHub personal access tokens',
  },
  {
    pattern: /gho_[a-zA-Z0-9]{36}/g,
    replacement: 'token=[REDACTED]',
    category: 'credential',
    description: 'GitHub OAuth tokens',
  },
  {
    pattern: /github_pat_[a-zA-Z0-9_]{82}/g,
    replacement: 'token=[REDACTED]',
    category: 'credential',
    description: 'GitHub fine-grained tokens',
  },
  {
    pattern: /token[=:]\s*['"]?[A-Za-z0-9._-]{20,}['"]?/gi,
    replacement: 'token=[REDACTED]',
    category: 'credential',
    description: 'Generic tokens',
  },
  {
    pattern: /(?:password|passwd|pwd)[\s:=]+[^\s]{6,}/gi,
    replacement: 'password=[REDACTED]',
    category: 'credential',
    description: 'Passwords (simple format)',
  },
  {
    pattern: /(?:password|passwd|pwd)["']?\s*[:=]\s*["']?[^\s"']{6,}/gi,
    replacement: 'password=[REDACTED]',
    category: 'credential',
    description: 'Passwords (quoted format)',
  },
  {
    pattern: /Authorization:\s*['"]?[A-Za-z0-9._-]+['"]?/gi,
    replacement: 'Authorization: [REDACTED]',
    category: 'credential',
    description: 'Authorization headers',
  },
  {
    pattern:
      /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi,
    replacement: '[PRIVATE_KEY_REDACTED]',
    category: 'credential',
    description: 'Private keys (PEM format)',
  },
];

/**
 * Standard redaction patterns for network identifiers
 */
export const NETWORK_PATTERNS: RedactionPattern[] = [
  {
    pattern:
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    replacement: '[REDACTED-IP]',
    category: 'network',
    description: 'IPv4 addresses',
  },
  {
    pattern: /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    replacement: '[REDACTED-IP]',
    category: 'network',
    description: 'IPv6 addresses',
  },
];

/**
 * All standard redaction patterns combined
 */
export const ALL_REDACTION_PATTERNS: RedactionPattern[] = [
  ...CREDENTIAL_PATTERNS, // Check credentials first (more specific)
  ...PII_PATTERNS,
  ...NETWORK_PATTERNS,
];

/**
 * Redact sensitive data from a string using provided patterns
 */
export function redactString(
  text: string,
  patterns: RedactionPattern[] = ALL_REDACTION_PATTERNS
): string {
  let redacted = text;

  for (const { pattern, replacement } of patterns) {
    redacted = redacted.replace(pattern, replacement);
  }

  return redacted;
}

/**
 * Check if a key name suggests sensitive data
 * Uses exact matches and specific compound terms to avoid false positives
 */
export function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();

  // Exact matches for single-word sensitive keys
  const exactMatches = [
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'apikey',
    'api_key',
    'authorization',
    'auth',
    'cookie',
    'session',
    'csrf',
    'xsrf',
  ];

  if (exactMatches.includes(lowerKey)) {
    return true;
  }

  // Compound terms that must include these specific patterns
  const compoundPatterns = [
    'private_key',
    'privatekey',
    'secret_key',
    'secretkey',
    'access_key',
    'accesskey',
    'api_key',
    'apikey',
    'auth_key',
    'authkey',
    'session_key',
    'sessionkey',
    'encryption_key',
    'encryptionkey',
  ];

  return compoundPatterns.some((pattern) => lowerKey.includes(pattern));
}

/**
 * Get patterns by category
 */
export function getPatternsByCategory(
  category: 'pii' | 'credential' | 'network'
): RedactionPattern[] {
  return ALL_REDACTION_PATTERNS.filter((p) => p.category === category);
}
