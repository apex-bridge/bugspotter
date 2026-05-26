/**
 * SDK-facing similarity endpoint.
 *
 * Lets the bug-report widget show "we may already know about this:
 * #44 (Fixed in v2.3)" inline, before the user submits. Powers the
 * deflection-acknowledge flow that finally works for anonymous /
 * non-org-member reporters where the existing `notify.email reporter`
 * token doesn't apply (see `dedup-reporter-design.md`).
 *
 * Auth: gated by `requireProject` + `requireApiKeyPermission(
 * 'reports:write')` — the same shape the SDK ingest path uses, so
 * an org's existing ingest-only key works without re-provisioning.
 *
 * Graceful degradation: if the org has intelligence disabled (or
 * misconfigured), this returns `{ matches: [] }` rather than 503.
 * The widget falls back to a normal submission with zero matches
 * shown — the user never sees an error originating from the
 * similarity probe.
 *
 * Response shape is intentionally narrower than the internal
 * SearchResponse: returns `canonical_id` / `title` / `status` /
 * `similarity` only. Description, resolution text, and timestamps
 * are intentionally NOT exposed via an ingest-only key.
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { IntelligenceClient } from '../../services/intelligence/intelligence-client.js';
import type { IntelligenceClientFactory } from '../../services/intelligence/tenant-config.js';
import { requireProject, requireApiKeyPermission } from '../middleware/auth.js';
import { sendSuccess } from '../utils/response.js';
import { AppError } from '../middleware/error.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

// Similarity threshold below which a match is hidden from the SDK.
// The intelligence /search returns its top-N regardless of score; the
// SDK has stricter UX needs (false-positive "is this the same?" chips
// burn user trust fast). 0.6 is conservative — empirical tuning lands
// after we have real-world deflection metrics, gated behind an org
// setting in a follow-up.
const SDK_SIMILARITY_FLOOR = 0.6;

// Embedding model produces noisy false positives below this length —
// matches the widget's own client-side floor. Treated as a soft-fail
// (empty matches) rather than 400 to stay consistent with the file's
// "probe never errors to the widget" contract.
const MIN_TITLE_LENGTH = 5;

// Hard ceiling on response size. Lower than admin search's 50 — the
// widget renders these inline and three is the max a user will
// realistically scan before submitting.
const SDK_MAX_LIMIT = 5;
const SDK_DEFAULT_LIMIT = 3;

interface SdkSimilarBody {
  title: string;
  description?: string;
  limit?: number;
}

interface SdkSimilarMatch {
  canonical_id: string;
  title: string;
  status: string;
  similarity: number;
}

const sdkSimilarSchema = {
  body: {
    type: 'object',
    required: ['title'],
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        // No minLength here — the 5-char floor is enforced as a soft
        // fail in the handler (returns 200 + {matches: []}) to honor
        // the file's "probe never errors to the widget" contract.
        // maxLength is kept as real abuse protection.
        maxLength: 500,
      },
      // Description accepted but ignored in v1 — title-only similarity
      // is faster and matches Sentry's pattern. Adding description to
      // the query is a v2 tuning question, not a v1 launch blocker.
      description: { type: 'string', maxLength: 5000 },
      limit: { type: 'integer', minimum: 1, maximum: SDK_MAX_LIMIT },
    },
  },
} as const;

/**
 * Resolve a per-org intelligence client without leaking 503 errors
 * to the SDK. Mirrors the admin-side `resolveClient` from
 * `intelligence.ts` but degrades to `null` on the
 * intelligence-not-configured branch rather than throwing.
 */
async function resolveClientSoft(
  organizationId: string | null | undefined,
  clientFactory: IntelligenceClientFactory | undefined,
  globalClient: IntelligenceClient
): Promise<IntelligenceClient | null> {
  // Multi-tenant mode: strictly per-org, never fall back to the
  // global client. globalClient uses platform-wide credentials —
  // serving a tenant request from it would cross isolation.
  if (clientFactory) {
    if (!organizationId) {
      return null;
    }
    try {
      return await clientFactory.getClientForOrg(organizationId);
    } catch (error) {
      logger.warn('SDK similar: per-org intelligence client resolve failed', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  // Single-tenant / self-hosted: no factory → globalClient is the
  // only client and IS the tenant's.
  return globalClient;
}

export function sdkSimilarRoutes(
  fastify: FastifyInstance,
  globalClient: IntelligenceClient,
  _db: DatabaseClient,
  clientFactory?: IntelligenceClientFactory
): void {
  fastify.post<{ Body: SdkSimilarBody }>(
    '/api/v1/sdk/similar',
    {
      schema: sdkSimilarSchema,
      // `requireProject` enforces single-project ingest-key shape;
      // `reports:write` is what the ingest-only key already carries.
      // No new permission needed for v1.
      preHandler: [requireProject, requireApiKeyPermission('reports:write')],
    },
    async (request, reply) => {
      const { title, limit } = request.body;
      const project = request.authProject;

      // `requireProject` guarantees this, but the type guard keeps
      // TS happy and protects against a future middleware re-order.
      if (!project) {
        throw new AppError('Project context required', 400, 'BadRequest');
      }

      // Short / whitespace-only titles produce only noise from the
      // embedding model. Soft-fail to empty matches rather than 400
      // so the widget's network panel stays clean and so direct API
      // callers get the same shape on every "no useful matches"
      // outcome.
      if (title.trim().length < MIN_TITLE_LENGTH) {
        return sendSuccess(reply, { matches: [] });
      }

      const client = await resolveClientSoft(project.organization_id, clientFactory, globalClient);

      // Soft-fail when intelligence isn't wired for this org — the
      // widget treats an empty match list as "no deflection
      // candidates" and proceeds with normal submission. No error
      // surface to end-users.
      if (!client) {
        return sendSuccess(reply, { matches: [] });
      }

      const effectiveLimit = limit ?? SDK_DEFAULT_LIMIT;

      let matches: SdkSimilarMatch[] = [];
      try {
        const result = await client.search({
          query: title,
          project_id: project.id,
          mode: 'fast',
          limit: effectiveLimit,
        });
        matches = result.results
          // Threshold filter — see SDK_SIMILARITY_FLOOR comment.
          .filter((r) => r.similarity >= SDK_SIMILARITY_FLOOR)
          // Narrow projection — never leak description / resolution /
          // timestamps through an ingest-only credential.
          .map((r) => ({
            canonical_id: r.bug_id,
            title: r.title,
            status: r.status,
            similarity: r.similarity,
          }));
      } catch (error) {
        // Same soft-fail contract: intelligence outage / circuit-
        // breaker open / timeout — the widget should still let the
        // user submit. Log for ops; return [] to the SDK.
        logger.warn('SDK similar: intelligence search failed, returning empty matches', {
          projectId: project.id,
          organizationId: project.organization_id,
          errorType: error instanceof Error ? error.name : 'NonErrorThrown',
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return sendSuccess(reply, { matches });
    }
  );
}
