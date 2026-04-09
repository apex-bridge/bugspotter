/**
 * Security Headers Constants
 * Single source of truth for security header values (DRY principle)
 *
 * IMPORTANT: These values are also used in:
 * - apps/admin/nginx-snippets/security-headers-permissions.conf (nginx)
 * - apps/admin/SECURITY.md (documentation)
 *
 * When updating these values, ensure they are synchronized across all locations.
 */

/**
 * Permissions-Policy header value
 * Restricts access to browser features for enhanced security
 *
 * Disabled features:
 * - accelerometer: Prevents access to device orientation sensors
 * - camera: Blocks camera access
 * - geolocation: Prevents location tracking
 * - gyroscope: Blocks gyroscope sensor access
 * - magnetometer: Prevents magnetometer sensor access
 * - microphone: Blocks microphone access
 * - payment: Prevents Payment Request API
 * - usb: Blocks USB device access
 */
export const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';
