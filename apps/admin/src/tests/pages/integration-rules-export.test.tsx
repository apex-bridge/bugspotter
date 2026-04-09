import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { exportRuleAsJson, copyRuleAsJson } from '../../lib/export-utils';
import type { IntegrationRule } from '../../types';

describe('Integration Rules - Export JSON', () => {
  let createObjectURLSpy: Mock;
  let revokeObjectURLSpy: Mock;
  let capturedAnchor: HTMLAnchorElement | null = null;

  beforeEach(() => {
    capturedAnchor = null;

    // Only mock URL methods (let DOM methods work natively)
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url') as Mock;
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}) as Mock;

    // Spy on createElement to capture anchor element
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        capturedAnchor = element as HTMLAnchorElement;
      }
      return element;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockRule: IntegrationRule = {
    id: 'rule-1',
    project_id: 'project-1',
    integration_id: 'integration-1',
    name: 'Test Rule',
    enabled: true,
    priority: 5,
    auto_create: true,
    filters: [
      {
        field: 'priority',
        operator: 'equals',
        value: 'critical',
        case_sensitive: false,
      },
    ],
    throttle: {
      max_per_hour: 10,
      max_per_day: 100,
      group_by: 'user',
      digest_mode: false,
      digest_interval_minutes: 30,
    },
    field_mappings: null,
    description_template: null,
    attachment_config: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  };

  it('should export rule as JSON with correct structure', () => {
    exportRuleAsJson(mockRule);

    // Verify Blob was created with correct type
    expect(createObjectURLSpy).toHaveBeenCalled();
    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobCall).toBeInstanceOf(Blob);
    expect(blobCall.type).toBe('application/json');
  });

  it('should exclude internal fields from export', () => {
    exportRuleAsJson(mockRule);

    // Get the Blob content
    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    const reader = new FileReader();

    return new Promise<void>((resolve) => {
      reader.onload = () => {
        const result = reader.result as string;
        const exportedData = JSON.parse(result);

        // Should include these fields
        expect(exportedData).toHaveProperty('name', 'Test Rule');
        expect(exportedData).toHaveProperty('enabled', true);
        expect(exportedData).toHaveProperty('priority', 5);
        expect(exportedData).toHaveProperty('filters');
        expect(exportedData).toHaveProperty('auto_create', true);
        expect(exportedData).toHaveProperty('throttle');

        // Should include configurable fields (even if null)
        expect(exportedData).toHaveProperty('field_mappings');
        expect(exportedData).toHaveProperty('description_template');
        expect(exportedData).toHaveProperty('attachment_config');

        // Should NOT include these internal fields
        expect(exportedData).not.toHaveProperty('id');
        expect(exportedData).not.toHaveProperty('project_id');
        expect(exportedData).not.toHaveProperty('integration_id');
        expect(exportedData).not.toHaveProperty('created_at');
        expect(exportedData).not.toHaveProperty('updated_at');

        resolve();
      };

      reader.readAsText(blobCall);
    });
  });

  it('should sanitize filename by replacing special characters', () => {
    const ruleWithSpecialChars = {
      ...mockRule,
      name: 'Test Rule / With * Special: Characters?',
    };

    exportRuleAsJson(ruleWithSpecialChars);

    // Verify filename was sanitized correctly (special chars replaced, timestamp appended)
    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.download).toMatch(/^Test_Rule___With___Special__Characters_-\d+\.json$/);
  });

  it('should create download link with correct properties', () => {
    exportRuleAsJson(mockRule);

    // Verify Blob URL was created and anchor element properties are correct
    expect(createObjectURLSpy).toHaveBeenCalled();
    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobCall).toBeInstanceOf(Blob);

    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.href).toBe('blob:mock-url');
    expect(capturedAnchor?.download).toMatch(/^Test_Rule-\d+\.json$/);
  });

  it('should trigger download and cleanup', () => {
    exportRuleAsJson(mockRule);

    // Verify object URL was created and revoked (cleanup)
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });

  it('should export filters correctly', () => {
    const ruleWithMultipleFilters: IntegrationRule = {
      ...mockRule,
      filters: [
        {
          field: 'status' as const,
          operator: 'in' as const,
          value: ['open', 'in_progress'],
          case_sensitive: false,
        },
        {
          field: 'error_message' as const,
          operator: 'contains' as const,
          value: 'error',
          case_sensitive: true,
        },
      ],
    };

    exportRuleAsJson(ruleWithMultipleFilters);

    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    const reader = new FileReader();

    return new Promise<void>((resolve) => {
      reader.onload = () => {
        const result = reader.result as string;
        const exportedData = JSON.parse(result);

        expect(exportedData.filters).toHaveLength(2);
        expect(exportedData.filters[0]).toEqual({
          field: 'status',
          operator: 'in',
          value: ['open', 'in_progress'],
          case_sensitive: false,
        });
        expect(exportedData.filters[1]).toEqual({
          field: 'error_message',
          operator: 'contains',
          value: 'error',
          case_sensitive: true,
        });

        resolve();
      };

      reader.readAsText(blobCall);
    });
  });

  it('should export throttle settings correctly', () => {
    exportRuleAsJson(mockRule);

    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    const reader = new FileReader();

    return new Promise<void>((resolve) => {
      reader.onload = () => {
        const result = reader.result as string;
        const exportedData = JSON.parse(result);

        expect(exportedData.throttle).toEqual({
          max_per_hour: 10,
          max_per_day: 100,
          group_by: 'user',
          digest_mode: false,
          digest_interval_minutes: 30,
        });

        resolve();
      };

      reader.readAsText(blobCall);
    });
  });

  it('should handle rule without throttle', () => {
    const ruleWithoutThrottle = {
      ...mockRule,
      throttle: null,
    };

    exportRuleAsJson(ruleWithoutThrottle);

    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    const reader = new FileReader();

    return new Promise<void>((resolve) => {
      reader.onload = () => {
        const result = reader.result as string;
        const exportedData = JSON.parse(result);

        expect(exportedData.throttle).toBeNull();

        resolve();
      };

      reader.readAsText(blobCall);
    });
  });

  it('should format JSON with proper indentation', () => {
    exportRuleAsJson(mockRule);

    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    const reader = new FileReader();

    return new Promise<void>((resolve) => {
      reader.onload = () => {
        const result = reader.result as string;

        // Check for proper indentation (2 spaces)
        expect(result).toContain('{\n  "name"');
        expect(result).toContain('  "enabled"');
        expect(result).toContain('  "filters"');

        resolve();
      };

      reader.readAsText(blobCall);
    });
  });

  it('should create valid JSON that can be parsed', () => {
    exportRuleAsJson(mockRule);

    const blobCall = createObjectURLSpy.mock.calls[0][0] as Blob;
    const reader = new FileReader();

    return new Promise<void>((resolve) => {
      reader.onload = () => {
        const result = reader.result as string;

        // Should not throw when parsing
        expect(() => JSON.parse(result)).not.toThrow();

        const parsed = JSON.parse(result);
        expect(parsed).toBeTypeOf('object');

        resolve();
      };

      reader.readAsText(blobCall);
    });
  });
});

describe('Integration Rules - Copy JSON to Clipboard', () => {
  let writeTextSpy: Mock;

  beforeEach(() => {
    // Mock clipboard API using vi.stubGlobal
    writeTextSpy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: writeTextSpy,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockRule: IntegrationRule = {
    id: 'rule-1',
    project_id: 'project-1',
    integration_id: 'integration-1',
    name: 'Test Rule',
    enabled: true,
    priority: 5,
    auto_create: true,
    filters: [
      {
        field: 'priority',
        operator: 'equals',
        value: 'critical',
        case_sensitive: false,
      },
    ],
    throttle: {
      max_per_hour: 10,
      max_per_day: 100,
      group_by: 'user',
      digest_mode: false,
      digest_interval_minutes: 30,
    },
    field_mappings: null,
    description_template: null,
    attachment_config: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
  };

  it('should copy rule as JSON to clipboard', async () => {
    await copyRuleAsJson(mockRule);

    expect(writeTextSpy).toHaveBeenCalledOnce();
    const copiedText = writeTextSpy.mock.calls[0][0] as string;

    // Verify it's valid JSON
    const parsed = JSON.parse(copiedText);
    expect(parsed).toHaveProperty('name', 'Test Rule');
    expect(parsed).toHaveProperty('enabled', true);
  });

  it('should exclude internal fields from clipboard JSON', async () => {
    await copyRuleAsJson(mockRule);

    const copiedText = writeTextSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(copiedText);

    // Should NOT include internal fields
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('project_id');
    expect(parsed).not.toHaveProperty('integration_id');
    expect(parsed).not.toHaveProperty('created_at');
    expect(parsed).not.toHaveProperty('updated_at');
  });

  it('should include configurable fields in clipboard JSON', async () => {
    await copyRuleAsJson(mockRule);

    const copiedText = writeTextSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(copiedText);

    // Should include configurable fields (even if null)
    expect(parsed).toHaveProperty('field_mappings');
    expect(parsed).toHaveProperty('description_template');
    expect(parsed).toHaveProperty('attachment_config');
  });

  it('should format clipboard JSON with proper indentation', async () => {
    await copyRuleAsJson(mockRule);

    const copiedText = writeTextSpy.mock.calls[0][0] as string;

    // Check for proper indentation (2 spaces)
    expect(copiedText).toContain('{\n  "name"');
    expect(copiedText).toContain('  "enabled"');
    expect(copiedText).toContain('  "filters"');
  });

  it('should handle clipboard write errors', async () => {
    writeTextSpy.mockRejectedValueOnce(new Error('Clipboard access denied'));

    await expect(copyRuleAsJson(mockRule)).rejects.toThrow('Clipboard access denied');
  });
});
