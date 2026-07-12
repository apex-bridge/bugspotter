# Spec: Wire per-org similarity threshold to intelligence service

<!-- Keep in sync with .github/ISSUE_TEMPLATE/spec.yml — that template is the canonical source. -->

Linked issue: Refs #226
ADR: pending

## Problem / motivation

The `intelligence_similarity_threshold` org setting is exposed in the BugSpotter UI as a slider (range 0.5–1.0). Org admins can move the slider and save a value; the value is correctly persisted in the org's JSONB settings column. However, `bugspotter-intelligence` never receives this value — it reads only its own `SIMILARITY_THRESHOLD` environment variable at startup. The result is a broken UX contract: a control that appears functional but has no observable effect. This fix threads the already-stored value through the existing HTTP call without requiring a schema migration.

## Scope and constraints

In scope:

- Modify `bugspotter-public` `intelligenceClient.getSimilarBugs()` to read the org's `intelligence_similarity_threshold` setting and forward it as `?threshold=<value>` on the upstream request to `bugspotter-intelligence`
- Modify `bugspotter-intelligence` `GET /api/v1/bugs/:id/similar` to accept, validate, and apply the `?threshold` query parameter, falling back to `process.env.SIMILARITY_THRESHOLD` when the parameter is absent
- Apply the same `?threshold` forwarding and acceptance logic to the mitigation endpoint (mirror endpoint, same service) if it performs a similarity lookup
- Add or update unit tests in `bugspotter-public` asserting `threshold` is appended to the upstream URL when the org setting is present and omitted when absent
- Add or update unit tests in `bugspotter-intelligence` asserting the query param overrides the env default, values outside [0.5, 1.0] are rejected with 422, and absence of the param uses the env default

Out of scope:

- Schema migrations — the value is already stored in the JSONB settings column
- UI changes — the slider and persistence logic already work correctly
- Changing the allowed range [0.5, 1.0] or the default env var semantics
- Authentication or authorisation changes to either service
- Altering any other intelligence endpoint beyond the similar-bugs and mitigation endpoints

Constraints:

- The `?threshold` query parameter must be treated as optional in `bugspotter-intelligence`; removing it from any client call must not break the service
- Validation must reject values strictly outside [0.5, 1.0] with HTTP 422 and a structured JSON error body consistent with the existing Fastify error schema
- The org setting value must be read at request time (not cached at startup) so changes take effect immediately without a deploy
- Both services are TypeScript; all changes must pass existing `tsc --noEmit` checks with no new `any` escapes
- Docker Compose environment variables for `SIMILARITY_THRESHOLD` remain the authoritative default and must not be removed

## Acceptance criteria

- [ ] When an org has `intelligence_similarity_threshold` set to `0.7`, a call to `GET /api/v1/bugs/:id/similar` originating from that org's workspace includes `?threshold=0.7` in the upstream request to `bugspotter-intelligence`, confirmed by an integration or unit test inspecting the outbound URL
- [ ] When an org has no `intelligence_similarity_threshold` value set (null or missing key), the upstream request omits the `?threshold` parameter entirely
- [ ] `bugspotter-intelligence` `GET /api/v1/bugs/:id/similar?threshold=0.7` returns results computed with threshold `0.7` rather than the env default, verified by a unit test that stubs the similarity computation and asserts the passed threshold value
- [ ] `bugspotter-intelligence` `GET /api/v1/bugs/:id/similar` (no `?threshold`) returns results computed with the value of `process.env.SIMILARITY_THRESHOLD`
- [ ] `bugspotter-intelligence` responds with HTTP 422 and a JSON error body when `?threshold` is below `0.5` (e.g., `0.3`)
- [ ] `bugspotter-intelligence` responds with HTTP 422 and a JSON error body when `?threshold` is above `1.0` (e.g., `1.1`)
- [ ] `bugspotter-intelligence` responds with HTTP 422 and a JSON error body when `?threshold` is not a number (e.g., `?threshold=banana`)
- [ ] The mitigation endpoint in `bugspotter-intelligence` exhibits identical `?threshold` acceptance, validation, and fallback behaviour as the similar-bugs endpoint
- [ ] `pnpm -r typecheck` passes with zero new errors after all changes
- [ ] `pnpm -r test` passes with no regressions; new test coverage for the above cases is included

## How (runnable steps)

```bash
# 1. Install dependencies (nothing new needed — no new packages required)
cd /repo
pnpm install

# 2. Update the intelligence client in bugspotter-public
# File: packages/bugspotter-public/src/clients/intelligenceClient.ts
#
# Before (illustrative):
#   async getSimilarBugs(bugId: string, options: GetSimilarBugsOptions = {}) {
#     const url = `${this.baseUrl}/api/v1/bugs/${bugId}/similar`;
#     return this.http.get(url);
#   }
#
# After: read org setting and append query param when present
cat << 'EOF' > /tmp/intelligence-client-patch.ts
// Inside getSimilarBugs, resolve the org setting before building the URL:
async getSimilarBugs(
  bugId: string,
  options: GetSimilarBugsOptions & { similarityThreshold?: number } = {}
): Promise<SimilarBug[]> {
  const url = new URL(`${this.baseUrl}/api/v1/bugs/${bugId}/similar`);
  if (options.similarityThreshold !== undefined) {
    url.searchParams.set('threshold', String(options.similarityThreshold));
  }
  return this.http.get(url.toString());
}
EOF
# Apply the pattern above to the actual file; adjust surrounding code as needed.

# 3. Pass the org setting from the route handler in bugspotter-public
# File: packages/bugspotter-public/src/routes/bugs/similar.ts (or equivalent handler)
#
# Read the persisted setting from the org record and forward it:
cat << 'EOF' > /tmp/similar-route-patch.ts
const orgSettings = request.org.settings as OrgSettings; // already fetched by auth middleware
const similarityThreshold: number | undefined =
  typeof orgSettings.intelligence_similarity_threshold === 'number'
    ? orgSettings.intelligence_similarity_threshold
    : undefined;

const results = await intelligenceClient.getSimilarBugs(bugId, { similarityThreshold });
EOF

# 4. Update the similar-bugs route schema in bugspotter-intelligence to accept ?threshold
# File: packages/bugspotter-intelligence/src/routes/bugs/similar.ts
cat << 'EOF' > /tmp/intelligence-route-patch.ts
import { Type } from '@sinclair/typebox'; // already used in the project

const querySchema = Type.Object({
  threshold: Type.Optional(
    Type.Number({ minimum: 0.5, maximum: 1.0 })
  ),
});

// Inside the route handler:
fastify.get<{ Params: { id: string }; Querystring: { threshold?: number } }>(
  '/api/v1/bugs/:id/similar',
  {
    schema: {
      querystring: querySchema,
      // ... existing params/response schemas unchanged
    },
  },
  async (request, reply) => {
    const threshold =
      request.query.threshold ?? Number(process.env.SIMILARITY_THRESHOLD ?? '0.85');
    // pass threshold to similarity computation:
    const results = await similarityService.findSimilar(request.params.id, { threshold });
    return reply.send(results);
  }
);
EOF
# Fastify's built-in AJV validation will return 400 by default for schema violations;
# to return 422 per acceptance criteria, add a custom setSchemaErrorFormatter or
# use a preValidation hook to map schema errors on the querystring to 422:
cat << 'EOF' > /tmp/422-patch.ts
fastify.setErrorHandler((error,
```
