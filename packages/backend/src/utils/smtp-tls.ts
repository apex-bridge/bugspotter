/**
 * SMTP transport security, derived from the port.
 *
 * Nodemailer needs two separate flags and they are easy to get subtly wrong:
 *   - `secure: true`  — wrap the connection in TLS immediately (SMTPS)
 *   - `requireTLS`    — plaintext connect, then refuse to continue unless
 *                       STARTTLS succeeds
 *
 * Setting neither leaves STARTTLS *opportunistic*: nodemailer upgrades if the
 * server advertises it, and silently sends credentials in the clear if a
 * network attacker strips the advertisement. So every supported port must map
 * to one flag or the other, never to neither.
 *
 * Alongside the IANA ports, this recognises the 2xxx aliases that relays
 * publish for hosts which block outbound 25/465/587 — a very common VPS
 * anti-spam default. Resend, SendGrid, Mailgun and Postmark all offer them.
 * Treating 2465 as "not secure" would attempt plaintext SMTP against a
 * TLS-only listener and fail with an opaque timeout.
 */

/** Ports that expect TLS from the first byte (SMTPS). */
const IMPLICIT_TLS_PORTS = new Set([465, 2465]);

/** Ports that expect a plaintext greeting followed by a STARTTLS upgrade. */
const STARTTLS_PORTS = new Set([25, 587, 2525, 2587]);

export interface SmtpTlsOptions {
  /** Connect with TLS immediately. */
  secure: boolean;
  /** Fail rather than continue unencrypted if STARTTLS is unavailable. */
  requireTLS: boolean;
}

/**
 * Map an SMTP port to nodemailer's transport security flags.
 *
 * Unknown ports fall back to requiring STARTTLS. That is the safe default: a
 * misconfigured port fails loudly instead of quietly sending credentials in
 * plaintext.
 */
export function resolveSmtpTls(port: number): SmtpTlsOptions {
  if (IMPLICIT_TLS_PORTS.has(port)) {
    return { secure: true, requireTLS: false };
  }
  if (STARTTLS_PORTS.has(port)) {
    return { secure: false, requireTLS: true };
  }
  return { secure: false, requireTLS: true };
}
