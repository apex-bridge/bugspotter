/**
 * Field Mappings Transformation Tests
 * Tests the bidirectional conversion between UI string format and API object format
 */

import { describe, it, expect } from 'vitest';
import {
  transformFieldMappingsForApi,
  transformFieldMappingsForUI,
} from '../../utils/field-mappings';

describe('Field Mappings Transformation', () => {
  describe('transformFieldMappingsForUI (Backend → UI)', () => {
    it('should return null when input is null', () => {
      expect(transformFieldMappingsForUI(null)).toBeNull();
    });

    it('should stringify objects to JSON', () => {
      const input = {
        assignee: { accountId: 'acc-123' },
        priority: { name: 'High' },
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        assignee: '{"accountId":"acc-123"}',
        priority: '{"name":"High"}',
      });
    });

    it('should keep string values as-is', () => {
      const input = {
        customfield_10001: 'Sprint 23',
        customfield_10002: 'Plain text value',
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        customfield_10001: 'Sprint 23',
        customfield_10002: 'Plain text value',
      });
    });

    it('should stringify arrays to JSON', () => {
      const input = {
        components: [{ name: 'Frontend' }, { id: '10001' }],
        labels: ['bug', 'urgent'],
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        components: '[{"name":"Frontend"},{"id":"10001"}]',
        labels: '["bug","urgent"]',
      });
    });

    it('should convert numbers to strings', () => {
      const input = {
        customfield_10001: 42,
        customfield_10002: 0,
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        customfield_10001: '42',
        customfield_10002: '0',
      });
    });

    it('should convert booleans to strings', () => {
      const input = {
        customfield_10001: true,
        customfield_10002: false,
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        customfield_10001: 'true',
        customfield_10002: 'false',
      });
    });

    it('should preserve null values', () => {
      const input = {
        assignee: { accountId: 'acc-123' },
        priority: null,
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        assignee: '{"accountId":"acc-123"}',
        priority: null,
      });
    });

    it('should preserve undefined values', () => {
      const input = {
        assignee: { accountId: 'acc-123' },
        priority: undefined,
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        assignee: '{"accountId":"acc-123"}',
        priority: undefined,
      });
    });

    it('should handle mixed types', () => {
      const input = {
        assignee: { accountId: 'acc-123' },
        customfield_10001: 'Sprint 23',
        customfield_10002: 42,
        archived: false,
      };

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({
        assignee: '{"accountId":"acc-123"}',
        customfield_10001: 'Sprint 23',
        customfield_10002: '42',
        archived: 'false',
      });
    });

    it('should handle empty object', () => {
      const input = {};

      const result = transformFieldMappingsForUI(input);

      expect(result).toEqual({});
    });
  });

  describe('transformFieldMappingsForApi (UI → Backend)', () => {
    it('should return null when input is null', () => {
      expect(transformFieldMappingsForApi(null)).toBeNull();
    });

    it('should parse JSON strings to objects', () => {
      const input = {
        assignee: '{"accountId":"acc-123"}',
        priority: '{"name":"High"}',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        assignee: { accountId: 'acc-123' },
        priority: { name: 'High' },
      });
    });

    it('should keep plain text values as strings', () => {
      const input = {
        customfield_10001: 'Sprint 23',
        customfield_10002: 'Plain text value',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        customfield_10001: 'Sprint 23',
        customfield_10002: 'Plain text value',
      });
    });

    it('should handle arrays in JSON strings', () => {
      const input = {
        components: '[{"name":"Frontend"},{"id":"10001"}]',
        labels: '["bug","urgent"]',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        components: [{ name: 'Frontend' }, { id: '10001' }],
        labels: ['bug', 'urgent'],
      });
    });

    it('should allow empty strings (to clear field values)', () => {
      const input = {
        customfield_10001: '',
        description: '',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        customfield_10001: '',
        description: '',
      });
    });

    it('should skip null values', () => {
      const input = {
        assignee: '{"accountId":"acc-123"}',
        priority: null as unknown as string,
        labels: '["bug"]',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        assignee: { accountId: 'acc-123' },
        labels: ['bug'],
      });
      expect(result).not.toHaveProperty('priority');
    });

    it('should skip undefined values', () => {
      const input = {
        assignee: '{"accountId":"acc-123"}',
        priority: undefined as unknown as string,
        labels: '["bug"]',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        assignee: { accountId: 'acc-123' },
        labels: ['bug'],
      });
      expect(result).not.toHaveProperty('priority');
    });

    it('should handle mixed JSON and plain text values', () => {
      const input = {
        assignee: '{"accountId":"acc-123"}',
        customfield_10001: 'Sprint 23',
        components: '[{"name":"Backend"}]',
        customfield_10002: 'Plain text',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        assignee: { accountId: 'acc-123' },
        customfield_10001: 'Sprint 23',
        components: [{ name: 'Backend' }],
        customfield_10002: 'Plain text',
      });
    });

    it('should handle malformed JSON gracefully', () => {
      const input = {
        assignee: '{"accountId":"acc-123"', // Missing closing brace
        customfield_10001: 'Valid plain text',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        assignee: '{"accountId":"acc-123"', // Kept as string
        customfield_10001: 'Valid plain text',
      });
    });

    it('should handle numeric string values', () => {
      const input = {
        customfield_10001: '42',
        customfield_10002: '0',
      };

      const result = transformFieldMappingsForApi(input);

      // JSON.parse converts numeric strings to numbers
      expect(result).toEqual({
        customfield_10001: 42,
        customfield_10002: 0,
      });
    });

    it('should handle boolean string values', () => {
      const input = {
        customfield_10001: 'true',
        customfield_10002: 'false',
      };

      const result = transformFieldMappingsForApi(input);

      // JSON.parse converts boolean strings to booleans
      expect(result).toEqual({
        customfield_10001: true,
        customfield_10002: false,
      });
    });

    it('should handle complex nested JSON objects', () => {
      const input = {
        customfield_10001: '{"nested":{"deep":{"value":"test"}}}',
        customfield_10002: '{"array":[1,2,3],"bool":true}',
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        customfield_10001: { nested: { deep: { value: 'test' } } },
        customfield_10002: { array: [1, 2, 3], bool: true },
      });
    });

    it('should preserve falsy values after JSON.parse', () => {
      const input = {
        customfield_bool: 'false', // JSON string "false"
        customfield_number: '0', // JSON string "0"
        customfield_string: '""', // JSON string '""' (empty string as JSON)
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        customfield_bool: false,
        customfield_number: 0,
        customfield_string: '',
      });
    });

    it('should handle empty object', () => {
      const input = {};

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({});
    });

    it('should handle all falsy values correctly (critical regression test)', () => {
      const input = {
        field_false: 'false', // Boolean false as JSON
        field_zero: '0', // Number 0 as JSON
        field_empty_string: '', // Direct empty string
        field_null: null as unknown as string, // null (should be skipped)
        field_undefined: undefined as unknown as string, // undefined (should be skipped)
        field_truthy: '{"value":"present"}', // Truthy value
      };

      const result = transformFieldMappingsForApi(input);

      expect(result).toEqual({
        field_false: false, // Preserved
        field_zero: 0, // Preserved
        field_empty_string: '', // Preserved
        // field_null omitted
        // field_undefined omitted
        field_truthy: { value: 'present' },
      });

      // Explicitly verify null/undefined are not present
      expect(result).not.toHaveProperty('field_null');
      expect(result).not.toHaveProperty('field_undefined');
    });
  });

  describe('Round-trip Transformation (Backend → UI → Backend)', () => {
    it('should preserve complex objects through round-trip', () => {
      const original = {
        assignee: { accountId: 'acc-123', displayName: 'John Doe' },
        priority: { name: 'High', id: '3' },
        components: [{ name: 'Frontend' }, { name: 'Backend' }],
      };

      const toUI = transformFieldMappingsForUI(original);
      const backToApi = transformFieldMappingsForApi(toUI!);

      expect(backToApi).toEqual(original);
    });

    it('should preserve plain strings through round-trip', () => {
      const original = {
        customfield_10001: 'Sprint 23',
        customfield_10002: 'Some plain text',
        description: 'Bug description',
      };

      const toUI = transformFieldMappingsForUI(original);
      const backToApi = transformFieldMappingsForApi(toUI!);

      expect(backToApi).toEqual(original);
    });

    it('should preserve mixed types through round-trip', () => {
      const original = {
        assignee: { accountId: 'acc-123' },
        customfield_10001: 'Sprint 23',
        labels: ['bug', 'urgent'],
        priority: { name: 'High' },
      };

      const toUI = transformFieldMappingsForUI(original);
      const backToApi = transformFieldMappingsForApi(toUI!);

      expect(backToApi).toEqual(original);
    });

    it('should handle empty strings correctly in round-trip', () => {
      const original = {
        description: '',
        customfield_10001: '',
      };

      const toUI = transformFieldMappingsForUI(original);
      const backToApi = transformFieldMappingsForApi(toUI!);

      expect(backToApi).toEqual(original);
    });

    it('should handle numbers and booleans through round-trip', () => {
      const original = {
        customfield_10001: 42,
        customfield_10002: 0,
        archived: true,
        enabled: false,
      };

      const toUI = transformFieldMappingsForUI(original);
      const backToApi = transformFieldMappingsForApi(toUI!);

      // Note: Numbers and booleans will be converted through JSON parsing
      expect(backToApi).toEqual(original);
    });

    it('should handle null values in round-trip', () => {
      const original = {
        assignee: { accountId: 'acc-123' },
        priority: null,
      };

      const toUI = transformFieldMappingsForUI(original);
      // null values are preserved in UI
      expect(toUI).toHaveProperty('priority', null);

      // But are omitted in API format
      const backToApi = transformFieldMappingsForApi(toUI!);
      expect(backToApi).toEqual({
        assignee: { accountId: 'acc-123' },
      });
      expect(backToApi).not.toHaveProperty('priority');
    });

    it('should simulate actual user workflow: load → edit → save', () => {
      // 1. Backend returns JSONB objects
      const backendData = {
        assignee: { accountId: 'acc-123' },
        priority: { name: 'High' },
        customfield_10001: 'Sprint 23',
      };

      // 2. Transform for UI display (rule editing form)
      const uiData = transformFieldMappingsForUI(backendData);

      expect(uiData).toEqual({
        assignee: '{"accountId":"acc-123"}',
        priority: '{"name":"High"}',
        customfield_10001: 'Sprint 23',
      });

      // 3. User edits a field (simulated)
      const editedUiData = {
        ...uiData,
        customfield_10001: 'Sprint 24', // User changed sprint
      };

      // 4. Transform back to API format for saving
      const apiData = transformFieldMappingsForApi(editedUiData);

      expect(apiData).toEqual({
        assignee: { accountId: 'acc-123' },
        priority: { name: 'High' },
        customfield_10001: 'Sprint 24',
      });
    });

    it('should handle complex nested structures in round-trip', () => {
      const original = {
        customfield_10001: {
          nested: {
            deep: {
              value: 'test',
              array: [1, 2, 3],
            },
          },
        },
        customfield_10002: {
          mixed: ['a', 1, true, { key: 'value' }],
        },
      };

      const toUI = transformFieldMappingsForUI(original);
      const backToApi = transformFieldMappingsForApi(toUI!);

      expect(backToApi).toEqual(original);
    });
  });
});
