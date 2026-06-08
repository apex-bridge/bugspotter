# ADR-0036: Self-service signup with URL-fragment token handoff

- Status: Accepted
- Area: signup / integration
- Source: `bugspotter-landing/src/components/useSignupSubmit.ts`, `SelfServiceSignupForm.tsx`; backend `/api/v1/auth/signup`
- Date: Landing phase 2

## Context

Free-tier users sign up on the landing site (one origin) and must land authenticated in the admin dashboard (a different org-subdomain origin) — without the landing site holding server-side session state, and without leaking the API key into logs or `Referer` headers.

## Decision

The React form POSTs to the backend **`/api/v1/auth/signup`**, receives an access token + `api_key`, and constructs a **URL fragment** `#handoff=<base64url-json>` pointing at the org subdomain's `/onboarding` page. The browser navigates cross-origin (`credentials: include` so the refresh-token cookie sticks). The backend response is **strictly validated** and fields are **explicitly mapped** (not spread) before building the URL; the subdomain is validated against RFC-1123 shape to prevent open redirects.

## Consequences

### Positive

- The fragment is never sent in `Referer` or server logs; `base64url` preserves special chars; UTF-8 round-trip supports Cyrillic/Kazakh names.
- No server-side session on the landing site; explicit field mapping blocks leaking future backend additions.

### Negative / Trade-offs

- The handoff payload shape couples the landing encoder to the admin decoder.
- Subdomain validation lives on the landing side; a 15s fetch timeout guards hung backends; errors mapped by status (409 taken, 429 rate-limited).

## Alternatives considered

- **Query param** — leaks the key in `Referer`. Rejected.
- **Shared session cookie / POST to admin** — cross-origin coupling, exposes creds to admin server logs. Rejected.
