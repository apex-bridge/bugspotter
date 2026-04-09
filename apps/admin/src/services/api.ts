/**
 * API Services Index
 * Re-exports all services for backward compatibility
 *
 * Each service is now in its own file following SRP (Single Responsibility Principle)
 */

export { authService } from './auth-service';
export { setupService } from './setup-service';
export { adminService } from './admin-service';
export { projectService } from './project-service';
export { bugReportService } from './bug-report-service';
export { userService } from './user-service';
export { analyticsService } from './analytics-service';
export { notificationService } from './notification-service';
export { integrationService } from './integration-service';
export { apiKeyService } from './api-key-service';
export { projectMemberService } from './project-member-service';
export { storageService } from './storage-service';
export { shareTokenService } from './share-token-service';
export { invitationService } from './invitation-service';
export { intelligenceService } from './intelligence-service';
