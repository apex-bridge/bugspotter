/**
 * Utility functions for audit log formatting and display
 */

// Re-export formatDate from format.ts for backward compatibility
export { formatDate } from './format';

/**
 * Get Tailwind CSS classes for action badge color based on HTTP method
 */
export function getActionBadgeColor(action: string): string {
  switch (action) {
    case 'POST':
      return 'bg-green-100 text-green-800';
    case 'PUT':
    case 'PATCH':
      return 'bg-blue-100 text-blue-800';
    case 'DELETE':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}
