/**
 * Linear Field Mappings
 *
 * Applies per-rule field overrides to a `LinearIssueInput` before it goes
 * to `issueCreate`. Mirrors `jira/field-mappings.ts` in surface — same
 * `Record<string, unknown>` input shape — but the supported keys differ
 * because Linear has a fixed schema (no Jira-style custom fields).
 *
 * Supported keys:
 *   - `assignee`      : `{ id: string }` or string UUID
 *   - `assigneeId`    : string UUID
 *   - `labels`        : `string[]` of label UUIDs
 *   - `labelIds`      : alias for `labels`
 *   - `priority`      : number 0..4 (Linear's wire format)
 *   - `projectId`     : Linear-side project (epic-grouping) UUID
 *   - `stateId`       : workflow-state UUID
 *   - `dueDate`       : ISO date string
 *   - `estimate`      : number (Linear estimate points)
 *
 * Unknown keys are ignored — unlike Jira, there's no `customfield_*`
 * pass-through, because the Linear API rejects unknown fields outright.
 */

import type { LinearIssueInput, LinearPriority } from './types.js';

function isLinearPriority(value: number): value is LinearPriority {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4;
}

export function applyFieldMappings(
  issueInput: LinearIssueInput,
  fieldMappings: Record<string, unknown>
): void {
  Object.entries(fieldMappings).forEach(([fieldName, fieldValue]) => {
    if (fieldValue === null || fieldValue === undefined) {
      return;
    }

    switch (fieldName) {
      case 'assignee': {
        if (typeof fieldValue === 'string') {
          issueInput.assigneeId = fieldValue;
        } else if (typeof fieldValue === 'object') {
          const id = (fieldValue as Record<string, unknown>).id;
          // Accept `accountId` too — the rule-form UI uses Jira's field
          // name for cross-platform compatibility. Treating it as the
          // Linear user UUID is documented in service.ts (`searchUsers`).
          const accountId = (fieldValue as Record<string, unknown>).accountId;
          if (typeof id === 'string') {
            issueInput.assigneeId = id;
          } else if (typeof accountId === 'string') {
            issueInput.assigneeId = accountId;
          }
        }
        break;
      }

      case 'assigneeId': {
        if (typeof fieldValue === 'string') {
          issueInput.assigneeId = fieldValue;
        }
        break;
      }

      case 'labels':
      case 'labelIds': {
        if (Array.isArray(fieldValue)) {
          const ids = fieldValue.filter((l): l is string => typeof l === 'string');
          issueInput.labelIds = [...(issueInput.labelIds ?? []), ...ids];
        }
        break;
      }

      case 'priority': {
        // Accept both `{ name: 'High' }` (Jira-style, for rule-form UI
        // compatibility) and a raw integer. Named priorities map onto
        // Linear's integer scheme; unknown names fall through unchanged.
        if (typeof fieldValue === 'number' && isLinearPriority(fieldValue)) {
          issueInput.priority = fieldValue;
        } else if (typeof fieldValue === 'object') {
          const name = (fieldValue as Record<string, unknown>).name;
          if (typeof name === 'string') {
            const mapped = priorityNameToLinear(name);
            if (mapped !== null) {
              issueInput.priority = mapped;
            }
          }
        }
        break;
      }

      case 'projectId': {
        if (typeof fieldValue === 'string') {
          issueInput.projectId = fieldValue;
        }
        break;
      }

      case 'stateId': {
        if (typeof fieldValue === 'string') {
          issueInput.stateId = fieldValue;
        }
        break;
      }

      case 'dueDate': {
        if (typeof fieldValue === 'string') {
          issueInput.dueDate = fieldValue;
        }
        break;
      }

      case 'estimate': {
        if (typeof fieldValue === 'number' && Number.isFinite(fieldValue)) {
          issueInput.estimate = fieldValue;
        }
        break;
      }

      case 'description': {
        if (typeof fieldValue === 'string') {
          issueInput.description = fieldValue;
        }
        break;
      }

      default:
        // Drop unknown keys silently — Linear rejects unknown input
        // fields server-side, and we'd rather skip than make the whole
        // ticket creation fail because a stale rule references a removed
        // field name.
        break;
    }
  });
}

function priorityNameToLinear(name: string): LinearPriority | null {
  const normalized = name.toLowerCase().trim();
  switch (normalized) {
    case 'urgent':
    case 'highest':
    case 'critical':
      return 1;
    case 'high':
      return 2;
    case 'medium':
    case 'normal':
      return 3;
    case 'low':
    case 'lowest':
    case 'minor':
      return 4;
    case 'none':
    case 'no priority':
      return 0;
    default:
      return null;
  }
}
