/**
 * Guards the notification-channel response schema on both edges: it must stop
 * dropping the whole config, and it must keep withholding the credentials.
 *
 * Fastify serializes a response through its schema and removes any property the
 * schema does not declare. `config` was declared as a bare `{ type: 'object' }`
 * - no properties, so every read returned `{}`. The admin's edit dialog seeds
 * its form from that and PATCHes it back, so opening a channel and renaming it
 * replaced the stored SMTP password with nothing.
 *
 * Declaring the config's fields is the fix, and it is also the risk: a viewer
 * can read this route, so the credential-bearing keys have to stay out. Both
 * directions are asserted here, because a change that satisfies one by breaking
 * the other looks like a fix from either side alone.
 *
 * The test drives a real Fastify instance rather than calling a handler,
 * because the stripping happens during serialization - a handler-level
 * assertion passes while the client receives nothing.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { getChannelSchema } from '../../src/api/schemas/notification-schema.js';

const CHANNEL_ID = '9f5a1c60-0f6f-4d1f-9d31-2a3d3e5b6c77';

/** An email channel as the repository deserializes one, secrets included. */
function emailChannel() {
  return {
    id: CHANNEL_ID,
    project_id: 'b1d1e0a2-6a1a-4f2e-9a77-1f6c0b6a2d34',
    name: 'Production alerts',
    type: 'email',
    config: {
      type: 'email',
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_secure: true,
      smtp_user: 'alerts@example.com',
      smtp_pass: 'super-secret-password',
      from_address: 'alerts@example.com',
      from_name: 'BugSpotter',
    },
    active: true,
    last_success_at: null,
    last_failure_at: null,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

async function serializeThroughSchema(channel: Record<string, unknown>) {
  const app = Fastify();
  app.get('/channels/:id', { schema: getChannelSchema }, async () => ({
    success: true as const,
    data: channel,
    timestamp: new Date(0).toISOString(),
  }));
  const response = await app.inject({ method: 'GET', url: `/channels/${CHANNEL_ID}` });
  await app.close();
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

describe('notification channel response schema', () => {
  it('keeps the non-secret config fields instead of serializing config to {}', async () => {
    const { statusCode, body } = await serializeThroughSchema(emailChannel());

    expect(statusCode).toBe(200);
    // The assertion that fails when config loses its declared properties: the
    // edit dialog reads exactly these to populate its form.
    expect(body.data.config).toMatchObject({
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_secure: true,
      smtp_user: 'alerts@example.com',
      from_address: 'alerts@example.com',
      from_name: 'BugSpotter',
    });
    expect(body.data.config).not.toEqual({});
  });

  it('withholds the SMTP password', async () => {
    const { body } = await serializeThroughSchema(emailChannel());

    expect(body.data.config).not.toHaveProperty('smtp_pass');
    expect(JSON.stringify(body)).not.toContain('super-secret-password');
  });

  it('withholds the webhook URL, which is itself the credential', async () => {
    const channel = {
      ...emailChannel(),
      type: 'slack',
      config: {
        type: 'slack',
        webhook_url: 'https://hooks.slack.com/services/T000/B000/xoxb-secret',
        channel: '#alerts',
        username: 'BugSpotter',
      },
    };

    const { body } = await serializeThroughSchema(channel);

    expect(body.data.config).not.toHaveProperty('webhook_url');
    expect(JSON.stringify(body)).not.toContain('xoxb-secret');
    // The rest of the Slack config still reaches the form.
    expect(body.data.config.channel).toBe('#alerts');
    expect(body.data.config.username).toBe('BugSpotter');
  });

  it('withholds webhook auth values, signature secrets and headers', async () => {
    const channel = {
      ...emailChannel(),
      type: 'webhook',
      config: {
        type: 'webhook',
        url: 'https://api.example.com/hooks/bugs',
        method: 'POST',
        auth_type: 'bearer',
        auth_value: 'bearer-token-secret',
        signature_secret: 'hmac-secret',
        headers: { Authorization: 'Bearer header-secret' },
        timeout_ms: 5000,
      },
    };

    const { body } = await serializeThroughSchema(channel);

    expect(body.data.config).not.toHaveProperty('auth_value');
    expect(body.data.config).not.toHaveProperty('signature_secret');
    // `headers` routinely carries an Authorization value, so the whole object
    // is withheld rather than filtered key by key.
    expect(body.data.config).not.toHaveProperty('headers');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('bearer-token-secret');
    expect(serialized).not.toContain('hmac-secret');
    expect(serialized).not.toContain('header-secret');

    expect(body.data.config).toMatchObject({
      url: 'https://api.example.com/hooks/bugs',
      method: 'POST',
      auth_type: 'bearer',
      timeout_ms: 5000,
    });
  });

  it('drops a config key nobody has declared yet, rather than leaking it', async () => {
    // additionalProperties: false makes the omission fail-closed - a field
    // added to ChannelConfig later shows up blank in the UI instead of being
    // disclosed to every viewer before anyone classifies it.
    const channel = emailChannel();
    const config = channel.config as Record<string, unknown>;
    config.oauth_refresh_token = 'not-yet-classified';

    const { body } = await serializeThroughSchema(channel);

    expect(body.data.config).not.toHaveProperty('oauth_refresh_token');
    expect(JSON.stringify(body)).not.toContain('not-yet-classified');
  });
});
