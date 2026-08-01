# Spec: backend proxy must forward org similarity threshold to intelligence service

<!-- This is the AI-generated spec document. .github/ISSUE_TEMPLATE/spec.yml is
     the human issue-filing form - different structure, different purpose. -->

Linked issue: Refs #237
ADR: n/a

**Files touched:** `packages/backend/src/api/routes/intelligence.ts`, `packages/backend/src/queue/workers/intelligence-worker.ts`, `packages/backend/tests/api/intelligence-routes.test.ts`, `packages/backend/tests/queue/intelligence-worker.test.ts` (new)
**Blocking prerequisites:** none

## Problem

The org-level `intelligence_similarity_threshold` setting (stored in `organizations.settings`, resolved via `tenant-config.ts`, fully wired through the admin CRUD API and admin UI) has no effect anywhere it should. The interactive similar-bugs route (`GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar`, `intelligence.ts:216-224`) only reads a client-supplied `threshold` query param. The automated dedup/auto-close worker (`intelligence-worker.ts`'s `processAnalyzeJob`, `getSimilarBugs` call at line 221) sends no threshold at all. Every org - whether or not it configured a custom threshold - gets whatever single global default the external `bugspotter-intelligence` Python service happens to be running with. This drives real auto-dedup/auto-close behavior for every organization, not just an API response value.

Prior history, for anyone reading this after the fact: this bug was previously misdiagnosed and "fixed" against a hallucinated in-repo TypeScript package (`packages/bugspotter-intelligence`), deleted in PR #260 once discovered. The real `bugspotter-intelligence` is a separate Python/FastAPI service in its own repo (see ADR-0007). `intelligence-client.ts` and the docker-compose service pointing at it were never touched by that episode and don't need to change here - this spec supersedes the one merged for this issue on 2026-07-19, which targeted the deleted package.

## Out of scope

- Changes to the external `bugspotter-intelligence` Python service - its `/api/v1/bugs/{bug_id}/similar` endpoint already accepts a `threshold` query param and falls back to its own global config default when omitted (`bug_query_service.py:89-93`); that fallback is exactly what this fix relies on.
- Changes to `intelligence-client.ts`'s `getSimilarBugs()` - it already omits the `threshold` query param entirely when `undefined` (`intelligence-client.ts:101-103`), which is the correct behavior for preserving the Python service's own fallback.
- UI surface for configuring `intelligence_similarity_threshold` - already exists (`intelligence-settings-panel.tsx`), untouched here.
- Aligning `intelligence_similarity_threshold`'s accepted PATCH range with anything else - not touched.
- Caching the per-request `db.organizations.findById` read - the client-resolution path in `resolveClient` already does an uncached read of the same kind; this fix adds one more, not a new caching concern.

## Constraints

1. Must NOT use `getOrgIntelligenceSettings`/`resolveOrgIntelligenceSettings` (`tenant-config.ts`) to obtain the fallback threshold. Both bake in a hardcoded default (0.75) whenever the org hasn't set a value (`tenant-config.ts:116-118`), which would make every org without an explicit override silently send `0.75` to the Python service - overriding its own global default rather than falling through to it. Must read the raw `org.settings.intelligence_similarity_threshold` (via `db.organizations.findById(orgId)`; `OrganizationSettings` type at `db/types.ts:705`) and only forward it when it is not `null`/`undefined`.
2. Precedence: client-supplied `threshold` (route) wins first; else the org's explicit raw setting if present; else omit the param entirely so `intelligence-client.ts`'s existing `undefined`-omission behavior and the Python service's own fallback apply. Never synthesize a value when neither the client nor the org has one.
3. In the route handler, only look up the org's threshold when `request.query.threshold` is `undefined` - avoid an unnecessary DB read on the common path where the client already supplied one.
4. `request.project.organization_id` is reliably populated in this handler: the route's `guard(db, { auth: 'userOrApiKey', resource: { type: 'project', paramName: 'projectId' } })` preHandler sets `request.project` before the handler runs (`project-access.ts:125`, documented as guaranteed at line 54-55 of the same file).
5. In the worker (`processAnalyzeJob`), `resolvedOrgId: string | undefined` is already an existing parameter (used later for `applyDedupAction` at line ~244) - reuse it, don't re-derive the org id.
6. `processAnalyzeJob` is currently not exported from `intelligence-worker.ts` (only `createIntelligenceWorker` is) and has zero test coverage today - there's an existing `// TODO: Add unit tests (processAnalyzeJob, ...)` at line 51. Export it (named export, no behavior change) so it can be unit-tested directly. The existing worker-test convention in this repo (e.g. `notification-worker.test.ts`) only shallow-tests worker creation and job-data validation, not processor logic - there's no existing harness for driving a job through the created worker's internal processor callback, so direct export-and-call is the pragmatic path here, not a new pattern to invent.
7. `createMockDb()` in `intelligence-routes.test.ts` (line ~97) has no `organizations` key - add `organizations: { findById: vi.fn() }`, matching the existing `projects` mock shape in that file.

## Acceptance criteria

- [ ] `GET .../similar?threshold=0.9`, org has `intelligence_similarity_threshold: 0.7` set - calls `getSimilarBugs` with `threshold: 0.9` and does not query `organizations.findById` - verified by test case A
- [ ] `GET .../similar` (no `threshold` param), org has `intelligence_similarity_threshold: 0.7` set - calls `getSimilarBugs` with `threshold: 0.7` - verified by test case B
- [ ] `GET .../similar` (no `threshold` param), org has no `intelligence_similarity_threshold` set (`null`/absent from `settings`) - calls `getSimilarBugs` with `threshold: undefined` (param omitted, never defaulted to `0.75`) - verified by test case C
- [ ] `GET .../similar` when `request.project.organization_id` is absent (self-hosted / no org) - does not attempt an org lookup and calls `getSimilarBugs` with `threshold: undefined` - verified by test case D
- [ ] Worker's `processAnalyzeJob`, given `resolvedOrgId` with an explicit org threshold set - calls `client.getSimilarBugs(bugReportId, { projectId, threshold: <org value> })` - verified by test case E
- [ ] Worker's `processAnalyzeJob`, given `resolvedOrgId` with no org threshold set - calls `getSimilarBugs` with `threshold: undefined` - verified by test case F
- [ ] Worker's `processAnalyzeJob`, given `resolvedOrgId === undefined` - does not attempt an org lookup - verified by test case G
- [ ] All existing tests in `intelligence-routes.test.ts` and the new intelligence-worker suite pass

## Changes

### `packages/backend/src/api/routes/intelligence.ts`

Add a small helper, and call it only when the client didn't already supply a threshold, right before the existing `getSimilarBugs` call.

```ts
// Add near resolveClient:
async function resolveOrgThreshold(
  db: DatabaseClient,
  orgId: string | undefined
): Promise<number | undefined> {
  if (!orgId) return undefined;
  const org = await db.organizations.findById(orgId);
  return org?.settings?.intelligence_similarity_threshold ?? undefined;
}
```

```ts
// Replace the existing handler body (lines 216-222):
const { projectId, id } = request.params;
let { threshold, limit } = request.query;
const client = await resolveClient(request, clientFactory, intelligenceClient);

if (threshold === undefined) {
  threshold = await resolveOrgThreshold(db, request.project?.organization_id ?? undefined);
}

const result = await handleIntelligenceRequest(client, (c) =>
  c.getSimilarBugs(id, { threshold, limit, projectId })
);
```

### `packages/backend/src/queue/workers/intelligence-worker.ts`

```ts
// Change the function to a named export (line 187) - no other signature change:
export async function processAnalyzeJob(
```

```ts
// Replace the existing call (line 221):
// Before:
const similarResult = await client.getSimilarBugs(bugReportId, { projectId });

// After:
let orgThreshold: number | undefined;
if (resolvedOrgId) {
  const org = await db.organizations.findById(resolvedOrgId);
  orgThreshold = org?.settings?.intelligence_similarity_threshold ?? undefined;
}
const similarResult = await client.getSimilarBugs(bugReportId, {
  projectId,
  threshold: orgThreshold,
});
```

## Tests

### `packages/backend/tests/api/intelligence-routes.test.ts`

**Mock/fixture updates required:**

```ts
// createMockDb(), add alongside the existing `projects` key:
organizations: {
  findById: vi.fn().mockResolvedValue({ id: MOCK_ORG_ID, settings: {} }),
},
```

**Test case A - client threshold wins, no org lookup (AC #1):**

```ts
it('uses the client-supplied threshold and does not look up the org setting', async () => {
  const mockDb = createMockDb();
  intelligenceRoutes(app, globalClient, mockDb, clientFactory as any);
  await app.inject({
    method: 'GET',
    url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar?threshold=0.9`,
  });
  expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
    BUG_ID,
    expect.objectContaining({ threshold: 0.9 })
  );
  expect(mockDb.organizations.findById).not.toHaveBeenCalled();
});
```

**Test case B - org threshold used when client omits one (AC #2):**

```ts
it('falls back to the org threshold when the client omits one', async () => {
  const mockDb = createMockDb();
  mockDb.organizations.findById.mockResolvedValue({
    id: MOCK_ORG_ID,
    settings: { intelligence_similarity_threshold: 0.7 },
  });
  intelligenceRoutes(app, globalClient, mockDb, clientFactory as any);
  await app.inject({
    method: 'GET',
    url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
  });
  expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
    BUG_ID,
    expect.objectContaining({ threshold: 0.7 })
  );
});
```

**Test case C - no org setting, threshold omitted not defaulted (AC #3):**

```ts
it('omits threshold entirely when neither client nor org has one set', async () => {
  const mockDb = createMockDb(); // organizations.findById resolves { settings: {} } by default
  intelligenceRoutes(app, globalClient, mockDb, clientFactory as any);
  await app.inject({
    method: 'GET',
    url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
  });
  expect(orgClient.getSimilarBugs).toHaveBeenCalledWith(
    BUG_ID,
    expect.objectContaining({ threshold: undefined })
  );
});
```

**Test case D - no org context, no lookup attempted (AC #4):**

```ts
it('does not attempt an org lookup when there is no organization_id (self-hosted)', async () => {
  const mockDb = createMockDb();
  mockDb.projects.findById.mockResolvedValue({ id: 'proj-1', organization_id: null });
  intelligenceRoutes(app, globalClient, mockDb); // no clientFactory - self-hosted path
  await app.inject({
    method: 'GET',
    url: `/api/v1/intelligence/projects/${PROJECT_ID}/bugs/${BUG_ID}/similar`,
  });
  expect(mockDb.organizations.findById).not.toHaveBeenCalled();
});
```

### `packages/backend/tests/queue/intelligence-worker.test.ts` (new file)

**Mock/fixture updates required:**

New file. Build minimal `DatabaseClient`/`IntelligenceClient`/`IJobHandle` mocks (`DatabaseClient` mock shape follows `notification-worker.test.ts`'s pattern), plus `organizations: { findById: vi.fn() }`. Import `processAnalyzeJob` directly per constraint #6 - no `createIntelligenceWorker`/queue harness needed for these cases.

**Test case E - worker forwards the org threshold (AC #5):**

```ts
it('forwards the org similarity threshold to getSimilarBugs', async () => {
  const mockDb = {
    organizations: {
      findById: vi.fn().mockResolvedValue({ settings: { intelligence_similarity_threshold: 0.7 } }),
    },
  } as any;
  const mockClient = {
    analyzeBug: vi.fn().mockResolvedValue({ embedding_generated: true, stored: true }),
    getSimilarBugs: vi.fn().mockResolvedValue({ is_duplicate: false, similar_bugs: [] }),
  } as any;
  const job = {
    id: 'job-1',
    data: { bugReportId: 'bug-1', projectId: 'proj-1', payload: { bug_id: 'bug-1' } },
  } as any;

  await processAnalyzeJob(job, mockClient, mockDb, 'org-1', Date.now(), mockRuleExecutor);

  expect(mockClient.getSimilarBugs).toHaveBeenCalledWith(
    'bug-1',
    expect.objectContaining({ threshold: 0.7 })
  );
});
```

**Test case F - no org setting, threshold omitted (AC #6):**

```ts
it('omits threshold when the org has none set', async () => {
  const mockDb = {
    organizations: { findById: vi.fn().mockResolvedValue({ settings: {} }) },
  } as any;
  // ...same client/job setup as test case E...

  await processAnalyzeJob(job, mockClient, mockDb, 'org-1', Date.now(), mockRuleExecutor);

  expect(mockClient.getSimilarBugs).toHaveBeenCalledWith(
    'bug-1',
    expect.objectContaining({ threshold: undefined })
  );
});
```

**Test case G - no resolvedOrgId, no lookup (AC #7):**

```ts
it('does not look up an org when resolvedOrgId is undefined', async () => {
  const mockDb = { organizations: { findById: vi.fn() } } as any;
  // ...same client/job setup, pass undefined for resolvedOrgId...

  await processAnalyzeJob(job, mockClient, mockDb, undefined, Date.now(), mockRuleExecutor);

  expect(mockDb.organizations.findById).not.toHaveBeenCalled();
});
```

## Verification

```bash
pnpm --filter @bugspotter/backend typecheck
pnpm --filter @bugspotter/backend test:unit
```

Rollback: n/a - purely additive read plus conditional param forwarding on two existing call sites; reverting restores current (buggy) behavior with no data or schema impact.
