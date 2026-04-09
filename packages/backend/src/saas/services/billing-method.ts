/**
 * Billing method validation logic.
 * Shared between the admin route and tests.
 */

export type BillingMethod = 'card' | 'invoice';

/**
 * Validate a billing method switch.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateBillingMethodSwitch(
  newMethod: BillingMethod,
  hasLegalEntity: boolean
): string | null {
  if (newMethod === 'invoice' && !hasLegalEntity) {
    return 'Cannot switch to invoice billing: no legal details on file. Ask the org owner to fill in Legal Details first.';
  }
  return null;
}
