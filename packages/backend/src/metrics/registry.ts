/**
 * Prometheus Metrics Registry
 * Shared registry and metric definitions used by API server and worker process.
 * Each Node.js process (container) gets its own registry instance.
 */

import client from 'prom-client';

export const register = new client.Registry();

// Default Node.js metrics (CPU, memory, event loop lag, GC, active handles)
client.collectDefaultMetrics({ register });

// === HTTP Metrics (API only) ===

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

// === Queue Metrics (Worker) ===

export const queueJobsProcessed = new client.Counter({
  name: 'queue_jobs_processed_total',
  help: 'Total number of queue jobs processed',
  labelNames: ['queue_name', 'status'] as const,
  registers: [register],
});

export const queueJobDuration = new client.Histogram({
  name: 'queue_job_duration_seconds',
  help: 'Duration of queue job processing in seconds',
  labelNames: ['queue_name'] as const,
  buckets: [0.5, 1, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

// === Platform-admin org retention ===
// Admin-initiated hard-deletion of soft-deleted orgs that have aged past
// ORG_RETENTION_DAYS. No scheduler — each increment is a human click.
// Labels: `result` =
//   'success'           — cascade executed
//   'validation_failed' — 400, subdomain confirmation mismatch
//   'not_found'         — 404, org id doesn't exist (stale UI / typo in
//                         a scripted call / already hard-deleted by
//                         another admin moments earlier)
//   'guard_failed'      — 409, org not soft-deleted / inside retention
//                         window / state changed during delete
//   'error'             — any other unexpected error
// Keep dashboards/alerts in sync when adding new labels.
export const orgHardDeleteTotal = new client.Counter({
  name: 'bugspotter_org_hard_delete_total',
  help: 'Platform-admin hard-deletions of soft-deleted organizations past the retention window',
  labelNames: ['result'] as const,
  registers: [register],
});

// === Self-service signup ===
// Funnel + abuse-mitigation telemetry. Lets ops dashboards answer
// questions like "did adding hCaptcha drop bot rejections?" or "what
// fraction of signups complete email verification?". Per-event audit
// log rows live in `application.audit_logs`; counters here are the
// rate-of-change view that pairs with them.
//
// Outcomes for `signup_attempts_total`:
//   'success'         — user, org, project, API key, verification token all committed
//   'spam_rejected'   — runSpamChecks returned rejected=true (any reason);
//                        per-check breakdown lives on `signup_spam_check_total`
//   'duplicate_email' — findByEmail found an existing user (read-side check)
//   'invalid_input'   — empty company_name, invalid subdomain, or
//                        otherwise rejected at the validation gate
// Keep dashboards/alerts in sync when adding new outcomes.
export const signupAttemptsTotal = new client.Counter({
  name: 'bugspotter_signup_attempts_total',
  help: 'Self-service signup attempts by terminal outcome',
  labelNames: ['outcome'] as const,
  registers: [register],
});

// Per-check fire rate for the spam filter. A single rejected attempt
// can trip multiple checks (e.g. disposable_email + suspicious_pattern
// summing past the score threshold), so totals here can exceed the
// `spam_rejected` count on `signup_attempts_total`. That's intentional —
// this counter answers "is the disposable-email blocklist actually
// catching anything?" independently of whether other checks also fired.
//
// Checks: 'honeypot' | 'rate_limit' | 'duplicate_pending' |
//         'disposable_email' | 'suspicious_pattern'
export const signupSpamCheckTotal = new client.Counter({
  name: 'bugspotter_signup_spam_check_total',
  help: 'Self-service signup spam-check fires (per check, not per request)',
  labelNames: ['check'] as const,
  registers: [register],
});

// Outcomes for email verification:
//   'success' — token consumed (or idempotent 200 for already-verified user)
//   'invalid' — terminal 4xx (unknown / consumed-but-not-verified / expired)
export const signupEmailVerificationTotal = new client.Counter({
  name: 'bugspotter_signup_email_verification_total',
  help: 'Email verification attempts by outcome',
  labelNames: ['outcome'] as const,
  registers: [register],
});

// Outcomes for verification email resend:
//   'success'           — new token issued + email dispatched (or silent
//                          no-op when user is already verified — same
//                          response shape, no probe-able state leak)
//   'user_not_found'    — JWT carries a stale user id (rare; normally
//                          requireUser would have rejected upstream)
//   'error'             — anything else (DB outage, unexpected throw)
export const signupVerificationResendTotal = new client.Counter({
  name: 'bugspotter_signup_verification_resend_total',
  help: 'Verification email resend requests by outcome',
  labelNames: ['outcome'] as const,
  registers: [register],
});

// Note: queueDepth and dbPoolSize gauges are created in collectors.ts
// with async collect callbacks (populated on each /metrics scrape).
