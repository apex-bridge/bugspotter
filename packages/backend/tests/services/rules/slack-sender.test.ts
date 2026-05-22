/**
 * Unit tests for `FetchBackedSlackSender`.
 *
 * Stubs `globalThis.fetch` per-test so the suite never reaches the
 * real Slack API. Verifies the URL/headers/body shape, the
 * `ok: false` JSON failure mode (Slack returns 200 + `{ok:false}` on
 * bad-token / channel-not-found / etc), and the error containment
 * contract the dispatcher relies on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchBackedSlackSender } from '../../../src/services/rules/slack-sender.js';

describe('FetchBackedSlackSender', () => {
  let sender: FetchBackedSlackSender;

  beforeEach(() => {
    sender = new FetchBackedSlackSender();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to chat.postMessage with bearer-token auth and JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );

    const ok = await sender.send({
      token: 'xoxb-123-456-abcDEF',
      channel: '#regressions',
      text: 'hello',
    });

    expect(ok).toBe(true);
    const mock = vi.mocked(globalThis.fetch);
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init?.method).toBe('POST');
    // Bearer token in Authorization header (Slack convention) — keeps
    // the token out of the URL so it doesn't end up in proxy access
    // logs or referer headers.
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: 'Bearer xoxb-123-456-abcDEF',
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      channel: '#regressions',
      text: 'hello',
    });
  });

  // Slack's failure mode is HTTP 200 + `{ ok: false, error: '...' }`,
  // not a 4xx/5xx — the sender must inspect the body to tell success
  // from failure. Without this branch, a `channel_not_found` reply
  // would be reported as a successful send.
  it('returns false when Slack responds 200 with ok=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), {
          status: 200,
        })
      )
    );

    const ok = await sender.send({
      token: 'xoxb-123-456-abcDEF',
      channel: '#nope',
      text: 'hi',
    });
    expect(ok).toBe(false);
  });

  it('returns false on a 4xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })));
    expect(await sender.send({ token: 'xoxb-123-456-abc', channel: '#x', text: 'hi' })).toBe(false);
  });

  it('returns false on a 5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    expect(await sender.send({ token: 'xoxb-123-456-abc', channel: '#x', text: 'hi' })).toBe(false);
  });

  it('returns false (without throwing) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await sender.send({ token: 'xoxb-123-456-abc', channel: '#x', text: 'hi' })).toBe(false);
  });

  it('returns false on AbortError without throwing', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    expect(await sender.send({ token: 'xoxb-123-456-abc', channel: '#x', text: 'hi' })).toBe(false);
  });

  it('handles a 200 with a non-JSON body as a failure (cannot confirm ok)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    expect(await sender.send({ token: 'xoxb-123-456-abc', channel: '#x', text: 'hi' })).toBe(false);
  });

  // Defense-in-depth: `response.json()` can legally return `null`,
  // an array, or a primitive (all valid JSON values). Without the
  // type guard, `body.ok` on a `null` body would throw into the
  // outer catch with a misleading "send threw" log.
  it.each(['null', '[]', '42', '"a string"'])(
    'handles a non-object JSON body as a failure: %s',
    async (json) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(json, { status: 200 })));
      expect(await sender.send({ token: 'xoxb-123-456-abc', channel: '#x', text: 'hi' })).toBe(
        false
      );
    }
  );

  // Defensive guard against malformed tokens. Slack bot tokens start
  // with `xoxb-` and use `[A-Za-z0-9-]` after the prefix; anything
  // else is rejected without touching the network. Without this, a
  // legacy row or test stub with `'\r\nX-Smuggle: yes'` could attempt
  // header injection via the Authorization value.
  it.each([
    '',
    'not-a-slack-token',
    'xoxp-123-456-abc', // user token, not a bot token
    'xoxb-bad token with spaces',
    'xoxb-newline\r\nX-Smuggled: yes',
    '/../admin',
  ])('refuses to send with a malformed token: %s', async (badToken) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await sender.send({ token: badToken, channel: '#x', text: 'hi' });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts well-formed bot tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
    expect(
      await sender.send({
        // Obvious placeholder shape — matches the regex but cannot be
        // mistaken for a leaked real token by secret scanners.
        token: 'xoxb-test-test-not-a-real-slack-bot-token',
        channel: '#x',
        text: 'hi',
      })
    ).toBe(true);
  });
});
