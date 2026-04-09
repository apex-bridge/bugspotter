/**
 * Share Token Configuration Constants
 * Shared between backend validation and frontend UI
 */

/**
 * Minimum expiration time for share tokens (1 hour)
 */
export const MIN_SHARE_TOKEN_EXPIRATION_HOURS = 1;

/**
 * Maximum expiration time for share tokens (720 hours = 30 days)
 */
export const MAX_SHARE_TOKEN_EXPIRATION_HOURS = 720;

/**
 * Default expiration time for share tokens (24 hours)
 */
export const DEFAULT_SHARE_TOKEN_EXPIRATION_HOURS = 24;

/**
 * Minimum password length for password-protected share tokens
 */
export const MIN_SHARE_TOKEN_PASSWORD_LENGTH = 8;

/**
 * Maximum password length for password-protected share tokens
 */
export const MAX_SHARE_TOKEN_PASSWORD_LENGTH = 128;
