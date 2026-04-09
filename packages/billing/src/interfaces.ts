/**
 * Billing Module — Core Interfaces
 * Defines the plugin contract and entity types for regional billing.
 */

import type { Pool, PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const INVOICE_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  PAID: 'paid',
  OVERDUE: 'overdue',
  CANCELED: 'canceled',
} as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

export const ACT_STATUS = {
  DRAFT: 'draft',
  SENT: 'sent',
  SIGNED: 'signed',
  CANCELED: 'canceled',
} as const;
export type ActStatus = (typeof ACT_STATUS)[keyof typeof ACT_STATUS];

export const BILLING_METHOD = {
  INVOICE: 'invoice',
  CARD: 'card',
} as const;
export type BillingMethod = (typeof BILLING_METHOD)[keyof typeof BILLING_METHOD];

// ---------------------------------------------------------------------------
// Entity interfaces
// ---------------------------------------------------------------------------

export interface Invoice {
  id: string;
  invoice_number: string;
  organization_id: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issued_at: Date | null;
  due_at: Date | null;
  paid_at: Date | null;
  pdf_storage_path: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  description: string;
  plan_name: string | null;
  period_start: Date | null;
  period_end: Date | null;
  quantity: number;
  unit_price: number;
  amount: number;
  created_at: Date;
}

export interface LegalEntity {
  id: string;
  organization_id: string;
  company_name: string;
  details: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * KZ-specific legal entity details (stored in LegalEntity.details JSONB).
 */
export interface KzLegalDetails {
  bin: string;
  legal_address: string;
  bank_name: string;
  iik: string;
  bik: string;
  director_name: string;
  phone?: string | null;
  email?: string | null;
}

export interface Act {
  id: string;
  act_number: string;
  invoice_id: string;
  status: ActStatus;
  signed_pdf_path: string | null;
  signed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Insert / Update types
// ---------------------------------------------------------------------------

export type InvoiceInsert = {
  id?: string;
  invoice_number: string;
  organization_id: string;
  amount: number;
  currency?: string;
  status?: InvoiceStatus;
  issued_at?: Date | null;
  due_at?: Date | null;
  notes?: string | null;
};

export type InvoiceUpdate = Partial<
  Omit<Invoice, 'id' | 'invoice_number' | 'organization_id' | 'created_at' | 'updated_at'>
>;

export type InvoiceLineInsert = {
  id?: string;
  invoice_id: string;
  description: string;
  plan_name?: string | null;
  period_start?: Date | null;
  period_end?: Date | null;
  quantity?: number;
  unit_price: number;
  amount: number;
};

export type LegalEntityInsert = {
  id?: string;
  organization_id: string;
  company_name: string;
  details?: Record<string, unknown>;
};

export type LegalEntityUpdate = Partial<
  Omit<LegalEntity, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
>;

export type ActInsert = {
  id?: string;
  act_number: string;
  invoice_id: string;
  status?: ActStatus;
};

export type ActUpdate = Partial<
  Omit<Act, 'id' | 'act_number' | 'invoice_id' | 'created_at' | 'updated_at'>
>;

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  organizationId: string;
  planName: string;
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  currency: string;
}

export interface InvoicePdfResult {
  pdfBuffer: Buffer;
  filename: string;
}

export interface BillingRegionPlugin {
  /** Region code, e.g. 'kz' */
  readonly regionCode: string;

  /**
   * Create an invoice for the given billing period.
   * Returns the created invoice ID.
   */
  createInvoice(input: CreateInvoiceInput, db: Pool | PoolClient): Promise<{ invoiceId: string }>;

  /**
   * Mark an invoice as paid (admin action).
   * Should also trigger subscription activation.
   */
  markPaid(invoiceId: string, db: Pool | PoolClient): Promise<void>;

  /**
   * Generate PDF for an invoice.
   */
  generateInvoicePdf(invoiceId: string, db: Pool | PoolClient): Promise<InvoicePdfResult>;

  /**
   * Generate Act of completed works PDF.
   */
  generateActPdf(actId: string, db: Pool | PoolClient): Promise<InvoicePdfResult>;

  /**
   * Validate legal entity details for this region.
   * @param companyName - the shared company_name column
   * @param details - the region-specific JSONB details
   * Returns array of error messages (empty = valid).
   */
  validateLegalEntity(companyName: string, details: Record<string, unknown>): string[];
}
