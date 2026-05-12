/**
 * Linear Template Renderer
 *
 * Variable substitution for custom description templates. Logic is
 * deliberately a verbatim copy of the Jira renderer — it's pure, has no
 * Jira-specific dependencies, and we don't want Linear to import across
 * plugin boundaries. When a third plugin lands, both copies should move
 * to `integrations/shared/`.
 */

import type { BugReport } from '../../db/types.js';

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

export function renderCustomTemplate(
  template: string,
  bugReport: BugReport,
  shareReplayUrl?: string
): string {
  let rendered = template;
  const meta = bugReport.metadata;

  const variables: Record<string, string> = {
    'error.message': getNestedMeta(meta, 'error.message'),
    'error.type': getNestedMeta(meta, 'error.type'),
    stack_trace: getNestedMeta(meta, 'error.stack'),

    user_email:
      getMeta(meta, 'user_email') || getNestedMeta(meta, 'metadata.user_email') || 'Unknown',
    session_id: getMeta(meta, 'session_id') || getNestedMeta(meta, 'metadata.session_id') || 'N/A',

    browser: getMeta(meta, 'browser') || getNestedMeta(meta, 'metadata.browser') || 'Unknown',
    browser_version:
      getMeta(meta, 'browser_version') || getNestedMeta(meta, 'metadata.browser_version'),
    os: getMeta(meta, 'os') || getNestedMeta(meta, 'metadata.os') || 'Unknown',
    viewport_width:
      getMeta(meta, 'viewport_width') || getNestedMeta(meta, 'metadata.viewport_width'),
    viewport_height:
      getMeta(meta, 'viewport_height') || getNestedMeta(meta, 'metadata.viewport_height'),

    url: getMeta(meta, 'url') || getNestedMeta(meta, 'metadata.url'),
    referrer: getMeta(meta, 'referrer') || getNestedMeta(meta, 'metadata.referrer'),

    priority: bugReport.priority || 'medium',
    timestamp: bugReport.created_at.toISOString(),
    title: bugReport.title || '',
    description: bugReport.description || '',

    source: getMeta(meta, 'source') || 'api',
    api_key_prefix: getMeta(meta, 'apiKeyPrefix'),

    replay_url: shareReplayUrl || bugReport.replay_url || '',
    screenshot_url: bugReport.screenshot_url || '',
  };

  if (meta && typeof meta === 'object') {
    addMetadataVariables(meta, variables);
  }

  Object.entries(variables).forEach(([key, value]) => {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  });

  rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');
  rendered = rendered.replace(/\[([^\]]+)\]\(\s*\)/g, '');
  rendered = rendered.replace(/\[\s*\]\([^)]+\)/g, '');

  return rendered;
}
