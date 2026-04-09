/**
 * Generic HTTP Integration Mapper
 * Maps bug reports to external API requests using configurable field mappings
 */

import type { BugReport } from '../../db/types.js';
import type { FieldMapping, EndpointConfig } from './types.js';
import { getLogger } from '../../logger.js';

const logger = getLogger();

/**
 * Generic HTTP Mapper
 * Transforms bug reports to external API format using field mappings
 */
export class GenericHttpMapper {
  private fieldMappings: FieldMapping[];

  constructor(fieldMappings: FieldMapping[]) {
    this.fieldMappings = fieldMappings;
  }

  /**
   * Map bug report to external API payload
   */
  mapBugReport(bugReport: BugReport): Record<string, unknown> {
    const payload: Record<string, unknown> = {};

    for (const mapping of this.fieldMappings) {
      const value = this.extractValue(bugReport, mapping.bugReportField);
      const transformedValue = this.applyTransform(value, mapping);
      const finalValue = transformedValue ?? mapping.defaultValue;

      if (finalValue !== undefined) {
        this.setNestedValue(payload, mapping.externalField, finalValue);
      }
    }

    logger.debug('Mapped bug report to external payload', {
      bugReportId: bugReport.id,
      mappingsApplied: this.fieldMappings.length,
    });

    return payload;
  }

  /**
   * Apply template to string (replaces {{variables}})
   */
  applyTemplate(template: string, variables: Record<string, unknown>): string {
    let result = template;

    // Replace all {{variable}} patterns, including dotted paths
    result = result.replace(/{{\s*([\w.]+)\s*}}/g, (_match, key) => {
      // Check if key exists as-is (for flattened keys like "bug.title")
      let value: unknown;
      if (key in variables) {
        value = variables[key];
      } else {
        // Try nested lookup for actual nested objects
        value = this.getNestedValue(variables, key);
      }

      // Handle different value types appropriately
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    });

    return result;
  }

  /**
   * Apply body template with bug report data
   */
  applyBodyTemplate(
    endpoint: EndpointConfig,
    bugReport: BugReport,
    mappedData: Record<string, unknown>
  ): Record<string, unknown> | string {
    if (!endpoint.bodyTemplate) {
      return mappedData;
    }

    // Build template variables from bug report and mapped data
    const variables: Record<string, unknown> = {
      ...this.flattenObject(bugReport as any, 'bug'),
      ...this.flattenObject(mappedData, 'data'),
    };

    const body = this.applyTemplate(endpoint.bodyTemplate, variables);

    // Try to parse as JSON, fallback to string
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  /**
   * Extract ID from response using JSON path
   */
  extractId(response: Record<string, unknown>, idField: string): string {
    const value = this.getNestedValue(response, idField);

    if (value === null || value === undefined) {
      throw new Error(`Failed to extract ID from response: field '${idField}' not found`);
    }

    return String(value);
  }

  /**
   * Build URL from response or template
   */
  buildUrl(
    response: Record<string, unknown>,
    baseUrl: string,
    responseMapping?: EndpointConfig['responseMapping']
  ): string {
    if (!responseMapping) {
      throw new Error('Response mapping configuration required to build URL');
    }

    // Try extracting URL from response first
    if (responseMapping.urlField) {
      const url = this.getNestedValue(response, responseMapping.urlField);
      if (url) {
        return String(url);
      }
    }

    // Fallback to URL template
    if (responseMapping.urlTemplate) {
      const variables: Record<string, unknown> = {
        baseUrl,
        ...this.flattenObject(response, ''),
      };
      return this.applyTemplate(responseMapping.urlTemplate, variables);
    }

    throw new Error('Unable to determine URL from response');
  }

  /**
   * Extract value from bug report using field path
   */
  private extractValue(bugReport: BugReport, fieldPath: string): unknown {
    return this.getNestedValue(bugReport as any, fieldPath);
  }

  /**
   * Get nested value using dot notation (e.g., 'user.name')
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: any = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Set nested value using dot notation
   */
  private setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current: any = obj;

    for (const key of keys) {
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    current[lastKey] = value;
  }

  /**
   * Apply transformation to value
   */
  private applyTransform(value: unknown, mapping: FieldMapping): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    const strValue = String(value);

    switch (mapping.transform) {
      case 'uppercase':
        return strValue.toUpperCase();
      case 'lowercase':
        return strValue.toLowerCase();
      case 'trim':
        return strValue.trim();
      case 'json_stringify':
        return JSON.stringify(value);
      default:
        return value;
    }
  }

  /**
   * Flatten nested object to dot notation
   */
  private flattenObject(
    obj: Record<string, unknown>,
    prefix: string = ''
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenObject(value as Record<string, unknown>, newKey));
      } else {
        result[newKey] = value;
      }
    }

    return result;
  }
}
