/**
 * RuleEvaluator Tests
 * Tests for integration rule evaluation service
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RuleEvaluator } from '../../src/services/integrations/rule-evaluator.js';
import type {
  IntegrationRuleRepository,
  IntegrationRule,
} from '../../src/db/integration-rule.repository.js';
import type { BugReport } from '../../src/db/types.js';
import { RuleMatcher } from '../../src/services/rule-matcher.js';
import { ThrottleChecker } from '../../src/services/integrations/throttle-checker.js';

// Mock cache service
vi.mock('../../src/cache/index.js', () => ({
  getCacheService: () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    getAutoCreateRules: vi.fn().mockImplementation(async (_projectId, _integrationId, fallback) => {
      return await fallback();
    }),
  }),
}));

describe('RuleEvaluator', () => {
  let ruleEvaluator: RuleEvaluator;
  let mockIntegrationRuleRepository: IntegrationRuleRepository;
  let mockThrottleChecker: ThrottleChecker;

  // Test fixtures
  const testBugReport: BugReport = {
    id: 'bug-123',
    project_id: 'project-123',
    title: 'Critical bug',
    description: 'App crashes on startup',
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
    screenshot_url: null,
    replay_url: null,
    screenshot_key: null,
    thumbnail_key: null,
    replay_key: null,
    upload_status: 'none',
    replay_upload_status: 'none',
    deleted_at: null,
    deleted_by: null,
    legal_hold: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const createMockRule = (overrides: Partial<IntegrationRule> = {}): IntegrationRule => ({
    id: 'rule-123',
    project_id: 'project-123',
    integration_id: 'integration-123',
    name: 'Auto-create Critical Bugs',
    enabled: true,
    priority: 100,
    filters: [],
    throttle: null,
    auto_create: true,
    field_mappings: null,
    description_template: null,
    attachment_config: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    // Restore all mocks to ensure test isolation
    vi.restoreAllMocks();

    // Spy on RuleMatcher for tests that want to mock it
    vi.spyOn(RuleMatcher, 'matchesFilters');

    // Create mock repositories and services
    mockIntegrationRuleRepository = {
      findAutoCreateRules: vi.fn(),
    } as any;

    mockThrottleChecker = {
      check: vi.fn(),
    } as any;

    ruleEvaluator = new RuleEvaluator(mockIntegrationRuleRepository, mockThrottleChecker);
  });

  describe('evaluateForAutoCreate', () => {
    it('should return not matched when no rules exist', async () => {
      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([]);

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(false);
      expect(result.rule).toBeUndefined();
      expect(result.throttled).toBeUndefined();
      expect(result.evaluatedRules).toBe(0);
    });

    it('should return matched when rule matches and not throttled', async () => {
      const mockRule = createMockRule();
      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        mockRule,
      ]);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 5,
        currentDaily: 20,
        limits: { hourly: 10, daily: 50 },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(true);
      expect(result.rule).toEqual(mockRule);
      expect(result.throttled).toBe(false);
      expect(result.evaluatedRules).toBe(1);
    });

    it('should return throttled when rule matches but throttled', async () => {
      const mockRule = createMockRule();
      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        mockRule,
      ]);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: false,
        reason: 'hourly_limit',
        currentHourly: 10,
        currentDaily: 30,
        limits: { hourly: 10, daily: 50 },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(true);
      expect(result.rule).toEqual(mockRule);
      expect(result.throttled).toBe(true);
      expect(result.throttleReason).toBe('hourly_limit');
      expect(result.evaluatedRules).toBe(1);
    });

    it('should skip rule when filters do not match', async () => {
      const mockRule = createMockRule({
        filters: [{ field: 'priority', operator: 'equals', value: 'low' }],
      });
      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        mockRule,
      ]);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(false);

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(false);
      expect(result.rule).toBeUndefined();
      expect(result.evaluatedRules).toBe(1);
      expect(mockThrottleChecker.check).not.toHaveBeenCalled();
    });

    it('should evaluate rules in priority order', async () => {
      const lowPriorityRule = createMockRule({ id: 'rule-1', priority: 10 });
      const highPriorityRule = createMockRule({ id: 'rule-2', priority: 100 });

      // Rules returned in priority DESC order (highest first)
      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        highPriorityRule,
        lowPriorityRule,
      ]);

      // First rule (high priority) doesn't match
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(false);
      // Second rule (low priority) matches
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 0,
        currentDaily: 0,
        limits: { hourly: null, daily: null },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe('rule-1'); // Low priority rule matched
      expect(result.evaluatedRules).toBe(2);
    });

    it('should return first matching rule', async () => {
      const rule1 = createMockRule({ id: 'rule-1', priority: 100 });
      const rule2 = createMockRule({ id: 'rule-2', priority: 50 });

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        rule1,
        rule2,
      ]);

      // First rule matches
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 0,
        currentDaily: 0,
        limits: { hourly: null, daily: null },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe('rule-1'); // First rule matched
      expect(result.evaluatedRules).toBe(1); // Stopped after first match
      expect(RuleMatcher.matchesFilters).toHaveBeenCalledTimes(1); // Only checked first rule
    });

    it('should pass bug report and filters to RuleMatcher', async () => {
      const filters = [
        { field: 'priority' as const, operator: 'equals' as const, value: 'critical' },
      ];
      const mockRule = createMockRule({ filters });

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        mockRule,
      ]);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 0,
        currentDaily: 0,
        limits: { hourly: null, daily: null },
      });

      await ruleEvaluator.evaluateForAutoCreate(testBugReport, 'project-123', 'integration-123');

      expect(RuleMatcher.matchesFilters).toHaveBeenCalledWith(testBugReport, filters, {
        ruleId: mockRule.id,
        ruleName: mockRule.name,
      });
    });

    it('should pass rule id and throttle config to ThrottleChecker', async () => {
      const throttleConfig = { max_per_hour: 10, max_per_day: 50 };
      const mockRule = createMockRule({ id: 'rule-xyz', throttle: throttleConfig });

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        mockRule,
      ]);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 5,
        currentDaily: 20,
        limits: { hourly: 10, daily: 50 },
      });

      await ruleEvaluator.evaluateForAutoCreate(testBugReport, 'project-123', 'integration-123');

      expect(mockThrottleChecker.check).toHaveBeenCalledWith('rule-xyz', throttleConfig);
    });

    it('should include daily_limit throttle reason', async () => {
      const mockRule = createMockRule();
      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        mockRule,
      ]);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: false,
        reason: 'daily_limit',
        currentHourly: 5,
        currentDaily: 50,
        limits: { hourly: 10, daily: 50 },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.throttled).toBe(true);
      expect(result.throttleReason).toBe('daily_limit');
    });

    it('should handle multiple rules with mixed matches', async () => {
      const rule1 = createMockRule({ id: 'rule-1', priority: 100 });
      const rule2 = createMockRule({ id: 'rule-2', priority: 80 });
      const rule3 = createMockRule({ id: 'rule-3', priority: 60 });

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        rule1,
        rule2,
        rule3,
      ]);

      // Rule 1: doesn't match
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(false);
      // Rule 2: doesn't match
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(false);
      // Rule 3: matches
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 0,
        currentDaily: 0,
        limits: { hourly: null, daily: null },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(true);
      expect(result.rule?.id).toBe('rule-3');
      expect(result.evaluatedRules).toBe(3);
    });

    it('should count all evaluated rules when none match', async () => {
      const rules = [
        createMockRule({ id: 'rule-1', priority: 100 }),
        createMockRule({ id: 'rule-2', priority: 80 }),
        createMockRule({ id: 'rule-3', priority: 60 }),
      ];

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce(rules);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValue(false); // All fail

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(false);
      expect(result.evaluatedRules).toBe(3);
    });

    it('should handle error by returning not matched', async () => {
      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(false);
      expect(result.evaluatedRules).toBe(0);
    });

    it('should handle RuleMatcher error by continuing to next rule', async () => {
      const rule1 = createMockRule({ id: 'rule-1', priority: 100 });
      const rule2 = createMockRule({ id: 'rule-2', priority: 80 });

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        rule1,
        rule2,
      ]);

      // First rule throws error
      vi.mocked(RuleMatcher.matchesFilters).mockImplementationOnce(() => {
        throw new Error('Invalid regex');
      });
      // Second rule matches
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 0,
        currentDaily: 0,
        limits: { hourly: null, daily: null },
      });

      // Should handle error gracefully
      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      // Error in evaluation should cause it to return not matched
      expect(result.matched).toBe(false);
    });

    it('should handle empty filters as match all', async () => {
      const mockRule = createMockRule({ filters: [] });

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        mockRule,
      ]);
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true); // Empty filters = match all
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: true,
        currentHourly: 0,
        currentDaily: 0,
        limits: { hourly: null, daily: null },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(true);
      expect(RuleMatcher.matchesFilters).toHaveBeenCalledWith(testBugReport, [], {
        ruleId: mockRule.id,
        ruleName: mockRule.name,
      });
    });

    it('should stop evaluating after first throttled match', async () => {
      const rule1 = createMockRule({ id: 'rule-1', priority: 100 });
      const rule2 = createMockRule({ id: 'rule-2', priority: 80 });

      vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
        rule1,
        rule2,
      ]);

      // First rule matches but is throttled
      vi.mocked(RuleMatcher.matchesFilters).mockReturnValueOnce(true);
      vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
        allowed: false,
        reason: 'hourly_limit',
        currentHourly: 10,
        currentDaily: 30,
        limits: { hourly: 10, daily: 50 },
      });

      const result = await ruleEvaluator.evaluateForAutoCreate(
        testBugReport,
        'project-123',
        'integration-123'
      );

      expect(result.matched).toBe(true);
      expect(result.throttled).toBe(true);
      expect(result.rule?.id).toBe('rule-1');
      expect(result.evaluatedRules).toBe(1); // Stopped after throttled match
      expect(RuleMatcher.matchesFilters).toHaveBeenCalledTimes(1); // Didn't evaluate rule2
    });

    describe('Console Log Filters', () => {
      it('should match bug with console_level filter', async () => {
        const bugWithConsole: BugReport = {
          id: 'bug-123',
          project_id: 'project-123',
          title: 'Critical bug',
          description: 'App crashes on startup',
          priority: 'critical',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            console: [{ level: 'error', message: 'NetworkError', timestamp: 1700000000000 }],
            network: [],
          },
          screenshot_url: null,
          replay_url: null,
          screenshot_key: null,
          thumbnail_key: null,
          replay_key: null,
          upload_status: 'none',
          replay_upload_status: 'none',
          deleted_at: null,
          deleted_by: null,
          legal_hold: false,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const mockRule = createMockRule({
          filters: [{ field: 'console_level', operator: 'equals', value: 'error' }],
        });

        vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
          mockRule,
        ]);
        vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
          allowed: true,
          currentHourly: 0,
          currentDaily: 0,
          limits: { hourly: null, daily: null },
        });

        const result = await ruleEvaluator.evaluateForAutoCreate(
          bugWithConsole,
          'project-123',
          'integration-123'
        );

        expect(result.matched).toBe(true);
        expect(result.rule).toEqual(mockRule);
      });

      it('should match bug with console_message filter', async () => {
        const bugWithConsole: BugReport = {
          id: 'bug-123',
          project_id: 'project-123',
          title: 'Critical bug',
          description: 'App crashes on startup',
          priority: 'critical',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            console: [
              {
                level: 'error',
                message: 'TypeError: Cannot read property',
                timestamp: 1700000000000,
              },
            ],
            network: [],
          },
          screenshot_url: null,
          replay_url: null,
          screenshot_key: null,
          thumbnail_key: null,
          replay_key: null,
          upload_status: 'none',
          replay_upload_status: 'none',
          deleted_at: null,
          deleted_by: null,
          legal_hold: false,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const mockRule = createMockRule({
          filters: [{ field: 'console_message', operator: 'contains', value: 'TypeError' }],
        });

        vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
          mockRule,
        ]);
        vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
          allowed: true,
          currentHourly: 0,
          currentDaily: 0,
          limits: { hourly: null, daily: null },
        });

        const result = await ruleEvaluator.evaluateForAutoCreate(
          bugWithConsole,
          'project-123',
          'integration-123'
        );

        expect(result.matched).toBe(true);
        expect(result.rule).toEqual(mockRule);
      });

      it('should not match when console filter does not match', async () => {
        const bugWithConsole: BugReport = {
          id: 'bug-123',
          project_id: 'project-123',
          title: 'Critical bug',
          description: 'App crashes on startup',
          priority: 'critical',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            console: [{ level: 'info', message: 'User logged in', timestamp: 1700000000000 }],
            network: [],
          },
          screenshot_url: null,
          replay_url: null,
          screenshot_key: null,
          thumbnail_key: null,
          replay_key: null,
          upload_status: 'none',
          replay_upload_status: 'none',
          deleted_at: null,
          deleted_by: null,
          legal_hold: false,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const mockRule = createMockRule({
          filters: [{ field: 'console_level', operator: 'equals', value: 'error' }],
        });

        vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
          mockRule,
        ]);

        const result = await ruleEvaluator.evaluateForAutoCreate(
          bugWithConsole,
          'project-123',
          'integration-123'
        );

        expect(result.matched).toBe(false);
      });
    });

    describe('Network Request Filters', () => {
      it('should match bug with network_status filter', async () => {
        const bugWithNetwork: BugReport = {
          id: 'bug-123',
          project_id: 'project-123',
          title: 'Critical bug',
          description: 'App crashes on startup',
          priority: 'critical',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            console: [],
            network: [
              {
                url: 'https://api.example.com/payment',
                method: 'POST',
                status: 500,
                statusText: 'Internal Server Error',
                duration: 1500,
                timestamp: 1700000000000,
              },
            ],
          },
          screenshot_url: null,
          replay_url: null,
          screenshot_key: null,
          thumbnail_key: null,
          replay_key: null,
          upload_status: 'none',
          replay_upload_status: 'none',
          deleted_at: null,
          deleted_by: null,
          legal_hold: false,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const mockRule = createMockRule({
          filters: [{ field: 'network_status', operator: 'equals', value: '500' }],
        });

        vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
          mockRule,
        ]);
        vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
          allowed: true,
          currentHourly: 0,
          currentDaily: 0,
          limits: { hourly: null, daily: null },
        });

        const result = await ruleEvaluator.evaluateForAutoCreate(
          bugWithNetwork,
          'project-123',
          'integration-123'
        );

        expect(result.matched).toBe(true);
        expect(result.rule).toEqual(mockRule);
      });

      it('should match bug with network_url filter', async () => {
        const bugWithNetwork: BugReport = {
          id: 'bug-123',
          project_id: 'project-123',
          title: 'Critical bug',
          description: 'App crashes on startup',
          priority: 'critical',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            console: [],
            network: [
              {
                url: 'https://api.example.com/auth/login',
                method: 'POST',
                status: 401,
                statusText: 'Unauthorized',
                duration: 100,
                timestamp: 1700000000000,
              },
            ],
          },
          screenshot_url: null,
          replay_url: null,
          screenshot_key: null,
          thumbnail_key: null,
          replay_key: null,
          upload_status: 'none',
          replay_upload_status: 'none',
          deleted_at: null,
          deleted_by: null,
          legal_hold: false,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const mockRule = createMockRule({
          filters: [{ field: 'network_url', operator: 'contains', value: '/auth' }],
        });

        vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
          mockRule,
        ]);
        vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
          allowed: true,
          currentHourly: 0,
          currentDaily: 0,
          limits: { hourly: null, daily: null },
        });

        const result = await ruleEvaluator.evaluateForAutoCreate(
          bugWithNetwork,
          'project-123',
          'integration-123'
        );

        expect(result.matched).toBe(true);
        expect(result.rule).toEqual(mockRule);
      });

      it('should combine console and network filters', async () => {
        const bugWithBoth: BugReport = {
          id: 'bug-123',
          project_id: 'project-123',
          title: 'Critical bug',
          description: 'App crashes on startup',
          priority: 'critical',
          status: 'open',
          metadata: {
            browser: 'Chrome',
            os: 'Windows',
            url: 'https://example.com',
            console: [{ level: 'error', message: 'API call failed', timestamp: 1700000000000 }],
            network: [
              {
                url: 'https://api.example.com/payment',
                method: 'POST',
                status: 500,
                statusText: 'Internal Server Error',
                duration: 1500,
                timestamp: 1700000001000,
              },
            ],
          },
          screenshot_url: null,
          replay_url: null,
          screenshot_key: null,
          thumbnail_key: null,
          replay_key: null,
          upload_status: 'none',
          replay_upload_status: 'none',
          deleted_at: null,
          deleted_by: null,
          legal_hold: false,
          created_at: new Date(),
          updated_at: new Date(),
        };

        const mockRule = createMockRule({
          filters: [
            { field: 'console_level', operator: 'equals', value: 'error' },
            { field: 'network_status', operator: 'in', value: ['500', '502', '503'] },
            { field: 'priority', operator: 'equals', value: 'critical' },
          ],
        });

        vi.mocked(mockIntegrationRuleRepository.findAutoCreateRules).mockResolvedValueOnce([
          mockRule,
        ]);
        vi.mocked(mockThrottleChecker.check).mockResolvedValueOnce({
          allowed: true,
          currentHourly: 0,
          currentDaily: 0,
          limits: { hourly: null, daily: null },
        });

        const result = await ruleEvaluator.evaluateForAutoCreate(
          bugWithBoth,
          'project-123',
          'integration-123'
        );

        expect(result.matched).toBe(true);
        expect(result.rule).toEqual(mockRule);
      });
    });
  });
});
