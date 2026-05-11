/**
 * Linear Mapper Tests
 *
 * Verifies bug-report → LinearIssueInput conversion. No network — the
 * mapper is pure.
 */

import { describe, it, expect } from 'vitest';
import {
  LinearBugReportMapper,
  mapPriorityToLinear,
} from '../../../src/integrations/linear/mapper.js';
import type { LinearConfig } from '../../../src/integrations/linear/types.js';
import type { BugReport } from '../../../src/db/types.js';

const baseConfig: LinearConfig = {
  apiKey: 'lin_api_xxx',
  teamId: 'team-uuid',
  teamKey: 'ENG',
  enabled: true,
};

function makeBugReport(overrides: Partial<BugReport> = {}): BugReport {
  return {
    id: 'bug-1',
    organization_id: 'org-1',
    project_id: 'project-1',
    title: 'Something broke',
    description: 'Steps: click, observe',
    priority: 'high',
    status: 'open',
    metadata: {
      browser: 'Chrome',
      os: 'macOS',
      url: 'https://example.com/page',
    },
    screenshot_url: 'https://example.com/screenshot.png',
    screenshot_key: 'screenshots/abc.png',
    replay_url: null,
    replay_key: null,
    replay_upload_status: 'pending',
    external_id: null,
    external_url: null,
    duplicate_of: null,
    created_at: new Date('2026-05-11T10:00:00Z'),
    updated_at: new Date('2026-05-11T10:00:00Z'),
    ...overrides,
  } as BugReport;
}

describe('mapPriorityToLinear', () => {
  it('maps priorities to Linear integers', () => {
    expect(mapPriorityToLinear('critical')).toBe(1);
    expect(mapPriorityToLinear('high')).toBe(2);
    expect(mapPriorityToLinear('medium')).toBe(3);
    expect(mapPriorityToLinear('low')).toBe(4);
    expect(mapPriorityToLinear('minor')).toBe(4);
  });

  it('returns 0 (no priority) for unknown or missing input', () => {
    expect(mapPriorityToLinear(undefined)).toBe(0);
    expect(mapPriorityToLinear('weird')).toBe(0);
  });
});

describe('LinearBugReportMapper.toLinearIssueInput', () => {
  it('produces a minimal valid input', () => {
    const mapper = new LinearBugReportMapper(baseConfig);
    const input = mapper.toLinearIssueInput(makeBugReport());

    expect(input.teamId).toBe('team-uuid');
    expect(input.title).toBe('Something broke');
    expect(input.priority).toBe(2);
    expect(input.description).toContain('Steps: click, observe');
    expect(input.description).toContain('### Environment');
    expect(input.description).toContain('Chrome');
  });

  it('truncates titles longer than 255 chars', () => {
    const longTitle = 'x'.repeat(300);
    const mapper = new LinearBugReportMapper(baseConfig);
    const input = mapper.toLinearIssueInput(makeBugReport({ title: longTitle }));

    expect(input.title.length).toBeLessThanOrEqual(255);
    expect(input.title.endsWith('...')).toBe(true);
  });

  it('applies config-level defaults: projectId and labels', () => {
    const mapper = new LinearBugReportMapper({
      ...baseConfig,
      projectId: 'linear-project-uuid',
      defaultLabels: ['label-bug', 'label-auto'],
    });
    const input = mapper.toLinearIssueInput(makeBugReport());

    expect(input.projectId).toBe('linear-project-uuid');
    expect(input.labelIds).toEqual(['label-bug', 'label-auto']);
  });

  it('uses custom template when provided, bypassing default body', () => {
    const mapper = new LinearBugReportMapper(baseConfig);
    const input = mapper.toLinearIssueInput(
      makeBugReport(),
      undefined,
      undefined,
      '# {{title}}\n\n{{description}}'
    );

    expect(input.description).toBe('# Something broke\n\nSteps: click, observe');
    // No default Environment section under a custom template.
    expect(input.description).not.toContain('### Environment');
  });

  it('embeds share replay URL into the default body when supplied', () => {
    const mapper = new LinearBugReportMapper(baseConfig);
    const input = mapper.toLinearIssueInput(makeBugReport(), 'https://app/shared/abc');

    expect(input.description).toContain('https://app/shared/abc');
    expect(input.description).toContain('### Attachments');
  });

  it('applies field-mapping overrides (assignee, labels, priority)', () => {
    const mapper = new LinearBugReportMapper({
      ...baseConfig,
      defaultLabels: ['label-bug'],
    });
    const input = mapper.toLinearIssueInput(makeBugReport(), undefined, {
      assigneeId: 'user-uuid',
      labels: ['label-urgent'],
      priority: { name: 'urgent' },
    });

    expect(input.assigneeId).toBe('user-uuid');
    // Field-mapping labels are appended to config defaults, not replacing
    expect(input.labelIds).toContain('label-bug');
    expect(input.labelIds).toContain('label-urgent');
    expect(input.priority).toBe(1);
  });

  it('respects raw integer priority from field-mappings', () => {
    const mapper = new LinearBugReportMapper(baseConfig);
    const input = mapper.toLinearIssueInput(makeBugReport(), undefined, { priority: 1 });
    expect(input.priority).toBe(1);
  });
});
