/**
 * Invitation Service
 * Handles email-based organization invitations: create, list, cancel, accept, auto-accept.
 */

import { randomBytes } from 'crypto';
import type { DatabaseClient } from '../../db/client.js';
import type { RepositoryRegistry } from '../../db/repositories/factory.js';
import type {
  OrganizationInvitation,
  OrganizationInvitationWithDetails,
  InvitationRole,
  InvitationStatus,
} from '../../db/types.js';
import { INVITATION_STATUS, INVITATION_ROLE } from '../../db/types.js';
import { AppError } from '../../api/middleware/error.js';
import { getLogger } from '../../logger.js';

const INVITATION_TOKEN_BYTES = 32;
const INVITATION_EXPIRY_DAYS = 7;

export interface InvitationPreview {
  organization_name: string;
  organization_subdomain: string;
  email: string;
  role: InvitationRole;
  status: InvitationStatus;
  expires_at: Date;
  inviter_name: string | null;
}

export class InvitationService {
  constructor(private readonly db: DatabaseClient) {}

  /**
   * Create a new invitation for an email address to join an organization.
   * Validates: no existing membership, no duplicate pending invite.
   */
  async createInvitation(
    organizationId: string,
    email: string,
    role: InvitationRole,
    invitedByUserId: string
  ): Promise<OrganizationInvitation> {
    const normalizedEmail = email.toLowerCase().trim();

    if (role === INVITATION_ROLE.OWNER) {
      // Defense-in-depth: prevent owner invitations for orgs that already have an owner.
      // Schema validation blocks 'owner' on the generic invite endpoint, but the service
      // must self-protect against misuse from internal callers.
      const existingOwner = await this.db.organizationMembers.findOwner(organizationId);
      if (existingOwner) {
        throw new AppError('Organization already has an owner', 409, 'Conflict');
      }

      // Prevent duplicate pending owner invitations (clear error instead of DB constraint 500)
      const pendingOwnerInvite =
        await this.db.invitations.findPendingOwnerByOrganizationId(organizationId);
      if (pendingOwnerInvite) {
        throw new AppError(
          'A pending owner invitation already exists for this organization',
          409,
          'Conflict'
        );
      }
    } else {
      // Check if user already exists and is already a member
      const existingUser = await this.db.users.findByEmail(normalizedEmail);
      if (existingUser) {
        const membership = await this.db.organizationMembers.findMembership(
          organizationId,
          existingUser.id
        );
        if (membership) {
          throw new AppError('User is already a member of this organization', 409, 'Conflict');
        }
      }
    }

    // Expire any stale invitations for this org+email first.
    // Without this, an expired-but-still-pending row blocks re-invites
    // (partial unique index on (org_id, email) WHERE status = 'pending').
    await this.db.invitations.expireStaleByOrgAndEmail(organizationId, normalizedEmail);

    // Check for duplicate pending (non-expired) invitation
    const existingInvite = await this.db.invitations.findPendingByOrgAndEmail(
      organizationId,
      normalizedEmail
    );
    if (existingInvite) {
      throw new AppError('A pending invitation already exists for this email', 409, 'Conflict');
    }

    return InvitationService.createInvitationRecord(this.db, {
      organizationId,
      email: normalizedEmail,
      role,
      invitedByUserId,
    });
  }

  /**
   * Create an invitation record using the given repository context.
   * Shared by createInvitation (pool) and adminCreateOrganization (transaction).
   */
  static async createInvitationRecord(
    repos: RepositoryRegistry,
    params: {
      organizationId: string;
      email: string;
      role: InvitationRole;
      invitedByUserId: string;
    }
  ): Promise<OrganizationInvitation> {
    const token = randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    return repos.invitations.create({
      organization_id: params.organizationId,
      email: params.email,
      role: params.role,
      invited_by: params.invitedByUserId,
      token,
      expires_at: expiresAt,
    });
  }

  /**
   * List pending invitations for an organization.
   */
  async listPendingInvitations(
    organizationId: string
  ): Promise<OrganizationInvitationWithDetails[]> {
    return this.db.invitations.findPendingByOrganizationId(organizationId);
  }

  /**
   * Validate that a token refers to a usable (pending + not expired) invitation.
   * Shared by preview, accept, and registration flows.
   *
   * @param persistExpiry - When true, marks expired invitations in DB (use for POST/mutating flows).
   *                        When false, throws without DB write (use for GET/read-only flows).
   */
  async validatePendingToken(
    token: string,
    { persistExpiry = true }: { persistExpiry?: boolean } = {}
  ): Promise<OrganizationInvitationWithDetails> {
    const invitation = await this.db.invitations.findByToken(token);
    if (!invitation) {
      throw new AppError('Invalid or expired invitation', 404, 'NotFound');
    }

    if (invitation.status !== INVITATION_STATUS.PENDING) {
      throw new AppError(`Invitation has already been ${invitation.status}`, 400, 'BadRequest');
    }

    if (new Date() > new Date(invitation.expires_at)) {
      if (persistExpiry) {
        await this.db.invitations.update(invitation.id, {
          status: INVITATION_STATUS.EXPIRED,
        });
      }
      throw new AppError('Invitation has expired', 410, 'Gone');
    }

    return invitation;
  }

  /**
   * Preview an invitation by token (public — no auth required).
   * Returns display-safe fields only; no sensitive IDs or raw token.
   */
  async previewInvitation(token: string): Promise<InvitationPreview> {
    const invitation = await this.validatePendingToken(token, { persistExpiry: false });

    return {
      organization_name: invitation.organization_name,
      organization_subdomain: invitation.organization_subdomain,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expires_at: invitation.expires_at,
      inviter_name: invitation.inviter_name,
    };
  }

  /**
   * Cancel a pending invitation.
   * Validates that the invitation belongs to the specified organization and is still pending.
   */
  async cancelInvitation(
    invitationId: string,
    organizationId: string
  ): Promise<OrganizationInvitation> {
    const invitation = await this.db.invitations.findById(invitationId);
    if (!invitation) {
      throw new AppError('Invitation not found', 404, 'NotFound');
    }
    if (invitation.organization_id !== organizationId) {
      throw new AppError('Invitation does not belong to this organization', 403, 'Forbidden');
    }
    if (invitation.status !== INVITATION_STATUS.PENDING) {
      throw new AppError(
        `Cannot cancel invitation with status: ${invitation.status}`,
        400,
        'BadRequest'
      );
    }

    const canceled = await this.db.invitations.cancelInvitation(invitationId);
    if (!canceled) {
      throw new AppError('Failed to cancel invitation', 500, 'InternalError');
    }
    return canceled;
  }

  /**
   * Accept invitation + join org atomically.
   * Returns { record, joined } on success, null if concurrently accepted.
   */
  private async acceptAndJoin(
    invitationId: string,
    organizationId: string,
    role: InvitationRole,
    userId?: string
  ): Promise<{ record: OrganizationInvitation; joined: boolean } | null> {
    return this.db.transaction(async (tx) => {
      const record = await tx.invitations.acceptInvitation(invitationId);
      if (!record) {
        return null;
      }

      if (!userId) {
        return { record, joined: false };
      }

      const existing = await tx.organizationMembers.findMembership(organizationId, userId);
      if (existing) {
        return { record, joined: false };
      }

      await tx.organizationMembers.create({
        organization_id: organizationId,
        user_id: userId,
        role,
      });
      return { record, joined: true };
    });
  }

  /**
   * Accept an invitation by token.
   * If userId is provided, auto-joins the user to the organization.
   * If userEmail is provided, enforces that it matches the invitation email.
   * Returns the invitation with details for display/redirect.
   */
  async acceptInvitation(
    token: string,
    userId?: string,
    userEmail?: string
  ): Promise<{ invitation: OrganizationInvitationWithDetails; joined: boolean }> {
    const invitation = await this.validatePendingToken(token);

    if (userEmail && userEmail.toLowerCase().trim() !== invitation.email.toLowerCase().trim()) {
      throw new AppError(
        'This invitation was sent to a different email address',
        403,
        'EmailMismatch',
        { invitation_email: invitation.email, current_user_email: userEmail }
      );
    }

    const result = await this.acceptAndJoin(
      invitation.id,
      invitation.organization_id,
      invitation.role,
      userId
    );
    if (!result) {
      throw new AppError('Invitation is no longer available', 409, 'Conflict');
    }

    return {
      invitation: {
        ...invitation,
        status: result.record.status,
        accepted_at: result.record.accepted_at,
      },
      joined: result.joined,
    };
  }

  /**
   * Auto-accept all valid pending invitations for a newly registered user.
   * Called during the registration flow.
   */
  async autoAcceptPendingInvitations(email: string, userId: string): Promise<number> {
    const logger = getLogger();
    const pendingInvites = await this.db.invitations.findPendingByEmail(email);

    let accepted = 0;
    for (const invite of pendingInvites) {
      try {
        const result = await this.acceptAndJoin(
          invite.id,
          invite.organization_id,
          invite.role,
          userId
        );
        if (result?.joined) {
          accepted++;
        }
      } catch (error) {
        logger.warn('Failed to auto-accept invitation', {
          invitationId: invite.id,
          email,
          organizationId: invite.organization_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (accepted > 0) {
      logger.info('Auto-accepted pending invitations on registration', {
        email,
        userId,
        accepted,
        total: pendingInvites.length,
      });
    }

    return accepted;
  }
}
