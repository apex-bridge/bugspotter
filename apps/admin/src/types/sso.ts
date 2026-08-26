/**
 * SSO (OIDC) config types for the admin panel.
 *
 * Mirrors the org-scoped `oidc_idp_config` shape #352 defines on the
 * backend (`packages/backend/src/db/repositories/`). #352 is
 * backend-only — a migration and a repository, no shared frontend
 * type — so these live locally here, the same convention already
 * used for `IntelligenceSettings` et al. in `./intelligence.ts`,
 * rather than in `@bugspotter/types`, which as of this writing
 * defines neither `SsoConfig` nor `SsoConfigUpdate`
 * (spec 0407-sso-4c-sso-config-data-layer.md, constraint 4).
 */

/**
 * Config as read from the backend. Never carries a raw secret value —
 * only the boolean `hasClientSecret` signals whether one is currently
 * stored. See ADR-0044 and the PR #345 fix it references.
 */
export interface SsoConfig {
  issuerUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  allowedDomains: string[];
  enforceSso: boolean;
}

/**
 * Update payload sent on save. `clientSecret` is optional, not
 * nullable: omit the key entirely to keep the existing secret.
 * Sending `''` would tell the backend to clear it instead — the
 * caller must never conflate the two (spec 0407, constraint 2).
 */
export interface SsoConfigUpdate {
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  allowedDomains: string[];
  enforceSso: boolean;
}
