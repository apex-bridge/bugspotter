/**
 * Share Token Routes
 * Public replay sharing with time-limited, optionally password-protected access
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import type { IStorageService } from '../../storage/types.js';
import {
  createShareTokenSchema,
  getSharedReplaySchema,
  deleteShareTokenSchema,
  getActiveShareTokenSchema,
} from '../schemas/share-token-schema.js';
import { sendSuccess, sendCreated } from '../utils/response.js';
import { findReportWithAccess } from '../utils/bug-report-helpers.js';
import { generateShareToken, hashPassword } from '../../utils/token-generator.js';
import { AppError } from '../middleware/error.js';
import { getLogger } from '../../logger.js';
import { config } from '../../config.js';
import { SessionService } from '../../services/session-service.js';

const logger = getLogger();

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Token substring length for secure logging
 * Shows first N characters of token in logs (prevents full token exposure)
 */
const TOKEN_LOG_LENGTH = 8;

/**
 * Milliseconds per hour constant
 * Used for expiration time calculations
 */
const MS_PER_HOUR = 60 * 60 * 1000;

// ============================================================================
// PRIVATE HELPERS
// ============================================================================

/**
 * Safely truncate token for logging (prevents full token exposure)
 * Returns first N characters or entire token if shorter
 * @param token - Token string to truncate
 * @returns Truncated token string safe for logging
 */
function truncateTokenForLog(token: string): string {
  return token.substring(0, Math.min(token.length, TOKEN_LOG_LENGTH));
}

/**
 * Type guard to check if an object has a valid viewport structure
 */
function isValidViewport(obj: unknown): obj is { width: number; height: number } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'width' in obj &&
    'height' in obj &&
    typeof (obj as Record<string, unknown>).width === 'number' &&
    typeof (obj as Record<string, unknown>).height === 'number'
  );
}

/**
 * Safely extract viewport from bug report metadata
 * Handles the nested metadata.metadata structure with proper type checking
 * @param metadata - Bug report metadata object
 * @returns Viewport object if valid, undefined otherwise
 */
function getViewportFromMetadata(
  metadata: Record<string, unknown>
): { width: number; height: number } | undefined {
  // Check if metadata exists and has the expected nested structure
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  // Access the nested metadata property safely
  const nestedMetadata = metadata.metadata;
  if (!nestedMetadata || typeof nestedMetadata !== 'object') {
    return undefined;
  }

  // Extract and validate viewport
  const viewport = (nestedMetadata as Record<string, unknown>).viewport;
  return isValidViewport(viewport) ? viewport : undefined;
}

export function shareTokenRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  storage: IStorageService
) {
  // Initialize session service for consistent session handling
  const sessionService = new SessionService(storage);
  /**
   * GET /api/v1/replays/:id/share
   * Get active share token for a bug report's session replay
   *
   * Authentication: Required (JWT or API Key)
   * Authorization: Must have access to bug report's project
   *
   * @throws {404} Bug report not found or no access
   * @throws {404} No active share token found
   */
  fastify.get<{
    Params: { id: string };
  }>('/api/v1/replays/:id/share', { schema: getActiveShareTokenSchema }, async (request, reply) => {
    const { id: bugReportId } = request.params;
    const userId = request.authUser?.id;

    logger.debug('Fetching active share token', { bugReportId, userId });

    // Verify bug report exists and user has access
    await findReportWithAccess(
      bugReportId,
      request.authUser,
      request.authProject,
      db,
      request.apiKey
    );

    // Get active (non-expired, non-deleted) share tokens
    const activeShares = await db.shareTokens.findActiveByBugReport(bugReportId);

    if (activeShares.length === 0) {
      throw new AppError('No active share token found', 404, 'ShareTokenNotFound');
    }

    // Return the most recent active share (should only be one with Option B)
    const shareToken = activeShares[0];
    const shareUrl = `${config.frontend.url}/shared/${shareToken.token}`;

    logger.info('Active share token retrieved', {
      tokenId: shareToken.id,
      bugReportId,
      userId,
    });

    return sendSuccess(reply, {
      id: shareToken.id,
      token: shareToken.token,
      share_url: shareUrl,
      expires_at: shareToken.expires_at,
      password_protected: !!shareToken.password_hash,
      view_count: shareToken.view_count,
      created_by: shareToken.created_by,
      created_at: shareToken.created_at,
    });
  });

  /**
   * POST /api/v1/replays/:id/share
   * Create a share token for a bug report's session replay
   *
   * Authentication: Required (JWT or API Key)
   * Authorization: Must have access to bug report's project
   *
   * @throws {404} Bug report not found or no access
   * @throws {404} Session replay not found (replay_key is null)
   * @throws {400} Invalid expiration hours (must be 1-720) or password (min 8 chars)
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      password?: string;
      expires_in_hours?: number;
    };
  }>('/api/v1/replays/:id/share', { schema: createShareTokenSchema }, async (request, reply) => {
    const { id: bugReportId } = request.params;
    const { password, expires_in_hours = config.shareToken.defaultExpirationHours } = request.body;
    const userId = request.authUser?.id;

    logger.debug('Creating share token', { bugReportId, userId, hasPassword: !!password });

    // Verify bug report exists and user has access
    const bugReport = await findReportWithAccess(
      bugReportId,
      request.authUser,
      request.authProject,
      db,
      request.apiKey
    );

    // Verify replay or metadata exists (lightweight check)
    if (!sessionService.hasShareableContent(bugReport)) {
      throw new AppError(
        'Bug report does not have a session replay or metadata',
        404,
        'ReplayNotFound'
      );
    }

    // Auto-revoke existing shares (Option B: one share at a time)
    const existingShares = await db.shareTokens.findActiveByBugReport(bugReportId);
    if (existingShares.length > 0) {
      logger.debug('Revoking existing shares', { bugReportId, count: existingShares.length });
      await db.shareTokens.deleteByBugReport(bugReportId);
    }

    // Generate cryptographically secure token
    const token = generateShareToken();

    // Hash password if provided
    let passwordHash: string | null = null;
    if (password) {
      passwordHash = await hashPassword(password);
    }

    // Calculate expiration time (convert hours to milliseconds)
    const expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + expires_in_hours * MS_PER_HOUR);

    // Create share token record
    const shareToken = await db.shareTokens.create({
      bug_report_id: bugReportId,
      token,
      expires_at: expiresAt,
      password_hash: passwordHash,
      created_by: userId || null,
    });

    // Build share URL (frontend route is /shared/:token)
    const shareUrl = `${config.frontend.url}/shared/${token}`;

    logger.info('Share token created', {
      tokenId: shareToken.id,
      bugReportId,
      expiresAt: shareToken.expires_at,
      expiresInHours: expires_in_hours,
      hasPassword: !!passwordHash,
      userId,
    });

    return sendCreated(reply, {
      token: shareToken.token,
      share_url: shareUrl,
      expires_at: shareToken.expires_at,
      password_protected: !!passwordHash,
    });
  });

  /**
   * GET /api/v1/replays/shared/:token
   * Access a shared replay (public route)
   *
   * Authentication: None required (public access)
   * Authorization: Valid token + optional password
   *
   * @throws {404} Token not found, expired, or incorrect password
   * @throws {404} Session replay not found (replay_key is null)
   */
  fastify.get<{
    Params: { token: string };
    Querystring: { password?: string };
  }>(
    '/api/v1/replays/shared/:token',
    {
      schema: getSharedReplaySchema,
      config: { public: true }, // No authentication required
    },
    async (request, reply) => {
      const { token } = request.params;
      const { password } = request.query;

      logger.info('🔍 PUBLIC: Accessing shared replay', {
        token: truncateTokenForLog(token),
        hasPassword: !!password,
        fullToken: token.substring(0, 20) + '...',
      });

      // First, check if token exists (without password verification)
      const tokenInfo = await db.shareTokens.findByToken(token);

      if (!tokenInfo) {
        // Token doesn't exist at all
        throw new AppError('Invalid or expired share token', 404, 'ShareTokenNotFound');
      }

      // If token is password-protected and no password provided, return 401
      if (tokenInfo.password_hash && !password) {
        throw new AppError('Password required for this replay', 401, 'PasswordRequired');
      }

      // Now verify password if provided
      const shareToken = await db.shareTokens.verifyToken(token, password);

      logger.info('🔍 PUBLIC: Token verification result', {
        found: !!shareToken,
        tokenId: shareToken?.id,
        bugReportId: shareToken?.bug_report_id,
        passwordProtected: !!tokenInfo.password_hash,
      });

      if (!shareToken) {
        // Password was provided but incorrect
        throw new AppError('Incorrect password', 401, 'InvalidPassword');
      }

      // Get bug report
      const bugReport = await db.bugReports.findById(shareToken.bug_report_id);

      if (!bugReport) {
        throw new AppError('Bug report not found', 404, 'ReplayNotFound');
      }

      // Verify shareable content exists (lightweight check)
      if (!sessionService.hasShareableContent(bugReport)) {
        throw new AppError('Session replay not found', 404, 'ReplayNotFound');
      }

      // Get session data using SessionService (creates virtual sessions from metadata)
      const sessions = await sessionService.getSessions(bugReport);

      // Merge replay session and metadata session into a single combined session
      let combinedSession = null;
      if (sessions.length > 0) {
        const replaySession = sessions.find((s) => s.events.type === 'rrweb');
        const metadataSession = sessions.find((s) => s.events.type === 'metadata');

        // Start with first available session
        const baseSession = replaySession || metadataSession || sessions[0];

        combinedSession = {
          id: baseSession.id,
          viewport: getViewportFromMetadata(bugReport.metadata),
          events: {
            type: baseSession.events.type,
            // Include rrweb events if available
            ...(replaySession?.events.recordedEvents && {
              recordedEvents: replaySession.events.recordedEvents,
            }),
            // Include console logs from metadata session
            console: metadataSession?.events.console || [],
            // Include network logs from metadata session
            network: metadataSession?.events.network || [],
            // Include metadata if available
            ...(metadataSession?.events?.metadata
              ? { metadata: metadataSession.events.metadata }
              : {}),
          },
        };
      }

      // Increment view count and get updated value (prevents race condition)
      const updatedViewCount = await db.shareTokens.incrementViewCount(token);

      // Generate presigned URLs for assets (only if storage keys exist)
      const urlExpiration = { expiresIn: config.shareToken.presignedUrlExpirationSeconds };

      const replayUrl = bugReport.replay_key
        ? await storage.getSignedUrl(bugReport.replay_key, urlExpiration)
        : null;

      const screenshotUrl = bugReport.screenshot_key
        ? await storage.getSignedUrl(bugReport.screenshot_key, urlExpiration)
        : null;

      const thumbnailUrl = bugReport.thumbnail_key
        ? await storage.getSignedUrl(bugReport.thumbnail_key, urlExpiration)
        : null;

      logger.info('Shared replay accessed', {
        tokenId: shareToken.id,
        bugReportId: bugReport.id,
        viewCount: updatedViewCount,
      });

      return sendSuccess(reply, {
        replay_url: replayUrl,
        bug_report: {
          id: bugReport.id,
          title: bugReport.title,
          description: bugReport.description,
          status: bugReport.status,
          priority: bugReport.priority,
          created_at: bugReport.created_at,
          screenshot_url: screenshotUrl,
          thumbnail_url: thumbnailUrl,
        },
        session: combinedSession,
        share_info: {
          expires_at: shareToken.expires_at,
          view_count: updatedViewCount,
          password_protected: !!shareToken.password_hash,
        },
      });
    }
  );

  /**
   * DELETE /api/v1/replays/share/:token
   * Revoke a share token (soft delete, idempotent)
   *
   * Authentication: Required (JWT or API Key)
   * Authorization: Must have access to the bug report's project
   *
   * @throws {404} Share token not found
   * @throws {403} No access to bug report's project
   */
  fastify.delete<{
    Params: { token: string };
  }>('/api/v1/replays/share/:token', { schema: deleteShareTokenSchema }, async (request, reply) => {
    const { token } = request.params;
    const userId = request.authUser?.id;

    logger.debug('Revoking share token', { token: truncateTokenForLog(token), userId });

    // Find token to verify ownership
    const shareToken = await db.shareTokens.findByToken(token);

    if (!shareToken) {
      throw new AppError('Share token not found', 404, 'ShareTokenNotFound');
    }

    // Verify user has access to the bug report
    await findReportWithAccess(
      shareToken.bug_report_id,
      request.authUser,
      request.authProject,
      db,
      request.apiKey
    );

    // Soft delete the token (idempotent - succeeds even if already deleted)
    await db.shareTokens.deleteByToken(token);

    logger.info('Share token revoked', {
      tokenId: shareToken.id,
      bugReportId: shareToken.bug_report_id,
      userId,
    });

    return sendSuccess(reply, {
      message: 'Share token revoked successfully',
    });
  });
}
