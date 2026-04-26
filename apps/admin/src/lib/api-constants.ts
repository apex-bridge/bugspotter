/**
 * API Constants
 * Centralized API base paths and endpoints
 */

/**
 * API version prefix
 * Used to construct all API endpoint paths
 */
export const API_VERSION = '/api/v1';

/**
 * API endpoint builders
 * Helper functions to construct consistent API paths
 */
export const API_ENDPOINTS = {
  // Auth endpoints
  auth: {
    login: () => `${API_VERSION}/auth/login`,
    logout: () => `${API_VERSION}/auth/logout`,
    refresh: () => `${API_VERSION}/auth/refresh`,
    magicLogin: () => `${API_VERSION}/auth/magic-login`,
    register: () => `${API_VERSION}/auth/register`,
    registrationStatus: () => `${API_VERSION}/auth/registration-status`,
    me: () => `${API_VERSION}/auth/me`,
    verifyEmail: () => `${API_VERSION}/auth/verify-email`,
    resendVerification: () => `${API_VERSION}/auth/resend-verification`,
  },

  // Deployment config
  deployment: () => `${API_VERSION}/deployment`,

  // Setup endpoints
  setup: {
    status: () => `${API_VERSION}/setup/status`,
    initialize: () => `${API_VERSION}/setup/initialize`,
    testStorage: () => `${API_VERSION}/setup/test-storage`,
  },

  // Project endpoints
  projects: {
    list: () => `${API_VERSION}/projects`,
    create: () => `${API_VERSION}/projects`,
    get: (id: string) => `${API_VERSION}/projects/${id}`,
    update: (id: string) => `${API_VERSION}/projects/${id}`,
    delete: (id: string) => `${API_VERSION}/projects/${id}`,
    stats: (id: string) => `${API_VERSION}/projects/${id}/stats`,
    members: (id: string) => `${API_VERSION}/projects/${id}/members`,
    apiKeys: (id: string) => `${API_VERSION}/projects/${id}/api-keys`,
    integrations: (id: string) => `${API_VERSION}/projects/${id}/integrations`,
  },

  // Bug report endpoints
  bugReports: {
    list: () => `${API_VERSION}/reports`,
    get: (id: string) => `${API_VERSION}/reports/${id}`,
    update: (id: string) => `${API_VERSION}/reports/${id}`,
    delete: (id: string) => `${API_VERSION}/reports/${id}`,
    bulkDelete: () => `${API_VERSION}/reports/bulk-delete`,
  },

  // Permissions endpoint
  permissions: {
    me: () => `${API_VERSION}/me/permissions`,
  },

  // User endpoints
  users: {
    list: () => `${API_VERSION}/users`,
    create: () => `${API_VERSION}/users`,
    get: (id: string) => `${API_VERSION}/users/${id}`,
    update: (id: string) => `${API_VERSION}/users/${id}`,
    delete: (id: string) => `${API_VERSION}/users/${id}`,
  },

  // Admin user endpoints
  adminUsers: {
    list: () => `${API_VERSION}/admin/users`,
    create: () => `${API_VERSION}/admin/users`,
    get: (id: string) => `${API_VERSION}/admin/users/${id}`,
    update: (id: string) => `${API_VERSION}/admin/users/${id}`,
    delete: (id: string) => `${API_VERSION}/admin/users/${id}`,
    projects: (id: string) => `${API_VERSION}/admin/users/${id}/projects`,
  },

  // Project member endpoints
  projectMembers: {
    list: (projectId: string) => `${API_VERSION}/projects/${projectId}/members`,
    add: (projectId: string) => `${API_VERSION}/projects/${projectId}/members`,
    update: (projectId: string, userId: string) =>
      `${API_VERSION}/projects/${projectId}/members/${userId}`,
    remove: (projectId: string, userId: string) =>
      `${API_VERSION}/projects/${projectId}/members/${userId}`,
  },

  // Integration endpoints (admin)
  integrations: {
    list: () => `${API_VERSION}/admin/integrations`,
    create: () => `${API_VERSION}/admin/integrations`,
    analyzeCode: () => `${API_VERSION}/admin/integrations/analyze-code`,
    getDetails: (type: string) => `${API_VERSION}/admin/integrations/${type}`,
    update: (type: string) => `${API_VERSION}/admin/integrations/${type}`,
    getStatus: (type: string) => `${API_VERSION}/admin/integrations/${type}/status`,
    getConfig: (type: string) => `${API_VERSION}/admin/integrations/${type}/config`,
    updateConfig: (type: string) => `${API_VERSION}/admin/integrations/${type}/config`,
    deleteConfig: (type: string) => `${API_VERSION}/admin/integrations/${type}/config`,
    delete: (type: string) => `${API_VERSION}/admin/integrations/${type}`,
    testConnection: (type: string) => `${API_VERSION}/admin/integrations/${type}/test`,
    oauthAuthorize: (type: string) => `${API_VERSION}/admin/integrations/${type}/oauth/authorize`,
    rules: {
      list: (platform: string, projectId: string) =>
        `${API_VERSION}/integrations/${platform}/${projectId}/rules`,
      create: (platform: string, projectId: string) =>
        `${API_VERSION}/integrations/${platform}/${projectId}/rules`,
      update: (platform: string, projectId: string, ruleId: string) =>
        `${API_VERSION}/integrations/${platform}/${projectId}/rules/${ruleId}`,
      delete: (platform: string, projectId: string, ruleId: string) =>
        `${API_VERSION}/integrations/${platform}/${projectId}/rules/${ruleId}`,
      copy: (platform: string, projectId: string, ruleId: string) =>
        `${API_VERSION}/integrations/${platform}/${projectId}/rules/${ruleId}/copy`,
    },
  },

  // Project-specific integration configuration
  projectIntegrations: {
    configure: (platform: string, projectId: string) =>
      `${API_VERSION}/integrations/${platform}/${projectId}`,
    get: (platform: string, projectId: string) =>
      `${API_VERSION}/integrations/${platform}/${projectId}`,
    update: (platform: string, projectId: string) =>
      `${API_VERSION}/integrations/${platform}/${projectId}`,
    delete: (platform: string, projectId: string) =>
      `${API_VERSION}/integrations/${platform}/${projectId}`,
    testConnection: (platform: string) => `${API_VERSION}/integrations/${platform}/test`,
    searchProjects: (platform: string) => `${API_VERSION}/integrations/${platform}/projects`,
  },

  // Notification endpoints
  notifications: {
    channels: {
      list: () => `${API_VERSION}/notifications/channels`,
      create: () => `${API_VERSION}/notifications/channels`,
      get: (id: string) => `${API_VERSION}/notifications/channels/${id}`,
      update: (id: string) => `${API_VERSION}/notifications/channels/${id}`,
      delete: (id: string) => `${API_VERSION}/notifications/channels/${id}`,
      test: (id: string) => `${API_VERSION}/notifications/channels/${id}/test`,
    },
    rules: {
      list: () => `${API_VERSION}/notifications/rules`,
      create: () => `${API_VERSION}/notifications/rules`,
      get: (id: string) => `${API_VERSION}/notifications/rules/${id}`,
      update: (id: string) => `${API_VERSION}/notifications/rules/${id}`,
      delete: (id: string) => `${API_VERSION}/notifications/rules/${id}`,
    },
    history: {
      list: () => `${API_VERSION}/notifications/history`,
      get: (id: string) => `${API_VERSION}/notifications/history/${id}`,
      retry: (id: string) => `${API_VERSION}/notifications/history/${id}/retry`,
    },
  },

  // Analytics endpoints
  analytics: {
    overview: () => `${API_VERSION}/analytics/overview`,
    trends: () => `${API_VERSION}/analytics/trends`,
    dashboard: () => `${API_VERSION}/analytics/dashboard`,
    reportsTrend: () => `${API_VERSION}/analytics/reports/trend`,
    projectsStats: () => `${API_VERSION}/analytics/projects/stats`,
  },

  // Audit log endpoints
  auditLogs: {
    list: () => `${API_VERSION}/audit-logs`,
    get: (id: string) => `${API_VERSION}/audit-logs/${id}`,
    statistics: () => `${API_VERSION}/audit-logs/statistics`,
    recent: () => `${API_VERSION}/audit-logs/recent`,
    byUser: (userId: string) => `${API_VERSION}/audit-logs/user/${userId}`,
  },

  // API key endpoints
  apiKeys: {
    list: () => `${API_VERSION}/api-keys`,
    create: () => `${API_VERSION}/api-keys`,
    get: (id: string) => `${API_VERSION}/api-keys/${id}`,
    update: (id: string) => `${API_VERSION}/api-keys/${id}`,
    delete: (id: string) => `${API_VERSION}/api-keys/${id}`,
    rotate: (id: string) => `${API_VERSION}/api-keys/${id}/rotate`,
    usage: (id: string) => `${API_VERSION}/api-keys/${id}/usage`,
  },

  // Admin endpoints
  admin: {
    health: () => `${API_VERSION}/admin/health`,
    settings: () => `${API_VERSION}/admin/settings`,
  },

  // Data residency endpoints
  dataResidency: {
    getPolicy: (projectId: string) => `${API_VERSION}/projects/${projectId}/data-residency`,
    updatePolicy: (projectId: string) => `${API_VERSION}/projects/${projectId}/data-residency`,
    compliance: (projectId: string) =>
      `${API_VERSION}/projects/${projectId}/data-residency/compliance`,
    audit: (projectId: string) => `${API_VERSION}/projects/${projectId}/data-residency/audit`,
    violations: (projectId: string) =>
      `${API_VERSION}/projects/${projectId}/data-residency/violations`,
    regions: () => `${API_VERSION}/data-residency/regions`,
  },

  // Organization endpoints
  organizations: {
    list: () => `${API_VERSION}/organizations`,
    me: () => `${API_VERSION}/organizations/me`,
    create: () => `${API_VERSION}/organizations`,
    get: (id: string) => `${API_VERSION}/organizations/${id}`,
    update: (id: string) => `${API_VERSION}/organizations/${id}`,
    quota: (id: string) => `${API_VERSION}/organizations/${id}/quota`,
    subscription: (id: string) => `${API_VERSION}/organizations/${id}/subscription`,
    members: (id: string) => `${API_VERSION}/organizations/${id}/members`,
    removeMember: (id: string, userId: string) =>
      `${API_VERSION}/organizations/${id}/members/${userId}`,
    invitations: (id: string) => `${API_VERSION}/organizations/${id}/invitations`,
    cancelInvitation: (id: string, invitationId: string) =>
      `${API_VERSION}/organizations/${id}/invitations/${invitationId}`,
  },

  // Admin organization endpoints
  adminOrganizations: {
    create: () => `${API_VERSION}/admin/organizations`,
    setPlan: (id: string) => `${API_VERSION}/admin/organizations/${id}/subscription`,
    setBillingMethod: (id: string) => `${API_VERSION}/admin/organizations/${id}/billing-method`,
    delete: (id: string) => `${API_VERSION}/admin/organizations/${id}`,
    restore: (id: string) => `${API_VERSION}/admin/organizations/${id}/restore`,
    deletionPrecheck: (id: string) => `${API_VERSION}/admin/organizations/${id}/deletion-precheck`,
    invite: (id: string) => `${API_VERSION}/admin/organizations/${id}/invitations`,
    listInvitations: (id: string) => `${API_VERSION}/admin/organizations/${id}/invitations`,
    cancelInvitation: (id: string, invitationId: string) =>
      `${API_VERSION}/admin/organizations/${id}/invitations/${invitationId}`,
    projects: (id: string) => `${API_VERSION}/admin/organizations/${id}/projects`,
    magicLoginStatus: (id: string) => `${API_VERSION}/admin/organizations/${id}/magic-login-status`,
    setMagicLoginStatus: (id: string) =>
      `${API_VERSION}/admin/organizations/${id}/magic-login-status`,
    generateMagicToken: (id: string) => `${API_VERSION}/admin/organizations/${id}/magic-token`,
    pendingHardDelete: () => `${API_VERSION}/admin/organizations/pending-hard-delete`,
    hardDelete: (id: string) => `${API_VERSION}/admin/organizations/${id}/hard-delete`,
  },

  // Admin organization request endpoints
  adminOrgRequests: {
    list: () => `${API_VERSION}/admin/organization-requests`,
    get: (id: string) => `${API_VERSION}/admin/organization-requests/${id}`,
    approve: (id: string) => `${API_VERSION}/admin/organization-requests/${id}/approve`,
    reject: (id: string) => `${API_VERSION}/admin/organization-requests/${id}/reject`,
    delete: (id: string) => `${API_VERSION}/admin/organization-requests/${id}`,
  },

  // Invitation endpoints
  invitations: {
    accept: () => `${API_VERSION}/invitations/accept`,
    preview: (token: string) =>
      `${API_VERSION}/invitations/preview?token=${encodeURIComponent(token)}`,
  },

  billing: {
    plans: () => `${API_VERSION}/billing/plans`,
    checkout: () => `${API_VERSION}/billing/checkout`,
    cancel: () => `${API_VERSION}/billing/cancel`,
    invoices: () => `${API_VERSION}/billing/invoices`,
    invoice: (id: string) => `${API_VERSION}/billing/invoices/${id}`,
    invoicePdf: (id: string) => `${API_VERSION}/billing/invoices/${id}/pdf`,
    markPaid: (id: string) => `${API_VERSION}/billing/invoices/${id}/mark-paid`,
    legalDetails: () => `${API_VERSION}/billing/legal-details`,
    actPdf: (id: string) => `${API_VERSION}/billing/acts/${id}/pdf`,
    adminInvoices: (orgId: string) => `${API_VERSION}/admin/billing/invoices/${orgId}`,
  },

  // Intelligence endpoints
  intelligence: {
    settings: (orgId: string) => `${API_VERSION}/organizations/${orgId}/intelligence/settings`,
    provisionKey: (orgId: string) => `${API_VERSION}/organizations/${orgId}/intelligence/key`,
    generateKey: (orgId: string) =>
      `${API_VERSION}/organizations/${orgId}/intelligence/key/generate`,
    revokeKey: (orgId: string) => `${API_VERSION}/organizations/${orgId}/intelligence/key`,
    enrichment: (bugId: string) => `${API_VERSION}/intelligence/bugs/${bugId}/enrichment`,
    feedback: `${API_VERSION}/intelligence/feedback`,
    bugFeedback: (bugId: string) => `${API_VERSION}/intelligence/bugs/${bugId}/feedback`,
    feedbackStats: (projectId: string) =>
      `${API_VERSION}/intelligence/projects/${projectId}/feedback/stats`,
    deflectionStats: (projectId: string) =>
      `${API_VERSION}/self-service/stats?project_id=${projectId}`,
    similarBugs: (projectId: string, bugId: string) =>
      `${API_VERSION}/intelligence/projects/${projectId}/bugs/${bugId}/similar`,
    mitigation: (projectId: string, bugId: string) =>
      `${API_VERSION}/intelligence/projects/${projectId}/bugs/${bugId}/mitigation`,
    search: (projectId: string) => `${API_VERSION}/intelligence/projects/${projectId}/search`,
  },

  // Health check
  health: () => `${API_VERSION}/health`,
};
