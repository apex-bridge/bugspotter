/**
 * Plan Quota Tests
 * Verifies plan definitions and quota lookups
 */

import { describe, it, expect } from 'vitest';
import { PLAN_QUOTAS, getQuotaForPlan } from '../../src/saas/plans.js';
import { PLAN_NAME, RESOURCE_TYPE } from '../../src/db/types.js';

const ALL_PLAN_NAMES = Object.values(PLAN_NAME);
const ALL_RESOURCE_TYPES = Object.values(RESOURCE_TYPE);

describe('PLAN_QUOTAS', () => {
  it('should define quotas for every plan', () => {
    for (const plan of ALL_PLAN_NAMES) {
      expect(PLAN_QUOTAS[plan]).toBeDefined();
    }
  });

  it('should define every resource type for each plan', () => {
    for (const plan of ALL_PLAN_NAMES) {
      for (const resource of ALL_RESOURCE_TYPES) {
        expect(PLAN_QUOTAS[plan][resource]).toBeTypeOf('number');
        expect(PLAN_QUOTAS[plan][resource]).toBeGreaterThan(0);
      }
    }
  });

  it('should have increasing quotas from trial to enterprise', () => {
    const order: (typeof PLAN_NAME)[keyof typeof PLAN_NAME][] = [
      PLAN_NAME.TRIAL,
      PLAN_NAME.STARTER,
      PLAN_NAME.PROFESSIONAL,
      PLAN_NAME.ENTERPRISE,
    ];

    for (const resource of ALL_RESOURCE_TYPES) {
      for (let i = 1; i < order.length; i++) {
        const lower = PLAN_QUOTAS[order[i - 1]][resource];
        const higher = PLAN_QUOTAS[order[i]][resource];
        expect(higher).toBeGreaterThan(lower);
      }
    }
  });
});

describe('getQuotaForPlan', () => {
  it('should return quotas for a valid plan', () => {
    const quotas = getQuotaForPlan(PLAN_NAME.STARTER);
    expect(quotas[RESOURCE_TYPE.PROJECTS]).toBe(3);
    expect(quotas[RESOURCE_TYPE.BUG_REPORTS]).toBe(1_000);
  });

  it('should throw for an unknown plan', () => {
    expect(() => getQuotaForPlan('nonexistent' as never)).toThrow('Unknown plan: nonexistent');
  });

  it('should return same reference as PLAN_QUOTAS entry', () => {
    const quotas = getQuotaForPlan(PLAN_NAME.PROFESSIONAL);
    expect(quotas).toBe(PLAN_QUOTAS[PLAN_NAME.PROFESSIONAL]);
  });
});
