/**
 * SSRF (Server-Side Request Forgery) Protection
 *
 * Comprehensive validation to prevent plugins from accessing:
 * - Private IPv4 ranges (RFC 1918, RFC 6598, loopback, link-local)
 * - Private IPv6 ranges (loopback, unique local, link-local)
 * - Cloud metadata endpoints (AWS, GCP, Azure, DigitalOcean)
 * - Special-use addresses (multicast, reserved, documentation)
 */

import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * IPv4 private and reserved ranges
 * Sources: RFC 1918, RFC 3927, RFC 5735, RFC 6598
 */
const BLOCKED_IPV4_RANGES = [
  // Loopback (127.0.0.0/8)
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255], name: 'loopback' },

  // Private networks (RFC 1918)
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255], name: 'private-10' },
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255], name: 'private-172.16' },
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255], name: 'private-192.168' },

  // Link-local (RFC 3927) - includes cloud metadata
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255], name: 'link-local' },

  // Carrier-grade NAT (RFC 6598)
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255], name: 'cgnat' },

  // This network (RFC 1122)
  { start: [0, 0, 0, 0], end: [0, 255, 255, 255], name: 'this-network' },

  // Broadcast
  { start: [255, 255, 255, 255], end: [255, 255, 255, 255], name: 'broadcast' },

  // Multicast (RFC 5771)
  { start: [224, 0, 0, 0], end: [239, 255, 255, 255], name: 'multicast' },

  // Reserved for future use (RFC 1112)
  { start: [240, 0, 0, 0], end: [255, 255, 255, 254], name: 'reserved' },
];

/**
 * IPv6 private and reserved ranges
 * Sources: RFC 4193, RFC 4291, RFC 3879
 * Note: URL parser KEEPS brackets in hostname, so we must match them
 */
const BLOCKED_IPV6_PATTERNS = [
  // Loopback (::1 in normalized form: 0000:0000:0000:0000:0000:0000:0000:0001)
  { pattern: /^0{4}:0{4}:0{4}:0{4}:0{4}:0{4}:0{4}:0{0,3}1$/i, name: 'loopback' },

  // Unique Local Addresses (fc00::/7) - patterns test normalized form
  { pattern: /^f[cd][0-9a-f]{2}:/i, name: 'unique-local' },

  // Link-local (fe80::/10)
  { pattern: /^fe[89ab][0-9a-f]:/i, name: 'link-local' },

  // IPv4-mapped IPv6 (::ffff:0:0/96) - checked separately with recursion
  { pattern: /^0{4}:0{4}:0{4}:0{4}:0{4}:ffff:/i, name: 'ipv4-mapped' },

  // Multicast (ff00::/8)
  { pattern: /^ff[0-9a-f]{2}:/i, name: 'multicast' },
];

/**
 * Blocked hostnames (exact match, case-insensitive)
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  'ip6-localhost',
  'ip6-loopback',

  // Alternative localhost names
  'localhost.localdomain',
  'broadcasthost',

  // AWS metadata endpoints
  'metadata',
  'metadata.google.internal',
  'instance-data',
];

/**
 * Cloud metadata IPs (most critical SSRF targets)
 */
const CLOUD_METADATA_IPS = [
  '169.254.169.254', // AWS, GCP, Azure, DigitalOcean
  '169.254.170.2', // AWS ECS container metadata
  'fd00:ec2::254', // AWS EC2 IPv6 metadata
];

/**
 * Parse IPv4 address into octets
 * SECURITY: Only accepts standard dotted-decimal notation to prevent bypass via
 * alternative formats (octal, hex, decimal, mixed) that URL parsers normalize
 */
function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    // Reject alternative number formats that could bypass SSRF filters:
    // - Octal notation: 0177 (leading zero)
    // - Hex notation: 0x7f, 0X7F
    // - Empty parts
    if (part === '' || part.startsWith('0x') || part.startsWith('0X') || /^0\d/.test(part)) {
      return null;
    }

    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255) {
      return null;
    }
    octets.push(octet);
  }

  return octets;
}

/**
 * Check if IPv4 address is in blocked range
 * Converts octets to 32-bit unsigned integer for simple numeric comparison
 * SECURITY: Uses >>> 0 to convert to unsigned (prevents negative values for IPs >= 128.0.0.0)
 */
function isIPv4InRange(
  octets: number[],
  range: { start: number[]; end: number[]; name: string }
): boolean {
  // Convert to unsigned 32-bit integer to handle IPs in 128.0.0.0–255.255.255.255 range
  // Without >>> 0, bitwise OR produces signed int (e.g., 255.255.255.255 → -1)
  const ipNum = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const startNum =
    ((range.start[0] << 24) | (range.start[1] << 16) | (range.start[2] << 8) | range.start[3]) >>>
    0;
  const endNum =
    ((range.end[0] << 24) | (range.end[1] << 16) | (range.end[2] << 8) | range.end[3]) >>> 0;

  return ipNum >= startNum && ipNum <= endNum;
}

/**
 * Normalize IPv6 address for comparison
 * Note: URL parser keeps brackets, so we remove them before normalization
 */
function normalizeIPv6(ip: string): string {
  // Remove brackets
  ip = ip.replace(/^\[|\]$/g, '');
  // Handle :: shorthand notation
  if (ip.includes('::')) {
    const parts = ip.split('::');
    const left = parts[0] ? parts[0].split(':').filter((p) => p) : [];
    const right = parts[1] ? parts[1].split(':').filter((p) => p) : [];
    const missing = 8 - left.length - right.length;
    const zeros = new Array(missing).fill('0000');
    const segments = [...left, ...zeros, ...right];

    // Pad each segment to 4 digits
    return segments
      .map((seg) => seg.padStart(4, '0'))
      .join(':')
      .toLowerCase();
  }

  // Already expanded, just pad segments
  const segments = ip.split(':').map((seg) => seg.padStart(4, '0'));
  return segments.join(':').toLowerCase();
}

/**
 * Check if hostname is an IPv4 address in private/reserved range
 */
function isBlockedIPv4(hostname: string): { blocked: boolean; reason?: string } {
  const octets = parseIPv4(hostname);
  if (!octets) {
    return { blocked: false };
  }

  for (const range of BLOCKED_IPV4_RANGES) {
    if (isIPv4InRange(octets, range)) {
      return {
        blocked: true,
        reason: `IPv4 ${range.name} range (${range.start.join('.')}-${range.end.join('.')})`,
      };
    }
  }

  return { blocked: false };
}

/**
 * Check if hostname is an IPv6 address in private/reserved range
 */
function isBlockedIPv6(hostname: string): { blocked: boolean; reason?: string } {
  // Check if it looks like IPv6
  if (!hostname.includes(':')) {
    return { blocked: false };
  }

  try {
    const normalized = normalizeIPv6(hostname);

    for (const { pattern, name } of BLOCKED_IPV6_PATTERNS) {
      if (pattern.test(normalized)) {
        return { blocked: true, reason: `IPv6 ${name} range` };
      }
    }

    // Check for IPv4-mapped addresses that map to blocked IPv4
    // Pattern 1: Hex notation (::ffff:7f00:0001)
    const ipv4MatchHex = normalized.match(
      /^0{4}:0{4}:0{4}:0{4}:0{4}:ffff:([0-9a-f]{4}):([0-9a-f]{4})$/i
    );
    if (ipv4MatchHex) {
      const octet1 = parseInt(ipv4MatchHex[1].substring(0, 2), 16);
      const octet2 = parseInt(ipv4MatchHex[1].substring(2, 4), 16);
      const octet3 = parseInt(ipv4MatchHex[2].substring(0, 2), 16);
      const octet4 = parseInt(ipv4MatchHex[2].substring(2, 4), 16);
      const ipv4 = `${octet1}.${octet2}.${octet3}.${octet4}`;

      const ipv4Check = isBlockedIPv4(ipv4);
      if (ipv4Check.blocked) {
        return { blocked: true, reason: `IPv4-mapped IPv6 (${ipv4}: ${ipv4Check.reason})` };
      }
    }

    // Pattern 2: Dotted-decimal notation (::ffff:127.0.0.1) - RFC 5952 allows this
    // Node's URL parser preserves this format instead of converting to hex
    const ipv4MatchDotted = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4MatchDotted) {
      const ipv4 = ipv4MatchDotted[1];
      const ipv4Check = isBlockedIPv4(ipv4);
      if (ipv4Check.blocked) {
        return { blocked: true, reason: `IPv4-mapped IPv6 (${ipv4}: ${ipv4Check.reason})` };
      }
    }
  } catch {
    // If parsing fails, allow (will fail at DNS resolution)
    return { blocked: false };
  }

  return { blocked: false };
}

/**
 * Detect alternative IPv4 encodings that URL parsers normalize
 * SECURITY: Prevents bypassing SSRF filters via non-standard IP formats
 *
 * Detects:
 * - Octal notation: http://0177.0.0.1 → 127.0.0.1
 * - Hex notation: http://0x7f.0.0.1 → 127.0.0.1
 * - Decimal notation: http://2130706433 → 127.0.0.1
 * - Mixed formats: http://127.0.0x1 → 127.0.0.1
 * - Leading zeros: http://0127.0.0.1 → 127.0.0.1
 */
function containsAlternativeIPFormat(url: string): boolean {
  // Extract hostname-like part from URL (between :// and first / : ? #)
  const hostnameMatch = url.match(/^[a-z]+:\/\/([^/:?#]+)/i);
  if (!hostnameMatch) {
    return false; // Malformed URL, will fail at URL parsing
  }

  const hostname = hostnameMatch[1].toLowerCase();

  // Skip bracket-wrapped IPv6 addresses (handled separately)
  if (hostname.startsWith('[')) {
    return false;
  }

  // Pattern 1: Detect hex notation (0x prefix)
  if (/0x[0-9a-f]/i.test(hostname)) {
    return true;
  }

  // Pattern 2: Detect octal notation (leading zero followed by digits)
  // Split by dots to check each segment
  const parts = hostname.split('.');
  for (const part of parts) {
    // Skip empty parts and valid single '0'
    if (part === '' || part === '0') {
      continue;
    }
    // Octal: starts with 0 and has more digits
    if (/^0\d/.test(part)) {
      return true;
    }
  }

  // Pattern 3: Detect decimal notation (pure number with no dots, value > 255)
  // Example: 2130706433 = 127.0.0.1 in decimal
  if (/^\d+$/.test(hostname)) {
    const decimalValue = parseInt(hostname, 10);
    // If it's a valid decimal IPv4 (> 255), it's an alternative format
    if (!isNaN(decimalValue) && decimalValue > 255) {
      return true;
    }
  }

  return false;
}

/**
 * Validate URL for SSRF protection
 *
 * @param url - URL to validate
 * @returns Parsed URL if safe
 * @throws Error if URL is unsafe
 */
export function validateSSRFProtection(url: string): URL {
  // 0. Pre-validation: Block alternative IPv4 encodings BEFORE URL parsing
  // SECURITY: URL parser normalizes octal (0177.0.0.1), hex (0x7f.0.0.1),
  // and decimal (2130706433) formats to canonical IPs, bypassing SSRF filters
  if (containsAlternativeIPFormat(url)) {
    logger.warn('SSRF attempt blocked: alternative IPv4 encoding detected', {
      url: url.substring(0, 100),
    });
    throw new Error('Alternative IP address formats are not allowed');
  }

  // 1. Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // 2. Block dangerous protocols
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Protocol not allowed: ${parsedUrl.protocol}`);
  }

  // 3. Extract hostname (remove brackets from IPv6)
  const hostname = parsedUrl.hostname.toLowerCase();

  // 4. Check blocked hostnames (exact match)
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    logger.warn('SSRF attempt blocked: blocked hostname', {
      hostname,
      url: url.substring(0, 100),
    });
    throw new Error('Requests to internal/private networks are not allowed');
  }

  // 5. Check cloud metadata IPs
  if (CLOUD_METADATA_IPS.includes(hostname)) {
    logger.warn('SSRF attempt blocked: cloud metadata endpoint', {
      hostname,
      url: url.substring(0, 100),
    });
    throw new Error('Requests to cloud metadata endpoints are not allowed');
  }

  // 6. Check IPv4 private/reserved ranges
  const ipv4Check = isBlockedIPv4(hostname);
  if (ipv4Check.blocked) {
    logger.warn('SSRF attempt blocked: IPv4 private range', {
      hostname,
      reason: ipv4Check.reason,
      url: url.substring(0, 100),
    });
    throw new Error('Requests to internal/private networks are not allowed');
  }

  // 7. Check IPv6 private/reserved ranges
  const ipv6Check = isBlockedIPv6(hostname);
  if (ipv6Check.blocked) {
    logger.warn('SSRF attempt blocked: IPv6 private range', {
      hostname,
      reason: ipv6Check.reason,
      url: url.substring(0, 100),
    });
    throw new Error('Requests to internal/private networks are not allowed');
  }

  return parsedUrl;
}

/**
 * Assert that a DNS-resolved IP address is not in the SSRF blocklist.
 *
 * Use this AFTER `validateSSRFProtection(url)` has accepted the URL string
 * but BEFORE actually connecting — otherwise a DNS rebinding attack
 * (resolver returns a public IP first, then a private IP on the actual
 * connect) bypasses the URL-based check entirely.
 *
 * Pattern in `hardened-http.ts`: resolve hostname once, call this, pass
 * the resolved IP via `lookup` to `https.request` so the connection can't
 * race a second DNS lookup back to a private address.
 *
 * @param ip - A DNS-resolved IP literal (IPv4 dotted-quad or IPv6).
 * @throws Error if the IP falls in any blocked range (private / loopback /
 *               link-local / cloud-metadata / etc).
 */
export function assertResolvedIpAllowed(ip: string): void {
  // Cloud metadata IPs are exact-match in the URL validator; mirror that
  // for resolved IPs so a hostname that resolves to 169.254.169.254 fails
  // here even though the URL string had a benign-looking domain.
  if (CLOUD_METADATA_IPS.includes(ip.toLowerCase())) {
    logger.warn('SSRF attempt blocked: hostname resolved to cloud metadata IP', { ip });
    throw new Error('Requests to cloud metadata endpoints are not allowed');
  }

  const ipv4Check = isBlockedIPv4(ip);
  if (ipv4Check.blocked) {
    logger.warn('SSRF attempt blocked: hostname resolved to private IPv4', {
      ip,
      reason: ipv4Check.reason,
    });
    throw new Error('Requests to internal/private networks are not allowed');
  }

  const ipv6Check = isBlockedIPv6(ip);
  if (ipv6Check.blocked) {
    logger.warn('SSRF attempt blocked: hostname resolved to private IPv6', {
      ip,
      reason: ipv6Check.reason,
    });
    throw new Error('Requests to internal/private networks are not allowed');
  }
}
