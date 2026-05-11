/**
 * Linear Field Mapping Tests
 *
 * Covers the per-rule override layer that lives between the mapper's
 * default field selection and the GraphQL call. Pure function, no I/O.
 */

import { describe, it, expect } from 'vitest';
import { applyFieldMappings } from '../../../src/integrations/linear/field-mappings.js';
import type { LinearIssueInput } from '../../../src/integrations/linear/types.js';

function base(): LinearIssueInput {
  return { teamId: 'team-uuid', title: 'T' };
}

describe('applyFieldMappings', () => {
  it('sets assigneeId from a bare string', () => {
    const input = base();
    applyFieldMappings(input, { assignee: 'user-uuid' });
    expect(input.assigneeId).toBe('user-uuid');
  });

  it('sets assigneeId from { id }', () => {
    const input = base();
    applyFieldMappings(input, { assignee: { id: 'user-uuid' } });
    expect(input.assigneeId).toBe('user-uuid');
  });

  it('accepts Jira-flavoured { accountId } shape from rule-form UI', () => {
    const input = base();
    applyFieldMappings(input, { assignee: { accountId: 'user-uuid' } });
    expect(input.assigneeId).toBe('user-uuid');
  });

  it('accepts direct assigneeId string', () => {
    const input = base();
    applyFieldMappings(input, { assigneeId: 'user-uuid' });
    expect(input.assigneeId).toBe('user-uuid');
  });

  it('appends labels to existing labelIds', () => {
    const input: LinearIssueInput = { ...base(), labelIds: ['existing'] };
    applyFieldMappings(input, { labels: ['new-1', 'new-2'] });
    expect(input.labelIds).toEqual(['existing', 'new-1', 'new-2']);
  });

  it('accepts labelIds as alias for labels', () => {
    const input = base();
    applyFieldMappings(input, { labelIds: ['a', 'b'] });
    expect(input.labelIds).toEqual(['a', 'b']);
  });

  it('accepts integer priority directly', () => {
    const input = base();
    applyFieldMappings(input, { priority: 1 });
    expect(input.priority).toBe(1);
  });

  it('maps named priorities (Jira-style) onto Linear integers', () => {
    const cases: Array<[string, number]> = [
      ['urgent', 1],
      ['highest', 1],
      ['high', 2],
      ['medium', 3],
      ['normal', 3],
      ['low', 4],
      ['lowest', 4],
      ['none', 0],
    ];
    for (const [name, expected] of cases) {
      const input = base();
      applyFieldMappings(input, { priority: { name } });
      expect(input.priority, `priority "${name}"`).toBe(expected);
    }
  });

  it('rejects out-of-range integer priorities', () => {
    const input = base();
    applyFieldMappings(input, { priority: 99 });
    expect(input.priority).toBeUndefined();
  });

  it('silently ignores unknown field names (no customfield_* pass-through)', () => {
    const input = base();
    applyFieldMappings(input, { customfield_10001: 'jira-only' });
    expect((input as Record<string, unknown>).customfield_10001).toBeUndefined();
  });

  it('skips null and undefined values', () => {
    const input = base();
    applyFieldMappings(input, { assigneeId: null, priority: undefined });
    expect(input.assigneeId).toBeUndefined();
    expect(input.priority).toBeUndefined();
  });

  it('passes stateId and dueDate through unchanged', () => {
    const input = base();
    applyFieldMappings(input, {
      stateId: 'state-uuid',
      dueDate: '2026-12-31',
      estimate: 5,
      projectId: 'linear-project-uuid',
    });
    expect(input.stateId).toBe('state-uuid');
    expect(input.dueDate).toBe('2026-12-31');
    expect(input.estimate).toBe(5);
    expect(input.projectId).toBe('linear-project-uuid');
  });
});
