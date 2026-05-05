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
     * also present and its signature verifies.
     *
     * **Attribution-only — never authz.** The api-key path is the
     * authoritative auth (api-key wins precedence), so `request.authUser`
     * stays undefined on this code path. This field exists purely so
     * audit consumers can record both identities and close the GH-97
     * dual-header gap.
     *
     * Carries only `userId` from the JWT claims — no DB lookup, no
     * user-existence verification. The semantic is "this is the user
     * the JWT claimed to be at request time," which is the right level
     * for an audit trail (a historical record of what credentials were
     * presented). Anything that needs a fresh user object should
     * continue to read from `authUser` and accept that this code path
     * doesn't populate it.
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
