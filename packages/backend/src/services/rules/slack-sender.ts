/**
 * Slack sender for `notify.slack` actions.
 *
 * Wraps the Slack Web API's `chat.postMessage` endpoint. Like the
 * Telegram sender, the surface is intentionally minimal — token +
 * channel + text in, boolean out — and the dispatcher handles
 * surrounding concerns (per-org token resolution, recipient
 * throttling, error logging).
 *
 * Two Slack-specific quirks worth knowing:
 *  - Auth lives in `Authorization: Bearer <token>`, not in the URL,
 *    so the token never lands in proxy access logs.
 *  - Slack signals failure via HTTP 200 + `{ ok: false, error: ... }`
 *    rather than a 4xx. The sender must parse the body and treat
 *    `ok === false` as a delivery failure, not just check `response.ok`.
 *
 * Token storage / decryption is handled by the wiring layer:
 * `OrganizationSettings.slack_bot_token` carries the encrypted blob
 * (same shape as `telegram_bot_token`), and the `SlackTokenResolver`
 * callback decrypts on demand.
 */

import { getLogger } from '../../logger.js';

const logger = getLogger();

// Slack typically responds in <500ms; 10s gives plenty of headroom
// without holding the executor up indefinitely. Matches the telegram
// and webhook timeouts for consistency.
const SLACK_TIMEOUT_MS = 10_000;

// Slack bot tokens are `xoxb-<digits>-<digits>-<base64-ish>`. The
// suffix uses `[A-Za-z0-9-]`. Anything else (user tokens `xoxp-`,
// app tokens `xapp-`, garbage rows, header-injection attempts via
// newline) is rejected before the network. Without this, a malformed
// token like `xoxb-foo\r\nX-Smuggled: yes` would land in the
// Authorization header and could attempt request smuggling on some
// HTTP stacks.
const SLACK_BOT_TOKEN_PATTERN = /^xoxb-[A-Za-z0-9-]+$/;

export interface SlackSendRequest {
  /** Plaintext bot token (`xoxb-...`). The wiring layer decrypts before reaching the sender. */
  token: string;
  /** Conversation target: `#channel`, channel id (`C12345`), or user id (`U12345`) for DMs. */
  channel: string;
  /** Message body. Plain text by default; markdown opt-in lives in a future field if needed. */
  text: string;
}

export interface SlackSender {
  /**
   * Returns `true` only when Slack confirms `ok: true` in the
   * response body. Returns `false` on any expected failure (HTTP
   * 4xx/5xx, network, timeout, `ok: false`, malformed token, body
   * that won't parse as JSON). Never throws — the dispatcher relies
   * on this contract.
   */
  send(req: SlackSendRequest): Promise<boolean>;
}

/**
 * Resolves the Slack bot token for a given organization. Returns
 * `null` when the org has no token configured (`slack_bot_token`
 * unset or empty), or when called for selfhosted bugs
 * (`organizationId === null`). The dispatcher treats `null` as "skip
 * cleanly" rather than as an error.
 */
export type SlackTokenResolver = (organizationId: string | null) => Promise<string | null>;

/**
 * Production sender — POSTs to `https://slack.com/api/chat.postMessage`
 * with a Bearer-token Authorization header and `{ channel, text }`
 * JSON body. Errors are logged but never thrown.
 */
export class FetchBackedSlackSender implements SlackSender {
  async send(req: SlackSendRequest): Promise<boolean> {
    if (!SLACK_BOT_TOKEN_PATTERN.test(req.token)) {
      logger.warn('SlackSender: refused malformed token (not xoxb- bot-token shape)');
      return false;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          // Slack documents `application/json; charset=utf-8` as the
          // canonical content type for this endpoint.
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${req.token}`,
        },
        body: JSON.stringify({ channel: req.channel, text: req.text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.warn('SlackSender: HTTP failure', { status: response.status });
        return false;
      }
      // Slack returns 200 even on logical failures (bad token, channel
      // missing, rate-limited). The body's `ok` flag is the source of
      // truth — without checking it, every `channel_not_found` would
      // be reported as a successful send.
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        logger.warn('SlackSender: response body was not JSON, treating as failure');
        return false;
      }
      // `response.json()` can return `null` (valid JSON for an empty
      // body), an array, or a primitive — none of which are shaped
      // like a Slack response. Without this guard, `body.ok` on a
      // `null` body would throw and be swallowed by the outer catch
      // with a misleading "send threw" log line.
      if (body === null || typeof body !== 'object') {
        logger.warn('SlackSender: response body was not a JSON object, treating as failure');
        return false;
      }
      const parsed = body as { ok?: unknown; error?: unknown };
      if (parsed.ok !== true) {
        logger.warn('SlackSender: chat.postMessage reported failure', {
          error: typeof parsed.error === 'string' ? parsed.error : undefined,
        });
        return false;
      }
      return true;
    } catch (error) {
      logger.warn('SlackSender: send threw', {
        errorType: error instanceof Error ? error.name : 'NonErrorThrown',
      });
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
