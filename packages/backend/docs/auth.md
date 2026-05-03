# Authentication and Authorization

Reference for how requests are authenticated and authorized in
`@bugspotter/backend`. Source-of-truth pointers in every section — if
this doc drifts from the code, the file:line links break visibly.

---

## 1. Authentication artifacts

Every request can carry up to four auth artifacts. Each is set by
exactly one auth handler and is read-only after middleware runs.

| Field                    | Set by                                                                                         | Carries                                                    | Used by                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `request.authUser`       | JWT bearer token (`handleJwtAuth`, [auth/handlers.ts](../src/api/middleware/auth/handlers.ts)) | Dashboard user (id, role, organization_id)                 | Project-role and platform-permission checks                                       |
| `request.apiKey`         | `X-API-Key: bgs_…` header (`handleNewApiKeyAuth`)                                              | The full ApiKey row (allowed_projects, permissions, scope) | API-key path of `checkProjectAccess`                                              |
| `request.authProject`    | Set alongside `apiKey` when `allowed_projects.length === 1`                                    | The single Project the key is scoped to                    | Convenience flag for project-scoped keys; do NOT bypass on this alone (see below) |
| `request.authShareToken` | `?shareToken=` query param or POST body (`handleShareTokenAuth`)                               | The decoded share token + bug-report scope                 | Public replay-access routes only                                                  |

**`authProject` is not a legacy flag.** It's set inside
`handleNewApiKeyAuth` _only_ after `request.apiKey` is set, _only_ for
single-project keys (which includes the self-service-signup-issued
ingest-only key). Bypassing on `authProject` alone would let that key
read reports across projects — don't.

---

## 2. Header precedence (and the audit-identity caveat)

The auth middleware ([auth/middleware.ts:42-86](../src/api/middleware/auth/middleware.ts#L42-L86))
tries auth methods in a fixed order, short-circuiting on the first one
that's _applicable_ (not first-success — see the gotcha below):

1. **`shareToken`** (query param on GET, body on POST) — if present and
   valid, returns immediately.
2. **`x-api-key`** header — if the header exists, runs API-key auth.
3. **`Authorization: Bearer …`** JWT — only consulted when no
   `x-api-key` header was present.

**Critical gotcha**: if `x-api-key` is present but invalid/revoked/expired,
the request is **rejected** — JWT is **not** tried as a fallback. The
middleware returns at the end of the api-key block regardless of
success or failure ([line 71](../src/api/middleware/auth/middleware.ts#L71)).
Operators sometimes assume a valid JWT will rescue a bad API key; it
won't. Either drop the api-key header or refresh the key.

When `x-api-key` AND `Authorization: Bearer` are both present and the
API key validates:

- `request.apiKey` is populated
- `request.authUser` stays **undefined** (JWT was never consulted)

This is _not_ a privilege-escalation surface (a leaked full-scope key
already grants full access; presenting JWT alongside adds nothing). But
it does have an audit-trail consequence: downstream loggers that read
`userId: request.authUser?.id || 'api-key'` record `'api-key'` even
when the JWT user is the actual actor. A user can deliberately combine
their JWT with an org's full-scope key to mask attribution. Tracked in
[#97](https://github.com/apex-bridge/bugspotter/issues/97).

---

## 3. The 3-layer authorization model

Most write routes compose three checks in their preHandler chain:

```ts
preHandler: [
  requireAuth,                                            // 1. Some auth ran
  requirePermission(db, 'integration_rules', 'create'),   // 2. Platform permission
  requireProjectAccess(db, { paramName: 'projectId' }),   // 3. Project membership
  requireProjectRole('admin'),                            // 4. Project role floor
],
```

| Layer                   | Source                                                                                                                               | What it checks                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Platform permission** | [auth/authorization.ts:243](../src/api/middleware/auth/authorization.ts#L243)                                                        | The user's platform role has `(resource, action)` in the seeded `permissions` table |
| **Project access**      | [middleware/project-access.ts](../src/api/middleware/project-access.ts) → [utils/resource.ts:144](../src/api/utils/resource.ts#L144) | The user/key has _some_ membership on the target project                            |
| **Project role floor**  | [auth/authorization.ts:272](../src/api/middleware/auth/authorization.ts#L272)                                                        | Effective project role meets the minimum (`viewer < member < admin < owner`)        |

**Cross-resource gates** (like the COPY route's target-project admin
check) live inline in the handler body via
`checkProjectAccess(targetProjectId, …, { minProjectRole: 'admin' })`
— preHandlers can only enforce on the route's path-param project.

---

## 4. Effective project role: explicit ∪ inherited

A user's project role is the **max** of two sources:

- **Explicit**: a row in `application.project_members` (or the
  `created_by` shortcut for owner). Read via
  [`db.projects.getUserRole`](../src/db/repositories/project.repository.ts).
- **Inherited**: the user's org membership, mapped through
  [`ORG_TO_PROJECT_ROLE`](../src/types/project-roles.ts):

  ```text
  org owner   → project admin
  org admin   → project admin
  org member  → project viewer
  ```

The composition is centralised in
[`pickHigherProjectRole`](../src/types/project-roles.ts) — both
`requireProjectAccess` middleware and the JWT branch of
`checkProjectAccess` use it. **Do not inline the comparison
elsewhere** — a future change to the precedence rule should be a
one-line edit.

`request.projectRole` is populated by `requireProjectAccess` from the
combined effective role, then read by `requireProjectRole` and any
handler that needs to make a finer-grained decision.

### Performance note

`requireProjectAccess` runs _both_ lookups in parallel
(`Promise.all([getUserRole, lookupInheritedProjectRole])`). For
hot-path callers, `lookupInheritedProjectRole` accepts an optional
`organizationId` to skip a redundant `findById`; the caller asserts
the org_id was just read from the same project. Trust contract is
documented at the function's JSDoc.

---

## 5. API-key bypass rules

API keys authenticate as a machine, not a project member. Three middleware
layers explicitly skip their gates for API-key auth:

| Middleware                                                                                        | API-key behaviour                                                                                                       | Reason                                                       |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `requirePermission` ([authorization.ts:247](../src/api/middleware/auth/authorization.ts#L247))    | Returns early if `apiKey` set without `authUser`                                                                        | Platform-permission table is keyed by user role, not machine |
| `requireProjectRole` ([authorization.ts:277](../src/api/middleware/auth/authorization.ts#L277))   | Returns early if `apiKey` set without `authUser`                                                                        | Same — no "project role" concept for machines                |
| `checkProjectAccess` minProjectRole branch ([resource.ts:144](../src/api/utils/resource.ts#L144)) | The `apiKey && !authUser` branch validates against `checkProjectPermission` only — `minProjectRole` is **NOT enforced** | Same — projects are scoped via `allowed_projects`, not roles |

**Net effect**: a full-scope API key (`allowed_projects: []`) can do
anything against any project on routes guarded only by these middlewares.
This is the design — full-scope keys are intentionally project-unbounded.
Limited-scope keys (`allowed_projects: [A]`) are still bounded by
`checkProjectPermission`'s allowed-list check.

If a route needs admin-level enforcement against API keys (e.g., to
reject machine-issued mutations), it must either reject API-key auth at
the preHandler or add an explicit check — `minProjectRole` doesn't do it.

The [`tests/integration/full-scope-api-key.test.ts`](../tests/integration/full-scope-api-key.test.ts)
suite has lock-in tests for this behaviour. Any future tightening of
the API-key path will fail those tests, surfacing the change rather
than shipping it silently.

---

## 6. Tenant resolution & cross-tenant guards (SaaS mode)

In SaaS mode (`DEPLOYMENT_MODE=saas`), every authenticated request
that arrives on a tenant subdomain is checked against the user's
org membership. Three layers of defence:

| Layer                         | Source                                                                                                  | What it does                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tenant resolution**         | [`saas/middleware/tenant.ts`](../src/saas/middleware/tenant.ts)                                         | Extracts subdomain → looks up org. Unknown subdomain → 404 (even on `TENANT_EXEMPT_PREFIXES`). Inactive subscription → 403. Sets `request.organization` + `request.organizationId` for tenant routes. Skips org-context for exempt routes (admin / users-me / audit-logs) so a user clicking "preferences" inside their tenant dashboard still hits the same handler the hub serves |
| **Login-time tenant-match**   | [`saas/middleware/tenant-match.ts:assertUserBelongsToTenant`](../src/saas/middleware/tenant-match.ts)   | Login / refresh / magic-login routes verify the credential holder belongs to the subdomain's org BEFORE issuing tokens. Same error shape as wrong-credentials so attackers can't enumerate "is this email registered to org X?" by diffing error codes. Hub-domain (no `request.organizationId`) keeps current product behaviour — a single-purpose login portal                    |
| **Request-time tenant-match** | [`saas/middleware/tenant-match.ts:createTenantMatchMiddleware`](../src/saas/middleware/tenant-match.ts) | Runs after auth + tenant resolution on every authenticated request. If `authUser.organization_id` and `request.organizationId` are both set and the user has no membership matching the org, returns 403 `TenantMismatch`. Catches stolen / hub-issued / replayed JWTs being used at the wrong tenant subdomain                                                                     |

### What's intentionally NOT enforced

- **Hub-domain login**: `app.kz.bugspotter.io` continues to issue tokens for any valid user. Product policy: hub serves as the universal login portal; per-tenant entry happens client-side after auth
- **Platform admins on tenant subdomains**: per product policy, SaaS admins only authenticate at the hub. Both guards still fire — there's no platform-admin exemption — so an admin JWT showing up on a tenant subdomain is rejected as anomalous
- **API-key requests**: full-scope API keys are intentionally project- and tenant-unbounded. The request-time middleware runs only when both `authUser` and `organizationId` are set; api-key-only requests skip it. Limited-scope keys are still bounded by their `allowed_projects`

### What's available for hardening

- **Org-bound JWTs**: bake `organizationId` into the JWT payload, verify on every request. Strongest guarantee but requires a forced re-login on rollout (in-flight tokens become invalid). Defense-in-depth on top of the layers above; not currently needed because A+B (login-time + request-time) close the practical attack surfaces

---

## 7. Open questions

These behaviours are documented, tested, and consistent with the current
design — but they're known design choices that may change. New work
adjacent to these should consult the linked issues before assuming
permanence.

- **[#97](https://github.com/apex-bridge/bugspotter/issues/97) — Audit-identity masking**: JWT + full-scope API key obscures user attribution in logs because `request.authUser` is never set when an API key is present. Three fix options proposed (populate `authUser` anyway, log both identities, or reject dual-header). Decision needed.
- ~~**[#101](https://github.com/apex-bridge/bugspotter/issues/101) — Cross-organisation rule copy**~~: closed. The intra-org viewer-source case landed in [#102](https://github.com/apex-bridge/bugspotter/pull/102); the cross-org strict-equality guard is in the COPY handler at [integration-rules.ts](../src/api/routes/integration-rules.ts) (`sourceProject.organization_id === targetProject.organization_id` enforced post-target-admin-check; throws 403 'Cannot copy rules across organizations' otherwise). Same guard applies to JWT and API-key auth uniformly.
- **API-key admin enforcement**: the bypass rules in §5 are intentional today, but the lock-in tests document them so a future product decision to add machine-level admin gates would surface as test diffs. No active ticket.
- **`checkProjectAccess` return type**: currently `Promise<void>` (throws on failure). Changing to `Promise<ProjectRole | null>` would let `requireProjectAccess` reuse the role resolved during access verification, eliminating the second `checkOrganizationAccess` round-trip for org-inherited users. 26 callsites; significant blast radius. Good candidate for a follow-up RBAC perf PR.
