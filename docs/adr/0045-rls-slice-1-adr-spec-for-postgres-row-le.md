# ADR-0045: Postgres row-level security — role model, transaction-scoped tenant context, and fail-closed bypass paths

- Status: Proposed
- Area: Database / multi-tenancy / security
- Date: 2026-11-15
- Refs: #451 (this ADR + spec, slice 1 of 7); #450 (parent — full RLS rollout, slices 2-7)

## Context

Tenant isolation today is enforced entirely in application code: every repository
method is expected to add `WHERE organization_id = $1` (or resolve the owning
organization via `projects`), and nothing in the database itself stops a query
that forgets to. The backend's runtime Postgres role is the migration
owner/superuser, so even if a policy were added to a table naively, `BYPASSRLS`
(implicit for superusers, and the default for table owners unless
`FORCE ROW LEVEL SECURITY` is set) would make it a no-op. There is no RLS,
no per-tenant policy, and no separate runtime role anywhere in the migration
history.

#450 is the full rollout; this issue (#451) is slice 1 — an ADR and a spec for
slices 2-7, docs only, no runtime change. The ADR has to settle, in a way that
survives contact with PgBouncer transaction pooling and BullMQ's connection
reuse, seven things: the role model, how tenant context gets from an HTTP
request into a Postgres GUC, how background jobs and platform admins bypass
without silently reopening the isolation gap, the exact shape of the policies,
a classification of every table, self-hosted behavior, and a rollout order
that keeps each slice revertible on its own.

This repo's `DatabaseClient` (`packages/backend/src/db/client.ts`) and
`transaction.ts` are the only place query execution is centralized; any design
that requires touching every repository call site at once is not viable as a
"purely additive per slice" rollout, so context propagation has to be solved
at that chokepoint.

The intelligence service's database (Era 4, `bugspotter-intelligence`, its own
Postgres instance) is out of scope — this ADR covers only the `public`
repo's backend database (`application`, `saas`, `public` schemas).

## Options considered

1. **Native Postgres RLS, transaction-scoped `set_config`, dual-role model
   (migration owner vs. `NOSUPERUSER NOBYPASSRLS` runtime role), explicit
   audited bypass role** — closes the superuser-bypass gap at the database
   layer, survives PgBouncer transaction pooling because the context is set
   and consumed inside the same transaction, and gives a single policy
   definition that's enforced regardless of which code path forgot a
   `WHERE` clause. Cost: real migration complexity (role/grant management,
   `ALTER DEFAULT PRIVILEGES`, a context-propagation layer in
   `DatabaseClient`), and a new fail-closed failure mode (a request that
   never sets context gets zero rows, not an error, unless policies are
   written carefully).

2. **RLS with session-level `set_config` (no transaction scoping)** —
   simpler to reason about (set once per connection, forget about it), but
   breaks under PgBouncer transaction pooling: a pooled connection is handed
   back to the pool at transaction end and reused by a different logical
   request on the next transaction, so session-level state leaks tenant
   context across unrelated requests. Rejected outright — this is the
   specific failure mode the issue calls out, and it's a cross-tenant data
   leak, not a performance problem.

3. **Keep isolation application-only; add defense-in-depth via static
   analysis / lint rules that flag repository queries missing a tenant
   filter** — much cheaper, no database changes, no new failure modes. But
   it only catches what the linter's heuristics can see (raw SQL in
   migrations, dynamic query builders, a new repository method that
   composes two existing ones) and does nothing for BullMQ workers or
   platform-admin routes that intentionally go wide. It doesn't satisfy the
   issue's requirement for an enforced, auditable boundary — it's a
   complement to RLS, not a substitute, and is noted as a Consequence
   rather than an alternative.

4. **RLS enforced via `SECURITY DEFINER` views/functions instead of native
   `CREATE POLICY`** — lets existing superuser-owned queries keep working
   unmodified by routing reads through a function that checks context
   internally. Rejected: it multiplies the surface area (every table needs
   a matching function, policies and functions can drift), and it sidesteps
   `FORCE ROW LEVEL SECURITY` semantics that Postgres already guarantees
   natively, buying homegrown risk for no real benefit over option 1.

## Decision

Adopt **Option 1** — native RLS, a dual-role model, transaction-local context
propagation, and an explicit audited bypass role — rolled out across slices
2-7 as described below. Policies get table classification; role/grant
management is isolated so it lands before any policy does.

### 1. Role model

Two roles, distinct from today's single superuser connection:

- **Migration owner** (`bugspotter_migrator`) — owns every table in
  `application`, `saas`, and `public`, runs migrations, is the only role
  that can `CREATE POLICY` / `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.
  Not used by the running backend after slice 4.
- **Runtime role** (`bugspotter_app`) — `NOSUPERUSER NOBYPASSRLS NOCREATEDB
NOCREATEROLE`. This is what the backend connects as in both `saas` and
  `selfhosted` mode. It gets `USAGE` on all three schemas and
  `SELECT, INSERT, UPDATE, DELETE` on every table via
  `GRANT ... ON ALL TABLES IN SCHEMA`, plus `ALTER DEFAULT PRIVILEGES FOR
ROLE bugspotter_migrator IN SCHEMA ... GRANT ...` so tables created by
  future migrations are covered automatically — without this, every new
  migration silently reopens an un-granted (and therefore RLS-moot, since
  the runtime role simply couldn't query the table) or, worse,
  forgotten-policy table.

A **third, narrowly-held bypass role** (`bugspotter_bypass`), `BYPASSRLS`
but otherwise as restricted as the runtime role, exists only for the paths
in section 3. It is never the backend's default connection role.

### 2. Context propagation

Tenant context travels as a transaction-local GUC,
`set_config('app.current_org_id', $orgId, true)` — the third argument
(`is_local = true`) is the load-bearing detail: the setting is cleared at
transaction end regardless of commit or rollback, which is exactly what
makes this safe under PgBouncer **transaction pooling**
(`docker-compose.yandex.yml`, port 6432). A pooled connection can be handed
to a different request between transactions, but never mid-transaction, so
"set at the start of every transaction, consumed only within it" has no
leak window. Session-level `set_config` (Option 2) does not have this
property and is rejected for that reason.

Mechanically: `DatabaseClient.transaction()` (`transaction.ts`) is extended
to accept an org-context parameter and run `SELECT set_config(...)` as the
first statement inside the transaction it opens, before the caller's
queries execute. To avoid rewriting every repository call site in this
slice, request-scoped org id is carried via `AsyncLocalStorage` (set once in
request middleware, after auth resolves tenant) and `DatabaseClient` reads
it from there when opening a transaction, rather than requiring every call
site to pass it explicitly. Call sites that already route through
`DatabaseClient.transaction()` get the behavior for free; single-statement
reads that currently bypass an explicit transaction wrapper are changed (in
slice 3) to open an implicit one-statement transaction, which is also where
the fail-closed property in section 4 gets exercised.

```mermaid
flowchart TD
    A[HTTP request] --> B[Auth middleware resolves tenant]
    B --> C[AsyncLocalStorage: org id set for request]
    C --> D[DatabaseClient.transaction opens tx]
    D --> E["set_config('app.current_org_id', orgId, true)"]
    E --> F[Repository query runs inside same tx]
    F --> G{RLS policy check<br/>USING / WITH CHECK}
    G -->|org id matches row| H[Row returned / write allowed]
    G -->|context NULL or mismatched| I[Zero rows / write rejected<br/>fail-closed]
    F --> J[Transaction commit or rollback]
    J --> K[set_config scope ends — no leak across pooled reuse]

    L[BullMQ worker / retention job / saas-admin route] --> M[withRLSBypass(reason, fn)]
    M --> N[Connect as bugspotter_bypass role]
    N --> O[Audit log: actor, reason, table, timestamp]
    O --> P[Query runs unfiltered by RLS]
```

> Per `docs/adr/README.md` guidance on diagrams, this should be rendered
> (`mermaid-cli` or equivalent) before merge — not yet done in this draft; see
> residual risk under Consequences.

### 3. Bypass model

Every code path that must see cross-tenant data goes through a single
function, `withRLSBypass(reason: string, fn)`, which is the _only_ place
permitted to acquire a connection as `bugspotter_bypass`. It logs
`{ actor, reason, caller, table(s) touched, timestamp }` to an audit sink
before running `fn`. Covered callers: BullMQ worker job handlers (per #450's
scope, these are legitimately cross-tenant — e.g. a retention sweep),
scheduled retention jobs, and `saas-admin` platform-admin routes. Migrations
don't need this path — they run as `bugspotter_migrator`, which owns the
tables outright. No other caller may construct a `bugspotter_bypass`
connection; this is enforced by only exposing that role's credentials to the
`withRLSBypass` module, not to general `DatabaseClient` configuration.

### 4. Policy shape

Every org-scoped table gets matching `USING` and `WITH CHECK` expressions
(not just `USING` — without `WITH CHECK` a session could read within its own
org but insert/update rows into another org's), plus
`ALTER TABLE ... FORCE ROW LEVEL SECURITY` so the policy applies even to the
table owner, closing the exact gap in the Context section. The predicate is
`organization_id = current_setting('app.current_org_id', true)::uuid`.
Using `true` (the `missing_ok` argument) rather than letting an unset GUC
raise an error is deliberate: an unset or empty setting returns `NULL`, and
`NULL = anything` evaluates to `NULL` (not `true`), so the policy fails
**closed** — a request that forgot to set context gets zero rows back, not
an error and not someone else's rows. Project-scoped tables (no direct
`organization_id` column) resolve org via a `WITH CHECK`/`USING` subquery
joining `projects` on the row's `project_id`, rather than a
duplicated-but-denormalized org column — avoiding a second source of truth
that could drift from the `projects` table.

### 5. Table inventory

Classification is: **org-scoped** (has `organization_id` directly, policy as
above), **project-scoped** (resolves org via `projects`, policy via join),
or **global** (no RLS — must state why: e.g. schema-migration bookkeeping
tables, or tables that are inherently platform-wide like a feature-flag
definition table consumed identically by every tenant). The issue's own
"How" section specifies the enumeration method
(`grep -liE "organization_id|project_id" packages/backend/src/db/migrations/*.sql`)
as a step for whoever executes slice 2 — this ADR does not have access to
run that grep and does not claim a specific table list. The spec for slice 2
must include the actual enumerated inventory as a reviewable table before
any policy migration is written; treat the taxonomy above as the rule, not
the list, until that enumeration lands.

### 6. Self-hosted mode behavior

`DEPLOYMENT_MODE=selfhosted` keeps RLS enabled and policies identical to
`saas` mode, rather than conditionally disabling policies for the
single-tenant case. Self-hosted still seeds exactly one organization, and
request middleware still sets `app.current_org_id` to that organization's
id on every transaction. The alternative — skip RLS entirely in
`selfhosted` — would mean the policies are only ever exercised in one mode,
undermining the point of enforcing isolation at the database layer, and
would require the config flags in `packages/backend/src/config.ts` to grow
a new RLS-specific branch. Keeping it uniform is the purely-additive,
lower-special-casing choice.

### Testing strategy

Covers all 11 categories required by #450's acceptance criteria. Each slice
(2-7) adds the subset relevant to what it changes; by slice 7 all 11 run as
part of the regression suite:

1. **Bypass-proof** — assert the runtime role literally cannot read/write
   cross-tenant rows even with a hand-crafted query that omits a `WHERE`
   clause (the scenario this ADR exists to close).
2. **Per-table CRUD matrix** — for every org/project-scoped table, four
   operations × "own org" / "other org" context = 8 cases per table,
   generated from the slice-2 inventory rather than hand-written per table.
3. **Fail-closed** — no `set_config` call made at all (context never set)
   returns zero rows / rejects writes, not an error and not all rows.
4. **Pooled-connection leak** — two transactions, different org context,
   run back-to-back on what PgBouncer may hand back as the same physical
   connection; assert the second never sees the first's context.
5. **Concurrency** — concurrent transactions with different org contexts
   on the same connection pool don't bleed into each other mid-flight.
6. **Role assertions** — a startup/CI check that the backend's configured
   role is `bugspotter_app` and has `rolbypassrls = false`, failing loudly
   if someone points `DATABASE_URL` at the migration owner by mistake.
7. **Bypass paths** — every `withRLSBypass` call site is exercised and
   asserted to produce an audit log entry with the expected reason.
8. **Full-suite regression as the runtime role** — the existing
   `test:unit`/integration suite re-run with the backend connected as
   `bugspotter_app` instead of the migration owner, to catch any existing
   query that implicitly relied on superuser/table-owner privileges.
9. **Self-hosted mode** — the full matrix above re-run with
   `DEPLOYMENT_MODE=selfhosted` and the single seeded org.
10. **Performance budget** — p95 latency on representative read/write
    endpoints within 10% of pre-RLS baseline; RLS predicate evaluation adds
    a per-row check, and this needs to be measured, not assumed.
11. **Migration up/down on prod-shaped data** — each policy migration
    applies and reverts cleanly against a prod-sized/shaped dataset,
    confirming `DOWN` fully restores pre-policy behavior (required for the
    per-slice rollback guarantee below).

### Rollout order (slices 2-7)

Each slice is purely additive and independently revertible via its own
migration's `DOWN`:

- **Slice 2** — create `bugspotter_app` / `bugspotter_migrator` /
  `bugspotter_bypass` roles, grants, `ALTER DEFAULT PRIVILEGES`. No RLS yet,
  no behavior change (backend still connects as today's role). Also lands
  the slice-2 table inventory (section 5).
- **Slice 3** — context propagation: `AsyncLocalStorage` plumbing,
  `DatabaseClient`/`transaction.ts` changes, tests 3/4/5 above against a
  staging role that doesn't yet enforce anything.
- **Slice 4** — cut the backend over to connect as `bugspotter_app`. Safe
  because no policies exist yet; test 6/8 land here.
- **Slice 5** — enable RLS + policies on org-scoped tables, `FORCE ROW
LEVEL SECURITY`. First slice with real enforcement; tests 1/2/3/10 land
  here.
- **Slice 6** — project-scoped table policies (via `projects` join).
- **Slice 7** — `withRLSBypass` for workers/retention/platform-admin routes
  with audit logging; tests 7/9/11 and the full 11-category suite close
  out here.

Rollback for any slice is reverting that slice's migration (`DROP POLICY`,
`ALTER ROLE` back, `REVOKE`), since nothing is destructive or
data-shape-changing — this is docs/schema/role plumbing, not a data
migration.

## Consequences

**Positive:**

- Tenant isolation becomes enforced at the database layer, independent of
  whether every current and future repository method remembers a
  `WHERE organization_id = $1` — closes the exact gap the Context section
  opens with.
- Transaction-local context propagation is compatible with PgBouncer
  transaction pooling by construction (Option 2's leak mode is structurally
  impossible here), so the production topology in
  `docker-compose.yandex.yml` doesn't need special-casing.
- Every cross-tenant access (worker, retention, platform-admin) is forced
  through one audited chokepoint instead of being implicitly possible
  anywhere a superuser-owned query happens to run.
- Self-hosted and saas mode share the same enforcement path, so RLS logic
  is exercised by both, not just the mode most CI runs cover.

**Negative / accepted:**

- Fail-closed means a bug in context propagation (middleware not setting
  `AsyncLocalStorage` before a query runs) manifests as silent empty
  results, not an error — slower to debug than a thrown exception. Accepted
  because the alternative (fail-open on missing context) is the cross-tenant
  leak this ADR exists to prevent; mitigated by test category 3 and role
  assertions (6) running in CI.
- Real migration and operational complexity: three roles instead of one,
  `ALTER DEFAULT PRIVILEGES` that must be kept in sync as new schemas are
  added, and a performance cost (test 10) that hasn't been measured yet
  since no policy exists in the repo today.
- The `AsyncLocalStorage`-based implicit context threading (section 2) is
  chosen specifically to avoid touching every call site in one slice;
  accepted tradeoff is that context flow is less locally visible at each
  call site than an explicit parameter would be — a reviewer has to know
  the convention rather than read it off the function signature.

**Neutral / residual risk:**

- Section 5's table inventory is stated as a classification rule, not an
  enumerated list — this ADR does not have access to run the issue's
  `grep` step against the actual migration files, so the concrete
  org-scoped / project-scoped / global table list is deferred to slice 2's
  spec and must be reviewed before any policy migration (slice 5+) is
  written.
- The Mermaid diagram above has not been rendered through `mermaid-cli`
  per `docs/adr/README.md`'s own guidance (it specifically warns ADR-0044's
  first diagram had a rendering-only bug); this should happen before this
  ADR moves to `Accepted`.
- Application-layer tenant filters (today's sole isolation mechanism) are
  not removed by this decision — they remain as defense-in-depth alongside
  RLS rather than being deleted once RLS lands, which is a deliberate
  belt-and-suspenders choice but means two mechanisms now need to agree.
