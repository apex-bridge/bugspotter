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

export interface IntelligenceStatus {
  intelligence_enabled: boolean;
}

/** Embedding-pipeline health within the platform-admin service status. */
export interface IntelligenceEmbeddingHealth {
  provider: string;
  model: string | null;
  total: number;
  /** Rows with a NULL embedding — > 0 signals a dimension mismatch. */
  nulls: number;
  min_dim: number | null;
  healthy: boolean;
}

/**
 * Operator (platform-admin) status of the intelligence service. Mirrors the
 * backend ServiceStatus, which proxies the upstream GET /admin/status.
 * Cloud-key fields are booleans only — secret values never cross the wire.
 */
export interface IntelligenceServiceStatus {
  version: string;
  llm_provider: string;
  llm_model: string | null;
  anthropic_key_configured: boolean;
  openai_key_configured: boolean;
  similarity_threshold: number;
  duplicate_threshold: number;
  embeddings: IntelligenceEmbeddingHealth;
}

export interface IntelligenceSettings {
  intelligence_enabled: boolean;
  intelligence_provider: string | null;
  intelligence_auto_analyze: boolean;
  intelligence_auto_enrich: boolean;
  intelligence_similarity_threshold: number;
  intelligence_dedup_enabled: boolean;
  intelligence_dedup_action: 'flag' | 'auto_close';
  intelligence_pre_file_dedup_grace_ms: number;
  intelligence_self_service_enabled: boolean;
  key_status?: IntelligenceKeyStatus;
  /**
   * Whether the org has a Telegram bot token configured. Boolean
   * signal only — the encrypted blob never crosses the wire on GET.
   * Drives the "configured / not configured" badge in the channels
   * panel.
   */
  telegram_bot_token_configured?: boolean;
  /** Whether the org has a Slack bot token configured. Same shape. */
  slack_bot_token_configured?: boolean;
}

export interface UpdateIntelligenceSettingsInput {
  intelligence_enabled?: boolean;
  intelligence_provider?: string | null;
  intelligence_auto_analyze?: boolean;
  intelligence_auto_enrich?: boolean;
  intelligence_similarity_threshold?: number | null;
  intelligence_dedup_enabled?: boolean;
  intelligence_dedup_action?: 'flag' | 'auto_close' | null;
  intelligence_pre_file_dedup_grace_ms?: number | null;
  intelligence_self_service_enabled?: boolean;
  /**
   * Plaintext bot token on the wire — the backend encrypts before
   * persistence. `null` or empty string clears the field. Pattern
   * enforced by the PATCH route's JSON schema; the sender re-checks
   * defensively before any network call.
   */
  telegram_bot_token?: string | null;
  /** Plaintext Slack `xoxb-` bot token. Same shape as telegram. */
  slack_bot_token?: string | null;
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

export type IntelligenceEventVerdict = 'correct' | 'incorrect' | 'partial';

/**
 * Verdict on a prior intelligence_event (LLM call) returned by smart search /
 * enrich / ask. Distinct from `SubmitFeedbackInput` which targets the local
 * suggestion_feedback table — this one writes to the upstream
 * `intelligence_feedback` table via the event-feedback proxy route.
 *
 * `user_ref` is intentionally NOT part of the wire shape: the backend derives
 * it from the authenticated session via `getAuditUserId(request)` so a
 * malicious caller can't spoof attribution to another user.
 */
export interface SubmitEventFeedbackInput {
  project_id: string;
  event_id: string;
  verdict: IntelligenceEventVerdict;
  note?: string | null;
}

export interface SubmitEventFeedbackResult {
  feedback_id: string;
}

// ============================================================================
// Observability (admin)
// ============================================================================

export interface ObservabilityOpStat {
  operation: string;
  calls: number;
  p50_ms: number | null;
  p95_ms: number | null;
  cost_micros_usd: number;
}

export interface ObservabilitySummary {
  tenant_id: string | null;
  from_ts: string | null;
  to_ts: string | null;
  calls: number;
  cost_micros_usd: number;
  p50_ms: number | null;
  p95_ms: number | null;
  /** 0..1 fraction of calls with status=error in the window. */
  error_rate: number;
  by_operation: ObservabilityOpStat[];
}

export interface ObservabilityEvent {
  id: string;
  tenant_id: string;
  operation: string;
  bug_id: string | null;
  provider: string;
  model: string;
  prompt_version: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_micros_usd: number | null;
  latency_ms: number;
  confidence: number | null;
  status: string;
  error_kind: string | null;
  cached: boolean;
  created_at: string;
  /** One-sentence "why" the LLM chose this label; absent/null for unwrapped/older calls. */
  rationale?: string | null;
}

export interface ObservabilityEventsPage {
  events: ObservabilityEvent[];
  limit: number;
  offset: number;
}

export interface ObservabilityAccuracy {
  tenant_id: string | null;
  operation: string | null;
  feedback_count: number;
  correct: number;
  incorrect: number;
  partial: number;
  /** correct / (correct + incorrect); null when denominator is 0. */
  precision: number | null;
}

export interface ObservabilitySummaryQuery {
  from?: string;
  to?: string;
}

export interface ObservabilityEventsQuery {
  operation?: string;
  status?: 'ok' | 'error';
  limit?: number;
  offset?: number;
}

export interface ObservabilityAccuracyQuery {
  operation?: string;
  from?: string;
  to?: string;
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
  /**
   * intelligence_event id for the LLM rerank call (smart mode only;
   * absent on cache hits or fast-mode searches). Pass back to the
   * feedback endpoint to record whether the ranking was correct.
   */
  event_id?: string | null;
  /** Overall confidence in the LLM-rerank ordering (smart mode only). */
  confidence?: number | null;
}

export interface SearchInput {
  query: string;
  mode?: 'fast' | 'smart';
  limit?: number;
  offset?: number;
  status?: string | null;
}
