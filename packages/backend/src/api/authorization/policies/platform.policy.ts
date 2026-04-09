/**
 * Platform Policy
 *
 * Two rules:
 * 1. Anonymous subjects are always denied.
 * 2. Platform admins (security.is_platform_admin) are always allowed.
 *
 * Within the policy chain, this is the centralized platform-admin bypass check.
 */

import type { Policy, PolicyResult, Subject, Action, Resource } from '../types.js';
import { isPlatformAdmin } from '../../middleware/auth/assertions.js';

export const platformPolicy: Policy = {
  name: 'platform',

  evaluate(subject: Subject, _action: Action, _resource: Resource): PolicyResult {
    if (subject.kind === 'anonymous') {
      return { decision: 'deny', reason: 'Authentication required' };
    }

    if (subject.kind === 'user' && isPlatformAdmin(subject.user)) {
      return { decision: 'allow', reason: 'Platform admin' };
    }

    return { decision: 'abstain' };
  },
};
