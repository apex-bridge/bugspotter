/**
 * Circuit Breaker
 * Prevents cascade failures when the intelligence service is unavailable.
 * States: closed (normal) → open (failing) → half-open (probing)
 */

import { getLogger } from '../../logger.js';
import type { CircuitBreakerConfig, CircuitState } from './types.js';

const logger = getLogger();

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private halfOpenInFlight = false;
  private readonly config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws if the circuit is open; tracks success/failure to manage state.
   *
   * @param fn - The async function to execute
   * @param shouldTrip - Optional predicate to decide if an error should trip the breaker.
   *   Defaults to tripping on all errors. Return false for client errors (4xx) that
   *   indicate a healthy service and shouldn't affect availability tracking.
   */
  async execute<T>(fn: () => Promise<T>, shouldTrip?: (error: unknown) => boolean): Promise<T> {
    if (!this.canExecute()) {
      const isHalfOpenProbeBlocked = this.state === 'half-open';
      logger.warn(
        isHalfOpenProbeBlocked
          ? 'Circuit breaker is half-open — probe already in flight, blocking additional calls'
          : 'Circuit breaker is open — intelligence service calls blocked',
        {
          state: this.state,
          failureCount: this.failureCount,
          lastFailure: new Date(this.lastFailureTime).toISOString(),
        }
      );
      const remainingMs = isHalfOpenProbeBlocked
        ? 0
        : Math.max(0, this.config.resetTimeout - (Date.now() - this.lastFailureTime));
      throw new CircuitOpenError(
        isHalfOpenProbeBlocked
          ? `Circuit breaker is half-open with a probe in flight. Retry after the probe completes.`
          : `Circuit breaker is open. Intelligence service unavailable. Retry after ${remainingMs}ms.`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const trip = shouldTrip ? shouldTrip(error) : true;
      if (trip) {
        this.onFailure();
      } else {
        // Non-tripping error: the service responded, just not with a server error.
        // In half-open: counts as a successful probe.
        // In closed: resets failure count (service is healthy).
        this.onSuccess();
      }
      throw error;
    }
  }

  /**
   * Check if the circuit allows a call through.
   * In half-open state, only one in-flight probe is allowed to prevent thundering herd.
   */
  private canExecute(): boolean {
    switch (this.state) {
      case 'closed':
        return true;

      case 'open': {
        const elapsed = Date.now() - this.lastFailureTime;
        if (elapsed >= this.config.resetTimeout) {
          this.transitionTo('half-open');
          this.halfOpenInFlight = true;
          return true;
        }
        return false;
      }

      case 'half-open':
        // Allow only one probe at a time in half-open state
        if (this.halfOpenInFlight) {
          return false;
        }
        this.halfOpenInFlight = true;
        return true;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenInFlight = false;
      this.successCount++;
      if (this.successCount >= this.config.halfOpenSuccessThreshold) {
        this.transitionTo('closed');
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.halfOpenInFlight = false;
      this.transitionTo('open');
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;

    if (newState === 'closed') {
      this.failureCount = 0;
      this.successCount = 0;
      this.halfOpenInFlight = false;
    } else if (newState === 'half-open') {
      this.successCount = 0;
    }

    logger.info('Circuit breaker state transition', {
      from: previousState,
      to: newState,
      failureCount: this.failureCount,
    });
  }

  /**
   * Get the current circuit state for monitoring/observability.
   * Side-effect-free — reports the logical state without mutating internals.
   */
  getState(): CircuitState {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeout) {
        return 'half-open';
      }
    }
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }
}

/**
 * Error thrown when the circuit breaker is open
 */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
