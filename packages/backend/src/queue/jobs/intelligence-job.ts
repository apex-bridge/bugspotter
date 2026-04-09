/**
 * Intelligence Job Definition
 * Processes bug analysis via the bugspotter-intelligence service
 */

import type {
  IntelligenceJobData,
  IntelligenceJobResult,
  AnalyzeBugRequest,
  UpdateResolutionRequest,
  EnrichBugRequest,
  MitigationJobPayload,
  DedupAction,
} from '../../services/intelligence/types.js';

export const INTELLIGENCE_JOB_NAME = 'process-intelligence';

export const INTELLIGENCE_JOB_TYPES = ['analyze', 'resolution', 'enrich', 'mitigation'] as const;
export type IntelligenceJobType = (typeof INTELLIGENCE_JOB_TYPES)[number];

export interface IntelligenceJob {
  name: typeof INTELLIGENCE_JOB_NAME;
  data: IntelligenceJobData;
}

/**
 * Validate intelligence job data, including type-specific payload checks.
 */
export function validateIntelligenceJobData(data: unknown): data is IntelligenceJobData {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const d = data as Partial<IntelligenceJobData>;

  if (
    !d.type ||
    !(INTELLIGENCE_JOB_TYPES as readonly string[]).includes(d.type) ||
    !d.bugReportId ||
    typeof d.bugReportId !== 'string' ||
    !d.projectId ||
    typeof d.projectId !== 'string' ||
    !d.payload ||
    typeof d.payload !== 'object'
  ) {
    return false;
  }

  // Type-specific payload validation
  if (d.type === 'analyze') {
    const payload = d.payload as Partial<AnalyzeBugRequest>;
    if (typeof payload.bug_id !== 'string' || typeof payload.title !== 'string') {
      return false;
    }
  } else if (d.type === 'resolution') {
    const payload = d.payload as Partial<UpdateResolutionRequest>;
    if (typeof payload.resolution !== 'string') {
      return false;
    }
  } else if (d.type === 'enrich') {
    const payload = d.payload as Partial<EnrichBugRequest>;
    if (typeof payload.bug_id !== 'string' || typeof payload.title !== 'string') {
      return false;
    }
  } else if (d.type === 'mitigation') {
    const payload = d.payload as Partial<MitigationJobPayload>;
    if (
      typeof payload.bug_id !== 'string' ||
      ('use_similar_bugs' in payload && typeof payload.use_similar_bugs !== 'boolean')
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Create intelligence job result
 */
export function createIntelligenceJobResult(
  type: IntelligenceJobType,
  bugReportId: string,
  success: boolean,
  options?: {
    isDuplicate?: boolean;
    similarBugs?: IntelligenceJobResult['similarBugs'];
    enriched?: boolean;
    enrichmentId?: string;
    mitigationGenerated?: boolean;
    mitigationId?: string;
    dedupAction?: DedupAction;
    dedupApplied?: boolean;
    duplicateOf?: string | null;
    error?: string;
  }
): IntelligenceJobResult {
  return {
    type,
    bugReportId,
    success,
    isDuplicate: options?.isDuplicate,
    similarBugs: options?.similarBugs,
    enriched: options?.enriched,
    enrichmentId: options?.enrichmentId,
    mitigationGenerated: options?.mitigationGenerated,
    mitigationId: options?.mitigationId,
    dedupAction: options?.dedupAction,
    dedupApplied: options?.dedupApplied,
    duplicateOf: options?.duplicateOf,
    error: options?.error,
  };
}
