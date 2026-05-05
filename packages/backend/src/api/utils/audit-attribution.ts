/**
 * Audit attribution helper.
 *
 * Single source of truth for "who do we record as the human actor
 * when writing an audit row." Used by the global audit middleware and
 * every handler-level logger that writes audit rows directly.
 *
 * Resolution order:
 *   1. `request.authUser?.id` — JWT-only path (auth middleware ran
 *      handleJwtAuth, populated authUser with a DB-verified User).
 *   2. `request.jwtUserIdentity?.id` — dual-header path (auth
 *      middleware authenticated via api-key but also verified an
 *      accompanying JWT for *attribution* — see auth/middleware.ts
 *      and the docstring on `request.jwtUserIdentity` in api/types.ts).
 *      Only set when both signature verification AND a DB existence
 *      check succeed; an invalid / forged / deleted-user JWT yields
 *      undefined here so the audit row records `null`.
 *   3. `null` — api-key-only path, share-token path, or anonymous
 *      request. Machine attribution (api_key_id) is captured
 *      separately in `details.api_key_id`; the human-actor column is
 *      honestly null.
 *
 * The two upstream fields are mutually exclusive by construction
 * (authUser only set on the JWT-only path; jwtUserIdentity only set
 * on the dual-header path), so this fallback never double-counts.
 *
 * Centralising it here is what protects the GH-97 contract: if the
 * resolution rule changes again (e.g., when the audit_logs.api_key_id
 * column from #104 lands), it changes here and propagates to every
 * caller — the alternative (open-coding the chain at every site)
 * silently drifts the moment one site is updated and the others
 * aren't.
 */

import type { FastifyRequest } from 'fastify';

export function getAuditUserId(request: FastifyRequest): string | null {
  return request.authUser?.id ?? request.jwtUserIdentity?.id ?? null;
}
