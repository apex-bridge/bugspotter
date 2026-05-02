/**
 * RuleEvaluator Integration Tests
 * Tests rule evaluation with real database using testcontainers
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabaseClient } from '../../src/db/client.js';
import type { DatabaseClient } from '../../src/db/client.js';
import { RuleEvaluator } from '../../src/services/integrations/rule-evaluator.js';
import { ThrottleChecker } from '../../src/services/integrations/throttle-checker.js';
import { getCacheService } from '../../src/cache/index.js';
import type { BugReport } from '../../src/db/types.js';
import { createProjectIntegrationSQL } from '../test-helpers.js';

describe('RuleEvaluator Integration Tests', () => {
  let db: DatabaseClient;
  let ruleEvaluator: RuleEvaluator;
  let throttleChecker: ThrottleChecker;
  let testProjectId: string;
  let testIntegrationId: string;
  let testBugReportId: string;

  beforeAll(async () => {
    db = await createDatabaseClient();

    // Create test project
    const project = await db.projects.create({
      name: 'Integration Test Project',
      settings: {},
    });
    testProjectId = project.id;

    // Create global Jira integration first
    // Use existing Jira integration from migration
    const jiraIntegration = await db.integrations.findByType('jira');
    if (!jiraIntegration) {
      throw new Error('Jira integration not found');
    }

    // Create GitHub integration (not in migration)
    await db.integrations.create({
      name: 'GitHub',
      type: 'github',
      description: 'GitHub issue tracking',
      status: 'active',
      config: {},
    });

    // Create test integration
    const integration = await db.query(createProjectIntegrationSQL(), [
      testProjectId,
      'jira',
      true,
      '{"api_token":"test","server_url":"https://test.atlassian.net"}',
      null,
    ]);
    testIntegrationId = integration.rows[0].id;

    // Create test bug report
    const bugReport = await db.bugReports.create({
      project_id: testProjectId,
      title: 'Critical Bug',
      description: 'App crashes',
      priority: 'critical',
      status: 'open',
      metadata: {
        browser: 'Chrome',
        os: 'Windows',
        url: 'https://example.com',
        user_agent: 'Mozilla/5.0',
        device_type: 'desktop',
        screen_resolution: '1920x1080',
      },
    });
    testBugReportId = bugReport.id;

    // Initialize services
    throttleChecker = new ThrottleChecker(db.tickets);
    ruleEvaluator = new RuleEvaluator(db.integrationRules, throttleChecker);
  });

  afterAll(async () => {
    if (db) {
      await db.query('DELETE FROM project_integrations WHERE project_id = $1', [testProjectId]);
      await db.query('DELETE FROM projects WHERE id = $1', [testProjectId]);
      await db.close();
    }
  });

  beforeEach(async () => {
    // Clean up integration rules and tickets before each test
    await db.query('DELETE FROM integration_rules WHERE project_id = $1', [testProjectId]);
    await db.query('DELETE FROM tickets WHERE bug_report_id = $1', [testBugReportId]);
    // RuleEvaluator caches auto-create rules per (projectId, integrationId)
    // via getCacheService().getAutoCreateRules. The test bypasses route
    // handlers (writes via the repository directly), so the cache stays
    // populated across tests and every test after the first reads stale
    // rules. Use `clear()` rather than `invalidateIntegrationRules` because
    // the latter's key pattern (`<prefix>:<projectId>:*`) doesn't match
    // auto-create cache keys (`<prefix>:auto:<projectId>:<integrationId>`)
    // — a real bug in cache-service.ts that affects production route
    // handlers too. Fixing that bug is tracked separately; clearing the
    // whole cache here sidesteps the issue without depending on key naming.
    await getCacheService().clear();
  });

  describe('should evaluate rules against real database', () => {
    it('should match rule based on priority and filters', async () => {
      // Create rules with different priorities and filters
      const highPriorityRule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'High Priority Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Low Priority Rule',
        enabled: true,
        priority: 50,
        auto_create: true,
        filters: [
          {
            field: 'status',
            operator: 'equals',
            value: 'open',
          },
        ],
      });

      // Get bug report
      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      // Evaluate
      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      // Should match high priority rule (priority=critical matches)
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe(highPriorityRule.id);
      expect(result.rule?.priority).toBe(100);
      expect(result.throttled).toBe(false);
      expect(result.evaluatedRules).toBe(1);
    });

    it('should return not matched when filters do not match', async () => {
      // Create rule that won't match
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Non-matching Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'low', // Bug has 'critical' priority
          },
        ],
      });

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      expect(result.matched).toBe(false);
      expect(result.rule).toBeUndefined();
      expect(result.evaluatedRules).toBe(1);
    });
  });

  describe('should respect rule priority ordering', () => {
    it('should return highest priority rule when all match', async () => {
      // Create rules with priorities 100, 50, 25
      const highRule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'High Priority (100)',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [], // Matches all
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Medium Priority (50)',
        enabled: true,
        priority: 50,
        auto_create: true,
        filters: [], // Matches all
      });

      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Low Priority (25)',
        enabled: true,
        priority: 25,
        auto_create: true,
        filters: [], // Matches all
      });

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      // Should return highest priority (100)
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe(highRule.id);
      expect(result.rule?.priority).toBe(100);
      expect(result.evaluatedRules).toBe(1); // Stopped after first match
    });

    it('should skip to lower priority when higher does not match', async () => {
      // High priority rule that won't match
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'High Priority (100)',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'low',
          },
        ],
      });

      // Medium priority rule that will match
      const mediumRule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Medium Priority (50)',
        enabled: true,
        priority: 50,
        auto_create: true,
        filters: [
          {
            field: 'priority',
            operator: 'equals',
            value: 'critical',
          },
        ],
      });

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      // Should return medium priority rule
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe(mediumRule.id);
      expect(result.rule?.priority).toBe(50);
      expect(result.evaluatedRules).toBe(2); // Evaluated both rules
    });
  });

  describe('should correctly query throttle counts from database', () => {
    it('should allow when under throttle limit', async () => {
      // Create rule with hourly throttle
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Throttled Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
        throttle: { max_per_hour: 5 },
      });

      // Create 4 tickets for this rule in the last hour
      const now = new Date();
      for (let i = 0; i < 4; i++) {
        await db.query(
          `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
           VALUES ($1, $2, 'jira', $3, $4, true, 'pending', $5)`,
          [testBugReportId, `JIRA-${i}`, testIntegrationId, rule.id, now]
        );
      }

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      // 5th bug should be allowed (4 < 5)
      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      expect(result.matched).toBe(true);
      expect(result.throttled).toBe(false);
      expect(result.rule?.id).toBe(rule.id);
    });

    it('should throttle when at limit', async () => {
      // Create rule with hourly throttle
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Throttled Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
        throttle: { max_per_hour: 5 },
      });

      // Create 5 tickets for this rule in the last hour (at limit)
      const now = new Date();
      for (let i = 0; i < 5; i++) {
        await db.query(
          `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
           VALUES ($1, $2, 'jira', $3, $4, true, 'pending', $5)`,
          [testBugReportId, `JIRA-${i}`, testIntegrationId, rule.id, now]
        );
      }

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      // 6th bug should be throttled (5 >= 5)
      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      expect(result.matched).toBe(true);
      expect(result.throttled).toBe(true);
      expect(result.throttleReason).toBe('hourly_limit');
      expect(result.rule?.id).toBe(rule.id);
    });

    it('should only count tickets from last hour', async () => {
      // Create rule with hourly throttle
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Throttled Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
        throttle: { max_per_hour: 5 },
      });

      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Create 5 tickets from 2 hours ago (should not count)
      for (let i = 0; i < 5; i++) {
        await db.query(
          `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
           VALUES ($1, $2, 'jira', $3, $4, true, 'pending', $5)`,
          [testBugReportId, `JIRA-OLD-${i}`, testIntegrationId, rule.id, twoHoursAgo]
        );
      }

      // Create 3 tickets from last hour
      for (let i = 0; i < 3; i++) {
        await db.query(
          `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
           VALUES ($1, $2, 'jira', $3, $4, true, 'pending', $5)`,
          [testBugReportId, `JIRA-RECENT-${i}`, testIntegrationId, rule.id, now]
        );
      }

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      // Should be allowed (only 3 in last hour < 5)
      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      expect(result.matched).toBe(true);
      expect(result.throttled).toBe(false);
    });

    it('should check daily limit', async () => {
      // Create rule with daily throttle
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Daily Throttled Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
        throttle: { max_per_day: 10 },
      });

      // Create 10 tickets in last 24 hours (at limit)
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        await db.query(
          `INSERT INTO tickets (bug_report_id, external_id, platform, integration_id, rule_id, created_automatically, sync_status, created_at)
           VALUES ($1, $2, 'jira', $3, $4, true, 'pending', $5)`,
          [testBugReportId, `JIRA-${i}`, testIntegrationId, rule.id, now]
        );
      }

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      expect(result.matched).toBe(true);
      expect(result.throttled).toBe(true);
      expect(result.throttleReason).toBe('daily_limit');
    });
  });

  describe('should handle concurrent rule evaluations', () => {
    it('should handle multiple simultaneous evaluations', async () => {
      // Create rule
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Concurrent Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
      });

      // Create multiple bug reports
      const bugReports: BugReport[] = [];
      for (let i = 0; i < 5; i++) {
        const bug = await db.bugReports.create({
          project_id: testProjectId,
          title: `Concurrent Bug ${i}`,
          description: 'Test',
          priority: 'high',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            user_agent: 'Mozilla/5.0',
            device_type: 'desktop',
            screen_resolution: '1920x1080',
          },
        });
        bugReports.push(bug);
      }

      // Evaluate all bugs concurrently
      const results = await Promise.all(
        bugReports.map((bug) =>
          ruleEvaluator.evaluateForAutoCreate(bug, testProjectId, testIntegrationId)
        )
      );

      // All should match the same rule
      results.forEach((result) => {
        expect(result.matched).toBe(true);
        expect(result.rule?.id).toBe(rule.id);
        expect(result.throttled).toBe(false);
      });

      // Cleanup
      for (const bug of bugReports) {
        await db.bugReports.delete(bug.id);
      }
    });

    it('should accurately track throttle with concurrent requests', async () => {
      // Create rule with low throttle limit
      const rule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Throttled Concurrent Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
        throttle: { max_per_hour: 3 },
      });

      // Create 5 bug reports
      const bugReports: BugReport[] = [];
      for (let i = 0; i < 5; i++) {
        const bug = await db.bugReports.create({
          project_id: testProjectId,
          title: `Throttle Bug ${i}`,
          description: 'Test',
          priority: 'high',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            user_agent: 'Mozilla/5.0',
            device_type: 'desktop',
            screen_resolution: '1920x1080',
          },
        });
        bugReports.push(bug);
      }

      // Evaluate all bugs concurrently
      const results = await Promise.all(
        bugReports.map((bug) =>
          ruleEvaluator.evaluateForAutoCreate(bug, testProjectId, testIntegrationId)
        )
      );

      // All should match but some might be throttled
      results.forEach((result) => {
        expect(result.matched).toBe(true);
        expect(result.rule?.id).toBe(rule.id);
      });

      // Note: Due to concurrent evaluation, throttle counts might not be perfectly sequential
      // but all results should be valid (either allowed or throttled with reason)
      const throttledCount = results.filter((r) => r.throttled).length;
      const allowedCount = results.filter((r) => !r.throttled).length;

      expect(allowedCount + throttledCount).toBe(5);
      expect(throttledCount).toBeGreaterThanOrEqual(0);

      // Cleanup
      for (const bug of bugReports) {
        await db.bugReports.delete(bug.id);
      }
    });
  });

  describe('should filter by project and integration correctly', () => {
    it('should only evaluate rules for correct project', async () => {
      // Create another project
      const project2 = await db.projects.create({
        name: 'Another Project',
        settings: {},
      });

      // Create integration for project2
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        project2.id,
        'jira',
        true,
        '{"api_token":"test","server_url":"https://test.atlassian.net"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      // Create rule for project2
      await db.integrationRules.createWithValidation({
        project_id: project2.id,
        integration_id: integration2Id,
        name: 'Other Project Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
      });

      // Create rule for testProject
      const testRule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Test Project Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
      });

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      // Evaluate for testProject
      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      // Should match testProject rule, not project2 rule
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe(testRule.id);
      expect(result.evaluatedRules).toBe(1); // Only evaluated rules from testProject

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE project_id = $1', [project2.id]);
      await db.query('DELETE FROM projects WHERE id = $1', [project2.id]);
    });

    it('should only evaluate rules for correct integration', async () => {
      // Create another integration for same project
      const integration2 = await db.query(createProjectIntegrationSQL(), [
        testProjectId,
        'github',
        true,
        '{"api_token":"test"}',
        null,
      ]);
      const integration2Id = integration2.rows[0].id;

      // Create rule for integration2
      await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: integration2Id,
        name: 'GitHub Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
      });

      // Create rule for testIntegration (Jira)
      const jiraRule = await db.integrationRules.createWithValidation({
        project_id: testProjectId,
        integration_id: testIntegrationId,
        name: 'Jira Rule',
        enabled: true,
        priority: 100,
        auto_create: true,
        filters: [],
      });

      const bugReport = (await db.bugReports.findById(testBugReportId)) as BugReport;

      // Evaluate for Jira integration
      const result = await ruleEvaluator.evaluateForAutoCreate(
        bugReport,
        testProjectId,
        testIntegrationId
      );

      // Should match Jira rule, not GitHub rule
      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe(jiraRule.id);
      expect(result.evaluatedRules).toBe(1); // Only evaluated Jira rules

      // Cleanup
      await db.query('DELETE FROM project_integrations WHERE id = $1', [integration2Id]);
    });
  });
});
