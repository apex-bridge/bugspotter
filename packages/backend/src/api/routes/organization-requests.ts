/**
 * Organization Request routes (public)
 * Submit and verify organization registration requests.
 * No authentication required — protected by spam filters and rate limiting.
 */

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from '../../db/client.js';
import {
  submitOrgRequestSchema,
  verifyEmailSchema,
} from '../schemas/organization-request-schema.js';
import { AppError } from '../middleware/error.js';
import { getLogger } from '../../logger.js';
import { SpamFilterService } from '../../saas/services/spam-filter.service.js';
import { ORG_REQUEST_STATUS } from '../../db/types.js';
import type { DataResidencyRegion } from '../../db/types.js';
import type { OrgRequestEmailService } from '../../saas/services/org-request-email.service.js';

const logger = getLogger();

/** Verification tokens expire after 24 hours */
const VERIFICATION_TOKEN_TTL_HOURS = 24;

interface SubmitBody {
  company_name: string;
  subdomain: string;
  contact_name: string;
  contact_email: string;
  phone?: string;
  message?: string;
  data_residency_region?: string;
  website?: string; // honeypot
}

interface VerifyBody {
  token: string;
}

export function organizationRequestRoutes(
  fastify: FastifyInstance,
  db: DatabaseClient,
  emailService?: OrgRequestEmailService
) {
  const spamFilter = new SpamFilterService(db);

  /**
   * POST /api/v1/organization-requests
   * Submit a new organization request (public, no auth)
   */
  fastify.post<{ Body: SubmitBody }>(
    '/api/v1/organization-requests',
    {
      schema: submitOrgRequestSchema,
      config: {
        public: true,
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const {
        company_name,
        subdomain,
        contact_name,
        contact_email,
        phone,
        message,
        data_residency_region,
        website, // honeypot
      } = request.body;

      const ip = request.ip;

      // Check subdomain availability (validation error, not spam)
      const subdomainAvailable = await spamFilter.isSubdomainAvailable(subdomain);
      if (!subdomainAvailable) {
        throw new AppError('This subdomain is already taken', 400, 'Bad Request');
      }

      // Run spam checks
      const spamResult = await spamFilter.check({
        company_name,
        subdomain,
        contact_email,
        ip_address: ip,
        honeypot: website,
      });

      if (spamResult.rejected) {
        // Return 201 to not reveal rejection to bots
        logger.info('Organization request spam-rejected', {
          email: contact_email,
          ip,
          score: spamResult.spam_score,
          reasons: spamResult.reasons,
        });
        return reply.status(201).send({
          success: true,
          message: 'Verification email sent. Please check your inbox.',
          timestamp: new Date().toISOString(),
        });
      }

      // Generate verification token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

      // Store the request
      await db.organizationRequests.create({
        company_name,
        subdomain: subdomain.toLowerCase(),
        contact_name,
        contact_email: contact_email.toLowerCase(),
        phone: phone || null,
        message: message || null,
        data_residency_region: data_residency_region as DataResidencyRegion,
        verification_token: hashedToken,
        ip_address: ip,
        honeypot: website || null,
        spam_score: spamResult.spam_score,
      });

      // Send verification email (non-blocking, logs errors)
      if (emailService) {
        await emailService.sendVerificationEmail({
          recipientEmail: contact_email,
          contactName: contact_name,
          companyName: company_name,
          token: rawToken, // Send raw token, DB stores hashed
        });
      } else {
        logger.warn('Email service not configured — verification email not sent', {
          email: contact_email,
        });
      }

      return reply.status(201).send({
        success: true,
        message: 'Verification email sent. Please check your inbox.',
        timestamp: new Date().toISOString(),
      });
    }
  );

  /**
   * POST /api/v1/organization-requests/verify-email
   * Verify email address for a pending request (public, no auth)
   */
  fastify.post<{ Body: VerifyBody }>(
    '/api/v1/organization-requests/verify-email',
    {
      schema: verifyEmailSchema,
      config: {
        public: true,
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { token } = request.body;

      // Hash the token for lookup
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
      const orgRequest = await db.organizationRequests.findByToken(hashedToken);

      if (!orgRequest) {
        throw new AppError('Invalid or expired verification token', 400, 'Bad Request');
      }

      // Handle terminal / non-pending states with specific messages
      if (orgRequest.status !== ORG_REQUEST_STATUS.PENDING_VERIFICATION) {
        const messages: Record<string, string> = {
          [ORG_REQUEST_STATUS.VERIFIED]: 'Email already verified. Your request is under review.',
          [ORG_REQUEST_STATUS.APPROVED]: 'Your request has been approved.',
          [ORG_REQUEST_STATUS.REJECTED]:
            'This request has been reviewed. Please contact support for details.',
          [ORG_REQUEST_STATUS.EXPIRED]:
            'This verification link has expired. Please submit a new request.',
        };
        return reply.send({
          success: true,
          message:
            messages[orgRequest.status] || 'Email already verified. Your request is under review.',
          timestamp: new Date().toISOString(),
        });
      }

      // Check if token is expired (24h)
      const createdAt = new Date(orgRequest.created_at);
      const expiresAt = new Date(
        createdAt.getTime() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000
      );
      if (new Date() > expiresAt) {
        await db.organizationRequests.updateStatus(orgRequest.id, ORG_REQUEST_STATUS.EXPIRED);
        throw new AppError(
          'Verification token has expired. Please submit a new request.',
          400,
          'Bad Request'
        );
      }

      // Atomically update status to prevent race conditions (double-click, etc.)
      const updateResult = await db.query(
        `UPDATE saas.organization_requests
         SET status = 'verified', email_verified_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND status = 'pending_verification'`,
        [orgRequest.id]
      );

      if (updateResult.rowCount === 0) {
        // Another request verified it concurrently — that's fine
        return reply.send({
          success: true,
          message: 'Email already verified. Your request is under review.',
          timestamp: new Date().toISOString(),
        });
      }

      // Send admin notification (non-blocking)
      if (emailService) {
        await emailService.sendAdminNotification({
          companyName: orgRequest.company_name,
          contactName: orgRequest.contact_name,
          contactEmail: orgRequest.contact_email,
          subdomain: orgRequest.subdomain,
          message: orgRequest.message,
          dataResidencyRegion: orgRequest.data_residency_region,
        });
      }

      logger.info('Organization request email verified', {
        requestId: orgRequest.id,
        email: orgRequest.contact_email,
      });

      return reply.send({
        success: true,
        message: 'Email verified. Your request is under review.',
        timestamp: new Date().toISOString(),
      });
    }
  );
}
