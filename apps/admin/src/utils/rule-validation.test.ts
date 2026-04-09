import { describe, expect, it } from 'vitest';
import { VALIDATION_MESSAGES, validateRuleForm, type RuleFormValues } from './rule-validation';
import type { ThrottleConfig } from '../types';

describe('rule-validation', () => {
  describe('validateRuleForm', () => {
    const validFormData: RuleFormValues = {
      name: 'Test Rule',
      enabled: true,
      priority: 5,
      autoCreate: false,
      filters: [
        {
          field: 'priority',
          operator: 'equals',
          value: 'high',
        },
      ],
      throttle: null,
      fieldMappings: {},
      descriptionTemplate: '',
    };

    it('should return null for valid form data', () => {
      const error = validateRuleForm(validFormData);
      expect(error).toBeNull();
    });

    it('should return error when name is empty', () => {
      const formData = { ...validFormData, name: '' };
      const error = validateRuleForm(formData);
      expect(error).toBe(VALIDATION_MESSAGES.NAME_REQUIRED);
    });

    it('should return error when name is only whitespace', () => {
      const formData = { ...validFormData, name: '   ' };
      const error = validateRuleForm(formData);
      expect(error).toBe(VALIDATION_MESSAGES.NAME_REQUIRED);
    });

    it('should return error when name exceeds max length', () => {
      const formData = { ...validFormData, name: 'a'.repeat(256) };
      const error = validateRuleForm(formData);
      expect(error).toBe(VALIDATION_MESSAGES.NAME_TOO_LONG);
    });

    it('should allow name at exactly max length', () => {
      const formData = { ...validFormData, name: 'a'.repeat(255) };
      const error = validateRuleForm(formData);
      expect(error).toBeNull();
    });

    it('should return error when priority is negative', () => {
      const formData = { ...validFormData, priority: -1 };
      const error = validateRuleForm(formData);
      expect(error).toBe(VALIDATION_MESSAGES.PRIORITY_INVALID);
    });

    it('should allow priority of 0', () => {
      const formData = { ...validFormData, priority: 0 };
      const error = validateRuleForm(formData);
      expect(error).toBeNull();
    });

    it('should allow priority of 100', () => {
      const formData = { ...validFormData, priority: 100 };
      const error = validateRuleForm(formData);
      expect(error).toBeNull();
    });

    describe('filter validation', () => {
      it('should return error when filter value is empty', () => {
        const formData = {
          ...validFormData,
          filters: [{ field: 'priority' as const, operator: 'equals' as const, value: '' }],
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.EMPTY_FILTERS);
      });

      it('should return error when filter value is only whitespace', () => {
        const formData = {
          ...validFormData,
          filters: [{ field: 'priority' as const, operator: 'equals' as const, value: '   ' }],
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.EMPTY_FILTERS);
      });

      it('should return error when filter has empty array value', () => {
        const formData = {
          ...validFormData,
          filters: [{ field: 'browser' as const, operator: 'in' as const, value: [] }],
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.EMPTY_FILTERS);
      });

      it('should return error when filter array has all empty string values', () => {
        const formData = {
          ...validFormData,
          filters: [{ field: 'browser' as const, operator: 'in' as const, value: ['', '  '] }],
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.EMPTY_FILTERS);
      });

      it('should allow multiple valid filters', () => {
        const formData = {
          ...validFormData,
          filters: [
            { field: 'priority' as const, operator: 'equals' as const, value: 'high' },
            { field: 'browser' as const, operator: 'contains' as const, value: 'Chrome' },
          ],
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should allow empty filters array', () => {
        const formData = { ...validFormData, filters: [] };
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should allow array values with at least one non-empty string', () => {
        const formData = {
          ...validFormData,
          filters: [
            { field: 'browser' as const, operator: 'in' as const, value: ['Chrome', 'Firefox'] },
          ],
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });
    });

    describe('throttle config validation', () => {
      it('should return error when throttle has neither max_per_hour nor max_per_day', () => {
        const formData = {
          ...validFormData,
          throttle: { group_by: 'url' } as unknown as ThrottleConfig,
        };
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.THROTTLE_REQUIRED);
      });

      it('should return error when throttle max_per_hour is 0', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_hour: 0, group_by: 'url' as const },
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.THROTTLE_HOUR_INVALID);
      });

      it('should return error when throttle max_per_hour is negative', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_hour: -1, group_by: 'url' as const },
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.THROTTLE_HOUR_INVALID);
      });

      it('should return error when throttle max_per_day is 0', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_day: 0, group_by: 'url' as const },
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.THROTTLE_DAY_INVALID);
      });

      it('should return error when throttle max_per_day is negative', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_day: -1, group_by: 'url' as const },
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.THROTTLE_DAY_INVALID);
      });

      it('should return error when throttle digest_interval_minutes is 0', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_hour: 10, digest_interval_minutes: 0 },
        };
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.THROTTLE_INTERVAL_INVALID);
      });

      it('should return error when throttle digest_interval_minutes is negative', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_hour: 10, digest_interval_minutes: -5 },
        };
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.THROTTLE_INTERVAL_INVALID);
      });

      it('should allow valid throttle config with both limits', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_hour: 10, max_per_day: 100, group_by: 'url' as const },
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should allow null throttle config', () => {
        const formData = { ...validFormData, throttle: null };
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should allow throttle with max_per_hour only', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_hour: 10, group_by: 'url' as const },
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should allow throttle with max_per_day only', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_day: 100, group_by: 'url' as const },
        } as RuleFormValues;
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should allow throttle with digest_interval_minutes', () => {
        const formData = {
          ...validFormData,
          throttle: { max_per_hour: 10, digest_interval_minutes: 60 },
        };
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });
    });

    describe('edge cases', () => {
      it('should handle form with all optional fields null', () => {
        const formData: RuleFormValues = {
          name: 'Test',
          enabled: true,
          priority: 0,
          autoCreate: false,
          filters: [],
          throttle: null,
          fieldMappings: null,
          descriptionTemplate: null,
        };
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should trim name before validation', () => {
        const formData = { ...validFormData, name: '  Test Rule  ' };
        const error = validateRuleForm(formData);
        expect(error).toBeNull();
      });

      it('should return first validation error when multiple issues exist', () => {
        const formData = {
          ...validFormData,
          name: '', // First error
          priority: -1, // Second error
        };
        const error = validateRuleForm(formData);
        expect(error).toBe(VALIDATION_MESSAGES.NAME_REQUIRED);
      });
    });
  });

  describe('VALIDATION_MESSAGES', () => {
    it('should have all expected message keys', () => {
      expect(VALIDATION_MESSAGES.NAME_REQUIRED).toBeDefined();
      expect(VALIDATION_MESSAGES.NAME_TOO_LONG).toBeDefined();
      expect(VALIDATION_MESSAGES.PRIORITY_INVALID).toBeDefined();
      expect(VALIDATION_MESSAGES.EMPTY_FILTERS).toBeDefined();
      expect(VALIDATION_MESSAGES.THROTTLE_REQUIRED).toBeDefined();
      expect(VALIDATION_MESSAGES.THROTTLE_HOUR_INVALID).toBeDefined();
      expect(VALIDATION_MESSAGES.THROTTLE_DAY_INVALID).toBeDefined();
      expect(VALIDATION_MESSAGES.THROTTLE_INTERVAL_INVALID).toBeDefined();
    });

    it('should have user-friendly error messages', () => {
      expect(VALIDATION_MESSAGES.NAME_REQUIRED).toContain('required');
      expect(VALIDATION_MESSAGES.NAME_TOO_LONG).toContain('255');
      expect(VALIDATION_MESSAGES.PRIORITY_INVALID).toContain('0');
      expect(VALIDATION_MESSAGES.THROTTLE_HOUR_INVALID).toContain('hour');
      expect(VALIDATION_MESSAGES.THROTTLE_DAY_INVALID).toContain('day');
      expect(VALIDATION_MESSAGES.THROTTLE_INTERVAL_INVALID).toContain('minutes');
    });
  });
});
