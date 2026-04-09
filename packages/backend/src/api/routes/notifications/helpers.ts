/**
 * Notification route helper functions
 * Shared utilities for notification CRUD operations
 */

import Handlebars from 'handlebars';
import type { DatabaseClient } from '../../../db/client.js';
import type { User, Project, ApiKey } from '../../../db/types.js';
import type { ProjectRole } from '../../../types/project-roles.js';
import { findOrThrow, checkProjectAccess } from '../../utils/resource.js';
import { AppError } from '../../middleware/error.js';
import { getLogger } from '../../../logger.js';
import {
  EmailChannelHandler,
  SlackChannelHandler,
  WebhookChannelHandler,
  DiscordChannelHandler,
  TeamsChannelHandler,
} from '../../../services/notifications/index.js';

const logger = getLogger();

// ============================================================================
// CHANNEL HELPERS
// ============================================================================

/**
 * Channel handler registry
 * Maps channel types to their handler classes
 */
const CHANNEL_HANDLERS = {
  email: EmailChannelHandler,
  slack: SlackChannelHandler,
  webhook: WebhookChannelHandler,
  discord: DiscordChannelHandler,
  teams: TeamsChannelHandler,
} as const;

/**
 * Test channel delivery by actually sending a test notification
 */
export async function testChannelDelivery(
  channelId: string,
  testMessage: string,
  db: DatabaseClient
): Promise<{ delivered: boolean; message: string; response?: unknown; error?: string }> {
  try {
    const channel = await findOrThrow(() => db.notificationChannels.findById(channelId), 'Channel');

    if (!channel.active) {
      return {
        delivered: false,
        message: 'Channel is inactive',
        error: 'Channel must be active to test delivery',
      };
    }

    logger.info('Testing channel delivery', { channelId, type: channel.type });

    // Get handler class for channel type
    const HandlerClass = CHANNEL_HANDLERS[channel.type];

    if (!HandlerClass) {
      return {
        delivered: false,
        message: `Unsupported channel type: ${channel.type}`,
        error: `Channel type '${channel.type}' is not supported`,
      };
    }

    // Create handler and test delivery with custom message
    const handler = new HandlerClass();
    const result = await handler.test(channel.config as never, testMessage);

    // Return standardized result
    if (result.success) {
      return {
        delivered: true,
        message: 'Test notification sent successfully',
        response: {
          message_id: result.message_id,
          ...result.response,
        },
      };
    } else {
      return {
        delivered: false,
        message: 'Test notification failed',
        error: result.error || 'Unknown error',
      };
    }
  } catch (error) {
    logger.error('Channel test failed', { channelId, error });
    return {
      delivered: false,
      message: 'Channel test failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Find channel by ID and verify project access
 * Combines findOrThrow + checkProjectAccess to eliminate duplication
 */
export async function findChannelAndCheckAccess(
  channelId: string,
  authUser: User | undefined,
  authProject: Project | undefined,
  apiKey: ApiKey | undefined,
  db: DatabaseClient,
  minProjectRole?: ProjectRole
) {
  const channel = await findOrThrow(() => db.notificationChannels.findById(channelId), 'Channel');
  await checkProjectAccess(channel.project_id, authUser, authProject, db, 'Channel', {
    apiKey,
    minProjectRole,
  });
  return channel;
}

// ============================================================================
// RULE HELPERS
// ============================================================================

/**
 * Find rule by ID and verify project access
 * Combines findOrThrow + checkProjectAccess to eliminate duplication
 * @param withChannels - If true, fetches rule with associated channels
 */
export async function findRuleAndCheckAccess(
  ruleId: string,
  authUser: User | undefined,
  authProject: Project | undefined,
  apiKey: ApiKey | undefined,
  db: DatabaseClient,
  withChannels = false,
  minProjectRole?: ProjectRole
) {
  const rule = await findOrThrow(
    () =>
      withChannels
        ? db.notificationRules.findByIdWithChannels(ruleId)
        : db.notificationRules.findById(ruleId),
    'Rule'
  );
  await checkProjectAccess(rule.project_id, authUser, authProject, db, 'Rule', {
    apiKey,
    minProjectRole,
  });
  return rule;
}

// ============================================================================
// TEMPLATE HELPERS
// ============================================================================

/**
 * Render template preview using Handlebars
 *
 * Security considerations:
 * - Template size limits to prevent DoS
 * - Context limits to prevent resource exhaustion
 * - Handlebars auto-escapes HTML by default (prevents XSS)
 * - NoEscape option disabled (always escape)
 * - Strict mode enabled (throws on missing properties)
 */
export function renderTemplatePreview(
  templateBody: string,
  subject: string | undefined,
  context: Record<string, unknown>
): { rendered_body: string; rendered_subject?: string } {
  // Validate input and get sanitized context
  const sanitizedContext = validateTemplateInput(templateBody, subject, context);

  try {
    // Compile templates with strict mode (throws on missing properties)
    // Handlebars automatically escapes HTML to prevent XSS
    const bodyTemplate = Handlebars.compile(templateBody, {
      strict: true,
      noEscape: false, // Always escape HTML
    });

    const renderedBody = bodyTemplate(sanitizedContext);

    // Compile subject if provided
    let renderedSubject: string | undefined;
    if (subject) {
      const subjectTemplate = Handlebars.compile(subject, {
        strict: true,
        noEscape: false,
      });
      renderedSubject = subjectTemplate(sanitizedContext);
    }

    return {
      rendered_body: renderedBody,
      ...(renderedSubject && { rendered_subject: renderedSubject }),
    };
  } catch (error) {
    // Handle template compilation/rendering errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown template error';
    logger.error('Template rendering failed', { error: errorMessage });
    throw new AppError(`Template rendering failed: ${errorMessage}`, 400, 'BadRequest');
  }
}

/**
 * Validate template input and sanitize context
 * Extracted from renderTemplatePreview for better separation of concerns
 */
function validateTemplateInput(
  templateBody: string,
  subject: string | undefined,
  context: Record<string, unknown>
): Record<string, unknown> {
  // Security: Enforce template size limits to prevent DoS
  const MAX_TEMPLATE_SIZE = 100_000; // 100KB
  const MAX_CONTEXT_KEYS = 100; // Limit number of variables
  const MAX_CONTEXT_VALUE_SIZE = 10_000; // 10KB per value

  if (templateBody.length > MAX_TEMPLATE_SIZE) {
    throw new AppError('Template body exceeds maximum size limit (100KB)', 400, 'BadRequest');
  }

  if (subject && subject.length > MAX_TEMPLATE_SIZE) {
    throw new AppError('Template subject exceeds maximum size limit (100KB)', 400, 'BadRequest');
  }

  // Security: Limit number of context variables to prevent resource exhaustion
  const contextKeys = Object.keys(context);
  if (contextKeys.length > MAX_CONTEXT_KEYS) {
    throw new AppError(
      `Context exceeds maximum number of variables (${MAX_CONTEXT_KEYS})`,
      400,
      'BadRequest'
    );
  }

  // Security: Validate and sanitize context values
  const sanitizedContext: Record<string, unknown> = {};
  for (const key of contextKeys) {
    const value = context[key];

    // Skip null/undefined
    if (value === null || value === undefined) {
      continue;
    }

    // Convert to string and check size
    const stringValue = String(value);
    if (stringValue.length > MAX_CONTEXT_VALUE_SIZE) {
      throw new AppError(
        `Context value for '${key}' exceeds maximum size limit (10KB)`,
        400,
        'BadRequest'
      );
    }

    sanitizedContext[key] = value;
  }

  return sanitizedContext;
}

// ============================================================================
// LOGGING HELPERS
// ============================================================================

/**
 * Log resource operation with consistent format
 * Standardizes logging across all notification routes
 */
export function logResourceOperation(
  operation: string,
  resourceType: string,
  resourceId: string,
  userId: string | undefined,
  metadata?: Record<string, unknown>
) {
  logger.info(`Notification ${resourceType.toLowerCase()} ${operation}`, {
    [`${resourceType.toLowerCase()}Id`]: resourceId,
    userId,
    ...metadata,
  });
}
