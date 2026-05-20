/**
 * DedupRule schema — TypeScript mirror of the Python Pydantic model in
 * bugspotter-intelligence (`models/dedup_rule.py`). The intelligence
 * service produces these via the NL parser; the rule engine in this
 * package consumes them.
 *
 * Two sources of truth is one too many — when you change a constraint
 * here (a new field, a new action type, a new trigger), change the
 * Python model in lockstep. The shape, regex patterns, and validation
 * semantics must match exactly or the rule the LLM emits in bs-intel
 * will fail to round-trip through this validator.
 *
 * Zod is used to validate JSONB blobs at the trust boundary (DB read,
 * admin write). The repository stores the raw blob; the schema is what
 * the executor and the API layer parse it through.
 */

import { z } from 'zod';

import { validateSSRFProtection } from './security/ssrf-validator.js';

// `<digits><unit>` duration strings used by trigger / condition / rate_limit
// windows. Leading [1-9] forbids zero-duration ("0h") windows that would
// silently make conditions meaningless. Must match `_WINDOW_PATTERN` in
// bugspotter-intelligence/src/bugspotter_intelligence/models/dedup_rule.py.
const WINDOW_PATTERN = /^[1-9]\d*[smhdw]$/;

// Standard 5-field cron. Deliberately loose — catches prose like
// "every monday" but doesn't validate semantics. Matches `_CRON_PATTERN`
// in the Python model.
const CRON_PATTERN = /^(\S+\s+){4}\S+$/;

// Recipients for notify.email.to: three special tokens (resolved at
// execution time) or a literal email. Loose email regex — strict
// RFC-5322 validation lives in the executor.
const EMAIL_TARGET_PATTERN = /^(reporter|closer|all_reporters|[^@\s]+@[^@\s]+\.[^@\s]+)$/;

// ============================================================================
// Triggers — pick exactly one
// ============================================================================

const triggerDuplicateDetectedSchema = z.object({
  type: z.literal('duplicate_detected'),
});

const triggerOutboxAboutToSkipSchema = z.object({
  type: z.literal('outbox_about_to_skip'),
});

const triggerClusterGrowingSchema = z.object({
  type: z.literal('cluster_growing'),
  threshold: z.number().int().min(2),
  window: z.string().regex(WINDOW_PATTERN),
});

const triggerScheduleSchema = z.object({
  type: z.literal('schedule'),
  cron: z.string().regex(CRON_PATTERN),
});

export const triggerSpecSchema = z.discriminatedUnion('type', [
  triggerDuplicateDetectedSchema,
  triggerOutboxAboutToSkipSchema,
  triggerClusterGrowingSchema,
  triggerScheduleSchema,
]);

export type TriggerSpec = z.infer<typeof triggerSpecSchema>;

// ============================================================================
// Conditions — zero or more, ANDed together
// ============================================================================

export const CONDITION_FIELDS = [
  'canonical.status',
  'canonical.closed_days_ago',
  'hits_in_window',
  'reporter.customer.tier',
  'severity',
] as const;

export const CONDITION_OPS = ['eq', 'in', 'not_in', 'gte', 'lte'] as const;

// Closed `field` literal so an LLM-emitted rule can't reference unknown
// paths the executor wouldn't recognize. The Python model gates the
// op/value coherence (e.g. `gte` requires a number, `in` requires a list)
// via a `model_validator(mode='after')`. We mirror that with a
// `superRefine` so the same coercions / rejections happen on the TS side.
export const conditionSpecSchema = z
  .object({
    field: z.enum(CONDITION_FIELDS),
    op: z.enum(CONDITION_OPS),
    value: z.unknown(),
    window: z.string().regex(WINDOW_PATTERN).optional(),
  })
  .transform((c) => {
    // Coerce scalar -> singleton list for in/not_in (LLMs commonly emit
    // `"value": "closed"` instead of `["closed"]`).
    if (
      (c.op === 'in' || c.op === 'not_in') &&
      !Array.isArray(c.value) &&
      (typeof c.value === 'string' || typeof c.value === 'number' || typeof c.value === 'boolean')
    ) {
      return { ...c, value: [c.value] };
    }
    // Coerce string-number -> number for gte/lte ("3" -> 3). Guard the
    // empty / whitespace-only case explicitly: `Number("")` is 0 in JS
    // (not NaN), which would silently treat a blank value as zero —
    // diverging from the Pydantic model where `int("")` raises. Trim
    // and require non-empty before delegating to Number().
    if ((c.op === 'gte' || c.op === 'lte') && typeof c.value === 'string') {
      const trimmed = c.value.trim();
      if (trimmed !== '') {
        const n = Number(trimmed);
        if (!Number.isNaN(n)) {
          return { ...c, value: n };
        }
      }
    }
    return c;
  })
  .superRefine((c, ctx) => {
    if (c.op === 'in' || c.op === 'not_in') {
      if (!Array.isArray(c.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `op '${c.op}' on field '${c.field}' requires a list value`,
          path: ['value'],
        });
      }
    }
    if (c.op === 'gte' || c.op === 'lte') {
      // `Number.isFinite` is the right check: rejects non-numbers,
      // booleans (typeof `true` is `'boolean'`, not `'number'`), and
      // — crucially — NaN / Infinity which would pass a naive
      // `typeof === 'number'` test but evaluate to `false` for every
      // comparison downstream, producing rules that silently never fire.
      if (!Number.isFinite(c.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `op '${c.op}' on field '${c.field}' requires a numeric value`,
          path: ['value'],
        });
      }
    }
    if (c.field === 'hits_in_window' && !c.window) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "field 'hits_in_window' requires a 'window' parameter, e.g. '24h'",
        path: ['window'],
      });
    }
  });

export type ConditionSpec = z.infer<typeof conditionSpecSchema>;

// ============================================================================
// Actions — at least one
// ============================================================================

export const CANONICAL_STATUSES = ['open', 'in_progress', 'closed', 'wont_fix'] as const;

const actionAddCommentSchema = z.object({
  type: z.literal('ticket.add_comment'),
  target: z.literal('canonical'),
  body: z.string().min(1),
});

const actionTransitionSchema = z.object({
  type: z.literal('ticket.transition'),
  target: z.literal('canonical'),
  to: z.enum(CANONICAL_STATUSES),
});

const actionEmailSchema = z.object({
  type: z.literal('notify.email'),
  to: z.string().regex(EMAIL_TARGET_PATTERN),
  template: z.string().min(1),
});

// Slack action must have exactly one of `channel` / `user` set —
// matches `ActionSlack._exactly_one_target` in the Python model.
const actionSlackSchema = z
  .object({
    type: z.literal('notify.slack'),
    channel: z.string().nullable().optional(),
    user: z.string().nullable().optional(),
    message: z.string().min(1),
  })
  .superRefine((a, ctx) => {
    const hasChannel = !!(a.channel && a.channel.trim() !== '');
    const hasUser = !!(a.user && a.user.trim() !== '');
    if (hasChannel === hasUser) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ActionSlack requires exactly one of `channel` or `user` to be set',
      });
    }
  });

// `z.string().url()` only checks syntax. Without an SSRF guard, an admin
// could persist a rule that makes the executor POST to internal services
// (127.*, 10.*, 169.254.* cloud metadata, etc). Reject at parse time so
// bad URLs never make it past write; the executor runs the same check
// again as defense-in-depth.
const actionWebhookSchema = z.object({
  type: z.literal('notify.webhook'),
  url: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          validateSSRFProtection(u);
          return true;
        } catch {
          return false;
        }
      },
      {
        message:
          'Webhook URL must be a public HTTPS/HTTP endpoint (no localhost, private, or metadata IPs)',
      }
    ),
  payload: z.record(z.unknown()).nullable().optional(),
});

// `chat_id` is a string because Telegram supports both numeric ids
// (group / supergroup ids are large negatives, well outside JS-safe
// integer range when one accidentally serializes them as Number) and
// `@channel_username` references for public channels. The dispatcher
// passes the value straight to the bot-API as a string, which is what
// the API documents as canonical.
const actionTelegramSchema = z.object({
  type: z.literal('notify.telegram'),
  chat_id: z.string().min(1),
  message: z.string().min(1),
});

// Plain `z.union` instead of `discriminatedUnion`: the latter requires
// every variant to be a `ZodObject`, but `actionSlackSchema` is a
// `ZodEffects` (wraps `.superRefine` for the XOR check). The union
// version produces slightly less targeted error messages on a
// type-mismatch but otherwise behaves identically.
export const actionSpecSchema = z.union([
  actionAddCommentSchema,
  actionTransitionSchema,
  actionEmailSchema,
  actionSlackSchema,
  actionWebhookSchema,
  actionTelegramSchema,
]);

export type ActionSpec = z.infer<typeof actionSpecSchema>;

// ============================================================================
// Rule
// ============================================================================

export const rateLimitSchema = z.object({
  count: z.number().int().min(1),
  window: z.string().regex(WINDOW_PATTERN),
});

export type RateLimit = z.infer<typeof rateLimitSchema>;

// `if` is a reserved word in JS, so the wire shape (`if`) is normalized
// to a `conditions` property. The Python model uses `if_` for the same
// reason and accepts both via `populate_by_name=True`. We accept either
// `if` or `conditions` on the input and produce `conditions` on the
// output type, so consumers don't have to bracket-access a reserved
// keyword.
export const dedupRuleSchema = z
  .object({
    name: z.string().min(1).max(120),
    when: triggerSpecSchema,
    if: z.array(conditionSpecSchema).optional(),
    conditions: z.array(conditionSpecSchema).optional(),
    then: z.array(actionSpecSchema).min(1),
    rate_limit: rateLimitSchema.nullable().optional(),
    enabled: z.boolean().default(true),
  })
  .transform((r) => {
    const { if: ifField, conditions: condField, ...rest } = r;
    return {
      ...rest,
      conditions: condField ?? ifField ?? [],
    };
  });

export type DedupRule = z.infer<typeof dedupRuleSchema>;

/**
 * Parse a stored / submitted DedupRule blob and return a typed value.
 * Throws a ZodError on validation failure — callers at the API
 * boundary should catch and surface the issues; the executor should
 * skip the rule and log.
 */
export function parseDedupRule(input: unknown): DedupRule {
  return dedupRuleSchema.parse(input);
}
