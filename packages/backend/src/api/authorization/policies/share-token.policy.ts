/**
 * Share Token Policy
 *
 * Share tokens grant read-only access to a single bug report.
 * No other actions or resources are permitted.
 */

import type { Policy, PolicyResult, Subject, Action, Resource } from '../types.js';

export const shareTokenPolicy: Policy = {
  name: 'shareToken',

  evaluate(subject: Subject, action: Action, resource: Resource): PolicyResult {
    if (subject.kind !== 'shareToken') {
      return { decision: 'abstain' };
    }

    if (
      resource.type === 'bugReport' &&
      action === 'read' &&
      subject.bugReportId === resource.bugReportId
    ) {
      return { decision: 'allow', reason: 'Share token grants read access to this bug report' };
    }

    return {
      decision: 'deny',
      reason: 'Share tokens only grant read access to the shared bug report',
    };
  },
};
