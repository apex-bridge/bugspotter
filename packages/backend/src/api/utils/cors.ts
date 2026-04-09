/**
 * CORS Utility Functions
 * Converts wildcard origin patterns to RegExp for @fastify/cors
 */

/**
 * Convert CORS origin patterns to format accepted by @fastify/cors
 *
 * Supports:
 * - Exact match strings: "https://example.com"
 * - Subdomain wildcards: "https://*.example.com" → /^https:\/\/[^.]+\.example\.com$/
 * - Port wildcards: "https://example.com:*" → /^https:\/\/example\.com:\d+$/
 * - IPv6 addresses: "http://[::1]:8080"
 *
 * @param origins - Array of origin patterns (strings with optional wildcards)
 * @returns Array of strings and RegExp patterns for @fastify/cors
 *
 * @example
 * ```typescript
 * convertCorsOriginsToRegex(['https://demo.bugspotter.io', 'https://*.demo.bugspotter.io'])
 * // => ['https://demo.bugspotter.io', /^https:\/\/[^.]+\.demo\.bugspotter\.io$/]
 *
 * convertCorsOriginsToRegex(['http://[::1]:*'])
 * // => [/^http:\/\/\[::1\]:\d+$/]
 * ```
 */
export function convertCorsOriginsToRegex(origins: string[]): (string | RegExp)[] {
  return origins
    .filter((pattern) => pattern.trim() !== '') // Filter out empty strings
    .map((pattern) => {
      // Wildcard-only patterns are security risks - reject them
      if (pattern === '*') {
        throw new Error('Wildcard-only CORS pattern (*) is not allowed for security reasons');
      }

      // If no wildcard, return as exact match string
      if (!pattern.includes('*')) {
        return pattern;
      }

      // Convert wildcard pattern to RegExp
      // Escape special regex characters first (but NOT the wildcard * we want to process)
      let regexPattern = pattern.replace(/[\\.$^()|[\]{}+?]/g, '\\$&');

      // Handle port wildcard (e.g., https://example.com:* or https://*.example.com:*)
      // Check for :* BEFORE it gets replaced by the general wildcard handler
      // Replace :* with :\d+ to match numeric ports only
      if (regexPattern.includes(':*')) {
        regexPattern = regexPattern.replace(/:\*/g, ':\\d+');
      }

      // Handle subdomain/hostname wildcard (e.g., https://*.example.com)
      // Use restrictive character class for valid hostname characters (RFC 1123)
      // Allows: alphanumeric, hyphen, but NOT dots (prevents subdomain traversal)
      // This must be done AFTER port wildcard to avoid replacing the \d+ pattern
      if (regexPattern.includes('*')) {
        regexPattern = regexPattern.replace(/\*/g, '[a-zA-Z0-9-]+');
      }

      return new RegExp(`^${regexPattern}$`);
    });
}
