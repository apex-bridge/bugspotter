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
}

// ============================================================================
// Feedback Types
// ============================================================================

export interface SubmitFeedbackToServiceRequest {
  suggestion_bug_id: string;
  rating: 1 | -1;
  suggestion_type: 'similar_bug' | 'mitigation' | 'duplicate';
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
