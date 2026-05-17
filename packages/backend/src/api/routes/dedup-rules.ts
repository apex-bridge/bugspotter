/**
 * Dedup Rules API — admin CRUD for the per-project rule engine.
 *
 * The rule executor (PR-C / PR-C2) reads from `application.dedup_rules`
 * but had no write path. This file is the write path: admin-only routes
 * for listing, creating, updating, and deleting rules on a project.
 *
 * **Auth model**: project-admin gate via `requireProjectRole('admin')`,
 * mirroring `integration-rules.ts`. Rule creation today is admin-only
 * because the C2 security carry-overs (auth-bound `reporter` recipient,
 * per-recipient rate limit, literal-email allowlist) haven't landed —
 * a non-admin tenant user able to author rules could exfiltrate bug
 * data via `notify.email.to = 'attacker@evil.com'`. Those mitigations
 * are tracked separately; when they land, the role gate can relax.
 *
 * **Validation**: every write goes through `parseDedupRule` (Zod). The
 * repository stores the raw blob; the schema is what the executor
 * parses on read, so writing a malformed rule would silently no-op the
 * executor — fail-closed at the API boundary instead.
 */

import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { DatabaseClient } from '../../db/client.js';
import { PG_UNIQUE_VIOLATION } from '../../db/pg-error-codes.js';
import {
  parseDedupRule,
  dedupRuleSchema,
  type DedupRule,
} from '../../integrations/dedup-rule.schema.js';
import { getLogger } from '../../logger.js';
import { requireAuth, requireProjectRole } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { requireProjectAccess } from '../middleware/project-access.js';
import { getAuditUserId } from '../utils/audit-attribution.js';
import { sendCreated, sendSuccess } from '../utils/response.js';

const logger = getLogger();

/**
 * Body shape for POST and PATCH. Matches the wire format of `DedupRule`
 * but typed loosely here — Zod is the source of truth and runs on every
 * request. Typing the body as `unknown` would also work; using a
 * `Record` keeps the route signature documentary without committing to
 * a TS shape that could drift from Zod.
 */
type DedupRuleBody = Record<string, unknown>;

/**
 * Convert a Zod failure into a 400 with the first issue's path + message.
 * Returning all issues would leak the schema's internal structure and
 * also overwhelm the admin UI's error toast; the first issue is what
 * the user needs to fix first anyway.
 */
function rejectIfInvalid(err: unknown): never {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    throw new AppError(`Invalid dedup rule: ${path}: ${issue.message}`, 400, 'BadRequest');
  }
  throw err;
}

/**
 * Catches the TOCTOU race where the `findByProjectAndName` pre-check
 * passes for two concurrent writes and the DB unique constraint trips
 * for the loser. Map the pg `23505` (unique_violation) to the same
 * 409 the pre-check produces, so the API contract stays consistent.
 */
function isUniqueNameViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * Look up a rule and verify it belongs to the project in the URL path.
 * A globally-unique UUID makes cross-project hits unlikely in practice,
 * but the check closes the rest of the surface (stale link, swapped
 * id) without an extra query — `findById` already returned project_id.
 */
async function loadRuleScopedToProject(ruleId: string, projectId: string, db: DatabaseClient) {
  const rule = await db.dedupRules.findById(ruleId);
  if (!rule || rule.project_id !== projectId) {
    throw new AppError('Dedup rule not found', 404, 'NotFound');
  }
  return rule;
}

export function registerDedupRuleRoutes(fastify: FastifyInstance, db: DatabaseClient): void {
  /**
   * GET /api/v1/projects/:projectId/dedup-rules
   * Lists every rule on the project (enabled and disabled). The admin
   * UI needs both so it can render the disabled rows with a toggle;
   * the executor uses `findByProject(_, false)` for its hot path, which
   * is a different code path.
   *
   * Admin-gated because rule bodies contain `notify.email.to` literals
   * and condition fields that should not be visible to project viewers
   * until the C2 carry-overs (auth-bound reporter, allowlist) land.
   */
  fastify.get<{ Params: { projectId: string } }>(
    '/api/v1/projects/:projectId/dedup-rules',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const rules = await db.dedupRules.findByProject(projectId, true);
      logger.debug('Listed dedup rules', {
        projectId,
        count: rules.length,
        userId: getAuditUserId(request),
      });
      return sendSuccess(reply, { rules });
    }
  );

  /**
   * GET /api/v1/projects/:projectId/dedup-rules/:ruleId
   * Single rule lookup. Admin-gated for the same reason as list.
   */
  fastify.get<{ Params: { projectId: string; ruleId: string } }>(
    '/api/v1/projects/:projectId/dedup-rules/:ruleId',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { projectId, ruleId } = request.params;
      const rule = await loadRuleScopedToProject(ruleId, projectId, db);
      return sendSuccess(reply, { rule });
    }
  );

  /**
   * POST /api/v1/projects/:projectId/dedup-rules
   * Body is the full DedupRule blob. Zod validates; the row stores
   * (name, rule_json, enabled) split out for query convenience.
   */
  fastify.post<{ Params: { projectId: string }; Body: DedupRuleBody }>(
    '/api/v1/projects/:projectId/dedup-rules',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { projectId } = request.params;
      let rule: DedupRule;
      try {
        rule = parseDedupRule(request.body);
      } catch (err) {
        rejectIfInvalid(err);
      }
      // Friendlier 409 than the raw uniqueness-constraint error the
      // DB would emit. The pre-check covers the common case; the
      // try/catch below catches the TOCTOU race where two concurrent
      // POSTs both pass this check.
      const existing = await db.dedupRules.findByProjectAndName(projectId, rule.name);
      if (existing) {
        throw new AppError(
          `Dedup rule '${rule.name}' already exists in this project`,
          409,
          'Conflict'
        );
      }
      let created;
      try {
        created = await db.dedupRules.create({
          project_id: projectId,
          name: rule.name,
          rule_json: rule,
          enabled: rule.enabled,
        });
      } catch (err) {
        if (isUniqueNameViolation(err)) {
          throw new AppError(
            `Dedup rule '${rule.name}' already exists in this project`,
            409,
            'Conflict'
          );
        }
        throw err;
      }
      logger.info('Dedup rule created', {
        projectId,
        ruleId: created.id,
        name: rule.name,
        trigger: rule.when.type,
        actionCount: rule.then.length,
        userId: getAuditUserId(request),
      });
      return sendCreated(reply, { rule: created });
    }
  );

  /**
   * PATCH /api/v1/projects/:projectId/dedup-rules/:ruleId
   * Accepts a partial. Two shapes are supported:
   *  - `{ enabled: boolean }` — toggle only, the common admin-UI op.
   *  - The full DedupRule blob — replaces name + rule_json + enabled.
   *
   * Mixing-and-matching at a sub-field level isn't supported because
   * the rule body is a discriminated union; rebuilding a half-rule
   * server-side would either be lossy or surprising. The admin UI
   * already round-trips full rules.
   */
  fastify.patch<{
    Params: { projectId: string; ruleId: string };
    Body: DedupRuleBody;
  }>(
    '/api/v1/projects/:projectId/dedup-rules/:ruleId',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { projectId, ruleId } = request.params;
      const body = request.body ?? {};
      const existing = await loadRuleScopedToProject(ruleId, projectId, db);

      const keys = Object.keys(body);
      const enabledOnly = keys.length === 1 && keys[0] === 'enabled';

      if (enabledOnly) {
        if (typeof body.enabled !== 'boolean') {
          throw new AppError('enabled must be a boolean', 400, 'BadRequest');
        }
        // Keep the `enabled` column and `rule_json.enabled` field in
        // sync. The executor filters by the column, but the rule
        // blob also carries an `enabled` field that future code (the
        // admin UI, an audit log, a re-validation pass) might read.
        // A drift between the two is technically harmless today but
        // breaks the implicit contract that `rule_json` is the
        // canonical rule shape.
        const syncedRuleJson = {
          ...(existing.rule_json as Record<string, unknown>),
          enabled: body.enabled,
        };
        const updated = await db.dedupRules.update(ruleId, {
          enabled: body.enabled,
          rule_json: syncedRuleJson,
        });
        logger.info('Dedup rule toggled', {
          projectId,
          ruleId,
          enabled: body.enabled,
          userId: getAuditUserId(request),
        });
        return sendSuccess(reply, { rule: updated });
      }

      // Full-rule replacement path.
      let rule: DedupRule;
      try {
        rule = dedupRuleSchema.parse(body);
      } catch (err) {
        rejectIfInvalid(err);
      }
      if (rule.name !== existing.name) {
        const nameClash = await db.dedupRules.findByProjectAndName(projectId, rule.name);
        if (nameClash && nameClash.id !== ruleId) {
          throw new AppError(
            `Dedup rule '${rule.name}' already exists in this project`,
            409,
            'Conflict'
          );
        }
      }
      let updated;
      try {
        updated = await db.dedupRules.update(ruleId, {
          name: rule.name,
          rule_json: rule,
          enabled: rule.enabled,
        });
      } catch (err) {
        // TOCTOU: a concurrent rename to the same target name slips
        // past the pre-check above; the unique constraint catches it.
        if (isUniqueNameViolation(err)) {
          throw new AppError(
            `Dedup rule '${rule.name}' already exists in this project`,
            409,
            'Conflict'
          );
        }
        throw err;
      }
      logger.info('Dedup rule updated', {
        projectId,
        ruleId,
        userId: getAuditUserId(request),
      });
      return sendSuccess(reply, { rule: updated });
    }
  );

  /**
   * DELETE /api/v1/projects/:projectId/dedup-rules/:ruleId
   * The AFTER DELETE trigger added in migration 025 cleans up
   * `notification_throttle` rows that referenced this rule — without
   * it, the polymorphic `rule_id` would orphan throttle state forever
   * (see migration 024's prose).
   */
  fastify.delete<{ Params: { projectId: string; ruleId: string } }>(
    '/api/v1/projects/:projectId/dedup-rules/:ruleId',
    {
      preHandler: [
        requireAuth,
        requireProjectAccess(db, { paramName: 'projectId' }),
        requireProjectRole('admin'),
      ],
    },
    async (request, reply) => {
      const { projectId, ruleId } = request.params;
      const rule = await loadRuleScopedToProject(ruleId, projectId, db);
      await db.dedupRules.delete(ruleId);
      logger.info('Dedup rule deleted', {
        projectId,
        ruleId,
        name: rule.name,
        userId: getAuditUserId(request),
      });
      return sendSuccess(reply, { message: `Dedup rule '${rule.name}' deleted` });
    }
  );

  logger.info('Dedup rule routes registered');
}
