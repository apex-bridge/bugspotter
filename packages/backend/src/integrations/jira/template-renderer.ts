/**
 * Jira Template Renderer
 * Handles custom description template variable substitution
 */

import type { BugReport } from '../../db/types.js';

/**
 * Safely get a top-level metadata value as a string
 */
function getMeta(metadata: Record<string, unknown> | undefined, key: string): string {
  if (!metadata) {
    return '';
  }
  const value = metadata[key];
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

/**
 * Safely get a nested metadata value by dot-separated path (e.g., "error.message", "metadata.browser")
 */
function getNestedMeta(metadata: Record<string, unknown> | undefined, path: string): string {
  if (!metadata) {
    return '';
  }
  const parts = path.split('.');
  let current: unknown = metadata;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return '';
    }
  }

  if (typeof current === 'string' || typeof current === 'number') {
    return String(current);
  }
  return '';
}

/**
 * Add dynamic metadata fields to variables map
 *
 * Supports 2 levels of nesting:
 * - Top-level: {{metadata.request_id}} for metadata.request_id = "123"
 * - Nested: {{metadata.user.email}} for metadata.user.email = "user@example.com"
 *
 * For deeper nesting (3+ levels), either:
 * 1. Flatten your metadata structure before sending
 * 2. Add predefined variables using getNestedMeta() in renderCustomTemplate()
 */
function addMetadataVariables(
  metadata: Record<string, unknown>,
  variables: Record<string, string>
): void {
  Object.entries(metadata).forEach(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number') {
      variables[`metadata.${key}`] = String(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value).forEach(([nestedKey, nestedValue]) => {
        if (typeof nestedValue === 'string' || typeof nestedValue === 'number') {
          variables[`metadata.${key}.${nestedKey}`] = String(nestedValue);
        }
      });
    }
  });
}

/**
 * Render custom description template with variable substitution.
 * Supports variables like {{error.message}}, {{user_email}}, {{browser}},
 * {{replay_url}}, {{screenshot_url}}, etc.
 *
 * Metadata lookup order for browser/device/location variables:
 * 1. Top-level metadata (SDK format): metadata.browser
 * 2. Nested metadata (Chrome extension format): metadata.metadata.browser
 * 3. Fallback default (e.g., "Unknown")
 */
export function renderCustomTemplate(
  template: string,
  bugReport: BugReport,
  shareReplayUrl?: string
): string {
  let rendered = template;
  const meta = bugReport.metadata;

  // Build variable map from bug report data
  const variables: Record<string, string> = {
    // Error information (from metadata.error object)
    'error.message': getNestedMeta(meta, 'error.message'),
    'error.type': getNestedMeta(meta, 'error.type'),
    stack_trace: getNestedMeta(meta, 'error.stack'),

    // User and session (flat metadata → nested metadata.metadata → fallback)
    user_email:
      getMeta(meta, 'user_email') || getNestedMeta(meta, 'metadata.user_email') || 'Unknown',
    session_id: getMeta(meta, 'session_id') || getNestedMeta(meta, 'metadata.session_id') || 'N/A',

    // Browser and device
    browser: getMeta(meta, 'browser') || getNestedMeta(meta, 'metadata.browser') || 'Unknown',
    browser_version:
      getMeta(meta, 'browser_version') || getNestedMeta(meta, 'metadata.browser_version'),
    os: getMeta(meta, 'os') || getNestedMeta(meta, 'metadata.os') || 'Unknown',
    viewport_width:
      getMeta(meta, 'viewport_width') || getNestedMeta(meta, 'metadata.viewport_width'),
    viewport_height:
      getMeta(meta, 'viewport_height') || getNestedMeta(meta, 'metadata.viewport_height'),

    // Location
    url: getMeta(meta, 'url') || getNestedMeta(meta, 'metadata.url'),
    referrer: getMeta(meta, 'referrer') || getNestedMeta(meta, 'metadata.referrer'),

    // Bug report direct fields
    priority: bugReport.priority || 'medium',
    timestamp: bugReport.created_at.toISOString(),
    title: bugReport.title || '',
    description: bugReport.description || '',

    // Report source and API key
    source: getMeta(meta, 'source') || 'api',
    api_key_prefix: getMeta(meta, 'apiKeyPrefix'),

    // Replay and screenshot URLs
    replay_url: shareReplayUrl || bugReport.replay_url || '',
    screenshot_url: bugReport.screenshot_url || '',
  };

  // Add all metadata fields dynamically (e.g., {{metadata.request_id}})
  if (meta && typeof meta === 'object') {
    addMetadataVariables(meta, variables);
  }

  // Replace all {{variable}} occurrences
  Object.entries(variables).forEach(([key, value]) => {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  });

  // Remove any unmatched variables (replace with empty string)
  rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');

  // Clean up empty Markdown links (e.g., [Watch Session Replay]())
  rendered = rendered.replace(/\[([^\]]+)\]\(\s*\)/g, ''); // [text]() -> remove
  rendered = rendered.replace(/\[\s*\]\([^)]+\)/g, ''); // [](url) -> remove

  return rendered;
}
