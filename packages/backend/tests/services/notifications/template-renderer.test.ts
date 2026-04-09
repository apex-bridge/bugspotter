/**
 * Unit tests for Template Renderer
 * Tests template rendering, context building, and variable replacement
 */

import { describe, it, expect } from 'vitest';
import { ValidationError } from '../../../src/api/middleware/error.js';
import {
  buildTemplateContext,
  renderTemplate,
} from '../../../src/services/notifications/template-renderer.js';

describe('Template Renderer', () => {
  describe('renderTemplate', () => {
    describe('Input Validation', () => {
      it('should throw ValidationError when template.body is missing', () => {
        const template = { subject: 'Test' };
        const context = createMockContext();

        expect(() => renderTemplate(template, context)).toThrow(ValidationError);
        expect(() => renderTemplate(template, context)).toThrow(
          'Template body is required and must be a string'
        );
      });

      it('should throw ValidationError when template.body is null', () => {
        const template = { body: null, subject: 'Test' };
        const context = createMockContext();

        expect(() => renderTemplate(template, context)).toThrow(ValidationError);
      });

      it('should throw ValidationError when template.body is not a string', () => {
        const template = { body: 123, subject: 'Test' };
        const context = createMockContext();

        expect(() => renderTemplate(template as any, context)).toThrow(ValidationError);
      });

      it('should throw ValidationError when template.body is empty string', () => {
        const template = { body: '', subject: 'Test' };
        const context = createMockContext();

        expect(() => renderTemplate(template, context)).toThrow(ValidationError);
      });

      it('should use empty string for subject when missing', () => {
        const template = { body: 'Test body' };
        const context = createMockContext();

        const result = renderTemplate(template, context);

        expect(result.subject).toBe('');
      });
    });

    describe('Recipient Handling', () => {
      it('should use bug user email as recipient', () => {
        const template = { body: 'Test' };
        const context = createMockContext({ userEmail: 'user@example.com' });

        const result = renderTemplate(template, context);

        expect(result.to).toBe('user@example.com');
      });

      it('should throw ValidationError when no recipients found', () => {
        const template = { body: 'Test' };
        const context = createMockContext({ userEmail: null });

        expect(() => renderTemplate(template, context)).toThrow(ValidationError);
        expect(() => renderTemplate(template, context)).toThrow('No valid recipients found');
      });

      it('should include error details when no recipients found', () => {
        const template = { body: 'Test' };
        const context = createMockContext({ userEmail: null });

        try {
          renderTemplate(template, context);
          expect.fail('Should have thrown ValidationError');
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          const validationError = error as ValidationError;
          expect(validationError.details).toMatchObject({
            hasContext: true,
            contextEmail: undefined, // null becomes undefined in the context
            templateRecipients: undefined,
          });
        }
      });

      it('should support single template recipient', () => {
        const template = { body: 'Test', recipients: 'admin@example.com' };
        const context = createMockContext({ userEmail: null });

        const result = renderTemplate(template, context);

        expect(result.to).toBe('admin@example.com');
      });

      it('should support multiple template recipients', () => {
        const template = { body: 'Test', recipients: ['admin@example.com', 'support@example.com'] };
        const context = createMockContext({ userEmail: null });

        const result = renderTemplate(template, context);

        expect(result.to).toEqual(['admin@example.com', 'support@example.com']);
      });

      it('should combine bug user and template recipients', () => {
        const template = { body: 'Test', recipients: ['admin@example.com'] };
        const context = createMockContext({ userEmail: 'user@example.com' });

        const result = renderTemplate(template, context);

        expect(result.to).toEqual(['user@example.com', 'admin@example.com']);
      });

      it('should filter out non-string template recipients', () => {
        const template = {
          body: 'Test',
          recipients: ['valid@example.com', 123, null, 'another@example.com'],
        };
        const context = createMockContext({ userEmail: null });

        const result = renderTemplate(template as any, context);

        expect(result.to).toEqual(['valid@example.com', 'another@example.com']);
      });

      it('should return single string when only one recipient', () => {
        const template = { body: 'Test', recipients: ['admin@example.com'] };
        const context = createMockContext({ userEmail: null });

        const result = renderTemplate(template, context);

        expect(result.to).toBe('admin@example.com');
      });

      it('should return array when multiple recipients', () => {
        const template = { body: 'Test', recipients: ['admin@example.com', 'support@example.com'] };
        const context = createMockContext({ userEmail: null });

        const result = renderTemplate(template, context);

        expect(Array.isArray(result.to)).toBe(true);
        expect(result.to).toHaveLength(2);
      });
    });

    describe('Variable Replacement', () => {
      it('should replace simple variables', () => {
        const template = {
          body: 'Bug: {{bug.title}}',
          subject: 'New Bug in {{project.name}}',
        };
        const context = createMockContext({ bugTitle: 'Test Bug', projectName: 'My Project' });

        const result = renderTemplate(template, context);

        expect(result.body).toBe('Bug: Test Bug');
        expect(result.subject).toBe('New Bug in My Project');
      });

      it('should replace nested variables', () => {
        const template = { body: 'User: {{bug.user.email}}' };
        const context = createMockContext({ userEmail: 'user@example.com' });

        const result = renderTemplate(template, context);

        expect(result.body).toBe('User: user@example.com');
      });

      it('should preserve placeholder for undefined variables', () => {
        const template = { body: 'Stack: {{bug.stack_trace}}' };
        const context = createMockContext({ stackTrace: undefined });

        const result = renderTemplate(template, context);

        expect(result.body).toBe('Stack: {{bug.stack_trace}}');
      });

      it('should preserve placeholder for null variables', () => {
        const template = { body: 'Stack: {{bug.stack_trace}}' };
        const context = createMockContext({ stackTrace: null });

        const result = renderTemplate(template, context);

        expect(result.body).toBe('Stack: {{bug.stack_trace}}');
      });

      it('should handle multiple variables in one template', () => {
        const template = {
          body: 'Bug {{bug.id}}: {{bug.title}} in {{project.name}} ({{bug.priority}})',
        };
        const context = createMockContext({
          bugId: 'bug-123',
          bugTitle: 'Critical Issue',
          projectName: 'App',
          priority: 'critical',
        });

        const result = renderTemplate(template, context);

        expect(result.body).toBe('Bug bug-123: Critical Issue in App (critical)');
      });

      it('should replace object variables with JSON', () => {
        const template = { body: 'User: {{bug.user}}' };
        const context = createMockContext({ userEmail: 'user@example.com' });

        const result = renderTemplate(template, context);

        expect(result.body).toContain('"email":"user@example.com"');
      });

      it('should preserve placeholder for circular reference objects', () => {
        const circular: any = { name: 'test' };
        circular.self = circular;

        const template = { body: 'Data: {{circular}}' };
        const context: any = createMockContext();
        context.circular = circular;

        const result = renderTemplate(template, context);

        expect(result.body).toBe('Data: {{circular}}');
      });
    });
  });

  describe('buildTemplateContext', () => {
    it('should build context with all required fields', () => {
      const bug = {
        id: 'bug-123',
        title: 'Test Bug',
        error_message: 'Error occurred',
        priority: 'high',
        status: 'open',
        browser: 'Chrome',
        os: 'Windows',
        url: 'https://example.com',
        user_email: 'user@example.com',
        user_name: 'John Doe',
        session_id: 'session-456',
      };
      const project = {
        id: 'project-789',
        name: 'My Project',
      };

      const context = buildTemplateContext(bug, project);

      expect(context.bug!.id).toBe('bug-123');
      expect(context.bug!.title).toBe('Test Bug');
      expect(context.bug!.message).toBe('Error occurred');
      expect(context.bug!.priority).toBe('high');
      expect(context.bug!.status).toBe('open');
      expect(context.bug!.browser).toBe('Chrome');
      expect(context.bug!.os).toBe('Windows');
      expect(context.bug!.url).toBe('https://example.com');
      expect(context.bug!.user.email).toBe('user@example.com');
      expect(context.bug!.user.name).toBe('John Doe');
      expect(context.project.id).toBe('project-789');
      expect(context.project.name).toBe('My Project');
      expect(context.link.bugDetail).toContain('bug-123');
      expect(context.link.replay).toContain('session-456');
    });

    it('should use defaults for missing bug fields', () => {
      const bug = { id: 'bug-123' };
      const project = { id: 'project-789' };

      const context = buildTemplateContext(bug, project);

      expect(context.bug!.title).toBe('Untitled Bug');
      expect(context.bug!.message).toBe('');
      expect(context.bug!.priority).toBe('medium');
      expect(context.bug!.status).toBe('open');
      expect(context.bug!.browser).toBe('Unknown');
      expect(context.bug!.os).toBe('Unknown');
      expect(context.bug!.url).toBe('');
      expect(context.bug!.user.email).toBeUndefined();
      expect(context.bug!.user.name).toBeUndefined();
    });

    it('should use error_message as title when title is missing', () => {
      const bug = { id: 'bug-123', error_message: 'TypeError: Cannot read property' };
      const project = { id: 'project-789' };

      const context = buildTemplateContext(bug, project);

      expect(context.bug!.title).toBe('TypeError: Cannot read property');
    });

    it('should truncate long error_message when used as title', () => {
      const longError = 'a'.repeat(150);
      const bug = { id: 'bug-123', error_message: longError };
      const project = { id: 'project-789' };

      const context = buildTemplateContext(bug, project);

      expect(context.bug!.title).toHaveLength(100);
    });

    it('should set priority color correctly', () => {
      const priorities = [
        { priority: 'critical', color: '#dc3545' },
        { priority: 'high', color: '#fd7e14' },
        { priority: 'medium', color: '#ffc107' },
        { priority: 'low', color: '#28a745' },
        { priority: 'unknown', color: '#6c757d' },
      ];

      priorities.forEach(({ priority, color }) => {
        const bug = { id: 'bug-123', priority };
        const project = { id: 'project-789' };

        const context = buildTemplateContext(bug, project);

        expect(context.bug!.priorityColor).toBe(color);
      });
    });

    it('should not include replay link when session_id is missing', () => {
      const bug = { id: 'bug-123' };
      const project = { id: 'project-789' };

      const context = buildTemplateContext(bug, project);

      expect(context.link.replay).toBeUndefined();
    });

    it('should use ADMIN_URL env var for links', () => {
      const originalEnv = process.env.ADMIN_URL;
      process.env.ADMIN_URL = 'https://admin.example.com';

      const bug = { id: 'bug-123' };
      const project = { id: 'project-789' };

      const context = buildTemplateContext(bug, project);

      expect(context.link.bugDetail).toBe('https://admin.example.com/bugs/bug-123');

      process.env.ADMIN_URL = originalEnv;
    });

    it('should include timestamp and timezone', () => {
      const bug = { id: 'bug-123' };
      const project = { id: 'project-789' };

      const context = buildTemplateContext(bug, project);

      expect(context.timestamp).toBeDefined();
      expect(context.timezone).toBe('UTC');
    });
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface MockContextOptions {
  bugId?: string;
  bugTitle?: string;
  projectName?: string;
  userEmail?: string | null;
  priority?: string;
  stackTrace?: string | null | undefined;
}

function createMockContext(options: MockContextOptions = {}): any {
  const userEmail = options.userEmail !== undefined ? options.userEmail : 'test@example.com';

  return {
    bug: {
      id: options.bugId || 'bug-123',
      title: options.bugTitle || 'Test Bug',
      message: 'Error message',
      priority: options.priority || 'medium',
      priorityColor: '#ffc107',
      status: 'open',
      browser: 'Chrome',
      os: 'Windows',
      url: 'https://example.com',
      user: {
        email: userEmail || undefined,
        name: 'Test User',
      },
      stack_trace: options.stackTrace,
    },
    project: {
      id: 'project-789',
      name: options.projectName || 'Test Project',
    },
    link: {
      bugDetail: 'http://localhost:3001/bugs/bug-123',
      replay: undefined,
    },
    timestamp: new Date().toLocaleString(),
    timezone: 'UTC',
  };
}
