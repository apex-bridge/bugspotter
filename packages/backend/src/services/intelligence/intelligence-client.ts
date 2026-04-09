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
  UpdateResolutionRequest,
  ResolutionUpdateResponse,
  AskRequest,
  AskResponse,
  BugDetailResponse,
  HealthResponse,
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
        // indicate the service is healthy, just rejecting our input.
        // Note: requestWithRetry wraps errors into IntelligenceError, so we check that.
        (error) => {
          if (error instanceof IntelligenceError) {
            return error.code !== 'client_error';
          }
          return true;
        }
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
    if (error instanceof CircuitOpenError) {
      return new IntelligenceError(error.message, 'circuit_open', 503);
    }

    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      const rawDetail =
        typeof error.response?.data === 'object' && error.response?.data !== null
          ? (error.response.data as Record<string, unknown>).detail
          : undefined;
      // detail could be a string or an object — coerce to string safely
      const detail =
        typeof rawDetail === 'string'
          ? rawDetail
          : rawDetail !== undefined
            ? JSON.stringify(rawDetail)
            : error.message;

      const code =
        status === 0
          ? 'network_error'
          : status === 429
            ? 'rate_limit_error'
            : status >= 500
              ? 'server_error'
              : 'client_error';
      return new IntelligenceError(
        `Intelligence ${method} ${path} failed: ${detail}`,
        code,
        status
      );
    }

    return new IntelligenceError(
      `Intelligence ${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
      'unknown',
      0
    );
  }
}

/**
 * Error from the intelligence service.
 * Used to distinguish intelligence failures from other errors in handlers.
 */
export class IntelligenceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'IntelligenceError';
  }
}
