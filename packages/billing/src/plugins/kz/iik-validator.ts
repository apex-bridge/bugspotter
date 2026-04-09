/**
 * Kazakhstan IIK (Individual Identification Code) / IBAN Validator
 *
 * Kazakhstan bank accounts follow IBAN format: KZcc BBBB CCCC CCCC CCCC
 *   KZ   = country code
 *   cc   = 2 check digits (mod 97)
 *   BBBB = bank code (3 digits + 1 letter or 4 digits)
 *   CCCC... = account number (13 characters)
 *
 * Total length: 20 characters (KZ + 18 alphanumeric)
 */

/**
 * Validate a Kazakhstan IIK (bank account number).
 * Returns an error message string or null if valid.
 */
export function validateIik(iik: string): string | null {
  if (!iik) {
    return 'IIK is required';
  }

  const cleaned = iik.replace(/\s/g, '').toUpperCase();

  if (cleaned.length !== 20) {
    return 'IIK must be exactly 20 characters';
  }

  if (!cleaned.startsWith('KZ')) {
    return 'IIK must start with KZ';
  }

  // Check digits (positions 2-3) must be numeric
  if (!/^\d{2}$/.test(cleaned.substring(2, 4))) {
    return 'IIK check digits must be numeric';
  }

  // Remaining 16 characters must be alphanumeric
  if (!/^[A-Z0-9]{16}$/.test(cleaned.substring(4))) {
    return 'IIK account portion must be alphanumeric';
  }

  // IBAN mod-97 check
  if (!verifyIbanChecksum(cleaned)) {
    return 'IIK checksum is invalid';
  }

  return null;
}

/**
 * Check if an IIK string is valid (boolean convenience).
 */
export function isValidIik(iik: string): boolean {
  return validateIik(iik) === null;
}

/**
 * Verify IBAN checksum using mod-97 algorithm (ISO 7064).
 * Move first 4 chars to end, convert letters to digits (A=10..Z=35), check mod 97 = 1.
 */
function verifyIbanChecksum(iban: string): boolean {
  // Move first 4 chars to end
  const rearranged = iban.substring(4) + iban.substring(0, 4);

  // Convert letters to digits: A=10, B=11, ..., Z=35
  let numericStr = '';
  for (const ch of rearranged) {
    if (ch >= 'A' && ch <= 'Z') {
      numericStr += (ch.charCodeAt(0) - 55).toString();
    } else {
      numericStr += ch;
    }
  }

  // Mod-97 on large number (process in chunks to avoid BigInt)
  let remainder = 0;
  for (const digit of numericStr) {
    remainder = (remainder * 10 + parseInt(digit, 10)) % 97;
  }

  return remainder === 1;
}

/**
 * Validate a Kazakhstan BIK (Bank Identifier Code / SWIFT code).
 * SWIFT/BIC codes are 8 or 11 alphanumeric characters.
 */
export function validateBik(bik: string): string | null {
  if (!bik) {
    return 'BIK is required';
  }

  const cleaned = bik.replace(/\s/g, '').toUpperCase();

  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(cleaned)) {
    return 'BIK must be 8 or 11 alphanumeric characters';
  }

  return null;
}

export function isValidBik(bik: string): boolean {
  return validateBik(bik) === null;
}
