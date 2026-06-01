/**
 * Intelligence Service
 * API client for intelligence settings, key provisioning, enrichment, and deflection stats.
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type {
  IntelligenceSettings,
  IntelligenceStatus,
  UpdateIntelligenceSettingsInput,
  ProvisionKeyResult,
  IntelligenceEnrichment,
  DeflectionStats,
  SubmitFeedbackInput,
  SubmitFeedbackResult,
  SubmitEventFeedbackInput,
  SubmitEventFeedbackResult,
  FeedbackRecord,
  FeedbackStats,
  SimilarBugsResponse,
  MitigationResponse,
  SearchInput,
  SearchResponse,
  ObservabilitySummary,
  ObservabilitySummaryQuery,
  ObservabilityEventsPage,
  ObservabilityEventsQuery,
  ObservabilityAccuracy,
  ObservabilityAccuracyQuery,
} from '../types/intelligence';

export const intelligenceService = {
  // Lightweight feature-flag read — readable by any org member,
  // unlike `getSettings` which is admin-only. Used to gate intel
  // affordances on bug-report-detail.
  getStatus: async (orgId: string): Promise<IntelligenceStatus> => {
    const response = await api.get(API_ENDPOINTS.intelligence.status(orgId));
    return response.data.data;
  },

  getSettings: async (orgId: string): Promise<IntelligenceSettings> => {
    const response = await api.get(API_ENDPOINTS.intelligence.settings(orgId));
    return response.data.data;
  },

  updateSettings: async (
    orgId: string,
    updates: UpdateIntelligenceSettingsInput
  ): Promise<IntelligenceSettings> => {
    const response = await api.patch(API_ENDPOINTS.intelligence.settings(orgId), updates);
    return response.data.data;
  },

  provisionKey: async (orgId: string, apiKey: string): Promise<ProvisionKeyResult> => {
    const response = await api.post(API_ENDPOINTS.intelligence.provisionKey(orgId), {
      api_key: apiKey,
    });
    return response.data.data;
  },

  generateKey: async (orgId: string): Promise<ProvisionKeyResult> => {
    // Pass explicit empty body so Fastify doesn't receive Content-Type: application/json
    // with no body (which triggers a 400 body-parse error).
    const response = await api.post(API_ENDPOINTS.intelligence.generateKey(orgId), {});
    return response.data.data;
  },

  revokeKey: async (orgId: string): Promise<void> => {
    await api.delete(API_ENDPOINTS.intelligence.revokeKey(orgId));
  },

  getEnrichment: async (bugId: string): Promise<IntelligenceEnrichment | null> => {
    try {
      const response = await api.get(API_ENDPOINTS.intelligence.enrichment(bugId));
      return response.data.data;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 404) {
          return null;
        }
      }
      throw error;
    }
  },

  getDeflectionStats: async (projectId: string): Promise<DeflectionStats> => {
    const response = await api.get(API_ENDPOINTS.intelligence.deflectionStats(projectId));
    return response.data.data;
  },

  submitFeedback: async (input: SubmitFeedbackInput): Promise<SubmitFeedbackResult> => {
    const response = await api.post(API_ENDPOINTS.intelligence.feedback, input);
    return response.data.data;
  },

  getBugFeedback: async (bugId: string): Promise<FeedbackRecord[]> => {
    const response = await api.get(API_ENDPOINTS.intelligence.bugFeedback(bugId));
    return response.data.data;
  },

  getFeedbackStats: async (projectId: string): Promise<FeedbackStats> => {
    const response = await api.get(API_ENDPOINTS.intelligence.feedbackStats(projectId));
    return response.data.data;
  },

  getSimilarBugs: async (projectId: string, bugId: string): Promise<SimilarBugsResponse | null> => {
    try {
      const response = await api.get(API_ENDPOINTS.intelligence.similarBugs(projectId, bugId));
      return response.data.data;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 404) {
          return null;
        }
      }
      throw error;
    }
  },

  getMitigation: async (projectId: string, bugId: string): Promise<MitigationResponse | null> => {
    try {
      const response = await api.get(API_ENDPOINTS.intelligence.mitigation(projectId, bugId));
      return response.data.data;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 404) {
          return null;
        }
      }
      throw error;
    }
  },

  triggerMitigation: async (projectId: string, bugId: string): Promise<{ queued: boolean }> => {
    const response = await api.post(API_ENDPOINTS.intelligence.mitigation(projectId, bugId), {});
    return response.data.data;
  },

  search: async (projectId: string, input: SearchInput): Promise<SearchResponse> => {
    const response = await api.post(API_ENDPOINTS.intelligence.search(projectId), input);
    return response.data.data;
  },

  /**
   * Record a verdict on a prior LLM call (intelligence_event). Distinct from
   * `submitFeedback` above — that one targets the local suggestion_feedback
   * table; this one writes to the upstream intelligence_feedback via the
   * event-feedback proxy and is keyed by `event_id`.
   */
  submitEventFeedback: async (
    input: SubmitEventFeedbackInput
  ): Promise<SubmitEventFeedbackResult> => {
    const { project_id, ...body } = input;
    const response = await api.post(API_ENDPOINTS.intelligence.eventFeedback(project_id), body);
    return response.data.data;
  },

  getObservabilitySummary: async (
    orgId: string,
    query: ObservabilitySummaryQuery = {}
  ): Promise<ObservabilitySummary> => {
    const response = await api.get(API_ENDPOINTS.intelligence.observabilitySummary(orgId), {
      params: query,
    });
    return response.data.data;
  },

  getObservabilityEvents: async (
    orgId: string,
    query: ObservabilityEventsQuery = {}
  ): Promise<ObservabilityEventsPage> => {
    const response = await api.get(API_ENDPOINTS.intelligence.observabilityEvents(orgId), {
      params: query,
    });
    return response.data.data;
  },

  getObservabilityAccuracy: async (
    orgId: string,
    query: ObservabilityAccuracyQuery = {}
  ): Promise<ObservabilityAccuracy> => {
    const response = await api.get(API_ENDPOINTS.intelligence.observabilityAccuracy(orgId), {
      params: query,
    });
    return response.data.data;
  },
};
