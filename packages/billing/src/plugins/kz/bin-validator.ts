/**
 * Kazakhstan BIN (Business Identification Number) Validator
 *
 * BIN is a 12-digit number assigned to legal entities and individual entrepreneurs.
 * Format: YYMMDD-T-NNNN-C
 *   YY   = year of registration (or birth year for IE)
 *   MM   = month
 *   DD   = day (for organizations: special encoding)
 *   T    = type digit (4,5,6 = legal entity; other = individual)
 *   NNNN = sequential number
 *   C    = check digit
 */

/**
 * Validate a Kazakhstan BIN.
 * Returns an error message string or null if valid.
 */
export function validateBin(bin: string): string | null {
  if (!bin) {
    return 'BIN is required';
  }

  const cleaned = bin.replace(/\s/g, '');

  if (!/^\d{12}$/.test(cleaned)) {
    return 'BIN must be exactly 12 digits';
  }

  // Basic date portion validation (first 6 digits = YYMMDD)
  const month = parseInt(cleaned.substring(2, 4), 10);
  if (month < 1 || month > 12) {
    return 'BIN has invalid month in date portion';
  }

  // Note: For organizational BINs, the "day" portion (positions 4-5) can exceed 31
  // as it encodes entity type information, not a calendar day.
  // We only reject clearly impossible values (>99).
  const day = parseInt(cleaned.substring(4, 6), 10);
  if (day < 0 || day > 99) {
    return 'BIN has invalid day in date portion';
  }

  // Check digit validation using weights
  if (!verifyCheckDigit(cleaned)) {
    return 'BIN check digit is invalid';
  }

  return null;
}

/**
 * Check if a BIN string is valid (boolean convenience).
 */
export function isValidBin(bin: string): boolean {
  return validateBin(bin) === null;
}

/**
 * Verify BIN check digit using the standard algorithm.
 * Two rounds of weighted sum modulo 11.
 */
function verifyCheckDigit(bin: string): boolean {
  const digits = bin.split('').map(Number);

  // First round weights: 1,2,3,4,5,6,7,8,9,10,11
  const weights1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += digits[i] * weights1[i];
  }

  let check = sum % 11;

  if (check === 10) {
    // Second round weights: 3,4,5,6,7,8,9,10,11,1,2
    const weights2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
    sum = 0;
    for (let i = 0; i < 11; i++) {
      sum += digits[i] * weights2[i];
    }
    check = sum % 11;

    if (check === 10) {
      return false; // Cannot compute valid check digit
    }
  }

  return check === digits[11];
}
