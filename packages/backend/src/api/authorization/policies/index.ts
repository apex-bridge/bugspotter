/**
 * Policy Registry
 *
 * THE single authorization entry point.
 * Evaluates policies in order. First allow/deny wins.
 * If all abstain, default is deny.
 *
 * Policy order:
 * 1. Platform — admin bypass, anonymous deny
 * 2. Share token — narrow scope, fast path
 * 3. Organization — org-level access + project inheritance
 * 4. Project — explicit project roles + API key access
 */

import type { Policy, Subject, Action, Resource, PolicyResult } from '../types.js';
import { platformPolicy } from './platform.policy.js';
import { shareTokenPolicy } from './share-token.policy.js';
import { organizationPolicy } from './organization.policy.js';
import { projectPolicy } from './project.policy.js';

const DEFAULT_POLICY_CHAIN: Policy[] = [
  platformPolicy,
  shareTokenPolicy,
  organizationPolicy,
  projectPolicy,
];

export async function authorize(
  subject: Subject,
  action: Action,
  resource: Resource,
  policies: Policy[] = DEFAULT_POLICY_CHAIN
): Promise<PolicyResult> {
  for (const policy of policies) {
    const result = await policy.evaluate(subject, action, resource);
    if (result.decision !== 'abstain') {
      return result;
    }
  }

  return { decision: 'deny', reason: 'No policy granted access (default deny)' };
}

export { platformPolicy, shareTokenPolicy, organizationPolicy, projectPolicy };
