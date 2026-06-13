import { describe, it, expect, vi } from 'vitest';
import { applyAiSeverityToPriority } from '../../../src/services/intelligence/severity-apply.js';
import {
  INTELLIGENCE_SETTINGS_DEFAULTS,
  type OrgIntelligenceSettings,
} from '../../../src/services/intelligence/tenant-config.js';
import type { DatabaseClient } from '../../../src/db/client.js';
import type { EnrichBugResponse } from '../../../src/services/intelligence/types.js';

function createMockDb(rowCount: number) {
  const query = vi.fn().mockResolvedValue({ rowCount, rows: [] });
  const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
  const db = {
    getPool: () => ({ query }),
    auditLogs: { create: auditCreate },
  } as unknown as DatabaseClient;
  return { db, query, auditCreate };
}

function settings(overrides?: Partial<OrgIntelligenceSettings>): OrgIntelligenceSettings {
  return {
    ...INTELLIGENCE_SETTINGS_DEFAULTS,
    intelligence_auto_apply_severity: true,
    intelligence_severity_apply_threshold: 0.8,
    ...overrides,
  };
}

function enrichment(overrides?: Partial<EnrichBugResponse>): EnrichBugResponse {
  return {
    bug_id: 'bug-1',
    category: 'ui',
    suggested_severity: 'high',
    tags: [],
    root_cause_summary: 'x',
    affected_components: [],
    confidence: { category: 0.9, severity: 0.9, tags: 0.9, root_cause: 0.9, components: 0.9 },
    ...overrides,
  };
}

const PARAMS = { bugReportId: 'bug-1', organizationId: 'org-1' };

describe('applyAiSeverityToPriority', () => {
  it('applies priority when enabled, confident, and the bug is still default', async () => {
    const { db, query, auditCreate } = createMockDb(1);

    const result = await applyAiSeverityToPriority(db, {
      ...PARAMS,
      enrichment: enrichment({ suggested_severity: 'high' }),
      settings: settings(),
    });

    expect(result).toEqual({ applied: true, priority: 'high' });
    // Conditional UPDATE guards on the bug still being at the default 'medium'.
    const [sql, args] = query.mock.calls[0];
    expect(sql).toContain('UPDATE application.bug_reports');
    expect(args).toEqual(['high', 'bug-1', 'medium']);
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate.mock.calls[0][0]).toMatchObject({
      action: 'bug_report.priority.ai_applied',
      resource: 'bug_report',
      resource_id: 'bug-1',
      organization_id: 'org-1',
      user_id: null,
    });
  });

  it('skips when the flag is off (no DB write)', async () => {
    const { db, query } = createMockDb(1);
    const result = await applyAiSeverityToPriority(db, {
      ...PARAMS,
      enrichment: enrichment(),
      settings: settings({ intelligence_auto_apply_severity: false }),
    });
    expect(result).toEqual({ applied: false, reason: 'disabled' });
    expect(query).not.toHaveBeenCalled();
  });

  it('skips when severity confidence is below the threshold', async () => {
    const { db, query } = createMockDb(1);
    const result = await applyAiSeverityToPriority(db, {
      ...PARAMS,
      enrichment: enrichment({
        confidence: { category: 0.9, severity: 0.5, tags: 0.9, root_cause: 0.9, components: 0.9 },
      }),
      settings: settings(),
    });
    expect(result).toEqual({ applied: false, reason: 'below_threshold' });
    expect(query).not.toHaveBeenCalled();
  });

  it('skips an unrecognized severity value', async () => {
    const { db, query } = createMockDb(1);
    const result = await applyAiSeverityToPriority(db, {
      ...PARAMS,
      enrichment: enrichment({ suggested_severity: 'catastrophic' }),
      settings: settings(),
    });
    expect(result).toEqual({ applied: false, reason: 'unknown_severity' });
    expect(query).not.toHaveBeenCalled();
  });

  it('does not audit when the bug priority is no longer the default (UPDATE matched 0 rows)', async () => {
    const { db, auditCreate } = createMockDb(0);
    const result = await applyAiSeverityToPriority(db, {
      ...PARAMS,
      enrichment: enrichment(),
      settings: settings(),
    });
    expect(result).toEqual({ applied: false, reason: 'priority_not_default' });
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
