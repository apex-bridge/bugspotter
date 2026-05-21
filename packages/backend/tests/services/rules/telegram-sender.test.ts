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
      token: 'bot:secret-123',
      chatId: '-1001234567890',
      text: 'hello',
    });

    expect(ok).toBe(true);
    const mock = vi.mocked(globalThis.fetch);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    // Token is URL-encoded in the path; `:` becomes %3A.
    expect(url).toBe(
      'https://api.telegram.org/bot' + encodeURIComponent('bot:secret-123') + '/sendMessage'
    );
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

    const ok = await sender.send({ token: 't', chatId: '@unknown', text: 'hi' });
    expect(ok).toBe(false);
  });

  it('returns false on a 5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    expect(await sender.send({ token: 't', chatId: '@c', text: 'hi' })).toBe(false);
  });

  it('returns false on a network error (fetch throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await sender.send({ token: 't', chatId: '@c', text: 'hi' })).toBe(false);
  });

  it('returns false on AbortError without throwing', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    expect(await sender.send({ token: 't', chatId: '@c', text: 'hi' })).toBe(false);
  });

  it('handles a 4xx with a non-JSON body without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('plain text error', { status: 400 }))
    );
    expect(await sender.send({ token: 't', chatId: '@c', text: 'hi' })).toBe(false);
  });
});
