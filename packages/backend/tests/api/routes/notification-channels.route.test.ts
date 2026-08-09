/**
 * PATCH /notifications/channels/:id - config merge.
 *
 * The response schema withholds the credential-bearing config fields, so no
 * client can echo them back on an edit. A replacing write would therefore drop
 * the SMTP password or webhook URL every time someone renamed a channel, which
 * is exactly the bug this guards: the route merges the incoming config over the
 * stored one instead.
 *
 * Auth is mocked to a no-op - it is covered by the authorization tests, and the
 * surface here is what reaches the repository.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../../src/db/client.js';

vi.mock('../../../src/api/middleware/auth.js', () => ({
  requireAuth: vi.fn(async () => undefined),
  requireProjectRole: () => async () => undefined,
  requireApiKeyPermission: () => async () => undefined,
}));

const findChannelAndCheckAccess = vi.fn();

vi.mock('../../../src/api/routes/notifications/helpers.js', () => ({
  findChannelAndCheckAccess: (...args: unknown[]) => findChannelAndCheckAccess(...args),
  testChannelDelivery: vi.fn(),
  logResourceOperation: vi.fn(),
}));

// Import AFTER the mocks so the route module resolves to the stubs.
import { registerChannelRoutes } from '../../../src/api/routes/notifications/channels.js';

const CHANNEL_ID = '9f5a1c60-0f6f-4d1f-9d31-2a3d3e5b6c77';
const PROJECT_ID = 'b1d1e0a2-6a1a-4f2e-9a77-1f6c0b6a2d34';

const STORED_CONFIG = {
  type: 'email',
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_secure: true,
  smtp_user: 'alerts@example.com',
  smtp_pass: 'super-secret-password',
  from_address: 'alerts@example.com',
  from_name: 'BugSpotter',
};

function storedChannel(config: Record<string, unknown> = STORED_CONFIG) {
  return {
    id: CHANNEL_ID,
    project_id: PROJECT_ID,
    name: 'Production alerts',
    type: 'email',
    config,
    active: true,
    last_success_at: null,
    last_failure_at: null,
    failure_count: 0,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

let update: Mock;

async function buildApp(): Promise<FastifyInstance> {
  update = vi.fn(async (_id: string, updates: Record<string, unknown>) =>
    storedChannel({ ...STORED_CONFIG, ...((updates.config as Record<string, unknown>) ?? {}) })
  );
  const db = { notificationChannels: { update } } as unknown as DatabaseClient;

  const app = Fastify();
  registerChannelRoutes(app, db);
  await app.ready();
  return app;
}

async function patch(app: FastifyInstance, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/notifications/channels/${CHANNEL_ID}`,
    payload,
  });
}

/** What the route handed the repository as `config`. */
function configWrittenToDb(): Record<string, unknown> | undefined {
  return update.mock.calls[0]?.[1]?.config;
}

describe('PATCH notification channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findChannelAndCheckAccess.mockResolvedValue(storedChannel());
  });

  it('keeps the stored password when the edit form sends config without it', async () => {
    const app = await buildApp();

    // What the admin dialog sends after a rename: every field it can see, and
    // no credential, because the API never gave it one.
    const response = await patch(app, {
      name: 'Renamed alerts',
      config: {
        type: 'email',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_secure: true,
        smtp_user: 'alerts@example.com',
        from_address: 'alerts@example.com',
        from_name: 'BugSpotter',
      },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(configWrittenToDb()?.smtp_pass).toBe('super-secret-password');
  });

  it('applies the fields the client did send', async () => {
    const app = await buildApp();

    const response = await patch(app, {
      config: { smtp_host: 'smtp.new-provider.com', smtp_port: 2525 },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(configWrittenToDb()).toMatchObject({
      smtp_host: 'smtp.new-provider.com',
      smtp_port: 2525,
      // untouched, and still present
      smtp_pass: 'super-secret-password',
      from_address: 'alerts@example.com',
    });
  });

  it('replaces a credential the user did retype', async () => {
    const app = await buildApp();

    const response = await patch(app, { config: { smtp_pass: 'rotated-password' } });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(configWrittenToDb()?.smtp_pass).toBe('rotated-password');
  });

  it('leaves config untouched when the PATCH omits it', async () => {
    const app = await buildApp();

    const response = await patch(app, { name: 'Renamed alerts' });
    await app.close();

    expect(response.statusCode).toBe(200);
    // undefined, not `{}` - serializeForUpdate skips the column entirely.
    expect(configWrittenToDb()).toBeUndefined();
    expect(update.mock.calls[0]?.[1]?.name).toBe('Renamed alerts');
  });

  it('does not merge an empty config into a wipe', async () => {
    const app = await buildApp();

    // The pre-fix admin dialog sent exactly this - config seeded from the `{}`
    // the API returned. It has to be a no-op, not a wipe.
    const response = await patch(app, { name: 'Renamed alerts', config: {} });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(configWrittenToDb()).toEqual(STORED_CONFIG);
  });
});
