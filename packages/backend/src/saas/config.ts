/**
 * SaaS Deployment Configuration
 * Controls which SaaS features are enabled based on DEPLOYMENT_MODE env var.
 */

export const DEPLOYMENT_MODE = {
  SELFHOSTED: 'selfhosted',
  SAAS: 'saas',
} as const;

export const DEPLOYMENT_MODES = ['selfhosted', 'saas'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export interface DeploymentFeatures {
  multiTenancy: boolean;
  billing: boolean;
  usageTracking: boolean;
  quotaEnforcement: boolean;
}

export interface DeploymentConfig {
  mode: DeploymentMode;
  features: DeploymentFeatures;
}

let cached: DeploymentConfig | null = null;

export function getDeploymentConfig(): DeploymentConfig {
  if (cached) {
    return cached;
  }

  const raw = process.env.DEPLOYMENT_MODE;
  const mode: DeploymentMode =
    DEPLOYMENT_MODES.find((m) => m === raw) ?? DEPLOYMENT_MODE.SELFHOSTED;

  const isSaas = mode === DEPLOYMENT_MODE.SAAS;

  cached = {
    mode,
    features: {
      multiTenancy: isSaas,
      billing: isSaas,
      usageTracking: isSaas,
      quotaEnforcement: isSaas,
    },
  };

  return cached;
}

/**
 * Reset cached config (for testing only).
 */
export function resetDeploymentConfig(): void {
  cached = null;
}
