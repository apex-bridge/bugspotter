/**
 * Domain Getters Tests
 * Verifies that the hybrid domain access pattern works correctly
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from '../../src/db/client.js';
import { config } from '../../src/config.js';

describe('DatabaseClient Domain Getters', () => {
  let db: DatabaseClient;

  beforeAll(async () => {
    db = createDatabaseClient(config.database.url);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('Core Domain', () => {
    it('should provide access to core repositories', () => {
      const core = db.core;

      expect(core).toBeDefined();
      expect(core.projects).toBe(db.projects);
      expect(core.projectMembers).toBe(db.projectMembers);
      expect(core.bugReports).toBe(db.bugReports);
      expect(core.users).toBe(db.users);
      expect(core.sessions).toBe(db.sessions);
      expect(core.tickets).toBe(db.tickets);
      expect(core.systemConfig).toBe(db.systemConfig);
      expect(core.auditLogs).toBe(db.auditLogs);
      expect(core.retention).toBe(db.retention);
    });

    it('should maintain referential equality between calls', () => {
      const core1 = db.core;
      const core2 = db.core;

      // Getter creates new object each time, but repositories are the same
      expect(core1.projects).toBe(core2.projects);
      expect(core1.bugReports).toBe(core2.bugReports);
    });
  });

  describe('Integration Domain', () => {
    it('should provide access to integration repositories', () => {
      const integration = db.integration;

      expect(integration).toBeDefined();
      expect(integration.integrations).toBe(db.integrations);
      expect(integration.syncLogs).toBe(db.integrationSyncLogs);
      expect(integration.fieldMappings).toBe(db.fieldMappings);
      expect(integration.webhooks).toBe(db.webhooks);
      expect(integration.oauthTokens).toBe(db.oauthTokens);
      expect(integration.projectIntegrations).toBe(db.projectIntegrations);
    });

    it('should maintain referential equality for repositories', () => {
      const integration1 = db.integration;
      const integration2 = db.integration;

      expect(integration1.integrations).toBe(integration2.integrations);
      expect(integration1.syncLogs).toBe(integration2.syncLogs);
    });
  });

  describe('Notification Domain', () => {
    it('should provide access to notification repositories', () => {
      const notification = db.notification;

      expect(notification).toBeDefined();
      expect(notification.channels).toBe(db.notificationChannels);
      expect(notification.rules).toBe(db.notificationRules);
      expect(notification.templates).toBe(db.notificationTemplates);
      expect(notification.history).toBe(db.notificationHistory);
      expect(notification.throttle).toBe(db.notificationThrottle);
    });

    it('should maintain referential equality for repositories', () => {
      const notification1 = db.notification;
      const notification2 = db.notification;

      expect(notification1.channels).toBe(notification2.channels);
      expect(notification1.rules).toBe(notification2.rules);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain flat access to all repositories', () => {
      // All original flat access still works
      expect(db.projects).toBeDefined();
      expect(db.integrations).toBeDefined();
      expect(db.notificationChannels).toBeDefined();
      expect(db.bugReports).toBeDefined();
      expect(db.users).toBeDefined();
    });

    it('should allow mixed access patterns', () => {
      // Can use flat and domain access interchangeably
      expect(db.projects).toBe(db.core.projects);
      expect(db.integrations).toBe(db.integration.integrations);
      expect(db.notificationChannels).toBe(db.notification.channels);
    });
  });

  describe('Type Safety', () => {
    it('should enforce correct types for domain objects', () => {
      // TypeScript compilation ensures these work
      const core = db.core;
      const integration = db.integration;
      const notification = db.notification;

      // Should have correct repository types
      expect(typeof core.projects.findById).toBe('function');
      expect(typeof integration.integrations.findById).toBe('function');
      expect(typeof notification.channels.findById).toBe('function');
    });
  });
});
