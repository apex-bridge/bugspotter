/**
 * Typed error hierarchy for the payment service.
 *
 * Categories:
 * - ConfigError      — missing env vars or invalid configuration
 * - ValidationError  — bad input from the caller (missing fields, unknown action)
 * - ProviderError    — upstream payment provider returned an error
 * - WebhookError     — webhook verification failures (IP, signature)
 */

export class PaymentServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'PaymentServiceError';
  }
}

export class ConfigError extends PaymentServiceError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class ValidationError extends PaymentServiceError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class ProviderError extends PaymentServiceError {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

export class WebhookError extends PaymentServiceError {
  constructor(
    message: string,
    public readonly statusCode: number = 401
  ) {
    super(message, 'WEBHOOK_ERROR');
    this.name = 'WebhookError';
  }
}
