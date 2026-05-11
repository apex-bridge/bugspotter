/**
 * Linear Plugin Tests
 *
 * Verifies the plugin definition (metadata, factory) and the
 * route-facing `validateConfig` entry point. The expensive part of
 * validation — `viewer()` and `teams()` calls — is mocked at the client
 * level so the test runs hermetically.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/integrations/linear/client.js', () => ({
  LinearClient: vi.fn().mockImplementation(() => ({
    viewer: vi.fn().mockResolvedValue({
      id: 'viewer-id',
      name: 'Test Viewer',
      email: 'viewer@example.com',
      organization: { id: 'org-1', name: 'Test Org', urlKey: 'test' },
    }),
    teams: vi.fn().mockResolvedValue([{ id: 'team-uuid', key: 'ENG', name: 'Engineering' }]),
  })),
}));

import { linearPlugin } from '../../../src/integrations/linear/plugin.js';
import { LINEAR_DEFAULT_DESCRIPTION_TEMPLATE } from '../../../src/integrations/linear/default-template.js';
import type { PluginContext } from '../../../src/integrations/plugin.types.js';

describe('linearPlugin', () => {
  let mockContext: PluginContext;

  beforeEach(() => {
    mockContext = {
      db: {
        bugReports: {},
        projectIntegrations: {},
        tickets: {},
      } as never,
      storage: {} as never,
    } as PluginContext;
  });

  describe('metadata', () => {
    it('has correct metadata', () => {
      expect(linearPlugin.metadata).toEqual({
        name: 'Linear Integration',
        platform: 'linear',
        version: '1.0.0',
        description: 'Create and sync issues with Linear',
        author: 'BugSpotter Team',
        requiredEnvVars: ['ENCRYPTION_KEY'],
        isBuiltIn: true,
        defaultDescriptionTemplate: LINEAR_DEFAULT_DESCRIPTION_TEMPLATE,
      });
    });

    it('declares ENCRYPTION_KEY env requirement', () => {
      expect(linearPlugin.metadata.requiredEnvVars).toContain('ENCRYPTION_KEY');
    });

    it('ships a Markdown default description template', () => {
      // Markdown sanity check — make sure we didn't accidentally ship ADF.
      const tpl = linearPlugin.metadata.defaultDescriptionTemplate ?? '';
      expect(tpl).toContain('## {{title}}');
      expect(tpl).not.toContain('"type":"doc"'); // ADF marker
    });
  });

  describe('factory', () => {
    it('creates LinearIntegrationService instance', () => {
      const service = linearPlugin.factory(mockContext);

      expect(service).toBeDefined();
      expect(service.platform).toBe('linear');
      expect(service.createFromBugReport).toBeDefined();
      expect(service.testConnection).toBeDefined();
      expect(service.validateConfig).toBeDefined();
    });

    it('exposes listProjects and searchUsers (optional methods)', () => {
      const service = linearPlugin.factory(mockContext);
      expect(service.listProjects).toBeDefined();
      expect(service.searchUsers).toBeDefined();
      expect(service.getAllowedAvatarDomains).toBeDefined();
    });
  });

  describe('lifecycle', () => {
    it('does not declare lifecycle hooks', () => {
      // Plugin loading should be synchronous; lifecycle hooks would add
      // async startup latency. Linear doesn't need any.
      expect('lifecycle' in linearPlugin).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('returns valid:true for a well-formed config', async () => {
      const service = linearPlugin.factory(mockContext);
      const result = await service.validateConfig({
        apiKey: 'lin_api_xxx',
        teamId: 'team-uuid',
        teamKey: 'ENG',
      });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts apiKey nested under authentication.token (wizard shape)', async () => {
      const service = linearPlugin.factory(mockContext);
      const result = await service.validateConfig({
        authentication: { type: 'apiKey', token: 'lin_api_xxx' },
        teamId: 'team-uuid',
        teamKey: 'ENG',
      });
      expect(result.valid).toBe(true);
    });

    it('fails on missing apiKey', async () => {
      const service = linearPlugin.factory(mockContext);
      const result = await service.validateConfig({
        teamId: 'team-uuid',
        teamKey: 'ENG',
      });
      expect(result.valid).toBe(false);
      expect(result.error?.toLowerCase()).toContain('api key');
    });

    it('fails on missing teamId', async () => {
      const service = linearPlugin.factory(mockContext);
      const result = await service.validateConfig({
        apiKey: 'lin_api_xxx',
        teamKey: 'ENG',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('teamId');
    });

    it('fails when team is not reachable for this key', async () => {
      const service = linearPlugin.factory(mockContext);
      const result = await service.validateConfig({
        apiKey: 'lin_api_xxx',
        teamId: 'wrong-team-uuid',
        teamKey: 'WRONG',
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not found|access/i);
    });
  });
});
