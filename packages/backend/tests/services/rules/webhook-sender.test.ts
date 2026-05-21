/**
 * Unit tests for `FetchBackedWebhookSender`.
 *
 * Stubs `globalThis.fetch` per-test so the suite never reaches a real
 * endpoint. Verifies POST shape, SSRF revalidation, and the error
 * containment contract the dispatcher relies on.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchBackedWebhookSender } from '../../../src/services/rules/webhook-sender.js';

describe('FetchBackedWebhookSender', () => {
  let sender: FetchBackedWebhookSender;

  beforeEach(() => {
    sender = new FetchBackedWebhookSender();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs the payload as JSON to the configured URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    const ok = await sender.send({
      url: 'https://hooks.example.com/dedup',
      payload: { event: 'duplicate_detected', priority: 'high' },
    });

    expect(ok).toBe(true);
    const mock = vi.mocked(globalThis.fetch);
    const [url, init] = mock.mock.calls[0];
    // The sender now passes a normalized URL object (not a raw string)
    // so non-ASCII / encoding edge cases settle the same way every hop.
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).toString()).toBe('https://hooks.example.com/dedup');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({
      event: 'duplicate_detected',
      priority: 'high',
    });
    // Block redirect-based SSRF — `manual` surfaces 3xx as non-ok
    // rather than following a 302 to a private IP.
    expect(init?.redirect).toBe('manual');
  });

  it('returns false on a 4xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    expect(await sender.send({ url: 'https://hooks.example.com/x', payload: {} })).toBe(false);
  });

  it('returns false on a 5xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })));
    expect(await sender.send({ url: 'https://hooks.example.com/x', payload: {} })).toBe(false);
  });

  it('returns false (without throwing) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await sender.send({ url: 'https://hooks.example.com/x', payload: {} })).toBe(false);
  });

  it('refuses to send to a private-network URL (SSRF revalidation)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    // The schema rejects these at parse time; this test pins the
    // sender-side defense in case a stored row was edited via direct
    // SQL or a future relaxation slips one through.
    for (const bad of [
      'http://127.0.0.1/hook',
      'http://localhost/hook',
      'http://10.0.0.1/hook',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      const ok = await sender.send({ url: bad, payload: {} });
      expect(ok).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns false on AbortError without throwing', async () => {
    const abortErr = new Error('aborted');
    abortErr.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    expect(await sender.send({ url: 'https://hooks.example.com/x', payload: {} })).toBe(false);
  });
});
