/**
 * @bugspotter/billing — Regional plugin-based invoice billing
 */

// Core interfaces and types
export {
  INVOICE_STATUS,
  ACT_STATUS,
  BILLING_METHOD,
  type InvoiceStatus,
  type ActStatus,
  type BillingMethod,
  type Invoice,
  type InvoiceLine,
  type LegalEntity,
  type Act,
  type InvoiceInsert,
  type InvoiceUpdate,
  type InvoiceLineInsert,
  type LegalEntityInsert,
  type LegalEntityUpdate,
  type ActInsert,
  type ActUpdate,
  type CreateInvoiceInput,
  type InvoicePdfResult,
  type KzLegalDetails,
  type BillingRegionPlugin,
} from './interfaces.js';

// Registry
export { BillingRegionRegistry } from './registry.js';

// KZ plugin
export { KzBillingPlugin } from './plugins/kz/index.js';

// KZ validators (exported for use in API validation)
export { validateBin, isValidBin } from './plugins/kz/bin-validator.js';
export { validateIik, isValidIik, validateBik, isValidBik } from './plugins/kz/iik-validator.js';

// Numbering utilities
export {
  nextInvoiceNumber,
  nextActNumber,
  formatNumber,
  parseNumber,
} from './plugins/kz/numbering.js';
