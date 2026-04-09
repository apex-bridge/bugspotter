/**
 * Invoice Billing Service
 * API client for invoice-based B2B billing endpoints.
 */

import { api, API_ENDPOINTS } from '../lib/api-client';

export interface Invoice {
  id: string;
  invoice_number: string;
  organization_id: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'canceled';
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  pdf_storage_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  description: string;
  plan_name: string | null;
  period_start: string | null;
  period_end: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  created_at: string;
}

export interface LegalEntity {
  id: string;
  organization_id: string;
  company_name: string;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Act {
  id: string;
  act_number: string;
  invoice_id: string;
  status: 'draft' | 'sent' | 'signed' | 'canceled';
  signed_pdf_path: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface InvoiceListResponse {
  data: Invoice[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const invoiceService = {
  /** List invoices for current organization */
  listInvoices: async (page = 1, limit = 20): Promise<InvoiceListResponse> => {
    const response = await api.get<{ success: boolean; data: InvoiceListResponse }>(
      API_ENDPOINTS.billing.invoices(),
      { params: { page, limit } }
    );
    return response.data.data;
  },

  /** Get a single invoice with line items and act */
  getInvoice: async (
    id: string
  ): Promise<{ invoice: Invoice; lines: InvoiceLine[]; act: Act | null }> => {
    const response = await api.get<{
      success: boolean;
      data: { invoice: Invoice; lines: InvoiceLine[]; act: Act | null };
    }>(API_ENDPOINTS.billing.invoice(id));
    return response.data.data;
  },

  /** Download invoice PDF */
  downloadInvoicePdf: async (id: string): Promise<Blob> => {
    const response = await api.get(API_ENDPOINTS.billing.invoicePdf(id), {
      responseType: 'blob',
    });
    return response.data;
  },

  /** Admin: mark invoice as paid */
  markPaid: async (id: string): Promise<void> => {
    await api.post(API_ENDPOINTS.billing.markPaid(id), {});
  },

  /** Admin: list invoices for a specific organization */
  adminListInvoices: async (orgId: string, page = 1, limit = 20): Promise<InvoiceListResponse> => {
    const response = await api.get<{ success: boolean; data: InvoiceListResponse }>(
      API_ENDPOINTS.billing.adminInvoices(orgId),
      { params: { page, limit } }
    );
    return response.data.data;
  },

  /** Get legal entity details */
  getLegalDetails: async (): Promise<LegalEntity | null> => {
    const response = await api.get<{
      success: boolean;
      data: { legal_entity: LegalEntity | null };
    }>(API_ENDPOINTS.billing.legalDetails());
    return response.data.data.legal_entity;
  },

  /** Save legal entity details (create or update) */
  saveLegalDetails: async (data: {
    company_name: string;
    details: Record<string, unknown>;
  }): Promise<LegalEntity> => {
    const response = await api.post<{
      success: boolean;
      data: { legal_entity: LegalEntity };
    }>(API_ENDPOINTS.billing.legalDetails(), data);
    return response.data.data.legal_entity;
  },

  /** Download act PDF */
  downloadActPdf: async (id: string): Promise<Blob> => {
    const response = await api.get(API_ENDPOINTS.billing.actPdf(id), {
      responseType: 'blob',
    });
    return response.data;
  },
};
