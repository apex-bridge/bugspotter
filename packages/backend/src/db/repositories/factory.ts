/**
 * Repository Factory
 * Single source of truth for creating repository instances
 */

import type { Pool, PoolClient } from 'pg';
import { ProjectRepository } from './project.repository.js';
import { ProjectMemberRepository } from './project-member.repository.js';
import { BugReportRepository } from './bug-report.repository.js';
import { UserRepository } from './user.repository.js';
import { TicketRepository } from './ticket.repository.js';
import { ShareTokenRepository } from './share-token.repository.js';
import { EmailVerificationTokenRepository } from './email-verification-token.repository.js';
import { SystemConfigRepository } from './system-config.repository.js';
import { AuditLogRepository } from './audit-log.repository.js';
import { ProjectIntegrationRepository } from '../project-integration.repository.js';
import { IntegrationRuleRepository } from '../integration-rule.repository.js';
import { NotificationChannelRepository } from './notification-channel.repository.js';
import { NotificationRuleRepository } from './notification-rule.repository.js';
import { NotificationTemplateRepository } from './notification-template.repository.js';
import { NotificationHistoryRepository } from './notification-history.repository.js';
import { NotificationThrottleRepository } from './notification-throttle.repository.js';
import { IntegrationRepository } from './integration.repository.js';
import { IntegrationSyncLogRepository } from './integration-sync-log.repository.js';
import { FieldMappingRepository } from './field-mapping.repository.js';
import { WebhookRepository } from './webhook.repository.js';
import { OAuthTokenRepository } from './oauth-token.repository.js';
import { ApiKeyRepository } from './api-key.repository.js';
import { TicketCreationOutboxRepository } from './ticket-creation-outbox.repository.js';
import { DataResidencyRepository } from './data-residency.repository.js';
import { OrganizationRepository } from '../../saas/repositories/organization.repository.js';
import { OrganizationMemberRepository } from '../../saas/repositories/organization-member.repository.js';
import { SubscriptionRepository } from '../../saas/repositories/subscription.repository.js';
import { UsageRecordRepository } from '../../saas/repositories/usage-record.repository.js';
import { InvitationRepository } from '../../saas/repositories/invitation.repository.js';
import { OrganizationRequestRepository } from '../../saas/repositories/organization-request.repository.js';
import { InvoiceRepository } from '../../saas/repositories/invoice.repository.js';
import { InvoiceLineRepository } from '../../saas/repositories/invoice-line.repository.js';
import { LegalEntityRepository } from '../../saas/repositories/legal-entity.repository.js';
import { ActRepository } from '../../saas/repositories/act.repository.js';

export interface RepositoryRegistry {
  projects: ProjectRepository;
  projectMembers: ProjectMemberRepository;
  bugReports: BugReportRepository;
  users: UserRepository;
  tickets: TicketRepository;
  shareTokens: ShareTokenRepository;
  emailVerificationTokens: EmailVerificationTokenRepository;
  projectIntegrations: ProjectIntegrationRepository;
  systemConfig: SystemConfigRepository;
  auditLogs: AuditLogRepository;
  retention: BugReportRepository;
  notificationChannels: NotificationChannelRepository;
  notificationRules: NotificationRuleRepository;
  notificationTemplates: NotificationTemplateRepository;
  notificationHistory: NotificationHistoryRepository;
  notificationThrottle: NotificationThrottleRepository;
  integrations: IntegrationRepository;
  integrationSyncLogs: IntegrationSyncLogRepository;
  fieldMappings: FieldMappingRepository;
  webhooks: WebhookRepository;
  oauthTokens: OAuthTokenRepository;
  apiKeys: ApiKeyRepository;
  integrationRules: IntegrationRuleRepository;
  ticketOutbox: TicketCreationOutboxRepository;
  dataResidency: DataResidencyRepository;
  // SaaS multi-tenant repositories
  organizations: OrganizationRepository;
  organizationMembers: OrganizationMemberRepository;
  subscriptions: SubscriptionRepository;
  usageRecords: UsageRecordRepository;
  invitations: InvitationRepository;
  organizationRequests: OrganizationRequestRepository;
  // Invoice billing repositories
  invoices: InvoiceRepository;
  invoiceLines: InvoiceLineRepository;
  legalEntities: LegalEntityRepository;
  acts: ActRepository;
}

/**
 * Create all repository instances with the given database connection
 * Used by both DatabaseClient and transaction contexts
 */
export function createRepositories(pool: Pool | PoolClient): RepositoryRegistry {
  const bugReports = new BugReportRepository(pool);

  return {
    projects: new ProjectRepository(pool),
    projectMembers: new ProjectMemberRepository(pool),
    bugReports,
    users: new UserRepository(pool),
    tickets: new TicketRepository(pool),
    shareTokens: new ShareTokenRepository(pool),
    emailVerificationTokens: new EmailVerificationTokenRepository(pool),
    projectIntegrations: new ProjectIntegrationRepository(pool),
    systemConfig: new SystemConfigRepository(pool),
    auditLogs: new AuditLogRepository(pool),
    // Retention operations consolidated into BugReportRepository
    retention: bugReports,
    // Notification system repositories
    notificationChannels: new NotificationChannelRepository(pool),
    notificationRules: new NotificationRuleRepository(pool),
    notificationTemplates: new NotificationTemplateRepository(pool),
    notificationHistory: new NotificationHistoryRepository(pool),
    notificationThrottle: new NotificationThrottleRepository(pool),
    // Integration system repositories
    integrations: new IntegrationRepository(pool),
    integrationSyncLogs: new IntegrationSyncLogRepository(pool),
    fieldMappings: new FieldMappingRepository(pool),
    webhooks: new WebhookRepository(pool),
    oauthTokens: new OAuthTokenRepository(pool),
    apiKeys: new ApiKeyRepository(pool),
    integrationRules: new IntegrationRuleRepository(pool),
    ticketOutbox: new TicketCreationOutboxRepository(pool),
    dataResidency: new DataResidencyRepository(pool),
    // SaaS multi-tenant repositories
    organizations: new OrganizationRepository(pool),
    organizationMembers: new OrganizationMemberRepository(pool),
    subscriptions: new SubscriptionRepository(pool),
    usageRecords: new UsageRecordRepository(pool),
    invitations: new InvitationRepository(pool),
    organizationRequests: new OrganizationRequestRepository(pool),
    // Invoice billing repositories
    invoices: new InvoiceRepository(pool),
    invoiceLines: new InvoiceLineRepository(pool),
    legalEntities: new LegalEntityRepository(pool),
    acts: new ActRepository(pool),
  };
}
