/**
 * API Key Org Role Inheritance Tests
 * Verifies that org owners/admins can create API keys for projects
 * in their org even without explicit project membership.
 */

import { describe, it, expect } from 'vitest';
import { getEffectiveProjectRole, hasPermissionLevel } from '../../src/types/project-roles.js';
import type { OrgMemberRole } from '../../src/db/types.js';

describe('API Key org role inheritance', () => {
  describe('getEffectiveProjectRole for API key authorization', () => {
    it('org owner inherits project admin role', () => {
      const effective = getEffectiveProjectRole(undefined, 'owner');
      expect(effective).toBe('admin');
      expect(hasPermissionLevel(effective!, 'admin')).toBe(true);
    });

    it('org admin inherits project admin role', () => {
      const effective = getEffectiveProjectRole(undefined, 'admin');
      expect(effective).toBe('admin');
      expect(hasPermissionLevel(effective!, 'admin')).toBe(true);
    });

    it('org member inherits project viewer role (insufficient for API keys)', () => {
      const effective = getEffectiveProjectRole(undefined, 'member');
      expect(effective).toBe('viewer');
      expect(hasPermissionLevel(effective!, 'admin')).toBe(false);
    });

    it('explicit project admin + org member = project admin', () => {
      const effective = getEffectiveProjectRole('admin', 'member');
      expect(effective).toBe('admin');
    });

    it('explicit project viewer + org owner = project admin (inherited wins)', () => {
      const effective = getEffectiveProjectRole('viewer', 'owner');
      expect(effective).toBe('admin');
    });

    it('explicit project member + org admin = project admin (inherited wins)', () => {
      const effective = getEffectiveProjectRole('member', 'admin');
      expect(effective).toBe('admin');
    });

    it('no explicit role + no org role = undefined', () => {
      const effective = getEffectiveProjectRole(undefined, undefined);
      expect(effective).toBeUndefined();
    });
  });

  describe('authorization logic simulation', () => {
    // Simulates the authorization check in api-keys.ts create handler
    function canCreateApiKeyForProject(
      explicitProjectRole: string | null,
      orgMembershipRole: OrgMemberRole | null
    ): boolean {
      // Explicit owner/admin passes immediately
      if (explicitProjectRole === 'owner' || explicitProjectRole === 'admin') {
        return true;
      }

      // Fall back to org inheritance
      if (orgMembershipRole) {
        const effectiveRole = getEffectiveProjectRole(
          explicitProjectRole
            ? (explicitProjectRole as 'owner' | 'admin' | 'member' | 'viewer')
            : undefined,
          orgMembershipRole
        );
        if (effectiveRole && hasPermissionLevel(effectiveRole, 'admin')) {
          return true;
        }
      }

      return false;
    }

    it('allows explicit project owner', () => {
      expect(canCreateApiKeyForProject('owner', null)).toBe(true);
    });

    it('allows explicit project admin', () => {
      expect(canCreateApiKeyForProject('admin', null)).toBe(true);
    });

    it('blocks explicit project member without org role', () => {
      expect(canCreateApiKeyForProject('member', null)).toBe(false);
    });

    it('blocks explicit project viewer without org role', () => {
      expect(canCreateApiKeyForProject('viewer', null)).toBe(false);
    });

    it('allows org owner with no explicit project role', () => {
      expect(canCreateApiKeyForProject(null, 'owner')).toBe(true);
    });

    it('allows org admin with no explicit project role', () => {
      expect(canCreateApiKeyForProject(null, 'admin')).toBe(true);
    });

    it('blocks org member with no explicit project role', () => {
      expect(canCreateApiKeyForProject(null, 'member')).toBe(false);
    });

    it('allows org owner even with explicit viewer role', () => {
      expect(canCreateApiKeyForProject('viewer', 'owner')).toBe(true);
    });

    it('blocks user with no project or org role', () => {
      expect(canCreateApiKeyForProject(null, null)).toBe(false);
    });
  });
});
