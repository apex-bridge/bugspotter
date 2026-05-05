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
     * also present and ALL THREE of these checks pass:
     *
     *   1. JWT signature verifies (`request.jwtVerify`)
     *   2. The claimed user exists in the database
     *      (`db.users.findById`) — mirrors `handleJwtAuth`'s
     *      existence check so a deleted / disabled-user JWT can't
     *      poison attribution
     *   3. The api-key targets exactly one project
     *      (`allowed_projects.length === 1`) AND the user has an
     *      effective role (explicit `project_members` OR org-inherited
     *      via the project's organization) on that project, checked
     *      by `jwtUserCanAttributeForApiKey`. Multi-project and
     *      full-scope api-keys skip attribution entirely — at this
     *      point in the lifecycle the request-target is ambiguous,
     *      so we can't unambiguously verify the JWT user has a
     *      relationship to the project the request actually
     *      operates on
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
