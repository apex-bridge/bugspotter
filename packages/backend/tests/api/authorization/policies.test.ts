/**
 * Authorization Policy Tests
 * Tests for the policy-based authorization system.
 *
 * Covers:
 * - Platform policy (admin bypass, anonymous deny)
 * - Organization policy (role hierarchy, inheritance to projects)
 * - Project policy (role hierarchy, API key access)
 * - Share token policy (read-only, single bug)
 * - Policy chain (authorize function, first-wins, default deny)
 */

import { describe, it, expect } from 'vitest';
import { authorize } from '../../../src/api/authorization/policies/index.js';
import { platformPolicy } from '../../../src/api/authorization/policies/platform.policy.js';
import { organizationPolicy } from '../../../src/api/authorization/policies/organization.policy.js';
import { projectPolicy } from '../../../src/api/authorization/policies/project.policy.js';
import { shareTokenPolicy } from '../../../src/api/authorization/policies/share-token.policy.js';
import type { Subject, Resource } from '../../../src/api/authorization/types.js';
import {
  getInheritedProjectRole,
  getEffectiveProjectRole,
} from '../../../src/types/project-roles.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function userSubject(
  role: 'admin' | 'user' | 'viewer' = 'user',
  overrides: Partial<Subject & { kind: 'user' }> = {}
): Subject {
  return {
    kind: 'user',
    user: {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      password_hash: null,
      role,
      oauth_provider: null,
      oauth_id: null,
      preferences: {},
      created_at: new Date(),
    },
    ...overrides,
  } as Subject;
}

function apiKeySubject(allowedProjects: string[] | null = null): Subject {
  return {
    kind: 'apiKey',
    apiKey: {
      id: 'key-1',
      key_hash: '',
      key_prefix: 'bgs_test',
      key_suffix: '',
      name: 'Test Key',
      description: null,
      type: 'project',
      status: 'active',
      permission_scope: 'full',
      permissions: [],
      allowed_projects: allowedProjects,
      allowed_environments: null,
    },
  } as Subject;
}

function shareTokenSubject(bugReportId: string): Subject {
  return { kind: 'shareToken', bugReportId };
}

const anonymousSubject: Subject = { kind: 'anonymous' };

// ---------------------------------------------------------------------------
// Platform Policy
// ---------------------------------------------------------------------------

describe('Platform Policy', () => {
  it('denies anonymous subjects', async () => {
    const result = await platformPolicy.evaluate(anonymousSubject, 'read', { type: 'platform' });
    expect(result.decision).toBe('deny');
  });

  it('allows platform admin for any action and resource', async () => {
    const admin = userSubject('admin');
    expect((await platformPolicy.evaluate(admin, 'delete', { type: 'platform' })).decision).toBe(
      'allow'
    );
    expect(
      (
        await platformPolicy.evaluate(admin, 'manage', {
          type: 'organization',
          organizationId: 'org-1',
        })
      ).decision
    ).toBe('allow');
    expect(
      (await platformPolicy.evaluate(admin, 'delete', { type: 'project', projectId: 'proj-1' }))
        .decision
    ).toBe('allow');
  });

  it('abstains for non-admin authenticated users', async () => {
    const user = userSubject('user');
    const result = await platformPolicy.evaluate(user, 'read', { type: 'platform' });
    expect(result.decision).toBe('abstain');
  });

  it('abstains for API keys', async () => {
    const key = apiKeySubject();
    const result = await platformPolicy.evaluate(key, 'read', {
      type: 'project',
      projectId: 'p-1',
    });
    expect(result.decision).toBe('abstain');
  });

  it('abstains for share tokens', async () => {
    const token = shareTokenSubject('bug-1');
    const result = await platformPolicy.evaluate(token, 'read', {
      type: 'bugReport',
      bugReportId: 'bug-1',
      projectId: 'p-1',
    });
    expect(result.decision).toBe('abstain');
  });
});

// ---------------------------------------------------------------------------
// Organization Policy
// ---------------------------------------------------------------------------

describe('Organization Policy', () => {
  const orgResource: Resource = { type: 'organization', organizationId: 'org-1' };

  it('allows org owner to manage', async () => {
    const owner = userSubject('user', { orgRole: 'owner' });
    expect((await organizationPolicy.evaluate(owner, 'manage', orgResource)).decision).toBe(
      'allow'
    );
    expect((await organizationPolicy.evaluate(owner, 'delete', orgResource)).decision).toBe(
      'allow'
    );
  });

  it('allows org admin to manage but not delete', async () => {
    const admin = userSubject('user', { orgRole: 'admin' });
    expect((await organizationPolicy.evaluate(admin, 'manage', orgResource)).decision).toBe(
      'allow'
    );
    expect((await organizationPolicy.evaluate(admin, 'delete', orgResource)).decision).toBe('deny');
  });

  it('allows org member to read but not manage', async () => {
    const member = userSubject('user', { orgRole: 'member' });
    expect((await organizationPolicy.evaluate(member, 'read', orgResource)).decision).toBe('allow');
    expect((await organizationPolicy.evaluate(member, 'manage', orgResource)).decision).toBe(
      'deny'
    );
  });

  it('denies user without org membership', async () => {
    const user = userSubject('user'); // no orgRole
    const result = await organizationPolicy.evaluate(user, 'read', orgResource);
    expect(result.decision).toBe('deny');
  });

  it('abstains for non-org resources', async () => {
    const owner = userSubject('user', { orgRole: 'owner' });
    const result = await organizationPolicy.evaluate(owner, 'read', {
      type: 'project',
      projectId: 'p-1',
    });
    expect(result.decision).toBe('abstain');
  });

  // --- Org-to-project inheritance ---
  describe('project inheritance', () => {
    const projectResource: Resource = {
      type: 'project',
      projectId: 'p-1',
      organizationId: 'org-1',
    };

    it('grants org owner project admin access', async () => {
      const owner = userSubject('user', { orgRole: 'owner' });
      const result = await organizationPolicy.evaluate(owner, 'manage', projectResource);
      expect(result.decision).toBe('allow');
    });

    it('grants org admin project admin access', async () => {
      const admin = userSubject('user', { orgRole: 'admin' });
      const result = await organizationPolicy.evaluate(admin, 'manage', projectResource);
      expect(result.decision).toBe('allow');
    });

    it('grants org member project read access', async () => {
      const member = userSubject('user', { orgRole: 'member' });
      expect((await organizationPolicy.evaluate(member, 'read', projectResource)).decision).toBe(
        'allow'
      );
      expect((await organizationPolicy.evaluate(member, 'list', projectResource)).decision).toBe(
        'allow'
      );
    });

    it('abstains when org member lacks inherited permission (lets project policy decide)', async () => {
      const member = userSubject('user', { orgRole: 'member' });
      const result = await organizationPolicy.evaluate(member, 'manage', projectResource);
      expect(result.decision).toBe('abstain');
    });

    it('abstains for projects without organizationId', async () => {
      const owner = userSubject('user', { orgRole: 'owner' });
      const result = await organizationPolicy.evaluate(owner, 'read', {
        type: 'project',
        projectId: 'p-1',
      });
      expect(result.decision).toBe('abstain');
    });

    it('grants org owner admin access to bug reports with organizationId', async () => {
      const owner = userSubject('user', { orgRole: 'owner' });
      const bugResource: Resource = {
        type: 'bugReport',
        bugReportId: 'bug-1',
        projectId: 'p-1',
        organizationId: 'org-1',
      };
      expect((await organizationPolicy.evaluate(owner, 'manage', bugResource)).decision).toBe(
        'allow'
      );
      expect((await organizationPolicy.evaluate(owner, 'read', bugResource)).decision).toBe(
        'allow'
      );
    });

    it('grants org member viewer access to bug reports with organizationId', async () => {
      const member = userSubject('user', { orgRole: 'member' });
      const bugResource: Resource = {
        type: 'bugReport',
        bugReportId: 'bug-1',
        projectId: 'p-1',
        organizationId: 'org-1',
      };
      expect((await organizationPolicy.evaluate(member, 'read', bugResource)).decision).toBe(
        'allow'
      );
      expect((await organizationPolicy.evaluate(member, 'manage', bugResource)).decision).toBe(
        'abstain'
      );
    });

    it('abstains for bug reports without organizationId', async () => {
      const owner = userSubject('user', { orgRole: 'owner' });
      const result = await organizationPolicy.evaluate(owner, 'read', {
        type: 'bugReport',
        bugReportId: 'bug-1',
        projectId: 'p-1',
      });
      expect(result.decision).toBe('abstain');
    });
  });
});

// ---------------------------------------------------------------------------
// Project Policy
// ---------------------------------------------------------------------------

describe('Project Policy', () => {
  const projectResource: Resource = { type: 'project', projectId: 'proj-1' };

  it('allows project owner to delete', async () => {
    const owner = userSubject('user', { projectRole: 'owner' });
    const result = await projectPolicy.evaluate(owner, 'delete', projectResource);
    expect(result.decision).toBe('allow');
  });

  it('allows project admin to manage', async () => {
    const admin = userSubject('user', { projectRole: 'admin' });
    expect((await projectPolicy.evaluate(admin, 'manage', projectResource)).decision).toBe('allow');
    expect((await projectPolicy.evaluate(admin, 'delete', projectResource)).decision).toBe('deny');
  });

  it('allows project member to create and update', async () => {
    const member = userSubject('user', { projectRole: 'member' });
    expect((await projectPolicy.evaluate(member, 'create', projectResource)).decision).toBe(
      'allow'
    );
    expect((await projectPolicy.evaluate(member, 'update', projectResource)).decision).toBe(
      'allow'
    );
    expect((await projectPolicy.evaluate(member, 'manage', projectResource)).decision).toBe('deny');
  });

  it('allows project viewer to read only', async () => {
    const viewer = userSubject('user', { projectRole: 'viewer' });
    expect((await projectPolicy.evaluate(viewer, 'read', projectResource)).decision).toBe('allow');
    expect((await projectPolicy.evaluate(viewer, 'list', projectResource)).decision).toBe('allow');
    expect((await projectPolicy.evaluate(viewer, 'create', projectResource)).decision).toBe('deny');
  });

  it('denies user without project role', async () => {
    const user = userSubject('user'); // no projectRole
    const result = await projectPolicy.evaluate(user, 'read', projectResource);
    expect(result.decision).toBe('deny');
  });

  it('allows API key with matching allowed_projects', async () => {
    const key = apiKeySubject(['proj-1', 'proj-2']);
    const result = await projectPolicy.evaluate(key, 'create', projectResource);
    expect(result.decision).toBe('allow');
  });

  it('denies API key with non-matching allowed_projects', async () => {
    const key = apiKeySubject(['proj-99']);
    const result = await projectPolicy.evaluate(key, 'create', projectResource);
    expect(result.decision).toBe('deny');
  });

  it('allows API key with null allowed_projects (unrestricted)', async () => {
    const key = apiKeySubject(null);
    const result = await projectPolicy.evaluate(key, 'create', projectResource);
    expect(result.decision).toBe('allow');
  });

  it('allows API key with empty allowed_projects (unrestricted, matches existing behavior)', async () => {
    const key = apiKeySubject([]);
    const result = await projectPolicy.evaluate(key, 'create', projectResource);
    expect(result.decision).toBe('allow');
  });

  it('abstains for non-project resources', async () => {
    const user = userSubject('user', { projectRole: 'admin' });
    const result = await projectPolicy.evaluate(user, 'read', {
      type: 'organization',
      organizationId: 'org-1',
    });
    expect(result.decision).toBe('abstain');
  });

  it('handles bugReport resource type using projectId', async () => {
    const member = userSubject('user', { projectRole: 'member' });
    const bugResource: Resource = { type: 'bugReport', bugReportId: 'bug-1', projectId: 'proj-1' };
    expect((await projectPolicy.evaluate(member, 'read', bugResource)).decision).toBe('allow');
    expect((await projectPolicy.evaluate(member, 'create', bugResource)).decision).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// Share Token Policy
// ---------------------------------------------------------------------------

describe('Share Token Policy', () => {
  it('allows read access to the shared bug report', async () => {
    const token = shareTokenSubject('bug-1');
    const resource: Resource = { type: 'bugReport', bugReportId: 'bug-1', projectId: 'p-1' };
    const result = await shareTokenPolicy.evaluate(token, 'read', resource);
    expect(result.decision).toBe('allow');
  });

  it('denies read access to a different bug report', async () => {
    const token = shareTokenSubject('bug-1');
    const resource: Resource = { type: 'bugReport', bugReportId: 'bug-2', projectId: 'p-1' };
    const result = await shareTokenPolicy.evaluate(token, 'read', resource);
    expect(result.decision).toBe('deny');
  });

  it('denies write access even to the shared bug report', async () => {
    const token = shareTokenSubject('bug-1');
    const resource: Resource = { type: 'bugReport', bugReportId: 'bug-1', projectId: 'p-1' };
    expect((await shareTokenPolicy.evaluate(token, 'update', resource)).decision).toBe('deny');
    expect((await shareTokenPolicy.evaluate(token, 'delete', resource)).decision).toBe('deny');
  });

  it('abstains for non-share-token subjects', async () => {
    const user = userSubject('user');
    const resource: Resource = { type: 'bugReport', bugReportId: 'bug-1', projectId: 'p-1' };
    const result = await shareTokenPolicy.evaluate(user, 'read', resource);
    expect(result.decision).toBe('abstain');
  });
});

// ---------------------------------------------------------------------------
// Authorize (policy chain)
// ---------------------------------------------------------------------------

describe('authorize() policy chain', () => {
  it('platform admin is allowed for anything', async () => {
    const admin = userSubject('admin');
    const result = await authorize(admin, 'delete', { type: 'project', projectId: 'p-1' });
    expect(result.decision).toBe('allow');
    expect(result.reason).toContain('admin');
  });

  it('anonymous is denied', async () => {
    const result = await authorize(anonymousSubject, 'read', { type: 'platform' });
    expect(result.decision).toBe('deny');
  });

  it('share token allowed for matching bug read', async () => {
    const token = shareTokenSubject('bug-1');
    const result = await authorize(token, 'read', {
      type: 'bugReport',
      bugReportId: 'bug-1',
      projectId: 'p-1',
    });
    expect(result.decision).toBe('allow');
  });

  it('org owner gets project access via inheritance', async () => {
    const owner = userSubject('user', { orgRole: 'owner' });
    const result = await authorize(owner, 'manage', {
      type: 'project',
      projectId: 'p-1',
      organizationId: 'org-1',
    });
    expect(result.decision).toBe('allow');
  });

  it('project member with explicit role is allowed', async () => {
    const member = userSubject('user', { projectRole: 'member' });
    const result = await authorize(member, 'create', { type: 'project', projectId: 'p-1' });
    expect(result.decision).toBe('allow');
  });

  it('user with no roles is denied (default deny)', async () => {
    const user = userSubject('user'); // no org or project role
    const result = await authorize(user, 'read', { type: 'project', projectId: 'p-1' });
    expect(result.decision).toBe('deny');
  });

  it('org member inherits project read but denied manage', async () => {
    const member = userSubject('user', { orgRole: 'member' });
    const readResult = await authorize(member, 'read', {
      type: 'project',
      projectId: 'p-1',
      organizationId: 'org-1',
    });
    expect(readResult.decision).toBe('allow');

    const manageResult = await authorize(member, 'manage', {
      type: 'project',
      projectId: 'p-1',
      organizationId: 'org-1',
    });
    expect(manageResult.decision).toBe('deny');
  });

  it('explicit project role elevates over inherited org role', async () => {
    // Org member inherits viewer, but explicit project admin allows manage
    const user = userSubject('user', { orgRole: 'member', projectRole: 'admin' });
    const result = await authorize(user, 'manage', {
      type: 'project',
      projectId: 'p-1',
      organizationId: 'org-1',
    });
    expect(result.decision).toBe('allow');
    expect(result.reason).toContain('Project role');
  });

  it('org member with explicit project owner can delete', async () => {
    const user = userSubject('user', { orgRole: 'member', projectRole: 'owner' });
    const result = await authorize(user, 'delete', {
      type: 'project',
      projectId: 'p-1',
      organizationId: 'org-1',
    });
    expect(result.decision).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// Shared inheritance utilities
// ---------------------------------------------------------------------------

describe('getInheritedProjectRole', () => {
  it('maps owner to admin', () => {
    expect(getInheritedProjectRole('owner')).toBe('admin');
  });

  it('maps admin to admin', () => {
    expect(getInheritedProjectRole('admin')).toBe('admin');
  });

  it('maps member to viewer', () => {
    expect(getInheritedProjectRole('member')).toBe('viewer');
  });
});

describe('getEffectiveProjectRole', () => {
  it('returns inherited when no explicit role', () => {
    expect(getEffectiveProjectRole(undefined, 'owner')).toBe('admin');
    expect(getEffectiveProjectRole(undefined, 'member')).toBe('viewer');
  });

  it('returns explicit when no org role', () => {
    expect(getEffectiveProjectRole('member', undefined)).toBe('member');
  });

  it('returns the higher of explicit and inherited', () => {
    expect(getEffectiveProjectRole('viewer', 'owner')).toBe('admin');
    expect(getEffectiveProjectRole('admin', 'member')).toBe('admin');
  });

  it('returns undefined when both are undefined', () => {
    expect(getEffectiveProjectRole(undefined, undefined)).toBeUndefined();
  });

  it('preserves explicit owner (higher than inherited admin)', () => {
    expect(getEffectiveProjectRole('owner', 'owner')).toBe('owner');
  });
});
