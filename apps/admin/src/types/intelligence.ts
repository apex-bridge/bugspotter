/**
 * Intelligence-related types for the admin panel.
 */

export interface IntelligenceKeyStatus {
  provisioned: boolean;
  decryptable: boolean;
  provisioned_at: string | null;
  provisioned_by: string | null;
  key_hint: string | null;
}

export interface IntelligenceSettings {
  intelligence_enabled: boolean;
  intelligence_provider: string | null;
  intelligence_auto_analyze: boolean;
  intelligence_auto_enrich: boolean;
  intelligence_similarity_threshold: number;
  intelligence_dedup_enabled: boolean;
  intelligence_dedup_action: 'flag' | 'auto_close';
  intelligence_self_service_enabled: boolean;
  key_status?: IntelligenceKeyStatus;
}

export interface UpdateIntelligenceSettingsInput {
  intelligence_enabled?: boolean;
  intelligence_provider?: string | null;
  intelligence_auto_analyze?: boolean;
  intelligence_auto_enrich?: boolean;
  intelligence_similarity_threshold?: number | null;
  intelligence_dedup_enabled?: boolean;
  intelligence_dedup_action?: 'flag' | 'auto_close' | null;
  intelligence_self_service_enabled?: boolean;
}

export interface ProvisionKeyResult {
  provisioned: boolean;
  provisioned_at: string;
  provisioned_by: string;
  key_hint: string;
}

export interface IntelligenceEnrichment {
  id: string;
  bug_report_id: string;
  project_id: string;
  organization_id: string | null;
  category: string;
  suggested_severity: string;
  tags: string[];
  root_cause_summary: string;
  affected_components: string[];
  confidence_category: number;
  confidence_severity: number;
  confidence_tags: number;
  confidence_root_cause: number;
  confidence_components: number;
  enrichment_version: number;
  created_at: string;
  updated_at: string;
}

export interface DeflectionStats {
  total_deflections: number;
  deflections_last_7d: number;
  deflections_last_30d: number;
  top_matched_bugs: Array<{ bug_id: string; deflection_count: number }>;
}

export type SuggestionType = 'similar_bug' | 'mitigation' | 'duplicate';

export interface SubmitFeedbackInput {
  bug_report_id: string;
  suggestion_bug_id: string;
  project_id: string;
  suggestion_type: SuggestionType;
  rating: -1 | 1;
  comment?: string;
}

export interface FeedbackRecord {
  id: string;
  bug_report_id: string;
  suggestion_bug_id: string;
  suggestion_type: SuggestionType;
  rating: -1 | 1;
  comment: string | null;
  user_id: string | null;
  created_at: string;
}

export interface SubmitFeedbackResult {
  id: string;
  created: boolean;
}

export interface FeedbackStats {
  total_feedback: number;
  positive_count: number;
  negative_count: number;
  accuracy_rate: number;
}

export interface SimilarBug {
  bug_id: string;
  title: string;
  description: string | null;
  status: string;
  resolution: string | null;
  similarity: number;
}

export interface SimilarBugsResponse {
  bug_id: string;
  is_duplicate: boolean;
  similar_bugs: SimilarBug[];
  threshold_used: number;
}

export interface MitigationResponse {
  bug_id: string;
  mitigation_suggestion: string;
  based_on_similar_bugs: boolean;
}

export interface SearchResult {
  bug_id: string;
  title: string;
  description: string | null;
  status: string;
  similarity: number;
  created_at: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
  mode: 'fast' | 'smart';
  query: string;
  cached: boolean;
}

export interface SearchInput {
  query: string;
  mode?: 'fast' | 'smart';
  limit?: number;
  offset?: number;
  status?: string | null;
}
