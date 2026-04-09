/**
 * Jira Client Constructor Validation Tests
 * Tests configuration validation and security checks during client initialization
 */

import { describe, it, expect } from 'vitest';
import { JiraClient } from '../../src/integrations/jira/client.js';

describe('JiraClient Constructor', () => {
  const validConfig = {
    host: 'https://example.atlassian.net',
    email: 'test@example.com',
    apiToken: 'test-token-123',
    projectKey: 'TEST',
    enabled: true,
  };

  describe('Configuration Validation', () => {
    it('should accept valid HTTPS configuration', () => {
      expect(() => new JiraClient(validConfig)).not.toThrow();
    });

    it('should reject missing host', () => {
      const config = { ...validConfig, host: '' };
      expect(() => new JiraClient(config)).toThrow(
        'Jira configuration incomplete: host, email, and apiToken are required'
      );
    });

    it('should reject missing email', () => {
      const config = { ...validConfig, email: '' };
      expect(() => new JiraClient(config)).toThrow(
        'Jira configuration incomplete: host, email, and apiToken are required'
      );
    });

    it('should reject missing apiToken', () => {
      const config = { ...validConfig, apiToken: '' };
      expect(() => new JiraClient(config)).toThrow(
        'Jira configuration incomplete: host, email, and apiToken are required'
      );
    });

    it('should remove trailing slash from host', () => {
      const config = { ...validConfig, host: 'https://example.atlassian.net/' };
      const client = new JiraClient(config);
      // Verify via getIssueUrl (which uses this.host)
      expect(client.getIssueUrl('TEST-1')).toBe('https://example.atlassian.net/browse/TEST-1');
    });
  });

  describe('Protocol Validation', () => {
    it('should reject HTTP URLs (client uses https module)', () => {
      const config = { ...validConfig, host: 'http://jira.example.com' };
      expect(() => new JiraClient(config)).toThrow(
        'Invalid Jira host protocol (http://jira.example.com): Only HTTPS is supported. Received http:, expected https:'
      );
    });

    it('should include problematic host in error message for debuggability', () => {
      const config = { ...validConfig, host: 'http://jira.example.com' };
      expect(() => new JiraClient(config)).toThrow('http://jira.example.com');
    });

    it('should accept https:// URLs', () => {
      const config = { ...validConfig, host: 'https://jira.example.com' };
      expect(() => new JiraClient(config)).not.toThrow();
    });

    it('should accept HTTPS on non-standard port', () => {
      const config = { ...validConfig, host: 'https://jira.example.com:8443' };
      expect(() => new JiraClient(config)).not.toThrow();
    });
  });

  describe('SSRF Protection', () => {
    it('should reject private IP addresses (192.168.x.x)', () => {
      const config = { ...validConfig, host: 'https://192.168.1.1' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to internal/private networks are not allowed'
      );
    });

    it('should reject localhost', () => {
      const config = { ...validConfig, host: 'https://localhost' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to internal/private networks are not allowed'
      );
    });

    it('should reject localhost with port', () => {
      const config = { ...validConfig, host: 'https://localhost:8080' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to internal/private networks are not allowed'
      );
    });

    it('should reject 127.0.0.1', () => {
      const config = { ...validConfig, host: 'https://127.0.0.1' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to internal/private networks are not allowed'
      );
    });

    it('should reject cloud metadata endpoints (AWS)', () => {
      const config = { ...validConfig, host: 'https://169.254.169.254' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to cloud metadata endpoints are not allowed'
      );
    });

    it('should reject 10.x.x.x private range', () => {
      const config = { ...validConfig, host: 'https://10.0.0.1' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to internal/private networks are not allowed'
      );
    });

    it('should reject 172.16.x.x private range', () => {
      const config = { ...validConfig, host: 'https://172.16.0.1' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to internal/private networks are not allowed'
      );
    });

    it('should include host in SSRF error message for debuggability', () => {
      const config = { ...validConfig, host: 'https://192.168.1.1' };
      expect(() => new JiraClient(config)).toThrow('https://192.168.1.1');
    });
  });

  describe('Valid Hostnames', () => {
    it('should accept Atlassian Cloud (*.atlassian.net)', () => {
      const config = { ...validConfig, host: 'https://mycompany.atlassian.net' };
      expect(() => new JiraClient(config)).not.toThrow();
    });

    it('should accept custom self-hosted domains', () => {
      const config = { ...validConfig, host: 'https://jira.example.com' };
      expect(() => new JiraClient(config)).not.toThrow();
    });

    it('should accept subdomains', () => {
      const config = { ...validConfig, host: 'https://jira.internal.example.com' };
      expect(() => new JiraClient(config)).not.toThrow();
    });

    it('should accept custom ports', () => {
      const config = { ...validConfig, host: 'https://jira.example.com:8443' };
      expect(() => new JiraClient(config)).not.toThrow();
    });
  });

  describe('Error Message Quality', () => {
    it('should provide clear error for invalid URLs', () => {
      const config = { ...validConfig, host: 'not-a-url' };
      expect(() => new JiraClient(config)).toThrow('Invalid Jira host URL');
      expect(() => new JiraClient(config)).toThrow('not-a-url');
    });

    it('should provide clear error for wrong protocol', () => {
      const config = { ...validConfig, host: 'http://jira.example.com' };
      expect(() => new JiraClient(config)).toThrow('Only HTTPS is supported');
      expect(() => new JiraClient(config)).toThrow('Received http:, expected https:');
    });

    it('should provide clear error for SSRF violations', () => {
      const config = { ...validConfig, host: 'https://localhost' };
      expect(() => new JiraClient(config)).toThrow(
        'Requests to internal/private networks are not allowed'
      );
    });
  });
});
