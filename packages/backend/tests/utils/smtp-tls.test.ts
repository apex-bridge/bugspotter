import { describe, it, expect } from 'vitest';
import { resolveSmtpTls } from '../../src/utils/smtp-tls.js';

describe('resolveSmtpTls', () => {
  it('uses implicit TLS on the SMTPS ports', () => {
    for (const port of [465, 2465]) {
      expect(resolveSmtpTls(port)).toEqual({ secure: true, requireTLS: false });
    }
  });

  it('requires STARTTLS on the submission ports', () => {
    for (const port of [25, 587, 2525, 2587]) {
      expect(resolveSmtpTls(port)).toEqual({ secure: false, requireTLS: true });
    }
  });

  it('handles relay alternative ports, which is the whole point', () => {
    // Hosts commonly block outbound 25/465/587 as an anti-spam default, so
    // relays publish 2xxx aliases. Treating 2465 as plaintext attempts a bare
    // SMTP greeting against a TLS-only listener and fails on an opaque timeout.
    expect(resolveSmtpTls(2465).secure).toBe(true);
    expect(resolveSmtpTls(2587).requireTLS).toBe(true);
  });

  it('never leaves a port with opportunistic-only TLS', () => {
    // secure:false + requireTLS:false is the dangerous combination - nodemailer
    // upgrades if STARTTLS is advertised and sends credentials in the clear if
    // an attacker strips the advertisement. No port may resolve to it.
    const ports = [25, 465, 587, 2222, 2465, 2525, 2587, 8025, 0, -1, 65535];
    for (const port of ports) {
      const { secure, requireTLS } = resolveSmtpTls(port);
      expect(secure || requireTLS, `port ${port} allows unencrypted fallback`).toBe(true);
    }
  });

  it('fails closed on an unknown port', () => {
    expect(resolveSmtpTls(1234)).toEqual({ secure: false, requireTLS: true });
  });
});
