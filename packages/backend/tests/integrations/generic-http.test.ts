/**
 * Generic HTTP Integration Service Tests
 * Tests the configurable HTTP integration with field mappings and templates
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GenericHttpMapper } from '../../src/integrations/generic-http/mapper.js';
import type { BugReport } from '../../src/db/types.js';
import type { FieldMapping, EndpointConfig } from '../../src/integrations/generic-http/types.js';

describe('GenericHttpMapper', () => {
  const mockBugReport: BugReport = {
    id: 'bug-123',
    project_id: 'proj-456',
    title: 'Test Bug',
    description: 'This is a test bug description',
    steps: ['Step 1', 'Step 2'],
    expected_behavior: 'Should work',
    actual_behavior: 'Does not work',
    severity: 'high',
    status: 'open',
    user_email: 'test@example.com',
    user_name: 'Test User',
    screenshot_url: 'https://example.com/screenshot.png',
    replay_url: null,
    browser: 'Chrome',
    browser_version: '120.0',
    os: 'Windows',
    os_version: '11',
    viewport_width: 1920,
    viewport_height: 1080,
    url: 'https://example.com/page',
    console_errors: null,
    network_errors: null,
    user_metadata: { custom: 'data' },
    external_id: null,
    external_url: null,
    created_at: new Date('2025-01-01T00:00:00Z'),
    updated_at: new Date('2025-01-01T00:00:00Z'),
  } as any;

  describe('Field Mapping', () => {
    it('should map simple fields', () => {
      const mappings: FieldMapping[] = [
        { bugReportField: 'title', externalField: 'summary' },
        { bugReportField: 'description', externalField: 'body' },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        summary: 'Test Bug',
        body: 'This is a test bug description',
      });
    });

    it('should map nested fields', () => {
      const mappings: FieldMapping[] = [
        { bugReportField: 'title', externalField: 'issue.title' },
        { bugReportField: 'severity', externalField: 'issue.priority' },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        issue: {
          title: 'Test Bug',
          priority: 'high',
        },
      });
    });

    it('should apply transformations', () => {
      const mappings: FieldMapping[] = [
        { bugReportField: 'title', externalField: 'title_upper', transform: 'uppercase' },
        { bugReportField: 'severity', externalField: 'severity_lower', transform: 'lowercase' },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        title_upper: 'TEST BUG',
        severity_lower: 'high',
      });
    });

    it('should use default values when field is missing', () => {
      const mappings: FieldMapping[] = [
        { bugReportField: 'nonexistent', externalField: 'field', defaultValue: 'default' },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        field: 'default',
      });
    });

    it('should skip fields without default when value is undefined', () => {
      const mappings: FieldMapping[] = [
        { bugReportField: 'title', externalField: 'title' },
        { bugReportField: 'nonexistent', externalField: 'missing' },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        title: 'Test Bug',
      });
      expect(result).not.toHaveProperty('missing');
    });
  });

  describe('Template Application', () => {
    it('should apply simple templates', () => {
      const mapper = new GenericHttpMapper([]);
      const template = 'Hello {{name}}!';
      const variables = { name: 'World' };

      const result = mapper.applyTemplate(template, variables);

      expect(result).toBe('Hello World!');
    });

    it('should handle multiple variables', () => {
      const mapper = new GenericHttpMapper([]);
      const template = '{{firstName}} {{lastName}} <{{email}}>';
      const variables = { firstName: 'John', lastName: 'Doe', email: 'john@example.com' };

      const result = mapper.applyTemplate(template, variables);

      expect(result).toBe('John Doe <john@example.com>');
    });

    it('should handle missing variables', () => {
      const mapper = new GenericHttpMapper([]);
      const template = 'Hello {{name}}!';
      const variables = {};

      const result = mapper.applyTemplate(template, variables);

      expect(result).toBe('Hello !');
    });

    it('should handle nested/dotted path variables', () => {
      const mapper = new GenericHttpMapper([]);
      const template = 'Bug: {{bug.title}} - Status: {{bug.status}}';
      const variables = {
        bug: {
          title: 'Test Bug',
          status: 'open',
        },
      };

      const result = mapper.applyTemplate(template, variables);

      expect(result).toBe('Bug: Test Bug - Status: open');
    });

    it('should handle object values with JSON.stringify', () => {
      const mapper = new GenericHttpMapper([]);
      const template = 'Metadata: {{metadata}}';
      const variables = {
        metadata: { key: 'value', count: 42 },
      };

      const result = mapper.applyTemplate(template, variables);

      expect(result).toBe('Metadata: {"key":"value","count":42}');
    });

    it('should apply body template with bug report data', () => {
      const mapper = new GenericHttpMapper([]);
      const endpoint: EndpointConfig = {
        path: '/issues',
        method: 'POST',
        bodyTemplate: '{"title": "{{bug.title}}", "description": "{{bug.description}}"}',
      };

      const mappedData = { priority: 'high' };
      const result = mapper.applyBodyTemplate(endpoint, mockBugReport, mappedData);

      expect(result).toEqual({
        title: 'Test Bug',
        description: 'This is a test bug description',
      });
    });
  });

  describe('Response Processing', () => {
    it('should extract ID from simple field', () => {
      const mapper = new GenericHttpMapper([]);
      const response = { id: 123, name: 'Test' };

      const id = mapper.extractId(response, 'id');

      expect(id).toBe('123');
    });

    it('should extract ID from nested field', () => {
      const mapper = new GenericHttpMapper([]);
      const response = { data: { issue: { id: 456 } } };

      const id = mapper.extractId(response, 'data.issue.id');

      expect(id).toBe('456');
    });

    it('should throw error when ID field not found', () => {
      const mapper = new GenericHttpMapper([]);
      const response = { name: 'Test' };

      expect(() => mapper.extractId(response, 'id')).toThrow(/not found/);
    });

    it('should build URL from response field', () => {
      const mapper = new GenericHttpMapper([]);
      const response = { html_url: 'https://example.com/issue/123' };
      const responseMapping: EndpointConfig['responseMapping'] = {
        idField: 'id',
        urlField: 'html_url',
      };

      const url = mapper.buildUrl(response, 'https://example.com', responseMapping);

      expect(url).toBe('https://example.com/issue/123');
    });

    it('should build URL from template', () => {
      const mapper = new GenericHttpMapper([]);
      const response = { id: 123, key: 'BUG-456' };
      const responseMapping: EndpointConfig['responseMapping'] = {
        idField: 'id',
        urlTemplate: '{{baseUrl}}/browse/{{key}}',
      };

      const url = mapper.buildUrl(response, 'https://jira.example.com', responseMapping);

      expect(url).toBe('https://jira.example.com/browse/BUG-456');
    });

    it('should prefer URL field over template', () => {
      const mapper = new GenericHttpMapper([]);
      const response = { html_url: 'https://direct.url', id: 123 };
      const responseMapping: EndpointConfig['responseMapping'] = {
        idField: 'id',
        urlField: 'html_url',
        urlTemplate: '{{baseUrl}}/issues/{{id}}',
      };

      const url = mapper.buildUrl(response, 'https://example.com', responseMapping);

      expect(url).toBe('https://direct.url');
    });
  });

  describe('Complex Field Mappings', () => {
    it('should handle JSON stringify transform', () => {
      const mappings: FieldMapping[] = [
        {
          bugReportField: 'steps',
          externalField: 'steps_json',
          transform: 'json_stringify',
        },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        steps_json: JSON.stringify(['Step 1', 'Step 2']),
      });
    });

    it('should handle multiple levels of nesting', () => {
      const mappings: FieldMapping[] = [
        { bugReportField: 'title', externalField: 'issue.fields.summary' },
        { bugReportField: 'severity', externalField: 'issue.fields.priority.name' },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        issue: {
          fields: {
            summary: 'Test Bug',
            priority: {
              name: 'high',
            },
          },
        },
      });
    });

    it('should create complete Jira-like payload', () => {
      const mappings: FieldMapping[] = [
        { bugReportField: 'title', externalField: 'fields.summary' },
        { bugReportField: 'description', externalField: 'fields.description' },
        { bugReportField: 'severity', externalField: 'fields.priority.name' },
        { bugReportField: 'browser', externalField: 'fields.environment' },
      ];

      const mapper = new GenericHttpMapper(mappings);
      const result = mapper.mapBugReport(mockBugReport);

      expect(result).toEqual({
        fields: {
          summary: 'Test Bug',
          description: 'This is a test bug description',
          priority: {
            name: 'high',
          },
          environment: 'Chrome',
        },
      });
    });
  });
});
