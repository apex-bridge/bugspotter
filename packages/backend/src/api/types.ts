/**
 * Type declarations for Fastify extensions
 * Using custom properties to avoid conflicts with Fastify's built-in properties
 *
 * This is the SINGLE SOURCE OF TRUTH for all API-related request properties.
 * For container/service properties (ctx), see src/container/request-context.ts
 */

import type { Project, User, ApiKey, Organization } from '../db/types.js';
import type { DataResidencyRegion } from '../data-residency/types.js';
import type { ProjectRole } from '../types/project-roles.js';

/**
 * Data residency context attached to requests
 */
export interface DataResidencyContext {
  /** Project ID being accessed */
  projectId: string;
  /** Data residency region for the project */
  region: DataResidencyRegion;
  /** Whether strict residency is enforced (KZ, RF) */
  strictResidency: boolean;
  /** Target storage region */
  storageRegion: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    // ============================================================================
    // AUTHENTICATION PROPERTIES (set by auth middleware)
    // ============================================================================

    /** Authenticated user (JWT or session) - set by requireUser middleware */
    authUser?: User;

    /** Authenticated project (API key) - set by requireApiKey middleware */
    authProject?: Project;

    /** API key used for authentication - set by requireApiKey middleware */
    apiKey?: ApiKey;

    /** Share token for anonymous bug report access - set by auth middleware */
    authShareToken?: { bug_report_id: string };

    /**
     * Shadow JWT identity for audit attribution on dual-header (api-key
     * + JWT) requests. Set by the auth middleware AFTER a successful
     * api-key authentication when an `Authorization: Bearer` header is
     * also present and BOTH of these checks pass:
     *
     *   1. JWT signature verifies (via `fastify.jwt.verify(token)`,
     *      not `request.jwtVerify()` — the latter writes the decoded
     *      claims to `request.user` as a `@fastify/jwt` side effect,
     *      which would silently expose a JWT identity to any future
     *      hook / plugin / route guard that uses the idiomatic
     *      `request.user` field. The instance method validates
     *      signature without touching the request).
     *   2. The api-key targets exactly one project
     *      (`allowed_projects.length === 1`) AND the user has an
     *      effective role (explicit `project_members` OR org-inherited
     *      via the project's organization) on that project, checked
     *      by `jwtUserCanAttributeForApiKey`. **Note**: this helper
     *      does NOT call `db.users.findById` — the "user must exist"
     *      property is *implicit*, derived from the cascade invariant
     *      (`project_members.user_id` and `organization_members.user_id`
     *      both have `ON DELETE CASCADE` against `application.users.id`,
     *      see `db/migrations/001_initial_schema.sql`), so a hard-
     *      deleted user has no membership rows left to match. There
     *      is no `is_active`/`deleted_at` field on users today, so
     *      hard-delete is the only deactivation path. If soft-delete
     *      for users is ever introduced, this helper must be updated
     *      to also check the user's active status — the implicit
     *      cascade guarantee won't extend to soft-deletion.
     *      Multi-project and full-scope api-keys also skip — at this
     *      point in the lifecycle the request-target is ambiguous,
     *      so we can't unambiguously verify the JWT user has a
     *      relationship to the project the request will actually
     *      operate on.
     *
     * Failing any of those leaves the field undefined and audit rows
     * record `user_id: null` — the same honest "unknown human actor"
     * shape pre-PR-107 had.
     *
     * **Attribution-only — never authz.** The api-key path is the
     * authoritative auth (api-key wins precedence); `request.authUser`
     * stays undefined on this code path. This field exists purely so
     * audit consumers can record both identities for dual-header
     * requests where the JWT user has a verifiable relationship to the
     * api-key's scope. Anything that needs a fresh user object should
     * continue to read from `authUser`.
     */
    jwtUserIdentity?: { id: string };

    /** JWT verification method - provided by @fastify/jwt plugin */
    jwtVerify(): Promise<{ userId: string }>;

    // ============================================================================
    // PROJECT-LEVEL PROPERTIES (set by requireProjectAccess middleware)
    // ============================================================================

    /** Project ID from route parameters - set by requireProjectAccess */
    projectId?: string;

    /** Project object from database - set by requireProjectAccess */
    project?: Project;

    /** User's role in the project - set by requireProjectAccess */
    projectRole?: ProjectRole;

    // ============================================================================
    // ORGANIZATION-LEVEL PROPERTIES (set by requireOrgAccess middleware)
    // ============================================================================

    /** Organization ID from route parameters - set by requireOrgAccess */
    organizationId?: string;

    /** Organization object from database - set by requireOrgAccess */
    organization?: Organization;

    // ============================================================================
    // AUDIT LOG SCOPE (set by requireAuditAccess middleware)
    // ============================================================================

    /** Org scope for audit log queries — null means all (platform admin), string means org-scoped */
    auditOrgScope?: string | null;

    // ============================================================================
    // DATA RESIDENCY (set by data residency middleware)
    // ============================================================================

    /** Data residency context for compliance - set by data residency middleware */
    dataResidency?: DataResidencyContext;
  }

  interface FastifyContextConfig {
    /** Mark routes as public (skip authentication) */
    public?: boolean;
  }
}

export {};
