/**
 * Dedup Rules API — route-level smoke tests.
 *
 * Auth middleware is mocked to no-op (covered by the dedicated
 * authorization tests). The interesting surface here is:
 *  - Zod validation on POST / PATCH-full (rejection shape + 400)
 *  - the (project_id, name) uniqueness pre-check returning 409
 *  - PATCH toggle-only path vs PATCH full-replace path
 *  - cross-project guard on ruleId lookup
 *  - delete cascade-trigger is exercised by the integration migration test,
 *    not here — this file just verifies the handler returns success
 *    and the repo's `delete` was called.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { DedupRuleRow } from '../../../src/db/dedup-rule.repository.js';

vi.mock('../../../src/api/middleware/auth.js', () => ({
  requireAuth: vi.fn(async () => undefined),
  requireProjectRole: () => async () => undefined,
  requireApiKeyPermission: () => async () => undefined,
}));

vi.mock('../../../src/api/middleware/project-access.js', () => ({
  requireProjectAccess: () => async () => undefined,
}));

vi.mock('../../../src/logger.js', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import AFTER mocks so route module resolves to the stubs.
import { registerDedupRuleRoutes } from '../../../src/api/routes/dedup-rules.js';
import { errorHandler } from '../../../src/api/middleware/error.js';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const OTHER_PROJECT_ID = '00000000-0000-0000-0000-000000000002';
const RULE_ID = '11111111-1111-1111-1111-111111111111';

function makeRow(overrides: Partial<DedupRuleRow> = {}): DedupRuleRow {
  return {
    id: RULE_ID,
    project_id: PROJECT_ID,
    name: 'r',
    rule_json: {},
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

interface MockDedupRepo {
  findByProject: Mock;
  findById: Mock;
  findByProjectAndName: Mock;
  create: Mock;
  update: Mock;
  delete: Mock;
}

function makeDb(): { db: DatabaseClient; repo: MockDedupRepo } {
  const repo: MockDedupRepo = {
    findByProject: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    findByProjectAndName: vi.fn(async () => null),
    create: vi.fn(async (data) => makeRow({ ...data, id: 'created' })),
    update: vi.fn(async () => makeRow({ id: 'updated' })),
    delete: vi.fn(async () => true),
  };
  const db = { dedupRules: repo } as unknown as DatabaseClient;
  return { db, repo };
}

async function buildServer(db: DatabaseClient): Promise<FastifyInstance> {
  const server = Fastify();
  server.setErrorHandler(errorHandler);
  registerDedupRuleRoutes(server, db);
  await server.ready();
  return server;
}

const VALID_RULE_BODY = {
  name: 'Notify reporter on dedup',
  when: { type: 'duplicate_detected' },
  conditions: [],
  then: [{ type: 'notify.email', to: 'reporter', template: 'dedup_ack' }],
  rate_limit: { count: 1, window: '24h' },
  enabled: true,
};

describe('Dedup Rules API', () => {
  let server: FastifyInstance;
  let repo: MockDedupRepo;

  beforeEach(() => {
    const setup = makeDb();
    repo = setup.repo;
    return buildServer(setup.db).then((s) => {
      server = s;
    });
  });

  afterEach(async () => {
    await server?.close();
  });

  describe('GET /projects/:projectId/dedup-rules', () => {
    it('lists rules (including disabled) for the project', async () => {
      repo.findByProject.mockResolvedValueOnce([
        makeRow({ name: 'B1' }),
        makeRow({ name: 'B2', enabled: false }),
      ]);

      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.rules).toHaveLength(2);
      // includeDisabled=true so the admin UI can render disabled rows.
      expect(repo.findByProject).toHaveBeenCalledWith(PROJECT_ID, true);
    });
  });

  describe('GET /projects/:projectId/dedup-rules/:ruleId', () => {
    it('returns the rule when it belongs to the project', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ name: 'B1' }));
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.rule.name).toBe('B1');
    });

    it('returns 404 when the rule belongs to a different project', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ project_id: OTHER_PROJECT_ID }));
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when the rule does not exist', async () => {
      repo.findById.mockResolvedValueOnce(null);
      const res = await server.inject({
        method: 'GET',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /projects/:projectId/dedup-rules', () => {
    it('creates a valid rule and returns 201', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules`,
        payload: VALID_RULE_BODY,
      });

      expect(res.statusCode).toBe(201);
      expect(repo.create).toHaveBeenCalledOnce();
      const arg = repo.create.mock.calls[0][0];
      expect(arg.project_id).toBe(PROJECT_ID);
      expect(arg.name).toBe('Notify reporter on dedup');
      expect(arg.enabled).toBe(true);
    });

    it('returns 400 with the offending field on Zod failure', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules`,
        payload: { ...VALID_RULE_BODY, when: { type: 'unknown_trigger' } },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain('Invalid dedup rule');
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns 400 when then[] is empty (schema requires min 1 action)', async () => {
      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules`,
        payload: { ...VALID_RULE_BODY, then: [] },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 409 when a rule with the same name already exists', async () => {
      repo.findByProjectAndName.mockResolvedValueOnce(
        makeRow({ name: 'Notify reporter on dedup' })
      );

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules`,
        payload: VALID_RULE_BODY,
      });

      expect(res.statusCode).toBe(409);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('returns 409 when a concurrent insert wins the TOCTOU race (pg 23505)', async () => {
      // Pre-check passes (no existing row), then a parallel POST commits
      // first; our INSERT trips the unique constraint. The handler must
      // map 23505 to 409, not let it surface as a 500.
      const uniqueErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
      repo.create.mockRejectedValueOnce(uniqueErr);

      const res = await server.inject({
        method: 'POST',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules`,
        payload: VALID_RULE_BODY,
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe('PATCH /projects/:projectId/dedup-rules/:ruleId', () => {
    it('toggles enabled and keeps rule_json.enabled in sync', async () => {
      repo.findById.mockResolvedValueOnce(
        makeRow({ rule_json: { name: 'r', enabled: true, foo: 'bar' } })
      );
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(200);
      // Both the column and the blob field must flip together so any
      // future code reading rule_json.enabled (the admin UI, a
      // re-validation pass) doesn't see drift.
      const arg = repo.update.mock.calls[0][1];
      expect(arg.enabled).toBe(false);
      expect(arg.rule_json).toMatchObject({ enabled: false, foo: 'bar' });
    });

    it('rejects non-boolean enabled on the toggle-only path', async () => {
      repo.findById.mockResolvedValueOnce(makeRow());
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
        payload: { enabled: 'no' },
      });
      expect(res.statusCode).toBe(400);
    });

    it.each([
      ['null', null],
      ['primitive string', 'broken'],
      ['array', ['a', 'b']],
    ])(
      'toggle path falls back to { enabled } on malformed rule_json (%s)',
      async (_label, malformed) => {
        // Defensive fallback path: the row's rule_json is unparseable,
        // so the toggle nudges it toward a canonical shape rather than
        // TypeError-ing on spread. The executor would have rejected
        // the malformed blob anyway; migration 025's backfill is the
        // recovery mechanism for the rule definition itself.
        repo.findById.mockResolvedValueOnce(makeRow({ rule_json: malformed }));
        const res = await server.inject({
          method: 'PATCH',
          url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
          payload: { enabled: false },
        });
        expect(res.statusCode).toBe(200);
        const arg = repo.update.mock.calls[0][1];
        expect(arg.enabled).toBe(false);
        expect(arg.rule_json).toEqual({ enabled: false });
      }
    );

    it('replaces the full rule when the body is the complete DedupRule shape', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ name: 'Old name' }));
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
        payload: { ...VALID_RULE_BODY, name: 'New name' },
      });
      expect(res.statusCode).toBe(200);
      const arg = repo.update.mock.calls[0][1];
      expect(arg.name).toBe('New name');
      expect(arg.rule_json).toMatchObject({ name: 'New name' });
    });

    it('preserves existing enabled when full-PATCH body omits the field', async () => {
      // The Zod schema has `enabled: z.boolean().default(true)`. Without
      // explicit handling, a full-rule PATCH that doesn't carry `enabled`
      // would Zod-fill `true` and silently re-enable a previously-disabled
      // rule. The route preserves the existing column value in that case.
      repo.findById.mockResolvedValueOnce(makeRow({ name: 'Old name', enabled: false }));
      const { enabled: _drop, ...bodyWithoutEnabled } = VALID_RULE_BODY;
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
        payload: { ...bodyWithoutEnabled, name: 'New name' },
      });
      expect(res.statusCode).toBe(200);
      const arg = repo.update.mock.calls[0][1];
      expect(arg.enabled).toBe(false);
      expect(arg.rule_json).toMatchObject({ enabled: false });
    });

    it('returns 409 if the renamed rule collides with another in the project', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ name: 'Old name' }));
      repo.findByProjectAndName.mockResolvedValueOnce(
        makeRow({ id: 'other-id', name: 'New name' })
      );

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
        payload: { ...VALID_RULE_BODY, name: 'New name' },
      });

      expect(res.statusCode).toBe(409);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('returns 409 when the rename race trips pg 23505 (TOCTOU)', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ name: 'Old name' }));
      // Pre-check finds no collision, but a concurrent rename slips
      // through; the UPDATE trips the unique constraint.
      const uniqueErr = Object.assign(new Error('duplicate key value'), { code: '23505' });
      repo.update.mockRejectedValueOnce(uniqueErr);

      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
        payload: { ...VALID_RULE_BODY, name: 'New name' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('returns 404 when the rule is scoped to another project', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ project_id: OTHER_PROJECT_ID }));
      const res = await server.inject({
        method: 'PATCH',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(404);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /projects/:projectId/dedup-rules/:ruleId', () => {
    it('deletes the rule when found', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ name: 'B1' }));
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
      });
      expect(res.statusCode).toBe(200);
      expect(repo.delete).toHaveBeenCalledWith(RULE_ID);
    });

    it('returns 404 and skips delete when the rule is not in this project', async () => {
      repo.findById.mockResolvedValueOnce(makeRow({ project_id: OTHER_PROJECT_ID }));
      const res = await server.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${PROJECT_ID}/dedup-rules/${RULE_ID}`,
      });
      expect(res.statusCode).toBe(404);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});
