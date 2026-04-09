/**
 * Intelligence Service — public API
 */

export { IntelligenceClient, IntelligenceError } from './intelligence-client.js';
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export type {
  IntelligenceClientConfig,
  AnalyzeBugRequest,
  AnalyzeBugResponse,
  SimilarBugsResponse,
  SimilarBug,
  MitigationResponse,
  SearchRequest,
  SearchResponse,
  SearchResult,
  UpdateResolutionRequest,
  ResolutionUpdateResponse,
  AskRequest,
  AskResponse,
  BugDetailResponse,
  HealthResponse,
  EnrichBugRequest,
  EnrichBugResponse,
  IntelligenceJobData,
  IntelligenceJobResult,
  CircuitBreakerConfig,
  CircuitState,
} from './types.js';
