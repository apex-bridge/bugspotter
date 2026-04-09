/**
 * Template Renderer
 * Handles template rendering and context building for notifications
 */

import { ValidationError } from '../../api/middleware/error.js';
import type {
  TemplateRenderContext,
  NotificationPayload,
  NotificationTemplate,
} from '../../types/notifications.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const TITLE_MAX_LENGTH = 100;

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#dc3545',
  high: '#fd7e14',
  medium: '#ffc107',
  low: '#28a745',
  default: '#6c757d',
} as const;

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Get string value from object safely
 */
function getStringValue(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Get priority color based on priority level
 */
function getPriorityColor(priority: string): string {
  return PRIORITY_COLORS[priority] || PRIORITY_COLORS.default;
}

/**
 * Generate bug title from bug data
 */
function getBugTitle(bug: Record<string, unknown>): string {
  const title = getStringValue(bug, 'title');
  if (title) {
    return title;
  }

  const errorMessage = getStringValue(bug, 'error_message');
  if (errorMessage) {
    return errorMessage.substring(0, TITLE_MAX_LENGTH);
  }

  return 'Untitled Bug';
}

/**
 * Get nested object value by dot-notation path
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((current: unknown, key: string) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj as unknown);
}

/**
 * Replace template variables with context values using {{variable}} syntax
 *
 * Supports:
 * - Simple variables: {{bug.title}}
 * - Nested access with dot notation: {{bug.user.email}}
 * - Whitespace tolerance: {{ bug.title }} (automatically trimmed)
 * - Object/array serialization: {{bug.metadata}} → JSON string
 * - Undefined/null preservation: {{missing.field}} → "{{missing.field}}" (unchanged)
 * - Circular reference protection: {{circular.ref}} → "{{circular.ref}}" (unchanged)
 *
 * Examples:
 * - replaceVariables("Bug: {{bug.title}}", {bug: {title: "Error"}}) → "Bug: Error"
 * - replaceVariables("Email: {{user.email}}", {user: {email: "a@b.c"}}) → "Email: a@b.c"
 * - replaceVariables("Data: {{obj}}", {obj: {x: 1}}) → 'Data: {"x":1}'
 * - replaceVariables("Missing: {{unknown}}", {}) → "Missing: {{unknown}}"
 *
 * @param text - Template string containing {{variable}} placeholders
 * @param context - Object containing values for variable replacement
 * @returns Rendered string with variables replaced
 */
function replaceVariables(text: string, context: Record<string, unknown>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = getNestedValue(context, path.trim());

    // Preserve placeholder for undefined and null values
    if (value === undefined || value === null) {
      return match;
    }

    // For objects/arrays, use JSON representation to avoid [object Object]
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        // Handle circular references
        return match;
      }
    }

    return String(value);
  });
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Build template rendering context from bug and project data
 */
export function buildTemplateContext(
  bug: Record<string, unknown>,
  project: Record<string, unknown>
): TemplateRenderContext {
  const bugPriority = getStringValue(bug, 'priority') || 'medium';
  const adminUrl = process.env.ADMIN_URL || 'http://localhost:3001';
  const bugId = bug.id as string;

  return {
    bug: {
      id: bugId,
      title: getBugTitle(bug),
      message: getStringValue(bug, 'error_message') || '',
      priority: bugPriority,
      priorityColor: getPriorityColor(bugPriority),
      status: getStringValue(bug, 'status') || 'open',
      browser: getStringValue(bug, 'browser') || 'Unknown',
      os: getStringValue(bug, 'os') || 'Unknown',
      url: getStringValue(bug, 'url') || '',
      user: {
        email: getStringValue(bug, 'user_email') || undefined,
        name: getStringValue(bug, 'user_name'),
      },
      stack_trace: getStringValue(bug, 'stack_trace'),
    },
    project: {
      id: project.id as string,
      name: getStringValue(project, 'name') || 'Unknown Project',
    },
    link: {
      bugDetail: `${adminUrl}/bugs/${bugId}`,
      replay: bug.session_id ? `${adminUrl}/replay/${bug.session_id}` : undefined,
    },
    timestamp: new Date().toLocaleString(),
    timezone: 'UTC',
  };
}

/**
 * Render template with context using simple string replacement
 */
export function renderTemplate(
  template: NotificationTemplate,
  context: TemplateRenderContext
): NotificationPayload {
  // Validate body exists and is a string
  if (!template.body || typeof template.body !== 'string') {
    throw new ValidationError('Template body is required and must be a string', {
      templateId: template.id,
      templateName: template.name,
      bodyType: typeof template.body,
    });
  }

  // Validate body is not empty after trimming
  if (template.body.trim().length === 0) {
    throw new ValidationError('Template body cannot be empty', {
      templateId: template.id,
      templateName: template.name,
    });
  }

  let body = template.body;
  let subject = template.subject || '';

  // Simple template variable replacement
  body = replaceVariables(body, context as unknown as Record<string, unknown>);
  subject = replaceVariables(subject, context as unknown as Record<string, unknown>);

  // Build recipient list from context
  const recipients: string[] = [];

  // Add bug reporter
  if (context.bug?.user.email) {
    recipients.push(context.bug.user.email);
  }

  // Add template-specified recipients if any
  if (template.recipients) {
    const templateRecipients = Array.isArray(template.recipients)
      ? template.recipients
      : [template.recipients];
    recipients.push(...templateRecipients.filter((r): r is string => typeof r === 'string'));
  }

  // Fail fast if no valid recipients
  if (recipients.length === 0) {
    throw new ValidationError(
      'No valid recipients found - bug context missing and template has no recipients',
      {
        hasContext: !!context.bug,
        contextEmail: context.bug?.user.email,
        templateRecipients: template.recipients,
      }
    );
  }

  return {
    to: recipients.length === 1 ? recipients[0] : recipients,
    subject,
    body,
  };
}
