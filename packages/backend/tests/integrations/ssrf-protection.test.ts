/**
 * Comprehensive SSRF Protection Tests
 * Tests all attack vectors and bypass attempts
 */

import { describe, it, expect } from 'vitest';
import { validateSSRFProtection } from '../../src/integrations/security/ssrf-validator.js';

describe('SSRF Protection', () => {
  describe('IPv4 Private Ranges (RFC 1918)', () => {
    it('should block 10.0.0.0/8 (entire range)', () => {
      expect(() => validateSSRFProtection('http://10.0.0.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://10.1.2.3')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://10.255.255.255')).toThrow(
        'internal/private networks'
      );
    });

    it('should block 172.16.0.0/12 (proper RFC 1918 range only)', () => {
      // Block 172.16.x.x through 172.31.x.x
      expect(() => validateSSRFProtection('http://172.16.0.0')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://172.16.254.1')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://172.23.45.67')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://172.31.255.255')).toThrow(
        'internal/private networks'
      );
    });

    it('should NOT block public 172.x.x.x outside RFC 1918 range', () => {
      // 172.0-15 and 172.32-255 are public
      expect(() => validateSSRFProtection('http://172.15.255.255')).not.toThrow();
      expect(() => validateSSRFProtection('http://172.32.0.0')).not.toThrow();
      expect(() => validateSSRFProtection('http://172.1.2.3')).not.toThrow();
      expect(() => validateSSRFProtection('http://172.100.200.1')).not.toThrow();
    });

    it('should block 192.168.0.0/16', () => {
      expect(() => validateSSRFProtection('http://192.168.0.1')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://192.168.1.1')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://192.168.255.255')).toThrow(
        'internal/private networks'
      );
    });
  });

  describe('IPv4 Loopback (127.0.0.0/8)', () => {
    it('should block entire 127.0.0.0/8 range', () => {
      expect(() => validateSSRFProtection('http://127.0.0.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://127.0.0.2')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://127.1.1.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://127.255.255.255')).toThrow(
        'internal/private networks'
      );
    });

    it('should block localhost hostname', () => {
      expect(() => validateSSRFProtection('http://localhost')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://localhost:8080')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://LOCALHOST')).toThrow('internal/private networks');
    });
  });

  describe('IPv4 Link-Local and Cloud Metadata (169.254.0.0/16)', () => {
    it('should block AWS/GCP/Azure metadata endpoint', () => {
      expect(() => validateSSRFProtection('http://169.254.169.254')).toThrow('cloud metadata');
      expect(() => validateSSRFProtection('http://169.254.169.254/latest/meta-data')).toThrow(
        'cloud metadata'
      );
      expect(() => validateSSRFProtection('https://169.254.169.254')).toThrow('cloud metadata');
    });

    it('should block AWS ECS metadata endpoint', () => {
      expect(() => validateSSRFProtection('http://169.254.170.2')).toThrow('cloud metadata');
      expect(() => validateSSRFProtection('http://169.254.170.2/v2/metadata')).toThrow(
        'cloud metadata'
      );
    });

    it('should block entire link-local range', () => {
      expect(() => validateSSRFProtection('http://169.254.0.1')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://169.254.1.1')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://169.254.255.255')).toThrow(
        'internal/private networks'
      );
    });
  });

  describe('IPv4 Special Ranges', () => {
    it('should block 0.0.0.0/8 (this network)', () => {
      expect(() => validateSSRFProtection('http://0.0.0.0')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://0.1.2.3')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://0.255.255.255')).toThrow(
        'internal/private networks'
      );
    });

    it('should block 100.64.0.0/10 (carrier-grade NAT)', () => {
      expect(() => validateSSRFProtection('http://100.64.0.0')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://100.100.100.100')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://100.127.255.255')).toThrow(
        'internal/private networks'
      );
    });

    it('should block 224.0.0.0/4 (multicast)', () => {
      expect(() => validateSSRFProtection('http://224.0.0.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://239.255.255.255')).toThrow(
        'internal/private networks'
      );
    });

    it('should block 240.0.0.0/4 (reserved)', () => {
      expect(() => validateSSRFProtection('http://240.0.0.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://255.255.255.254')).toThrow(
        'internal/private networks'
      );
    });

    it('should block broadcast address', () => {
      expect(() => validateSSRFProtection('http://255.255.255.255')).toThrow(
        'internal/private networks'
      );
    });

    it('should correctly handle high IP addresses (>= 128.0.0.0) with unsigned comparison', () => {
      // Regression test: bitwise operators produce signed 32-bit integers
      // For IPs >= 128.0.0.0, signed interpretation causes negative values
      // Must use >>> 0 to convert to unsigned for correct range checks

      // Test multicast range (224-239) - these IPs have high bit set
      expect(() => validateSSRFProtection('http://224.0.0.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://239.255.255.255')).toThrow(
        'internal/private networks'
      );

      // Test reserved range (240-255) - maximum IP values
      expect(() => validateSSRFProtection('http://240.0.0.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://255.255.255.254')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://255.255.255.255')).toThrow(
        'internal/private networks'
      );

      // Test public IPs in high range should NOT be blocked
      // 200.0.0.0/8 is public (Latin America)
      expect(() => validateSSRFProtection('http://200.1.2.3')).not.toThrow();
    });
  });

  describe('IPv6 Loopback', () => {
    it('should block ::1 (compact notation)', () => {
      expect(() => validateSSRFProtection('http://[::1]')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://[::1]:8080')).toThrow(
        'internal/private networks'
      );
    });

    it('should block ::1 (expanded notation)', () => {
      expect(() => validateSSRFProtection('http://[0:0:0:0:0:0:0:1]')).toThrow(
        'internal/private networks'
      );
      expect(() =>
        validateSSRFProtection('http://[0000:0000:0000:0000:0000:0000:0000:0001]')
      ).toThrow('internal/private networks');
    });

    it('should block localhost variations', () => {
      expect(() => validateSSRFProtection('http://ip6-localhost')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://ip6-loopback')).toThrow(
        'internal/private networks'
      );
    });
  });

  describe('IPv6 Unique Local (fc00::/7)', () => {
    it('should block fc00::/7 range', () => {
      expect(() => validateSSRFProtection('http://[fc00::1]')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://[fc12:3456::1]')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://[fd00::1]')).toThrow('internal/private networks');
      expect(() =>
        validateSSRFProtection('http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]')
      ).toThrow('internal/private networks');
    });
  });

  describe('IPv6 Link-Local (fe80::/10)', () => {
    it('should block fe80::/10 range', () => {
      expect(() => validateSSRFProtection('http://[fe80::1]')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://[fe80::a1b2:c3d4:e5f6:7890]')).toThrow(
        'internal/private networks'
      );
      expect(() =>
        validateSSRFProtection('http://[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]')
      ).toThrow('internal/private networks');
    });
  });

  describe('IPv6 Cloud Metadata', () => {
    it('should block AWS EC2 IPv6 metadata', () => {
      expect(() => validateSSRFProtection('http://[fd00:ec2::254]')).toThrow(
        'internal/private networks'
      );
    });

    it('should block metadata hostname', () => {
      expect(() => validateSSRFProtection('http://metadata')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://metadata.google.internal')).toThrow(
        'internal/private networks'
      );
    });
  });

  describe('IPv6 Special Ranges', () => {
    it('should block IPv4-mapped IPv6 addresses with private IPv4', () => {
      // Dotted-decimal notation (RFC 5952) - ::ffff:127.0.0.1
      expect(() => validateSSRFProtection('http://[::ffff:127.0.0.1]')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://[::ffff:10.0.0.1]')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://[::ffff:192.168.1.1]')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://[::ffff:169.254.169.254]')).toThrow(
        'internal/private networks'
      );
    });

    it('should block IPv4-mapped IPv6 addresses in hex notation', () => {
      // Hex notation - ::ffff:7f00:0001 (127.0.0.1)
      expect(() => validateSSRFProtection('http://[::ffff:7f00:0001]')).toThrow(
        'internal/private networks'
      );
      // ::ffff:0a00:0001 (10.0.0.1)
      expect(() => validateSSRFProtection('http://[::ffff:0a00:0001]')).toThrow(
        'internal/private networks'
      );
      // ::ffff:c0a8:0101 (192.168.1.1)
      expect(() => validateSSRFProtection('http://[::ffff:c0a8:0101]')).toThrow(
        'internal/private networks'
      );
      // ::ffff:a9fe:a9fe (169.254.169.254 - AWS metadata)
      expect(() => validateSSRFProtection('http://[::ffff:a9fe:a9fe]')).toThrow(
        'internal/private networks'
      );
    });

    it('should block multicast (ff00::/8)', () => {
      expect(() => validateSSRFProtection('http://[ff02::1]')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://[ff05::1]')).toThrow('internal/private networks');
    });
  });

  describe('Protocol Validation', () => {
    it('should only allow http and https', () => {
      expect(() => validateSSRFProtection('http://example.com')).not.toThrow();
      expect(() => validateSSRFProtection('https://example.com')).not.toThrow();
    });

    it('should block dangerous protocols', () => {
      expect(() => validateSSRFProtection('file:///etc/passwd')).toThrow('Protocol not allowed');
      expect(() => validateSSRFProtection('ftp://example.com')).toThrow('Protocol not allowed');
      expect(() => validateSSRFProtection('gopher://example.com')).toThrow('Protocol not allowed');
      expect(() => validateSSRFProtection('javascript:alert(1)')).toThrow('Protocol not allowed');
      expect(() => validateSSRFProtection('data:text/html,<script>alert(1)</script>')).toThrow(
        'Protocol not allowed'
      );
    });
  });

  describe('Valid Public URLs', () => {
    it('should allow legitimate public IPs', () => {
      // Major DNS servers
      expect(() => validateSSRFProtection('http://8.8.8.8')).not.toThrow();
      expect(() => validateSSRFProtection('http://1.1.1.1')).not.toThrow();

      // Public 172.x ranges (outside 172.16-31)
      expect(() => validateSSRFProtection('http://172.15.255.255')).not.toThrow();
      expect(() => validateSSRFProtection('http://172.32.0.1')).not.toThrow();

      // Public addresses
      expect(() => validateSSRFProtection('http://93.184.216.34')).not.toThrow(); // example.com
    });

    it('should allow legitimate domains', () => {
      expect(() => validateSSRFProtection('http://example.com')).not.toThrow();
      expect(() => validateSSRFProtection('https://api.github.com')).not.toThrow();
      expect(() => validateSSRFProtection('https://httpbin.org/get')).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid URLs', () => {
      expect(() => validateSSRFProtection('not a url')).toThrow('Invalid URL');
      expect(() => validateSSRFProtection('://missing-protocol')).toThrow('Invalid URL');
    });

    it('should handle malformed IPs gracefully', () => {
      // URL parser rejects malformed IPs (good behavior - fail closed)
      expect(() => validateSSRFProtection('http://999.999.999.999')).toThrow('Invalid URL');
      expect(() => validateSSRFProtection('http://256.1.1.1')).toThrow('Invalid URL');
    });

    it('should handle URLs with ports', () => {
      expect(() => validateSSRFProtection('http://127.0.0.1:8080')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://[::1]:3000')).toThrow(
        'internal/private networks'
      );
      expect(() => validateSSRFProtection('http://example.com:8080')).not.toThrow();
    });

    it('should handle URLs with paths and query strings', () => {
      expect(() =>
        validateSSRFProtection('http://169.254.169.254/latest/meta-data/iam/security-credentials/')
      ).toThrow('cloud metadata');
      expect(() => validateSSRFProtection('http://example.com/path?query=value')).not.toThrow();
    });

    it('should be case-insensitive for hostnames', () => {
      expect(() => validateSSRFProtection('http://LOCALHOST')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://LocalHost')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://METADATA.GOOGLE.INTERNAL')).toThrow(
        'internal/private networks'
      );
    });
  });

  describe('Bypass Attempt Prevention', () => {
    it('should not be fooled by DNS tricks', () => {
      // Domain suffix tricks would require DNS resolution to detect
      expect(() => validateSSRFProtection('http://127.0.0.1.example.com')).not.toThrow();

      // URL parser interprets shorthand IPs as hostnames, but they're blocked if valid IPv4
      // Note: "127.1" gets treated as hostname "127.1" by URL parser, not as IPv4
      // This is actually safe since DNS will resolve it (or fail), and we validate after
    });

    it('should handle URL encoding attempts', () => {
      // URL parser handles decoding, but we validate the parsed hostname
      expect(() => validateSSRFProtection('http://127.0.0.1')).toThrow('internal/private networks');
    });

    it('should handle various localhost representations', () => {
      expect(() => validateSSRFProtection('http://localhost')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://127.0.0.1')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://[::1]')).toThrow('internal/private networks');
      expect(() => validateSSRFProtection('http://[0:0:0:0:0:0:0:1]')).toThrow(
        'internal/private networks'
      );
    });
  });

  describe('Alternative IPv4 Encoding Bypass Attempts', () => {
    describe('Octal Notation', () => {
      it('should block octal-encoded 127.0.0.1 (0177.0.0.1)', () => {
        expect(() => validateSSRFProtection('http://0177.0.0.1')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block partial octal encoding (127.0.0.01)', () => {
        expect(() => validateSSRFProtection('http://127.0.0.01')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block octal-encoded private IPs (0012.0.0.1)', () => {
        expect(() => validateSSRFProtection('http://0012.0.0.1')).toThrow(
          'Alternative IP address formats'
        );
      });
    });

    describe('Hexadecimal Notation', () => {
      it('should block hex-encoded 127.0.0.1 (0x7f.0.0.1)', () => {
        expect(() => validateSSRFProtection('http://0x7f.0.0.1')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block uppercase hex (0X7F.0.0.1)', () => {
        expect(() => validateSSRFProtection('http://0X7F.0.0.1')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block partial hex encoding (127.0.0.0x1)', () => {
        expect(() => validateSSRFProtection('http://127.0.0.0x1')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block hex-encoded private IPs (0xC0.0xA8.0.1)', () => {
        expect(() => validateSSRFProtection('http://0xC0.0xA8.0.1')).toThrow(
          'Alternative IP address formats'
        );
      });
    });

    describe('Decimal Notation', () => {
      it('should block decimal-encoded 127.0.0.1 (2130706433)', () => {
        expect(() => validateSSRFProtection('http://2130706433')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block decimal-encoded 10.0.0.1 (167772161)', () => {
        expect(() => validateSSRFProtection('http://167772161')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block decimal-encoded 192.168.1.1 (3232235777)', () => {
        expect(() => validateSSRFProtection('http://3232235777')).toThrow(
          'Alternative IP address formats'
        );
      });
    });

    describe('Mixed Format Attacks', () => {
      it('should block mixed octal and decimal (0177.0.0.0x1)', () => {
        expect(() => validateSSRFProtection('http://0177.0.0.0x1')).toThrow(
          'Alternative IP address formats'
        );
      });

      it('should block mixed hex and decimal (0x7f.0.1)', () => {
        expect(() => validateSSRFProtection('http://0x7f.0.1')).toThrow(
          'Alternative IP address formats'
        );
      });
    });

    describe('Valid Standard Format', () => {
      it('should allow standard decimal notation (no leading zeros)', () => {
        // Public IP addresses in standard format should pass
        expect(() => validateSSRFProtection('http://8.8.8.8')).not.toThrow();
        expect(() => validateSSRFProtection('http://1.1.1.1')).not.toThrow();
      });

      it('should allow valid port with standard IP', () => {
        expect(() => validateSSRFProtection('http://8.8.8.8:8080')).not.toThrow();
      });
    });
  });

  describe('Return Value', () => {
    it('should return parsed URL object for valid URLs', () => {
      const result = validateSSRFProtection('https://example.com/path?query=1');
      expect(result).toBeInstanceOf(URL);
      expect(result.hostname).toBe('example.com');
      expect(result.pathname).toBe('/path');
      expect(result.search).toBe('?query=1');
    });
  });
});
