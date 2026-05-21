/**
 * Unit tests for `FetchBackedTelegramSender`.
 *
 * Stubs `globalThis.fetch` per-test (same pattern used by
 * `rpc-bridge-security.test.ts` after the flake fix) so the suite
 * never reaches the real Telegram API. Verifies the URL shape, JSON
 * body, response handling, and error containment contract the
 * dispatcher relies on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchBackedTelegramSender } from '../../../src/services/rules/telegram-sender.js';

describe('FetchBackedTelegramSender', () => {
  let sender: FetchBackedTelegramSender;

  beforeEach(() => {
    sender = new FetchBackedTelegramSender();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the bot-specific sendMessage URL with the expected JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );

    const ok = await sender.send({
      token: '123:ABCdef',
      chatId: '-1001234567890',
      text: 'hello',
    });

    expect(ok).toBe(true);
    const mock = vi.mocked(globalThis.fetch);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    // Token is passed literally in the path — Telegram's API expects
    // the raw `<bot_id>:<secret>` format, and `:` is RFC-3986-safe in
    // the path component. Encoding via `encodeURIComponent` would
    // escape `:` to `%3A` and break the request.
    expect(url).toBe('https://api.telegram.org/bot123:ABCdef/sendMessage');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({
      chat_id: '-1001234567890',
      text: 'hello',
    });
  });

  it('returns false on a 4xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
          status: 400,
        })
      )
    );

    const ok = await sender.send({ token: '123:ABCdef', chatId: '@unknown', text: 'hi' });
    expect(ok).toBe(false);
  });

  it('returns false on a 5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    expect(await sender.send({ token: '123:ABCdef', chatId: '@c', text: 'hi' })).toBe(false);
  });

  it('returns false on a network error (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await sender.send({ token: '123:ABCdef', chatId: '@c', text: 'hi' })).toBe(false);
  });

  it('returns false on AbortError without throwing', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    expect(await sender.send({ token: '123:ABCdef', chatId: '@c', text: 'hi' })).toBe(false);
  });

  it('handles a 4xx with a non-JSON body without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('plain text error', { status: 400 }))
    );
    expect(await sender.send({ token: '123:ABCdef', chatId: '@c', text: 'hi' })).toBe(false);
  });

  // Defensive guard against path-traversal-shaped tokens. The PATCH
  // route validates token shape, but the sender double-checks so a
  // legacy row or test stub with a malformed token can't escape the
  // bot path on URL build (e.g. token = `/../admin` would otherwise
  // produce `https://api.telegram.org/bot/../admin/sendMessage` →
  // normalized to `/admin/sendMessage`).
  it.each(['/../admin', 'bad token', '', '123:abc/extra', '../escape'])(
    'refuses to send with a malformed token: %s',
    async (badToken) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const ok = await sender.send({ token: badToken, chatId: '@c', text: 'hi' });
      expect(ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('accepts BotFather-shaped tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
    expect(await sender.send({ token: '123456:AbCdEf_GhI-jKlMnO', chatId: '@c', text: 'hi' })).toBe(
      true
    );
  });
});
