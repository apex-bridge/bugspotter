/**
 * Admin Billing Method Tests
 * Tests the shared validateBillingMethodSwitch helper used by the
 * PATCH /api/v1/admin/organizations/:id/billing-method route.
 */

import { describe, it, expect } from 'vitest';
import { validateBillingMethodSwitch } from '../../src/saas/services/billing-method.js';

describe('validateBillingMethodSwitch', () => {
  it('allows switching to card without legal details', () => {
    expect(validateBillingMethodSwitch('card', false)).toBeNull();
  });

  it('allows switching to card with legal details', () => {
    expect(validateBillingMethodSwitch('card', true)).toBeNull();
  });

  it('allows switching to invoice when legal details exist', () => {
    expect(validateBillingMethodSwitch('invoice', true)).toBeNull();
  });

  it('blocks switching to invoice without legal details', () => {
    const error = validateBillingMethodSwitch('invoice', false);
    expect(error).not.toBeNull();
    expect(error).toContain('no legal details');
  });
});
