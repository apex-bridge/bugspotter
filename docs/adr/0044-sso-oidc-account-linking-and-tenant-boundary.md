# ADR-0044: SSO/OIDC auth extension - provider model, account-linking, and the tenant boundary

- Status: Proposed
- Area: Auth / multi-tenancy / security
- Date: 2026-08-16
- Refs: #265 (SSO/OIDC login); #345 (superseded spec - see Context)

## Context

Issue #265 asks for OIDC login as BugSpotter's first SSO integration, and its
own "How" section requires an ADR before implementation, naming four
questions: provider abstraction, the account-linking rule, tenant->IdP
mapping in `saas` mode, and whether SSO users may also hold API keys.

A spec was drafted directly against those four questions (PR #345) and went
through three rounds of review before this ADR was written - each round
found a _different_ category of defect the prior round didn't touch:
infrastructure gaps (plaintext secret storage, SSRF via admin-supplied
`issuerUrl`, missing admin-role check), a design-level bug (cross-tenant
account takeover, detailed below), and mechanical inconsistencies (spec
referencing unversioned routes that don't exist). That pattern - review
keeps finding new things, never converges - is itself evidence the decisions
below were being made implicitly, one constraint at a time, inside an
814-line implementation-level spec, instead of explicitly, before any
schema or endpoint was written. This ADR exists to make them explicit.
**PR #345 is being closed as superseded by this ADR's decisions**, split
into smaller, independently-shippable follow-up issues once this is
ratified.

### The bug that forced this

`users.email` is globally unique across the whole database
(`001_initial_schema.sql`). `oidc_idp_config` is per-tenant, and tenant admins configure
their own IdP's issuer/client credentials. The spec's account-linking rule
(match an incoming ID-token's verified email against `users.email`,
tenant-unscoped) meant any tenant admin - or anyone who compromises one -
could configure an IdP that asserts `email_verified: true` for an address
belonging to a user in a **different** tenant, and the login would link
straight into that other tenant's existing account. That is a real
cross-tenant account-takeover path, not a theoretical one: the IdP _trust_
boundary is per-tenant, but the account _identity_ boundary was global. The
spec's other fixes (SSRF guard, admin-only config access, secret
encryption) all narrow who can reach this path; none of them close it,
because the flaw is in what happens once a login is reached, not in who can
configure it.

## Decision

### 1. Account-linking is tenant-scoped, not email-scoped

An OIDC login may only auto-link to an **existing** `users` row if that
user already holds a membership in the **same tenant** whose IdP produced
the login. Concretely: resolve the tenant from the login path first
(`/api/v1/auth/oidc/:tenant/callback`), then check whether the ID-token's verified
email matches an existing user **who is a member of that tenant**. If yes,
link. If the email matches a user who is _not_ a member of that tenant,
**reject the login** with a generic, non-enumerating error ("this login
could not be completed - contact your administrator") rather than silently
creating a shadow account or silently linking across the tenant boundary.
If the email matches no existing user at all, create one and add them to
the tenant, per the original create-on-first-login intent - gated by
domain, below.

This is the hard boundary. It closes the takeover path by construction:
an attacker's IdP can assert whatever it wants about an email address, but
it can never cause a login to resolve to an account outside the tenant the
attacker's own IdP is scoped to.

### 2. `allowed_domains` is enforced on every login, not just checked at config time

Every OIDC login (both the linking branch and the create-on-first-login
branch) must verify the ID-token email's domain is present in the tenant's
`allowed_domains` list before proceeding. This doesn't replace decision 1 -
a tenant admin could in principle set `allowed_domains` to a domain they
don't own, and nothing here verifies domain _ownership_ - but it closes the
adjacent, lesser risk (typos, stale config, accidental over-broad IdPs
minting arbitrary new accounts) and is cheap to enforce given the field
already exists in the schema. **Fail closed when unconfigured**: an empty
or missing `allowed_domains` on a tenant's IdP config rejects every OIDC
login for that tenant (both linking and creation), rather than permitting
any domain by default - a tenant admin who never sets this field gets "SSO
doesn't work yet," not a silently unrestricted login path. Domain-ownership
verification (DNS TXT record challenge, the way most enterprise SSO
products do it) is explicitly **out of scope for v1** - noted as a
residual risk below, not silently ignored.

### 3. Tenant -> IdP mapping (`saas` mode)

One IdP per tenant, `oidc_idp_config` keyed by `UNIQUE(tenant_id)`, exactly
as the original spec had it - this part was never in question. Multi-IdP-
per-tenant stays explicitly out of scope, as the original issue said.

### 4. Enforcement must work identically in `selfhosted` mode, not just `saas`

The spec's `enforce_sso` guards all read from `oidc_idp_config` via
`findByTenantId`. In `selfhosted` mode there is no tenant table row by
design (Constraint 7 of the original spec: a single global IdP via env
vars) - so every guard would silently and permanently evaluate to
"not enforced," regardless of what an operator configures. Decision: add
`OIDC_ENFORCE_SSO` as a fourth selfhosted env var, alongside the existing
`OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` trio the original spec
already defined. Each enforcement guard branches on `DEPLOYMENT_MODE`: read
the env var in `selfhosted`, read the tenant's DB row in `saas`. This
mirrors the config source both modes already use for the IdP's other three
settings - it does not introduce a new pattern, it completes an existing
one the spec applied inconsistently.

### 5. API keys and SSO are orthogonal - no restriction in v1

API keys authenticate a specific programmatic-access credential
(issued and managed via `packages/backend/src/api/routes/api-keys.ts`;
authenticated via a separate middleware path from user-session JWTs
entirely, per ADR-0008's triple-auth model), not a login method for a
human. Nothing in this feature's design
requires coupling them. **Decision: SSO users may create and hold API
keys exactly as password-auth users do; enforcing SSO does not touch API
key issuance.** Revisit only if a specific enterprise customer requires
"no access outside SSO, including programmatic" - that is a distinct,
larger feature (credential-issuance policy), not a default to build
speculatively now.

### 6. Provider mechanics and infrastructure controls

Unchanged from the original spec's review-fixed state - not in question,
restated for completeness. These were found missing and fixed during PR
#345's first review round,
before #345 was closed as superseded - restated here explicitly, as their
own required constraints, so a fresh implementation PR doesn't have to
rediscover them:

- `openid-client` v5, PKCE S256 required (no implicit flow, no plain
  PKCE), full ID-token validation (`iss`/`aud`/`nonce`/`exp`/JWKS
  signature), CSRF `state` + `nonce` via the existing Redis cache layer
  with a <=10 minute TTL.
- `client_secret` encrypted at rest via the existing encryption utility
  (`getEncryptionService()` / `CredentialEncryption`,
  `packages/backend/src/utils/encryption.ts`), matching the Jira/Linear
  integration-credential pattern - never stored in plaintext.
- `issuerUrl` is admin-supplied and must be validated with
  `validateSSRFProtection()` (`packages/backend/src/integrations/security
/ssrf-validator.ts`, the same guard `rpc-bridge.ts` already uses) at
  config-save time and immediately before every `Issuer.discover()` call -
  it is otherwise a live SSRF vector reachable against internal hosts and
  cloud metadata endpoints.
- The IdP-config admin endpoints (read and write) require tenant-admin
  role via `requireTenantOrgRole(db, ORG_MEMBER_ROLE.ADMIN)`
  (`packages/backend/src/api/middleware/org-access.ts`) - a valid session
  alone (`app.authenticate`) is not sufficient, since any tenant member
  could otherwise repoint the IdP at an attacker-controlled one.
- The IdP-config GET response never returns the decrypted secret - a
  boolean presence flag only; PUT treats an omitted secret as
  keep-existing.

These held up across all three review rounds (once fixed) and are
restated here so this ADR is a complete, self-sufficient answer to #265's
four questions plus the fifth this review process forced out, not because
any of them were contested on their own merits.

## Rejected alternatives

**Redesign `users.email` to be unique per-tenant instead of globally.**
Closes the same bug at the schema level instead of the application level.
Rejected for v1: touches every existing query that assumes global email
uniqueness (login lookup, password reset, notification addressing), is a
migration on a table every other feature depends on, and is a much larger,
riskier change than the actual problem requires. The tenant-scoped-linking
check (decision 1) gets the same safety property without touching schema
that predates this feature.

**Require manual (human) approval for every SSO-created account.**
Closes the takeover path and the domain-abuse path both, at the cost of
defeating the entire point of SSO (frictionless login for provisioned
users). Rejected - `allowed_domains` enforcement (decision 2) is the
proportionate control for the abuse case; account takeover is closed
structurally by decision 1 regardless.

**A single DB row with a sentinel tenant id for selfhosted enforcement,
instead of an env var.** Keeps one code path instead of branching per
`DEPLOYMENT_MODE`. Rejected because it's inconsistent with how the other
three IdP settings already work in selfhosted mode (env vars, explicitly
"no DB row required for v1" per the original spec) - introducing a DB
dependency for exactly one of four related settings is the same
inconsistency-by-omission that caused the bug this ADR exists to fix.

## Consequences

### Positive

- The cross-tenant takeover path is closed by construction, not by a
  permission check that something could bypass or a validator that could
  be misconfigured - an attacker's own IdP is structurally incapable of
  producing a login that resolves outside its tenant.
- Selfhosted and saas enforcement now share the same shape (read config
  from the mode-appropriate source, branch once), rather than saas being
  fully specified and selfhosted silently broken.
- Splitting the original spec into per-decision follow-ups (schema +
  repository + encryption; the login/callback path itself; the
  `enforce_sso` guards on existing endpoints; admin UI) means each piece
  fits comfortably inside what this pipeline has actually demonstrated it
  can deliver, and the highest-stakes piece (the enforcement guards, which
  touch existing auth endpoints) gets reviewed in total isolation instead
  of as four lines inside a sixteen-file diff.

### Negative / residual

- A real person who legitimately has separate accounts in two different
  tenants under the same email cannot auto-link via SSO across them -
  they'll hit the generic rejection and need support to sort out manually.
  Accepted: silent cross-tenant linking is the vulnerability this ADR
  closes, so this is the direct, correct cost of closing it, not an
  oversight.
- `allowed_domains` has no domain-ownership verification in v1. A tenant
  admin can still claim a domain they don't control; `allowed_domains`
  narrows the blast radius (must ALSO know a valid email at that domain
  that resolves inside their own tenant boundary per decision 1) but does
  not eliminate operator misconfiguration. Filed as a known v2 gap, not
  silently accepted as solved.
- Four follow-up issues instead of one - more coordination surface, more
  PRs to track to closure. Accepted per explicit owner direction: given
  the alternative demonstrated by #345 (three review rounds, still not
  converged, on a single monolithic diff), the coordination cost is judged
  worth the reduction in shipped-defect risk for a feature this
  security-sensitive.
