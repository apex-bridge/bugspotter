/**
 * SaaS Plan Definitions
 * Single source of truth for plan quota limits.
 */

import { PLAN_NAME, RESOURCE_TYPE } from '../db/types.js';
import type { PlanName, ResourceType } from '../db/types.js';

const GB = 1024 ** 3;

/**
 * Quota limits for a single plan.
 * Keys match ResourceType values.
 */
export type PlanQuotas = Record<ResourceType, number>;

/**
 * Quota limits per plan tier.
 *
 * - projects: total active projects (not per-period)
 * - bug_reports: per billing period
 * - storage_bytes: total (cumulative)
 * - api_calls: per billing period
 * - screenshots: per billing period
 * - session_replays: per billing period
 */
export const PLAN_QUOTAS: Record<PlanName, PlanQuotas> = {
  [PLAN_NAME.TRIAL]: {
    [RESOURCE_TYPE.PROJECTS]: 2,
    [RESOURCE_TYPE.BUG_REPORTS]: 100,
    [RESOURCE_TYPE.STORAGE_BYTES]: 1 * GB,
    [RESOURCE_TYPE.API_CALLS]: 5_000,
    [RESOURCE_TYPE.SCREENSHOTS]: 100,
    [RESOURCE_TYPE.SESSION_REPLAYS]: 50,
  },
  [PLAN_NAME.STARTER]: {
    [RESOURCE_TYPE.PROJECTS]: 3,
    [RESOURCE_TYPE.BUG_REPORTS]: 1_000,
    [RESOURCE_TYPE.STORAGE_BYTES]: 10 * GB,
    [RESOURCE_TYPE.API_CALLS]: 50_000,
    [RESOURCE_TYPE.SCREENSHOTS]: 1_000,
    [RESOURCE_TYPE.SESSION_REPLAYS]: 500,
  },
  [PLAN_NAME.PROFESSIONAL]: {
    [RESOURCE_TYPE.PROJECTS]: 10,
    [RESOURCE_TYPE.BUG_REPORTS]: 10_000,
    [RESOURCE_TYPE.STORAGE_BYTES]: 50 * GB,
    [RESOURCE_TYPE.API_CALLS]: 100_000,
    [RESOURCE_TYPE.SCREENSHOTS]: 10_000,
    [RESOURCE_TYPE.SESSION_REPLAYS]: 5_000,
  },
  [PLAN_NAME.ENTERPRISE]: {
    [RESOURCE_TYPE.PROJECTS]: 50,
    [RESOURCE_TYPE.BUG_REPORTS]: 100_000,
    [RESOURCE_TYPE.STORAGE_BYTES]: 500 * GB,
    [RESOURCE_TYPE.API_CALLS]: 1_000_000,
    [RESOURCE_TYPE.SCREENSHOTS]: 100_000,
    [RESOURCE_TYPE.SESSION_REPLAYS]: 50_000,
  },
};

/**
 * Plan prices per currency (monthly).
 */
export const PLAN_PRICES: Record<PlanName, Record<string, number>> = {
  [PLAN_NAME.TRIAL]: { KZT: 0, RUB: 0, USD: 0 },
  [PLAN_NAME.STARTER]: { KZT: 4_990, RUB: 990, USD: 9 },
  [PLAN_NAME.PROFESSIONAL]: { KZT: 14_990, RUB: 2_990, USD: 29 },
  [PLAN_NAME.ENTERPRISE]: { KZT: 49_990, RUB: 9_990, USD: 99 },
};

/**
 * Get quota limits for a given plan.
 * Throws if the plan name is unknown.
 */
export function getQuotaForPlan(planName: PlanName): PlanQuotas {
  const quotas = PLAN_QUOTAS[planName];
  if (!quotas) {
    throw new Error(`Unknown plan: ${planName}`);
  }
  return quotas;
}

/** Map data-residency region to billing currency. */
const REGION_CURRENCY: Record<string, string> = {
  kz: 'KZT',
  rf: 'RUB',
};

/** Get the billing currency code for a given region. Defaults to USD. */
export function getRegionCurrency(region: string): string {
  return REGION_CURRENCY[region] ?? 'USD';
}

/** Get the price for a plan in a given currency. */
export function getPlanPrice(planName: PlanName, currency: string): number {
  const prices = PLAN_PRICES[planName];
  if (!prices) {
    throw new Error(`Unknown plan: ${planName}`);
  }
  const price = prices[currency];
  if (price === undefined) {
    throw new Error(`No ${currency} price for plan: ${planName}`);
  }
  return price;
}

/**
 * Combined plan configuration for the public API.
 */
export interface PlanConfig {
  name: PlanName;
  prices: Record<string, number>;
  quotas: PlanQuotas;
}

export function getPlansConfig(): PlanConfig[] {
  return (Object.keys(PLAN_QUOTAS) as PlanName[])
    .filter((name) => name !== PLAN_NAME.TRIAL)
    .map((name) => ({
      name,
      prices: PLAN_PRICES[name],
      quotas: PLAN_QUOTAS[name],
    }));
}
