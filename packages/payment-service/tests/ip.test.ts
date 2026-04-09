import { describe, it, expect } from 'vitest';
import { ipMatchesCidr, isIpAllowed } from '../src/utils/ip.js';

describe('ipMatchesCidr', () => {
  it('matches exact IP when no CIDR suffix', () => {
    expect(ipMatchesCidr('10.0.0.1', '10.0.0.1')).toBe(true);
    expect(ipMatchesCidr('10.0.0.2', '10.0.0.1')).toBe(false);
  });

  it('matches IPs within a /24 subnet', () => {
    expect(ipMatchesCidr('192.168.1.0', '192.168.1.0/24')).toBe(true);
    expect(ipMatchesCidr('192.168.1.255', '192.168.1.0/24')).toBe(true);
    expect(ipMatchesCidr('192.168.2.0', '192.168.1.0/24')).toBe(false);
  });

  it('matches IPs within a /29 subnet (Kaspi ranges)', () => {
    // /29 = 8 addresses: .152 through .159
    expect(ipMatchesCidr('194.187.247.152', '194.187.247.152/29')).toBe(true);
    expect(ipMatchesCidr('194.187.247.159', '194.187.247.152/29')).toBe(true);
    expect(ipMatchesCidr('194.187.247.160', '194.187.247.152/29')).toBe(false);
  });

  it('handles /32 (single host)', () => {
    expect(ipMatchesCidr('10.0.0.1', '10.0.0.1/32')).toBe(true);
    expect(ipMatchesCidr('10.0.0.2', '10.0.0.1/32')).toBe(false);
  });

  it('handles /0 (all IPs)', () => {
    expect(ipMatchesCidr('1.2.3.4', '0.0.0.0/0')).toBe(true);
    expect(ipMatchesCidr('255.255.255.255', '0.0.0.0/0')).toBe(true);
  });

  it('rejects invalid IPs', () => {
    expect(ipMatchesCidr('not-an-ip', '10.0.0.0/8')).toBe(false);
    expect(ipMatchesCidr('256.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(ipMatchesCidr('10.0.0', '10.0.0.0/8')).toBe(false);
    expect(ipMatchesCidr('10.0.0.1.2', '10.0.0.0/8')).toBe(false);
  });

  it('rejects invalid CIDR bits', () => {
    expect(ipMatchesCidr('10.0.0.1', '10.0.0.0/33')).toBe(false);
    expect(ipMatchesCidr('10.0.0.1', '10.0.0.0/-1')).toBe(false);
    expect(ipMatchesCidr('10.0.0.1', '10.0.0.0/abc')).toBe(false);
  });

  it('rejects invalid subnet address', () => {
    expect(ipMatchesCidr('10.0.0.1', '999.0.0.0/8')).toBe(false);
  });

  it('rejects non-integer octets', () => {
    expect(ipMatchesCidr('10.0.0.1.5', '10.0.0.0/8')).toBe(false);
    expect(ipMatchesCidr('10.0.0.1e2', '10.0.0.0/8')).toBe(false);
  });
});

describe('isIpAllowed', () => {
  const allowlist = new Set(['194.187.247.152/29', '194.187.247.160/29']);

  it('allows IPs in the allowlist ranges', () => {
    expect(isIpAllowed('194.187.247.155', allowlist)).toBe(true);
    expect(isIpAllowed('194.187.247.163', allowlist)).toBe(true);
  });

  it('rejects IPs outside the allowlist ranges', () => {
    expect(isIpAllowed('194.187.247.170', allowlist)).toBe(false);
    expect(isIpAllowed('10.0.0.1', allowlist)).toBe(false);
  });

  it('returns false for empty allowlist', () => {
    expect(isIpAllowed('10.0.0.1', new Set())).toBe(false);
  });
});
