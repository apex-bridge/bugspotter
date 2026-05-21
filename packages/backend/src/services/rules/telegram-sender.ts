/**
 * Telegram sender for `notify.telegram` actions.
 *
 * Wraps the Telegram Bot API's `sendMessage` endpoint. The sender is
 * intentionally minimal — token + chat_id + text in, boolean out —
 * because the dedup-rule dispatcher handles surrounding concerns
 * (token resolution per org, recipient throttling, error logging).
 *
 * Token storage / decryption is handled by the wiring layer:
 * `OrganizationSettings.telegram_bot_token` carries the encrypted
 * blob (same shape as `intelligence_api_key`), and the
 * `TelegramTokenResolver` callback decrypts on demand. Selfhosted
 * deployments either configure a global token via env (future) or
 * skip — `notify.telegram` is currently SaaS-only on the hot path.
 */

import { getLogger } from '../../logger.js';

const logger = getLogger();

// Bot API timeout — typically responds in <500ms; 10s gives plenty of
// headroom for transient network slowness without holding the executor
// up indefinitely.
const TELEGRAM_TIMEOUT_MS = 10_000;

export interface TelegramSendRequest {
  /** Plaintext bot token. The wiring layer decrypts before reaching the sender. */
  token: string;
  /** Chat id — numeric-as-string (e.g. `-1001234567890`) or `@username`. */
  chatId: string;
  /** Message body. Plain text (no parse_mode by default). */
  text: string;
}

export interface TelegramSender {
  /**
   * Returns `true` when the message was accepted by the bot API,
   * `false` on any expected failure (network, timeout, 4xx, 5xx).
   * Never throws — the dispatcher relies on this contract.
   */
  send(req: TelegramSendRequest): Promise<boolean>;
}

/**
 * Resolves the bot token for a given organization. Returns `null`
 * when the org has no token configured (`telegram_bot_token` unset
 * or empty), or when called for selfhosted bugs (`organizationId ===
 * null`). The dispatcher treats `null` as "skip cleanly" rather than
 * as an error.
 *
 * Production wires this to the encryption service so the plaintext
 * token only exists briefly in memory at dispatch time.
 */
export type TelegramTokenResolver = (organizationId: string | null) => Promise<string | null>;

/**
 * Production sender — POSTs to `https://api.telegram.org/bot<TOKEN>/sendMessage`
 * with `{ chat_id, text }`. Errors are logged but never thrown.
 */
export class FetchBackedTelegramSender implements TelegramSender {
  async send(req: TelegramSendRequest): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${encodeURIComponent(req.token)}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: req.chatId, text: req.text }),
          signal: controller.signal,
        }
      );
      if (!response.ok) {
        // Pull `description` out of the body if present — it's the
        // bot API's human-readable error. Suppress otherwise; raw
        // 4xx/5xx codes alone are usually enough for ops.
        let description: string | undefined;
        try {
          const body = (await response.json()) as { description?: string };
          description = body.description;
        } catch {
          // ignore — non-JSON body
        }
        logger.warn('TelegramSender: bot API reported failure', {
          status: response.status,
          description,
        });
        return false;
      }
      return true;
    } catch (error) {
      // AbortError, network failure, malformed url, etc. Log type
      // only — `error.message` from fetch is often unstable across
      // node versions and not useful to ops.
      logger.warn('TelegramSender: send threw', {
        errorType: error instanceof Error ? error.name : 'NonErrorThrown',
      });
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
