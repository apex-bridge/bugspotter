/**
 * KZ Seller Configuration
 * Legal details for Apex Bridge Technology TOO (the seller/provider).
 * These appear on every KZ invoice and act PDF.
 *
 * Values are configured via SELLER_* environment variables.
 * DEFAULT_SELLER fields are intentionally blank — all SELLER_* env vars
 * must be set in production for complete invoice/act PDFs.
 */

export interface KzSellerConfig {
  company_name: string;
  bin: string;
  legal_address: string;
  bank_name: string;
  iik: string;
  bik: string;
  director_name: string;
  phone: string;
  email: string;
}

const DEFAULT_SELLER: KzSellerConfig = {
  company_name: 'TOO "Apex Bridge Technology"',
  bin: '',
  legal_address: '',
  bank_name: '',
  iik: '',
  bik: '',
  director_name: '',
  phone: '',
  email: '',
};

/**
 * Get the seller config from environment or fallback to defaults.
 * Environment variables: SELLER_BIN, SELLER_IIK, SELLER_BIK, etc.
 */
export function getKzSellerConfig(): KzSellerConfig {
  return {
    company_name: process.env.SELLER_COMPANY_NAME || DEFAULT_SELLER.company_name,
    bin: process.env.SELLER_BIN || DEFAULT_SELLER.bin,
    legal_address: process.env.SELLER_LEGAL_ADDRESS || DEFAULT_SELLER.legal_address,
    bank_name: process.env.SELLER_BANK_NAME || DEFAULT_SELLER.bank_name,
    iik: process.env.SELLER_IIK || DEFAULT_SELLER.iik,
    bik: process.env.SELLER_BIK || DEFAULT_SELLER.bik,
    director_name: process.env.SELLER_DIRECTOR_NAME || DEFAULT_SELLER.director_name,
    phone: process.env.SELLER_PHONE || DEFAULT_SELLER.phone,
    email: process.env.SELLER_EMAIL || DEFAULT_SELLER.email,
  };
}
