/**
 * IP address utilities for webhook source validation.
 */

function ipToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const n = Number(part);
    if (n < 0 || n > 255) {
      return null;
    }
  }
  return parts.reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

export function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    return ip === cidr;
  }
  const [subnet, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  // For /0, all IPs match; for /32, exact match via full mask
  const mask = bits === 0 ? 0 : ~((1 << (32 - bits)) - 1) >>> 0;
  const ipNum = ipToNum(ip);
  const subnetNum = ipToNum(subnet);
  return ipNum !== null && subnetNum !== null && (ipNum & mask) === (subnetNum & mask);
}

/**
 * Check if an IP matches any entry in a CIDR allowlist.
 */
export function isIpAllowed(ip: string, allowlist: ReadonlySet<string>): boolean {
  return [...allowlist].some((cidr) => ipMatchesCidr(ip, cidr));
}
