# Spec: Backend proxy must forward org similarity threshold to intelligence service

<!-- Keep in sync with .github/ISSUE_TEMPLATE/spec.yml — that template is the canonical source. -->

Linked issue: Refs #237
ADR: pending

## Problem / motivation

`GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` resolves the similarity threshold exclusively from the client-supplied `threshold` query param. The per-org `intelligence_similarity_threshold` stored in `intelligence_settings` and resolved through `tenant-config.ts` is never read inside the route handler and is never forwarded to the `bugspotter-intelligence` service. As a result, the `resolveThreshold(queryValue, orgDefault)` helper introduced in #226 always receives `undefined` as `orgDefault`, making the org-level setting a no-op end-to-end. Org administrators who configure a custom threshold see no effect on returned results.

## Blocking prerequisites

The following must land before this spec's "How" steps can run end-to-end:

- **#238 — graduate `bugspotter-intelligence` scaffold**: the package currently has no `package.json`, `tsconfig.json`, or `vitest.config.ts`, and `@sinclair/typebox` (imported by `similar.ts`) is not in `pnpm-lock.yaml`. Steps 4–7 below (`pnpm --filter bugspotter-intelligence build/test`) will fail to even resolve the package until #238 is merged.

## Scope and constraints

In scope:

- Reading `intelligence_similarity_threshold` directly from the org's `settings` JSONB via `db.organizations.findById` inside the similar-bugs route handler in `packages/backend/src/api/routes/intelligence.ts` (raw read, not `getOrgIntelligenceSettings`, to preserve the `undefined` signal when no override is set — see Constraints)
- Passing the resolved org threshold as `orgThreshold` to `IntelligenceClient.getSimilarBugs`
- Forwarding `orgThreshold` as the `org_threshold` query param in the HTTP request made by `IntelligenceClient` to the intelligence service
- Adding `org_threshold` to the querystring schema in `packages/bugspotter-intelligence/src/routes/bugs/similar.ts` and passing it as `orgDefault` to `resolveThreshold`
- Unit tests for the five threshold-precedence cases enumerated in the How section

Out of scope:

- Changes to the `resolveThreshold` function itself (already correct from #226)
- UI surface for configuring `intelligence_similarity_threshold` (tracked separately)
- Caching of the per-org settings DB read (the `db.organizations.findById` call runs uncached on every `/similar` request; the `clientFactory` LRU cache only covers the `IntelligenceClient` instance, not raw settings). Acceptable for a first pass; a follow-up should evaluate whether to extend the cache or batch the reads.
- Altering the threshold-resolution logic for any endpoint other than `/similar`
- Aligning the `intelligence_similarity_threshold` accepted range in `intelligence-settings.ts` (currently `[0, 1]`) with `resolveThreshold`'s valid range (`[0.5, 1.0]`). An org configured with a value below 0.5 will silently fall through to env/hardcoded fallback — the same "setting is a no-op" symptom this fix addresses, for a subset of otherwise-valid values. Tracked as a follow-up: either tighten the PATCH schema to `minimum: 0.5` or surface a warning to the admin.

Constraints:

- `orgThreshold` must never override an explicitly supplied client `threshold`; `resolveThreshold` precedence order (client → org → env → hardcoded 0.85) must be preserved
- The raw JSONB read must be used instead of `getOrgIntelligenceSettings`, which always fills in a 0.75 default and would collapse "org has no setting" into a number, making the env-var and hardcoded-0.85 fallback paths unreachable
- TypeScript does not propagate control-flow narrowing of an optional parameter into a nested closure. Even though `intelligenceRoutes` early-returns when `db` is falsy, `db` is still typed as `DatabaseClient | undefined` inside the nested `async (request, reply) =>` handler — `tsc --strict` emits `TS18048: 'db' is possibly 'undefined'`. Bind it to a const immediately after the early-return guard: `const database = db;`. TypeScript narrows a const binding at the point of assignment and the narrowing holds inside the closure. Use `database` (not `db`) everywhere in the handler body.
- The `org_threshold` query param sent to the intelligence service must be omitted entirely (not sent as an empty string) when no org setting exists, so that `resolveThreshold` correctly falls through to the env-var fallback
- No new database migrations are required; `intelligence_settings` and `intelligence_similarity_threshold` already exist
- Changes must not alter the public API contract of `GET /similar` as seen by external callers

## Acceptance criteria

- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar?threshold=0.9` — with org setting 0.7 — causes `resolveThreshold` to be called with `(0.9, 0.7)` and return 0.9 (client wins), verified by spying on `resolveThreshold` or the logged threshold value
- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` (no `threshold` param) — with org setting 0.7 — causes `resolveThreshold` to be called with `(undefined, 0.7)` and return 0.7, confirmed via integration test asserting the proxied request URL contains `org_threshold=0.7`
- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` (no `threshold` param) — org `settings` JSONB has no `intelligence_similarity_threshold` key (or it is null) — causes `resolveThreshold` to be called with `(undefined, undefined)` and return the `SIMILARITY_THRESHOLD` env value (0.6 in the test), verified by spying on `resolveThreshold`'s return value (not on result content, since `similar.ts` returns a stub `[]`)
- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` (no `threshold` param, no org setting, no `SIMILARITY_THRESHOLD` env var) — `resolveThreshold` returns 0.85 without error, verified by spy
- [ ] When `request.project?.organization_id` is absent, the handler does not throw and `getSimilarBugs` receives `orgThreshold: undefined`
- [ ] The `org_threshold` query param is absent from the proxied URL when `orgThreshold` is `undefined`, verified by a unit test asserting the constructed URL string
- [ ] All existing test assertions and logic in `packages/backend` and `packages/bugspotter-intelligence` continue to pass. **Note:** `createMockDb()` in `packages/backend/tests/api/intelligence-routes.test.ts` must be updated to add an `organizations` key; without it `db.organizations.findById(...)` throws `TypeError` on any test that hits the similar-bugs handler with `request.project.organization_id` set. The required addition to the helper is: `organizations: { findById: vi.fn().mockResolvedValue({ settings: { intelligence_similarity_threshold: null } }) }`. This is a mock-fixture update, not a change to test assertions or logic.

## How (runnable steps)

> **Prerequisite:** merge #238 first so `pnpm --filter bugspotter-intelligence` resolves.

```bash
# 1. No new packages required; ensure lockfile is up to date after #238 lands
cd /repo
pnpm install --frozen-lockfile

# 2. Edit the similar-bugs route handler
# File: packages/backend/src/api/routes/intelligence.ts
#
# After the existing `if (!db) { ... return; }` early-return guard,
# add a const binding to capture the narrowed type for use in closures:
#
#   const database = db;   // narrows DatabaseClient | undefined → DatabaseClient
#                          // tsc --strict does not propagate narrowing into
#                          // nested async closures from a parameter; a const
#                          // binding at this scope holds the narrowing.
#
# Inside the handler for GET /projects/:projectId/bugs/:id/similar,
# after the existing `resolveClient` call, add:
#
#   const orgThreshold: number | undefined =
#     request.project?.organization_id != null
#       ? ((await database.organizations.findById(request.project.organization_id))
#           ?.settings?.intelligence_similarity_threshold) ?? undefined
#       : undefined;
#
# Note: reads the raw JSONB field rather than going through
# getOrgIntelligenceSettings, which fills in a 0.75 default and would
# collapse "org has no setting" into a number, making the env-var and
# hardcoded-0.85 fallback paths unreachable.
#
# Then update the getSimilarBugs call from:
#   c.getSimilarBugs(id, { threshold, limit, projectId })
# to:
#   c.getSimilarBugs(id, { threshold, limit, projectId, orgThreshold })

# 3. Forward orgThreshold in IntelligenceClient
# File: packages/backend/src/services/intelligence/intelligence-client.ts
#
# In getSimilarBugs, add orgThreshold to the params object:
#
#   const params: Record<string, string> = {};
#   if (options?.threshold !== undefined) {
#     params.threshold = String(options.threshold);
#   }
#   if (options?.limit !== undefined) {
#     params.limit = String(options.limit);
#   }
#   if (options?.projectId !== undefined) {
#     params.project_id = options.projectId;
#   }
#   if (options?.orgThreshold !== undefined) {
#     params.org_threshold = String(options.orgThreshold);
#   }
#
# Update the method signature to accept orgThreshold:
#   getSimilarBugs(
#     bugId: string,
#     options?: { threshold?: number; limit?: number; projectId?: string; orgThreshold?: number }
#   ): Promise<SimilarBugsResponse>

# 4. Add org_threshold to the intelligence service querystring schema
# File: packages/bugspotter-intelligence/src/routes/bugs/similar.ts
#
# In the Fastify route schema, add to the querystring object:
#   org_threshold: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1.0 }))
#
# Note: minimum is 0.5 (not 0) to match resolveThreshold's THRESHOLD_MIN.
# Values below 0.5 are silently ignored by resolveThreshold; accepting them
# here would forward a value that is immediately discarded. The mismatch
# with intelligence-settings.ts (which accepts [0, 1]) is a known gap
# tracked as a follow-up.
#
# In the handler, update the resolveThreshold call from:
#   const threshold = resolveThreshold(request.query.threshold);
# to:
#   const threshold = resolveThreshold(request.query.threshold, request.query.org_threshold);

# 5. Build to confirm no TypeScript errors
pnpm --filter backend build
pnpm --filter @bugspotter/intelligence build   # requires #238

# 6. Run existing unit tests
pnpm --filter backend test:unit
pnpm --filter @bugspotter/intelligence test    # requires #238

# 7. Add unit tests for threshold precedence
#
# File: packages/bugspotter-intelligence/tests/routes/bugs/similar.test.ts
# (requires #238 for package resolution)
#
# Test case A — client threshold wins (AC #1):
#   vi.mock('../../src/utils/threshold.js'); spy on resolveThreshold.
#   Call handler with threshold=0.9 and org_threshold=0.7.
#   Assert resolveThreshold called with (0.9, 0.7) and spy returns 0.9.
#
# Test case B — org default used when no client threshold (AC #2):
#   Call handler with org_threshold=0.7, no threshold.
#   Assert resolveThreshold called with (undefined, 0.7) and spy returns 0.7.
#
# Test case C — env fallback (AC #3):
#   process.env.SIMILARITY_THRESHOLD = '0.6'; no threshold, no org_threshold.
#   Assert resolveThreshold called with (undefined, undefined) and spy returns 0.6.
#   Note: assert on resolveThreshold's return value, NOT on result content
#   (similar.ts returns a stub [] regardless of threshold until #238 wires the real service).
#
# Test case D — hardcoded fallback (AC #4):
#   No threshold, no org_threshold, no SIMILARITY_THRESHOLD env var.
#   Assert resolveThreshold returns 0.85.
#
# File: packages/backend/tests/api/intelligence-routes.test.ts
#
# Test case E — graceful no-org-context fallback (AC #5):
#   Stub handler with request.project absent; assert getSimilarBugs
#   receives orgThreshold: undefined (option omitted).
#
# Test case F — org_threshold absent from proxied URL when undefined (AC #6):
#   Call getSimilarBugs(bugId, { threshold: 0.9 }) with no orgThreshold.
#   Spy on the underlying HTTP request; assert URL does not contain 'org_threshold'.
```
