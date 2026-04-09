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
