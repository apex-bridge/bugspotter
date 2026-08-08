/**
 * Guards the shared-replay response schema against silently dropping media URLs.
 *
 * Fastify serializes a response through its schema and removes any property the
 * schema does not declare. The share route signs screenshot and thumbnail URLs
 * and puts them on `bug_report` (share-tokens.ts), but they were absent from the
 * schema, so every shared link lost them - with no error anywhere, and storage
 * perfectly healthy. `replay_url` was unaffected only because it is declared one
 * level up on `data`, and that asymmetry is what made it read as a storage bug.
 *
 * The test drives a real Fastify instance rather than calling the handler,
 * because the stripping happens in serialization: a handler-level assertion
 * passes while the client receives nothing.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { getSharedReplaySchema } from '../../src/api/schemas/share-token-schema.js';

/** A response body shaped like the one share-tokens.ts builds. */
function sharedReplayPayload() {
  return {
    success: true as const,
    data: {
      bug_report: {
        id: '3f24a1d7-1816-4553-b29d-5df19586f882',
        title: 'Checkout crash',
        description: 'Payment processor undefined',
        status: 'open',
        priority: 'medium',
        created_at: new Date(0).toISOString(),
        screenshot_url: 'https://storage.example.com/screenshots/a/original.png?X-Amz-Signature=x',
        thumbnail_url: 'https://storage.example.com/screenshots/a-thumb/original.png?X-Amz-Sig=y',
      },
      replay_url: 'https://storage.example.com/replays/a/replay.gz?X-Amz-Signature=z',
      share_info: {
        view_count: 1,
        expires_at: new Date(0).toISOString(),
        password_protected: false,
      },
    },
    timestamp: new Date(0).toISOString(),
  };
}

// The schema validates the request too: params require a >=32-char token.
const TOKEN = 'a'.repeat(43);
const URL = `/replays/shared/${TOKEN}`;

async function serializeThroughSchema(
  payload: ReturnType<typeof sharedReplayPayload> = sharedReplayPayload()
) {
  const app = Fastify();
  app.get('/replays/shared/:token', { schema: getSharedReplaySchema }, async () => payload);
  const response = await app.inject({ method: 'GET', url: URL });
  await app.close();
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

describe('getSharedReplaySchema', () => {
  it('keeps screenshot_url and thumbnail_url on the shared bug report', async () => {
    const { statusCode, body } = await serializeThroughSchema();

    expect(statusCode).toBe(200);
    // The assertion that fails when either property is dropped from the schema.
    expect(body.data.bug_report.screenshot_url).toBe(
      sharedReplayPayload().data.bug_report.screenshot_url
    );
    expect(body.data.bug_report.thumbnail_url).toBe(
      sharedReplayPayload().data.bug_report.thumbnail_url
    );
  });

  it('still returns replay_url and the rest of the bug report', async () => {
    const { body } = await serializeThroughSchema();

    expect(body.data.replay_url).toBe(sharedReplayPayload().data.replay_url);
    expect(body.data.bug_report.id).toBe(sharedReplayPayload().data.bug_report.id);
    expect(body.data.bug_report.title).toBe('Checkout crash');
  });

  it('accepts null media URLs, for a report that has no screenshot', async () => {
    const payload = sharedReplayPayload();
    payload.data.bug_report.screenshot_url = null as unknown as string;
    payload.data.bug_report.thumbnail_url = null as unknown as string;

    const { statusCode, body } = await serializeThroughSchema(payload);

    expect(statusCode).toBe(200);
    expect(body.data.bug_report.screenshot_url).toBeNull();
    expect(body.data.bug_report.thumbnail_url).toBeNull();
  });
});
