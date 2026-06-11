/**
 * Intelligence Service Types
 * Request/response types matching the bugspotter-intelligence API contracts
 */

// ============================================================================
// Circuit Breaker
// ============================================================================

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** How long to wait before trying half-open (ms) */
  resetTimeout: number;
  /** Number of successful calls in half-open to close circuit */
  halfOpenSuccessThreshold: number;
}

// ============================================================================
// Intelligence Client Configuration
// ============================================================================

export interface IntelligenceClientConfig {
  /** Base URL of the intelligence service (e.g. http://intelligence-api:8000) */
  baseUrl: string;
  /** API key for authenticating with intelligence service */
  apiKey: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Maximum retry attempts */
  maxRetries: number;
  /** Initial backoff delay in milliseconds */
  backoffDelay: number;
  /** Circuit breaker configuration */
  circuitBreaker: CircuitBreakerConfig;
}

// ============================================================================
// Request Types (matching intelligence API)
// ============================================================================

export interface AnalyzeBugRequest {
  bug_id: string;
  title: string;
  description?: string | null;
  console_logs?: Record<string, unknown>[] | null;
  network_logs?: Record<string, unknown>[] | null;
  metadata?: Record<string, unknown> | null;
}

export interface SearchRequest {
  query: string;
  project_id?: string;
  mode?: 'fast' | 'smart';
  limit?: number;
  offset?: number;
  status?: string | null;
  date_from?: string | null;
  date_to?: string | null;
}

export interface UpdateResolutionRequest {
  resolution: string;
  status?: 'resolved' | 'closed' | 'wont_fix';
}

export interface AskRequest {
  question: string;
  project_id?: string;
  context?: string[] | null;
  temperature?: number;
  max_tokens?: number;
}

// ============================================================================
// Response Types (matching intelligence API)
// ============================================================================

export interface AnalyzeBugResponse {
  bug_id: string;
  embedding_generated: boolean;
  stored: boolean;
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
  resolution: string | null;
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
   * intelligence_event id for the rerank LLM call (smart mode only;
   * absent on cache hits and fast mode). Pass back to
   * POST /api/v1/intelligence/feedback when collecting verdicts.
   */
  event_id?: string | null;
  /** Overall confidence in the LLM-rerank ordering (smart mode only). */
  confidence?: number | null;
}

export interface ResolutionUpdateResponse {
  bug_id: string;
  status: string;
  resolution_summary: string;
  updated: boolean;
}

export interface AskResponse {
  answer: string;
  provider: string;
  model: string;
  /** intelligence_event id for this LLM call. */
  event_id?: string | null;
}

export interface BugDetailResponse {
  bug_id: string;
  title: string;
  description: string | null;
  status: string;
  resolution: string | null;
  resolution_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface HealthResponse {
  status: string;
}

// ============================================================================
// Enrichment Types
// ============================================================================

export interface EnrichBugRequest {
  bug_id: string;
  title: string;
  description?: string | null;
  console_logs?: Record<string, unknown>[] | null;
  network_logs?: Record<string, unknown>[] | null;
  metadata?: Record<string, unknown> | null;
}

export interface EnrichBugResponse {
  bug_id: string;
  category: string;
  suggested_severity: string;
  tags: string[];
  root_cause_summary: string;
  affected_components: string[];
  confidence: {
    category: number;
    severity: number;
    tags: number;
    root_cause: number;
    components: number;
  };
  /** intelligence_event id for this enrichment LLM call. */
  event_id?: string | null;
}

// ============================================================================
// Feedback Types
// ============================================================================

export interface SubmitFeedbackToServiceRequest {
  suggestion_bug_id: string;
  rating: 1 | -1;
  suggestion_type: 'similar_bug' | 'mitigation' | 'duplicate';
}

/**
 * Verdict on an intelligence_event recorded by the upstream observability
 * pipeline. Distinct from `SubmitFeedbackToServiceRequest` which targets
 * the local `suggestion_feedback` table — this one is keyed by `event_id`
 * and lands in the upstream `intelligence_feedback` table.
 */
export interface SubmitEventFeedbackRequest {
  event_id: string;
  verdict: 'correct' | 'incorrect' | 'partial';
  user_ref?: string | null;
  note?: string | null;
}

export interface SubmitEventFeedbackResponse {
  feedback_id: string;
}

// ============================================================================
// Observability Types (mirror upstream GET /admin/observability/*)
// ============================================================================

export interface ObservabilityOpStat {
  operation: string;
  calls: number;
  p50_ms: number | null;
  p95_ms: number | null;
  cost_micros_usd: number;
}

export interface ObservabilitySummaryResponse {
  tenant_id: string | null;
  from_ts: string | null;
  to_ts: string | null;
  calls: number;
  cost_micros_usd: number;
  p50_ms: number | null;
  p95_ms: number | null;
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
  /** One-sentence "why" the LLM chose this label; null for unwrapped/older calls. */
  rationale: string | null;
}

export interface ObservabilityEventsResponse {
  events: ObservabilityEvent[];
  limit: number;
  offset: number;
}

export interface ObservabilityAccuracyResponse {
  tenant_id: string | null;
  operation: string | null;
  feedback_count: number;
  correct: number;
  incorrect: number;
  partial: number;
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

// ============================================================================
// Intelligence Job Data (for BullMQ queue)
// ============================================================================

export interface MitigationJobPayload {
  bug_id: string;
  use_similar_bugs?: boolean;
  // projectId is on job.data.projectId (required, validated) — not duplicated here
}

export interface IntelligenceJobData {
  type: 'analyze' | 'resolution' | 'enrich' | 'mitigation';
  bugReportId: string;
  projectId: string;
  organizationId?: string;
  payload: AnalyzeBugRequest | UpdateResolutionRequest | EnrichBugRequest | MitigationJobPayload;
}

export type DedupAction = 'flag' | 'auto_close';

export interface IntelligenceJobResult {
  type: string;
  bugReportId: string;
  success: boolean;
  isDuplicate?: boolean;
  similarBugs?: SimilarBug[];
  enriched?: boolean;
  enrichmentId?: string;
  mitigationGenerated?: boolean;
  mitigationId?: string;
  dedupAction?: DedupAction;
  dedupApplied?: boolean;
  duplicateOf?: string | null;
  error?: string;
}
