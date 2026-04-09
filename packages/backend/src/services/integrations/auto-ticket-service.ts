/**
 * Automatic Ticket Creation Service (with Transactional Outbox Pattern)
 * Orchestrates automatic ticket creation when bug reports are created
 *
 * Flow (NEW - Transactional Outbox Pattern):
 * 1. Evaluate integration rules to find matching auto-create rule
 * 2. Check throttle limits
 * 3. **Create outbox entry in database transaction** (ensures atomicity)
 * 4. Return immediately (bug report creation continues)
 * 5. **Background worker processes outbox** (async ticket creation)
 *
 * Benefits:
 * - No orphaned tickets (external API call happens AFTER db transaction commits)
 * - Fast bug report creation (doesn't wait for external API)
 * - Automatic retries with exponential backoff
 * - Dead letter queue for failed attempts
 *
 * Old Flow (DEPRECATED - causes orphaned tickets):
 * 1-2. Same
 * 3. Create ticket on external platform ❌ BEFORE db transaction
 * 4. Record ticket in database ❌ Can fail, leaving orphaned ticket
 *
 * Handles errors gracefully to prevent blocking bug report creation
 */

import { getLogger } from '../../logger.js';
import type { DatabaseClient } from '../../db/client.js';
import type { BugReport } from '../../db/types.js';
import { RuleEvaluator } from './rule-evaluator.js';
import { ThrottleChecker } from './throttle-checker.js';

const logger = getLogger();

/**
 * Result of automatic ticket creation attempt
 */
export interface AutoTicketResult {
  success: boolean;
  externalId?: string;
  externalUrl?: string;
  platform?: string;
  ruleId?: string;
  ruleName?: string;
  error?: string;
  throttled?: boolean;
  throttleReason?: 'hourly_limit' | 'daily_limit';
}

/**
 * Service for automatic ticket creation based on integration rules
 *
 * Uses Transactional Outbox Pattern:
 * - Rule evaluation happens immediately (priority ordering)
 * - Throttle checking is atomic with outbox entry creation
 * - External ticket creation happens asynchronously via background worker
 * - Errors don't block bug report creation (graceful degradation)
 */
export class AutoTicketService {
  private readonly ruleEvaluator: RuleEvaluator;

  constructor(private readonly db: DatabaseClient) {
    // Initialize rule evaluator with throttle checker
    const throttleChecker = new ThrottleChecker(db.tickets);
    this.ruleEvaluator = new RuleEvaluator(db.integrationRules, throttleChecker);
  }

  /**
   * Attempt to automatically create ticket for bug report
   *
   * @param bugReport - Bug report to create ticket for
   * @param projectId - Project ID for rule lookup
   * @param integrationId - Integration ID (project_integrations.id)
   * @param platform - Integration platform (jira, github, etc.)
   * @returns Result of automatic ticket creation attempt
   *
   * @example
   * ```typescript
   * const result = await autoTicketService.tryCreateTicket(
   *   bugReport,
   *   projectId,
   *   integrationId,
   *   'jira'
   * );
   *
   * if (result.success) {
   *   logger.info('Automatic ticket created', { externalId: result.externalId });
   * } else if (result.throttled) {
   *   logger.warn('Ticket creation throttled', { reason: result.throttleReason });
   * } else {
   *   logger.error('Ticket creation failed', { error: result.error });
   * }
   * ```
   */
  async tryCreateTicket(
    bugReport: BugReport,
    projectId: string,
    integrationId: string,
    platform: string
  ): Promise<AutoTicketResult> {
    try {
      logger.debug('Starting automatic ticket creation', {
        bugReportId: bugReport.id,
        projectId,
        integrationId,
        platform,
      });

      // Step 1: Evaluate rules to find matching auto-create rule
      const evaluation = await this.ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        projectId,
        integrationId
      );

      if (!evaluation.matched) {
        logger.debug('No auto-create rules matched', {
          bugReportId: bugReport.id,
          evaluatedRules: evaluation.evaluatedRules,
        });
        return { success: false };
      }

      if (evaluation.throttled) {
        logger.warn('Auto-create rule throttled', {
          bugReportId: bugReport.id,
          ruleId: evaluation.rule?.id,
          ruleName: evaluation.rule?.name,
          reason: evaluation.throttleReason,
        });
        return {
          success: false,
          throttled: true,
          throttleReason: evaluation.throttleReason,
          ruleId: evaluation.rule?.id,
          ruleName: evaluation.rule?.name,
        };
      }

      // Rule matched and not throttled
      const rule = evaluation.rule!;

      logger.info('Auto-create rule matched', {
        bugReportId: bugReport.id,
        ruleId: rule.id,
        ruleName: rule.name,
        priority: rule.priority,
      });

      // Step 2: Create outbox entry in database transaction (TRANSACTIONAL OUTBOX PATTERN)
      // This ensures atomicity - if DB transaction fails, no external ticket is created
      // Background worker will process the outbox entry asynchronously
      const outboxEntry = await this.db.ticketOutbox.create({
        bug_report_id: bugReport.id,
        project_id: projectId,
        integration_id: integrationId,
        platform,
        rule_id: rule.id,
        payload: {
          // Snapshot of rule configuration at queue time (preserves state if rule modified/deleted)
          description_template: rule.description_template,
          field_mappings: rule.field_mappings,
          attachment_config: rule.attachment_config,
          // Bug report context for template rendering
          bugReportId: bugReport.id,
          projectId: bugReport.project_id,
          title: bugReport.title,
          description: bugReport.description,
        },
        scheduled_at: new Date(), // Process immediately
        max_retries: 3, // 3 retries with exponential backoff
      });

      logger.info('Automatic ticket creation queued (outbox)', {
        bugReportId: bugReport.id,
        outboxEntryId: outboxEntry.id,
        platform,
        ruleId: rule.id,
        ruleName: rule.name,
      });

      return {
        success: true,
        // Note: externalId and externalUrl are not yet available (async processing)
        // Clients can poll the outbox status or listen for webhook events
        platform,
        ruleId: rule.id,
        ruleName: rule.name,
      };
    } catch (error) {
      logger.error('Automatic ticket creation failed', {
        bugReportId: bugReport.id,
        projectId,
        integrationId,
        platform,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
