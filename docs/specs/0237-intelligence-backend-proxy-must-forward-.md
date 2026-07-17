# Spec: Backend proxy must forward org similarity threshold to intelligence service

<!-- Keep in sync with .github/ISSUE_TEMPLATE/spec.yml — that template is the canonical source. -->

Linked issue: Refs #237
ADR: pending

## Problem / motivation

`GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` resolves the similarity threshold exclusively from the client-supplied `threshold` query param. The per-org `intelligence_similarity_threshold` stored in `intelligence_settings` and resolved through `tenant-config.ts` is never read inside the route handler and is never forwarded to the `bugspotter-intelligence` service. As a result, the `resolveThreshold(queryValue, orgDefault)` helper introduced in #226 always receives `undefined` as `orgDefault`, making the org-level setting a no-op end-to-end. Org administrators who configure a custom threshold see no effect on returned results.

## Scope and constraints

In scope:

- Reading `intelligence_similarity_threshold` directly from the org's `settings` JSONB via `db.organizations.findById` inside the similar-bugs route handler in `packages/backend/src/api/routes/intelligence.ts` (raw read, not `getOrgIntelligenceSettings`, to preserve the `undefined` signal when no override is set)
- Passing the resolved org threshold as `orgThreshold` to `IntelligenceClient.getSimilarBugs`
- Forwarding `orgThreshold` as the `org_threshold` query param in the HTTP request made by `IntelligenceClient` to the intelligence service
- Adding `org_threshold` to the querystring schema in `packages/bugspotter-intelligence/src/routes/bugs/similar.ts` and passing it as `orgDefault` to `resolveThreshold`
- Unit tests for the three threshold-precedence cases (client wins, org default used, env/hardcoded fallback used)
- Integration test covering the full proxy path with a seeded org setting

Out of scope:

- Changes to the `resolveThreshold` function itself (already correct from #226)
- UI surface for configuring `intelligence_similarity_threshold` (tracked separately)
- Caching of org settings within the request lifecycle beyond what is already provided by the database queries or client caching
- Altering the threshold-resolution logic for any endpoint other than `/similar`

Constraints:

- `orgThreshold` must never override an explicitly supplied client `threshold`; `resolveThreshold` precedence order (client → org → env → hardcoded 0.85) must be preserved
- `clientFactory` and `request.project?.organization_id` may be absent in test contexts; the code path must degrade gracefully to `undefined` without throwing
- The `org_threshold` query param sent to the intelligence service must be omitted entirely (not sent as an empty string) when no org setting exists, so that `resolveThreshold` correctly falls through to the env-var fallback
- No new database migrations are required; `intelligence_settings` and `intelligence_similarity_threshold` already exist
- Changes must not alter the public API contract of `GET /similar` as seen by external callers

## Acceptance criteria

- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar?threshold=0.9` returns similar bugs computed with threshold 0.9 even when the org setting is 0.7, confirming client-supplied value wins
- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` (no `threshold` param) for an org whose `intelligence_similarity_threshold` is 0.7 causes the intelligence service to call `resolveThreshold(undefined, 0.7)` and compute results at 0.7, confirmed via integration test asserting the proxied request URL contains `org_threshold=0.7`
- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` (no `threshold` param) for an org with no `intelligence_similarity_threshold` value in its `settings` JSONB (key absent or null) causes the intelligence service to call `resolveThreshold(undefined, undefined)` and fall back to `SIMILARITY_THRESHOLD` env var when set, confirmed by setting the env var to 0.6 and asserting results differ from the 0.85 hardcoded default
- [ ] `GET /api/v1/intelligence/projects/:projectId/bugs/:id/similar` (no `threshold` param, no org setting, no `SIMILARITY_THRESHOLD` env var) falls back to the hardcoded default of 0.85 without error
- [ ] When `clientFactory` is `null` or `request.project?.organization_id` is absent, the handler does not throw and behaves identically to the pre-fix behaviour (env/hardcoded fallback only)
- [ ] The `org_threshold` query param is absent from the proxied URL when `orgThreshold` resolves to `undefined`, verified by a unit test asserting the constructed URL string
- [ ] All existing tests in `packages/backend` and `packages/bugspotter-intelligence` continue to pass without modification

## How (runnable steps)

```bash
# 1. Install dependencies (no new packages required)
cd /repo
pnpm install

# 2. Edit the similar-bugs route handler
# File: packages/backend/src/api/routes/intelligence.ts
#
# Inside the handler for GET /projects/:projectId/bugs/:id/similar,
# after the existing `resolveClient` call, add:
#
#   const orgThreshold: number | undefined =
#     db != null && request.project?.organization_id != null
#       ? ((await db.organizations.findById(request.project.organization_id))
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
# In getSimilarBugs, update the params object construction:
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
#   org_threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 }))
#
# In the handler, update the resolveThreshold call from:
#   const threshold = resolveThreshold(request.query.threshold);
# to:
#   const threshold = resolveThreshold(request.query.threshold, request.query.org_threshold);

# 5. Build to confirm no TypeScript errors
pnpm --filter backend build
pnpm --filter bugspotter-intelligence build

# 6. Run existing unit tests
pnpm --filter backend test
pnpm --filter bugspotter-intelligence test

# 7. Add unit tests for threshold precedence
# File: packages/bugspotter-intelligence/tests/routes/bugs/similar.test.ts
#
# Test case A — client threshold wins:
#   Mock resolveThreshold; call handler with threshold=0.9 and org_threshold=0.7;
#   assert resolveThreshold called with (0.9, 0.7) and result is 0.9.
#
# Test case B — org default used when no client threshold:
#   Call handler with org_threshold=0.7 and no threshold;
#   assert resolveThreshold called with (undefined, 0.7) and result is 0.7.
#
# Test case C — env/hardcoded fallback:
#   Call handler with neither threshold nor org_threshold;
#   set SIMILARITY_THRESHOLD=0.6 in process.env;
#   assert resolveThreshold returns 0.6
#
# File: packages/backend/tests/api/intelligence-routes.test.ts
#
# Test case D — graceful no-org-context fallback (AC #5):
#   Stub the similar-bugs handler with request.project absent (undefined) and
#   db null; assert the handler does not throw, and the getSimilarBugs call
#   receives orgThreshold: undefined (i.e. the option is omitted).
#
# Test case E — org_threshold absent from proxied URL when undefined (AC #6):
#   Call getSimilarBugs(bugId, { threshold: 0.9 }) with no orgThreshold;
#   spy on the underlying axios request; assert the constructed URL does not
#   contain the query param 'org_threshold'.
```
