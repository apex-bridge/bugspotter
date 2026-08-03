/**
 * Intelligence Client
 * HTTP client for communicating with the bugspotter-intelligence service.
 * Includes circuit breaker, retry with exponential backoff, and timeout handling.
 */

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { getLogger } from '../../logger.js';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
import type {
  IntelligenceClientConfig,
  AnalyzeBugRequest,
  AnalyzeBugResponse,
  EnrichBugRequest,
  EnrichBugResponse,
  SimilarBugsResponse,
  MitigationResponse,
  SearchRequest,
  SearchResponse,
  SubmitEventFeedbackRequest,
  SubmitEventFeedbackResponse,
  ObservabilitySummaryQuery,
  ObservabilitySummaryResponse,
  ObservabilityEventsQuery,
  ObservabilityEventsResponse,
  ObservabilityAccuracyQuery,
  ObservabilityAccuracyResponse,
  UpdateResolutionRequest,
  ResolutionUpdateResponse,
  AskRequest,
  AskResponse,
  BugDetailResponse,
  HealthResponse,
  ServiceStatus,
} from './types.js';

const logger = getLogger();

export class IntelligenceClient {
  private readonly http: AxiosInstance;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly config: IntelligenceClientConfig;

  constructor(config: IntelligenceClientConfig) {
    this.config = config;

    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
    });

    this.circuitBreaker = new CircuitBreaker(config.circuitBreaker);

    logger.info('IntelligenceClient initialized', {
      baseUrl: config.baseUrl,
      timeout: config.timeout,
      maxRetries: config.maxRetries,
    });
  }

  // ==========================================================================
  // Bug Analysis
  // ==========================================================================

  /**
   * Submit a bug for analysis (embedding + storage).
   * Called asynchronously after a bug is created in the main backend.
   */
  async analyzeBug(request: AnalyzeBugRequest): Promise<AnalyzeBugResponse> {
    return this.request<AnalyzeBugResponse>('POST', '/api/v1/bugs/analyze', request);
  }

  /**
   * Request AI enrichment for a bug (categorization, severity, tags, root cause, components).
   * The endpoint may not exist yet in the intelligence service — callers should
   * handle 404 responses gracefully.
   */
  async enrichBug(request: EnrichBugRequest): Promise<EnrichBugResponse> {
    return this.request<EnrichBugResponse>('POST', '/api/v1/bugs/enrich', request);
  }

  /**
   * Get bug details from the intelligence service.
   */
  async getBug(bugId: string): Promise<BugDetailResponse> {
    return this.request<BugDetailResponse>('GET', `/api/v1/bugs/${encodeURIComponent(bugId)}`);
  }

  /**
   * Find similar bugs by ID.
   */
  async getSimilarBugs(
    bugId: string,
    options?: { threshold?: number; limit?: number; projectId?: string }
  ): Promise<SimilarBugsResponse> {
    const params: Record<string, string> = {};
    if (options?.threshold !== undefined) {
      params.threshold = String(options.threshold);
    }
    if (options?.limit !== undefined) {
      params.limit = String(options.limit);
    }
    if (options?.projectId !== undefined) {
      params.project_id = options.projectId;
    }

    return this.request<SimilarBugsResponse>(
      'GET',
      `/api/v1/bugs/${encodeURIComponent(bugId)}/similar`,
      undefined,
      { params }
    );
  }

  /**
   * Get AI-generated mitigation suggestion for a bug.
   */
  async getMitigation(
    bugId: string,
    options?: { useSimilarBugs?: boolean; projectId?: string }
  ): Promise<MitigationResponse> {
    const params: Record<string, string> = {};
    if (options?.useSimilarBugs !== undefined) {
      params.use_similar_bugs = String(options.useSimilarBugs);
    }
    if (options?.projectId !== undefined) {
      params.project_id = options.projectId;
    }

    return this.request<MitigationResponse>(
      'GET',
      `/api/v1/bugs/${encodeURIComponent(bugId)}/mitigation`,
      undefined,
      { params }
    );
  }

  /**
   * Update bug resolution in the intelligence service.
   * Called when a bug is resolved so the RAG context grows.
   */
  async updateResolution(
    bugId: string,
    request: UpdateResolutionRequest
  ): Promise<ResolutionUpdateResponse> {
    return this.request<ResolutionUpdateResponse>(
      'PATCH',
      `/api/v1/bugs/${encodeURIComponent(bugId)}/resolution`,
      request
    );
  }

  // ==========================================================================
  // Search & Q&A
  // ==========================================================================

  /**
   * Natural language search across bugs.
   */
  async search(request: SearchRequest): Promise<SearchResponse> {
    return this.request<SearchResponse>('POST', '/api/v1/search', request);
  }

  /**
   * General Q&A with LLM + bug database context.
   */
  async ask(request: AskRequest): Promise<AskResponse> {
    return this.request<AskResponse>('POST', '/api/v1/ask', request);
  }

  /**
   * Record a user verdict on a previous intelligence_event.
   * Distinct from the local suggestion-feedback flow — this lands in the
   * upstream `intelligence_feedback` table and powers the observability
   * /accuracy endpoint.
   */
  async submitEventFeedback(
    request: SubmitEventFeedbackRequest
  ): Promise<SubmitEventFeedbackResponse> {
    return this.request<SubmitEventFeedbackResponse>(
      'POST',
      '/api/v1/intelligence/feedback',
      request
    );
  }

  // ==========================================================================
  // Observability (admin)
  //
  // Upstream scopes by caller's tenant API key — no tenant_id param is sent
  // or accepted. Each method maps a typed query object to URL params.
  // ==========================================================================

  async getObservabilitySummary(
    query: ObservabilitySummaryQuery = {}
  ): Promise<ObservabilitySummaryResponse> {
    const params: Record<string, string> = {};
    if (query.from !== undefined) {
      params.from = query.from;
    }
    if (query.to !== undefined) {
      params.to = query.to;
    }
    return this.request<ObservabilitySummaryResponse>(
      'GET',
      '/api/v1/admin/observability/summary',
      undefined,
      { params }
    );
  }

  async getObservabilityEvents(
    query: ObservabilityEventsQuery = {}
  ): Promise<ObservabilityEventsResponse> {
    const params: Record<string, string> = {};
    if (query.operation !== undefined) {
      params.operation = query.operation;
    }
    if (query.status !== undefined) {
      params.status = query.status;
    }
    if (query.limit !== undefined) {
      params.limit = String(query.limit);
    }
    if (query.offset !== undefined) {
      params.offset = String(query.offset);
    }
    return this.request<ObservabilityEventsResponse>(
      'GET',
      '/api/v1/admin/observability/events',
      undefined,
      { params }
    );
  }

  async getObservabilityAccuracy(
    query: ObservabilityAccuracyQuery = {}
  ): Promise<ObservabilityAccuracyResponse> {
    const params: Record<string, string> = {};
    if (query.operation !== undefined) {
      params.operation = query.operation;
    }
    if (query.from !== undefined) {
      params.from = query.from;
    }
    if (query.to !== undefined) {
      params.to = query.to;
    }
    return this.request<ObservabilityAccuracyResponse>(
      'GET',
      '/api/v1/admin/observability/accuracy',
      undefined,
      { params }
    );
  }

  // ==========================================================================
  // Service status (platform-admin)
  //
  // Requires a MASTER-key client (the upstream gate is require_master_key);
  // construct this client with adminBaseUrl + masterApiKey, not a per-org key.
  // ==========================================================================

  async getServiceStatus(): Promise<ServiceStatus> {
    return this.request<ServiceStatus>('GET', '/api/v1/admin/status');
  }

  // ==========================================================================
  // Health
  // ==========================================================================

  /**
   * Check intelligence service health.
   * Bypasses the circuit breaker — used to probe availability.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.http.get<HealthResponse>('/health', { timeout: 5000 });
      return response.data.status === 'healthy';
    } catch {
      return false;
    }
  }

  /**
   * Get the current circuit breaker state for monitoring.
   */
  getCircuitState() {
    return {
      state: this.circuitBreaker.getState(),
      failureCount: this.circuitBreaker.getFailureCount(),
    };
  }

  // ==========================================================================
  // Internal: request with circuit breaker + retry
  // ==========================================================================

  private async request<T>(
    method: string,
    path: string,
    data?: unknown,
    extraConfig?: AxiosRequestConfig
  ): Promise<T> {
    try {
      return await this.circuitBreaker.execute(
        async () => this.requestWithRetry<T>(method, path, data, extraConfig),
        // Only trip the breaker on server/network/rate-limit errors — client errors (4xx)
        // indicate the service is healthy, just rejecting our input, and
        // `llm_unavailable` means the service is healthy but its LLM backend is
        // transiently down. Note: requestWithRetry wraps errors into
        // IntelligenceError, so the predicate checks that.
        shouldTripCircuitBreaker
      );
    } catch (error) {
      // Re-throw IntelligenceError as-is — it's already wrapped
      if (error instanceof IntelligenceError) {
        throw error;
      }
      // Wrap everything else (CircuitOpenError, unexpected errors)
      throw this.wrapError(error, method, path);
    }
  }

  private async requestWithRetry<T>(
    method: string,
    path: string,
    data?: unknown,
    extraConfig?: AxiosRequestConfig,
    attempt = 1
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const response = await this.http.request<T>({
        method,
        url: path,
        data,
        ...extraConfig,
      });

      logger.debug('Intelligence API call succeeded', {
        method,
        path,
        status: response.status,
        duration: Date.now() - startTime,
        attempt,
      });

      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      const isRetryable = this.isRetryableError(error);
      const hasRetriesLeft = attempt <= this.config.maxRetries;

      if (axios.isAxiosError(error)) {
        logger.warn('Intelligence API call failed', {
          method,
          path,
          status: error.response?.status,
          message: error.message,
          duration,
          attempt,
          isRetryable,
          hasRetriesLeft,
        });
      } else {
        logger.error('Intelligence API unexpected error', {
          method,
          path,
          error: error instanceof Error ? error.message : String(error),
          duration,
          attempt,
        });
      }

      if (isRetryable && hasRetriesLeft) {
        const delay = this.calculateBackoff(attempt);
        logger.info('Retrying intelligence API call', {
          method,
          path,
          attempt: attempt + 1,
          delay,
        });
        await this.sleep(delay);
        return this.requestWithRetry<T>(method, path, data, extraConfig, attempt + 1);
      }

      throw this.wrapError(error, method, path);
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    // Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
    if (!error.response) {
      return true;
    }

    // Server errors (5xx) are retryable
    const status = error.response.status;
    return status >= 500 || status === 429;
  }

  private calculateBackoff(attempt: number): number {
    const base = this.config.backoffDelay;
    const delay = base * Math.pow(2, attempt - 1);
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private wrapError(error: unknown, method: string, path: string): IntelligenceError {
    return mapIntelligenceError(error, method, path);
  }
}

/**
 * Error from the intelligence service.
 * Used to distinguish intelligence failures from other errors in handlers.
 */
export class IntelligenceError extends Error {
  /**
   * Seconds the upstream asked us to wait, parsed from `Retry-After`. Metadata
   * only: no caller reads it yet. `IntelligenceClient` is shared by a queue
   * worker that could absorb the wait and by request-path routes that cannot,
   * so honouring the hint belongs to the caller, not to the client.
   */
  public readonly retryAfter?: number;
  /**
   * Whether this error should count against the circuit breaker. Left undefined
   * by every error that does not opt out, so `shouldTripCircuitBreaker` falls
   * back to the code-based default rather than needing a per-code string check.
   */
  public readonly tripCircuitBreaker?: boolean;

  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    options?: { retryAfter?: number; tripCircuitBreaker?: boolean }
  ) {
    super(message);
    this.name = 'IntelligenceError';
    this.retryAfter = options?.retryAfter;
    this.tripCircuitBreaker = options?.tripCircuitBreaker;
  }
}

/**
 * Maps an arbitrary thrown value onto an `IntelligenceError`.
 *
 * Exported (and taking `method`/`path` explicitly, which is how the message
 * prefix is built) so unit tests can drive the mapping directly instead of
 * staging a full retry sequence through a public client method.
 */
export function mapIntelligenceError(
  error: unknown,
  method: string,
  path: string
): IntelligenceError {
  if (error instanceof CircuitOpenError) {
    return new IntelligenceError(error.message, 'circuit_open', 503);
  }

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    const body =
      typeof error.response?.data === 'object' && error.response?.data !== null
        ? (error.response.data as Record<string, unknown>)
        : undefined;
    const rawDetail = body?.detail;
    // detail could be a string or an object — coerce to string safely
    const detail =
      typeof rawDetail === 'string'
        ? rawDetail
        : rawDetail !== undefined
          ? JSON.stringify(rawDetail)
          : error.message;

    // A 503 carrying code `llm_unavailable` is the intelligence service telling
    // us its LLM backend is transiently down, not that the service itself is
    // broken. Treating it like any other 5xx trips the breaker and degrades
    // every intelligence feature for what is usually a cold start.
    if (status === 503 && body?.code === 'llm_unavailable') {
      const raw = parseInt(
        typeof error.response?.headers?.['retry-after'] === 'string'
          ? error.response.headers['retry-after']
          : '30',
        10
      );
      const retryAfter = Math.min(Number.isNaN(raw) ? 30 : raw, 120);
      return new IntelligenceError(
        `Intelligence ${method} ${path} failed: ${detail}`,
        'llm_unavailable',
        503,
        { retryAfter, tripCircuitBreaker: false }
      );
    }

    const code =
      status === 0
        ? 'network_error'
        : status === 429
          ? 'rate_limit_error'
          : status >= 500
            ? 'server_error'
            : 'client_error';
    return new IntelligenceError(`Intelligence ${method} ${path} failed: ${detail}`, code, status);
  }

  return new IntelligenceError(
    `Intelligence ${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
    'unknown',
    0
  );
}

/**
 * Whether an error should count as a circuit-breaker failure.
 *
 * Takes `unknown` rather than `IntelligenceError` because the predicate this
 * replaces also had to handle values that were never wrapped, which it counted
 * as failures. Reads the opt-out flag first so no per-code string check is
 * needed here as new recoverable conditions are added.
 */
export function shouldTripCircuitBreaker(error: unknown): boolean {
  if (error instanceof IntelligenceError) {
    return error.tripCircuitBreaker ?? error.code !== 'client_error';
  }
  return true;
}
