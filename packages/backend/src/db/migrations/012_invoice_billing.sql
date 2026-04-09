-- ============================================================================
-- Migration 012: Invoice-Based Billing for B2B Legal Entities
-- ============================================================================
-- Adds support for invoice billing (счёт → оплата → акт → ЭСФ) targeting
-- Kazakhstan legal entities. Part of the regional billing plugin architecture.
--
-- New column: organizations.billing_method
-- New tables: legal_entities, invoices, invoice_lines, acts
-- New sequences: invoice_number_seq, act_number_seq
-- ============================================================================

SET search_path TO saas;

-- ---------------------------------------------------------------------------
-- 1. Billing method on organizations
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS billing_method VARCHAR(20) NOT NULL DEFAULT 'card';

ALTER TABLE organizations
  ADD CONSTRAINT valid_billing_method CHECK (billing_method IN ('invoice', 'card'));

COMMENT ON COLUMN organizations.billing_method IS
  'invoice = B2B bank transfer billing, card = card-based checkout (future)';

-- ---------------------------------------------------------------------------
-- 2. Legal entities (1:1 with organizations using invoice billing)
-- ---------------------------------------------------------------------------
-- company_name is a shared column (needed for display/search in every region).
-- Region-specific fields live in the JSONB `details` column.
-- Each billing plugin defines its own schema and validates `details`.
--
-- KZ details: { bin, legal_address, bank_name, iik, bik, director_name, phone, email }
-- EU details: { vat_id, iban, registration_number, ... }  (future)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE
        REFERENCES organizations(id) ON DELETE CASCADE,

    company_name VARCHAR(500) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_entities_org
    ON legal_entities(organization_id);
CREATE INDEX IF NOT EXISTS idx_legal_entities_bin
    ON legal_entities USING gin ((details->'bin'));

COMMENT ON TABLE legal_entities IS
    'Legal entity details for B2B invoice billing. Region-specific fields stored in JSONB details.';

CREATE TRIGGER update_legal_entities_updated_at
    BEFORE UPDATE ON legal_entities FOR EACH ROW
    EXECUTE FUNCTION application.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(20) NOT NULL UNIQUE,     -- INV-2026-0001
    organization_id UUID NOT NULL
        REFERENCES organizations(id) ON DELETE CASCADE,

    amount NUMERIC(12,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'KZT',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',

    issued_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    pdf_storage_path VARCHAR(500),
    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_invoice_status CHECK (
        status IN ('draft', 'sent', 'paid', 'overdue', 'canceled')
    ),
    CONSTRAINT positive_invoice_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_invoices_org
    ON invoices(organization_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status
    ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_at
    ON invoices(due_at) WHERE status IN ('sent', 'overdue');

COMMENT ON TABLE invoices IS 'B2B invoices for legal entity billing';

CREATE TRIGGER update_invoices_updated_at
    BEFORE UPDATE ON invoices FOR EACH ROW
    EXECUTE FUNCTION application.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 4. Invoice line items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL
        REFERENCES invoices(id) ON DELETE CASCADE,

    description VARCHAR(500) NOT NULL,
    plan_name VARCHAR(50),
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT positive_line_quantity CHECK (quantity > 0),
    CONSTRAINT positive_line_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
    ON invoice_lines(invoice_id);

COMMENT ON TABLE invoice_lines IS 'Line items on B2B invoices';

-- ---------------------------------------------------------------------------
-- 5. Acts of completed works (Акт выполненных работ)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    act_number VARCHAR(20) NOT NULL UNIQUE,         -- ACT-2026-0001
    invoice_id UUID NOT NULL
        REFERENCES invoices(id) ON DELETE CASCADE,

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    signed_pdf_path VARCHAR(500),
    signed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_act_status CHECK (
        status IN ('draft', 'sent', 'signed', 'canceled')
    )
);

CREATE INDEX IF NOT EXISTS idx_acts_invoice
    ON acts(invoice_id);
CREATE INDEX IF NOT EXISTS idx_acts_status
    ON acts(status);

COMMENT ON TABLE acts IS
    'Acts of completed works (Акт выполненных работ) for B2B billing';

CREATE TRIGGER update_acts_updated_at
    BEFORE UPDATE ON acts FOR EACH ROW
    EXECUTE FUNCTION application.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 6. Sequential numbering sequences
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS saas.invoice_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS saas.act_number_seq START 1;
