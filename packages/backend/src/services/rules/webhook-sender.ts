/**
 * Webhook sender for `notify.webhook` actions.
 *
 * POSTs the configured payload as JSON to the rule's URL. The schema
 * already SSRF-validates the URL at parse time; this sender
 * re-validates at dispatch time as defense in depth — without that,
 * a malicious `organization.settings` PATCH against an older row
 * (or a future schema relaxation) could bypass the parse-time check.
 *
 * Known gap: DNS rebinding for outbound `fetch`. The URL-string
 * SSRF check validates IP literals + cloud-metadata hostnames, but
 * does not resolve DNS and pin the connection. A malicious admin
 * who controls DNS for an attacker-owned hostname could flip the
 * record to a private IP between validation and the fetch hop. The
 * codebase's `pinHostnameToIp` + `createPinnedAgent` solve this for
 * `https.request` / `axios` callers, but Node's undici-backed
 * `fetch` does not honour an `agent` option (see hardened-http.ts
 * header comment, lines 26–29), so plumbing it through `fetch`
 * requires an undici `Dispatcher` rewrite. Deferred — the threat
 * model is "admin is the attacker" since webhook URLs are admin-
 * configured. Tracked for the next security pass.
 *
 * No HMAC signing in v1. Receivers that need authenticity should
 * verify via the URL itself (single-use webhook secrets in the
 * path/query are the common pattern for Slack/Discord-style hooks).
 * Signed-payload support is a follow-up if a real consumer asks.
 */

import { getLogger } from '../../logger.js';
import { validateSSRFProtection } from '../../integrations/security/ssrf-validator.js';

const logger = getLogger();

// Webhook receivers typically ack quickly (<2s); 10s gives generous
// headroom for slow third-party services without holding the executor.
const WEBHOOK_TIMEOUT_MS = 10_000;

export interface WebhookSendRequest {
  /** Public HTTPS/HTTP endpoint (SSRF-validated by the schema). */
  url: string;
  /** Arbitrary JSON object; `{}` when the rule's action carries no payload. */
  payload: Record<string, unknown>;
}

export interface WebhookSender {
  /**
   * Returns `true` when the receiver responded with a 2xx, `false`
   * on any expected failure (SSRF rejection at dispatch, network
   * error, timeout, 4xx, 5xx). Never throws.
   */
  send(req: WebhookSendRequest): Promise<boolean>;
}

export class FetchBackedWebhookSender implements WebhookSender {
  async send(req: WebhookSendRequest): Promise<boolean> {
    // Re-validate SSRF at dispatch time. The schema check at parse
    // time catches admin-written rules, but a stored row could have
    // been edited via direct SQL since (e.g. ops poking the JSONB
    // settings column) and we don't want to trust the at-rest data.
    //
    // Capture the URL object so we can (a) pass a normalized URL to
    // `fetch` instead of the raw string, and (b) log only hostname on
    // failure paths — webhook URLs often carry tokens in the
    // path/query that must not land in logs.
    let validatedUrl: URL;
    try {
      validatedUrl = validateSSRFProtection(req.url);
    } catch (error) {
      logger.warn('WebhookSender: SSRF revalidation rejected URL', {
        errorType: error instanceof Error ? error.name : 'NonErrorThrown',
      });
      return false;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    let response: Response | undefined;
    try {
      response = await fetch(validatedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'BugSpotter-Webhook',
        },
        body: JSON.stringify(req.payload),
        signal: controller.signal,
        // Block redirect-based SSRF: a public URL that 302s to a
        // private IP would slip past the upfront check. `manual`
        // surfaces the 3xx as a non-ok response; we treat it as a
        // failed delivery rather than chase the trampoline.
        redirect: 'manual',
      });
      if (!response.ok) {
        logger.warn('WebhookSender: receiver reported failure', {
          status: response.status,
          hostname: validatedUrl.hostname,
        });
        return false;
      }
      return true;
    } catch (error) {
      logger.warn('WebhookSender: send threw', {
        errorType: error instanceof Error ? error.name : 'NonErrorThrown',
        hostname: validatedUrl.hostname,
      });
      return false;
    } finally {
      clearTimeout(timeoutId);
      // Drain the body so undici releases the socket back to the
      // pool. Without this, every successful or 4xx/5xx response
      // holds the socket until idle-timeout, exhausting the pool
      // under sustained webhook traffic. Mirrors the pattern in
      // hardened-http.ts between redirect hops.
      try {
        await response?.body?.cancel?.();
      } catch {
        // best-effort cleanup
      }
    }
  }
}
