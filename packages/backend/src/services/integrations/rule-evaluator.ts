/**
 * Rule Evaluator Service
 * Finds the first matching auto-create rule for a bug report
 * Handles rule matching, priority ordering, and throttle checking
 *
 * Uses caching to avoid repeated database lookups for frequently evaluated rules.
 */

import { getLogger } from '../../logger.js';
import type { IntegrationRuleRepository } from '../../db/integration-rule.repository.js';
import type { IntegrationRule } from '../../db/integration-rule.repository.js';
import type { BugReport } from '../../db/types.js';
import { RuleMatcher } from '../rule-matcher.js';
import { ThrottleChecker } from './throttle-checker.js';
import { getCacheService } from '../../cache/index.js';

const logger = getLogger();

/**
 * Result of rule evaluation with match status and throttle information
 */
export interface RuleEvaluationResult {
  matched: boolean;
  rule?: IntegrationRule;
  throttled?: boolean;
  throttleReason?: 'hourly_limit' | 'daily_limit';
  evaluatedRules: number;
}

/**
 * Service for evaluating integration rules against bug reports
 *
 * Determines which rule (if any) should trigger auto-ticket creation
 * by checking filters and throttle limits in priority order.
 */
export class RuleEvaluator {
  constructor(
    private integrationRuleRepository: IntegrationRuleRepository,
    private throttleChecker: ThrottleChecker
  ) {}

  /**
   * Evaluate bug report against auto-create rules to find first match
   *
   * @param bugReport - Bug report to evaluate
   * @param projectId - Project ID for rule lookup
   * @param integrationId - Integration ID for rule lookup
   * @returns Evaluation result with matched rule and throttle status
   *
   * @example
   * ```typescript
   * const result = await evaluator.evaluateForAutoCreate(bugReport, projectId, integrationId);
   * if (result.matched && !result.throttled) {
   *   await createTicket(bugReport, result.rule);
   * } else if (result.throttled) {
   *   logger.warn('Rule throttled', { reason: result.throttleReason });
   * }
   * ```
   */
  async evaluateForAutoCreate(
    bugReport: BugReport,
    projectId: string,
    integrationId: string
  ): Promise<RuleEvaluationResult> {
    try {
      logger.debug('Starting rule evaluation', {
        bugReportId: bugReport.id,
        projectId,
        integrationId,
      });

      // Step 1: Fetch all auto-create rules for this project/integration (with caching)
      // Rules are already ordered by priority DESC (highest priority first)
      const cache = getCacheService();
      const rules = await cache.getAutoCreateRules<IntegrationRule[]>(
        projectId,
        integrationId,
        () => this.integrationRuleRepository.findAutoCreateRules(projectId, integrationId)
      );

      if (rules.length === 0) {
        logger.debug('No auto-create rules found', {
          bugReportId: bugReport.id,
          projectId,
          integrationId,
        });
        return {
          matched: false,
          evaluatedRules: 0,
        };
      }

      logger.debug('Found auto-create rules', {
        bugReportId: bugReport.id,
        ruleCount: rules.length,
      });

      // Step 2: Iterate through rules in priority order
      let evaluatedCount = 0;

      for (const rule of rules) {
        evaluatedCount++;

        logger.info('Evaluating rule against bug report', {
          bugReportId: bugReport.id,
          ruleId: rule.id,
          ruleName: rule.name,
          priority: rule.priority,
          filterCount: rule.filters.length,
          bugReport: {
            title: bugReport.title,
            priority: bugReport.priority,
            status: bugReport.status,
            browser: bugReport.metadata?.browser,
            os: bugReport.metadata?.os,
            url: bugReport.metadata?.url,
            userEmail: (bugReport.metadata?.user as { email?: string } | undefined)?.email,
          },
          filters: rule.filters,
        });

        // Step 2a: Check if bug matches rule filters
        const matchesFilters = RuleMatcher.matchesFilters(bugReport, rule.filters, {
          ruleId: rule.id,
          ruleName: rule.name,
        });

        if (!matchesFilters) {
          logger.info('Rule rejected - filters did not match', {
            bugReportId: bugReport.id,
            ruleId: rule.id,
            ruleName: rule.name,
            priority: rule.priority,
            result: 'SKIP_TO_NEXT_RULE',
          });
          continue; // Move to next rule
        }

        logger.info('Rule passed - all filters matched!', {
          bugReportId: bugReport.id,
          ruleId: rule.id,
          ruleName: rule.name,
          priority: rule.priority,
          filterCount: rule.filters.length,
          result: 'FILTERS_MATCHED',
        });

        // Step 2b: Check throttle limits
        const throttleResult = await this.throttleChecker.check(rule.id, rule.throttle);

        // Step 2c: If allowed, return matched with rule
        if (throttleResult.allowed) {
          logger.info('✅ RULE MATCHED AND ALLOWED - Ticket will be created', {
            bugReportId: bugReport.id,
            bugTitle: bugReport.title,
            ruleId: rule.id,
            ruleName: rule.name,
            priority: rule.priority,
            evaluatedRules: evaluatedCount,
            throttleStatus: 'ALLOWED',
            result: 'CREATE_TICKET',
          });

          return {
            matched: true,
            rule,
            throttled: false,
            evaluatedRules: evaluatedCount,
          };
        }

        // Step 2d: If throttled, return matched but throttled
        logger.warn('⚠️ RULE MATCHED BUT THROTTLED - Ticket creation blocked', {
          bugReportId: bugReport.id,
          bugTitle: bugReport.title,
          ruleId: rule.id,
          ruleName: rule.name,
          throttleReason: throttleResult.reason,
          currentHourly: throttleResult.currentHourly,
          currentDaily: throttleResult.currentDaily,
          limits: throttleResult.limits,
          result: 'THROTTLED',
        });

        return {
          matched: true,
          rule,
          throttled: true,
          throttleReason: throttleResult.reason,
          evaluatedRules: evaluatedCount,
        };
      }

      // Step 3: No rules matched
      logger.info('❌ NO RULES MATCHED - Ticket will not be created', {
        bugReportId: bugReport.id,
        bugTitle: bugReport.title,
        projectId,
        integrationId,
        evaluatedRules: evaluatedCount,
        totalRulesChecked: rules.length,
        result: 'NO_MATCH',
      });

      return {
        matched: false,
        evaluatedRules: evaluatedCount,
      };
    } catch (error) {
      logger.error('Rule evaluation failed', {
        bugReportId: bugReport.id,
        projectId,
        integrationId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return no match on error to avoid blocking bug report processing
      return {
        matched: false,
        evaluatedRules: 0,
      };
    }
  }
}
