/**
 * The edit dialog's config round-trip.
 *
 * The API withholds credential-bearing config fields, so the form shows them
 * blank and a blank one must mean "unchanged" - sending it back would overwrite
 * a stored SMTP password with an empty string. The form also holds everything
 * as strings, while the stored config is typed.
 */

import { describe, it, expect } from 'vitest';
import {
  buildChannelConfigUpdate,
  isWriteOnlyConfigKey,
  toFormConfig,
} from '../../../components/notifications/channel-config-helpers';

describe('toFormConfig', () => {
  it('stringifies the typed fields so inputs can hold them', () => {
    expect(
      toFormConfig({
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_secure: true,
        from_name: 'BugSpotter',
      })
    ).toEqual({
      smtp_host: 'smtp.example.com',
      smtp_port: '587',
      smtp_secure: 'true',
      from_name: 'BugSpotter',
    });
  });

  it('leaves withheld credentials absent rather than blank strings', () => {
    // The API does not send smtp_pass at all; nothing should invent a value
    // for it, because a present-but-empty one would be written back.
    const form = toFormConfig({ smtp_host: 'smtp.example.com' });

    expect(form).not.toHaveProperty('smtp_pass');
    expect(buildChannelConfigUpdate(form)).toEqual({
      ok: true,
      config: { smtp_host: 'smtp.example.com' },
    });
  });

  it('skips fields the form does not render, so they survive the merge', () => {
    // `mentions` and `retry_policy` have no input; round-tripping them through
    // a text field is how they would get corrupted. The backend keeps them.
    const form = toFormConfig({
      webhook_url: 'https://hooks.slack.com/services/T000/B000/secret',
      channel: '#alerts',
      mentions: { critical: '@channel' },
      retry_policy: { max_attempts: 3, backoff_ms: 1000 },
    });

    expect(form).toEqual({
      webhook_url: 'https://hooks.slack.com/services/T000/B000/secret',
      channel: '#alerts',
    });
  });

  it('tolerates a null or absent config', () => {
    expect(toFormConfig(null)).toEqual({});
    expect(toFormConfig(undefined)).toEqual({});
  });

  it('skips null values instead of turning them into "null"', () => {
    expect(toFormConfig({ from_name: null, smtp_host: 'smtp.example.com' })).toEqual({
      smtp_host: 'smtp.example.com',
    });
  });
});

describe('buildChannelConfigUpdate', () => {
  it('drops a blank credential so the stored one is kept', () => {
    const result = buildChannelConfigUpdate({
      smtp_host: 'smtp.example.com',
      smtp_pass: '',
      webhook_url: '',
    });

    expect(result).toEqual({ ok: true, config: { smtp_host: 'smtp.example.com' } });
  });

  it('sends a credential the user retyped', () => {
    const result = buildChannelConfigUpdate({ smtp_pass: 'rotated-password' });

    expect(result).toEqual({ ok: true, config: { smtp_pass: 'rotated-password' } });
  });

  it('sends a blanked non-secret field, because that is a real edit', () => {
    const result = buildChannelConfigUpdate({ from_name: '' });

    expect(result).toEqual({ ok: true, config: { from_name: '' } });
  });

  it('coerces the port back to a number and the TLS flag back to a boolean', () => {
    const result = buildChannelConfigUpdate({ smtp_port: '2525', smtp_secure: 'false' });

    expect(result).toEqual({ ok: true, config: { smtp_port: 2525, smtp_secure: false } });
  });

  it('omits an unparseable port rather than writing NaN', () => {
    const result = buildChannelConfigUpdate({ smtp_port: '', smtp_host: 'smtp.example.com' });

    expect(result).toEqual({ ok: true, config: { smtp_host: 'smtp.example.com' } });
  });

  it('parses custom headers from the JSON textarea', () => {
    const result = buildChannelConfigUpdate({
      url: 'https://api.example.com/hooks',
      headers: '{"X-Token": "abc"}',
    });

    expect(result).toEqual({
      ok: true,
      config: { url: 'https://api.example.com/hooks', headers: { 'X-Token': 'abc' } },
    });
  });

  it('reports invalid header JSON instead of storing the raw string', () => {
    expect(buildChannelConfigUpdate({ headers: 'not json' })).toEqual({
      ok: false,
      error: 'invalid-headers',
    });
  });

  it('rejects header JSON that parses but is not a plain object', () => {
    // All of these parse cleanly and would then be spread into the outgoing
    // request headers by the webhook handler, corrupting every delivery.
    for (const headers of ['null', '[]', '["X-Token"]', '"abc"', '5', 'true']) {
      expect(buildChannelConfigUpdate({ headers })).toEqual({
        ok: false,
        error: 'invalid-headers',
      });
    }
  });

  it('treats blank headers as unchanged, not as an empty object', () => {
    expect(buildChannelConfigUpdate({ headers: '' })).toEqual({ ok: true, config: {} });
    expect(buildChannelConfigUpdate({ headers: '  \n ' })).toEqual({ ok: true, config: {} });
  });

  it('turns a form seeded from a withheld config into a no-op update', () => {
    // The whole failure, end to end: read gives no credentials, the user
    // changes only the channel name, and the resulting config must not carry
    // anything that would overwrite what is stored.
    const form = toFormConfig({ smtp_host: 'smtp.example.com', smtp_port: 587 });
    const result = buildChannelConfigUpdate(form);

    expect(result).toEqual({
      ok: true,
      config: { smtp_host: 'smtp.example.com', smtp_port: 587 },
    });
    expect(result.ok && result.config).not.toHaveProperty('smtp_pass');
  });
});

describe('isWriteOnlyConfigKey', () => {
  it('knows which fields the form must show blank', () => {
    for (const key of ['smtp_pass', 'webhook_url', 'auth_value', 'signature_secret', 'headers']) {
      expect(isWriteOnlyConfigKey(key)).toBe(true);
    }
    expect(isWriteOnlyConfigKey('smtp_host')).toBe(false);
    expect(isWriteOnlyConfigKey('url')).toBe(false);
  });
});
