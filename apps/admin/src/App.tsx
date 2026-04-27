import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n/config';
import { AuthProvider } from './contexts/auth-context';
import { OrganizationProvider } from './contexts/organization-context';
import { DeploymentProvider } from './contexts/deployment-context';
import { ProtectedRoute } from './components/protected-route';
import { AdminRoute } from './components/admin-route';
import { OrgRoute } from './components/org-route';
import { SaaSRoute } from './components/saas-route';
import { DefaultRedirect } from './components/default-redirect';
import LoginPage from './pages/login';
import RegisterPage from './pages/register';
import OnboardingPage from './pages/onboarding';
import VerifyEmailPage from './pages/verify-email';
import SetupWizard from './pages/setup';
import DashboardLayout from './components/dashboard-layout';
import DashboardPage from './pages/dashboard';
import UsersPage from './pages/users';
import SettingsPage from './pages/settings';
import ProjectsPage from './pages/projects';
import ProjectIntegrationsPage from './pages/project-integrations';
import ProjectIntegrationConfigPage from './pages/project-integration-config';
import ProjectMembersPage from './pages/project-members';
import { ProjectDataResidencyPage } from './pages/project-data-residency';
import HealthPage from './pages/health';
import BugReportsPage from './pages/bug-reports';
import AuditLogsPage from './pages/audit-logs';
import NotificationsPage from './pages/notifications';
import IntegrationsOverview from './pages/integrations/overview';
import CreateIntegration from './pages/integrations/create';
import IntegrationConfigPage from './pages/integrations/integration-config';
import IntegrationEditPage from './pages/integrations/edit';
import IntegrationRulesPage from './pages/integrations/rules';
import ApiKeysPage from './pages/api-keys';
import SharedReplayViewer from './pages/shared-replay-viewer';
import OrganizationsPage from './pages/platform/organizations';
import OrganizationDetailPage from './pages/platform/organization-detail';
import MyOrganizationPage from './pages/organization/my-organization';
import OrgMembersPage from './pages/organization/org-members';
import OrgUsagePage from './pages/organization/org-usage';
import OrgBillingPage from './pages/organization/org-billing';
import OrgInvoicesPage from './pages/organization/org-invoices';
import OrgInvoiceDetailPage from './pages/organization/org-invoice-detail';
import OrgLegalDetailsPage from './pages/organization/org-legal-details';
import OrgIntelligencePage from './pages/organization/org-intelligence';
import AcceptInvitationPage from './pages/invitations/accept';
import OrganizationRequestsPage from './pages/platform/organization-requests';
import OrgRetentionPage from './pages/platform/org-retention';

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <DeploymentProvider>
        <Router>
          <AuthProvider>
            <OrganizationProvider>
              <Routes>
                {/* Public routes - no authentication required */}
                <Route path="/shared/:token" element={<SharedReplayViewer />} />

                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                {/*
                  `/onboarding` is intentionally outside ProtectedRoute.
                  It reads a handoff blob passed by the landing signup
                  form (cross-origin redirect from `bugspotter.io`) via
                  URL fragment (`#handoff=`) or query (`?handoff=`),
                  decodes it, and seeds the auth context.
                  The handoff param IS the bootstrap access token; no
                  existing app session is loaded from storage on mount
                  yet, and the refresh cookie may still be arriving
                  from the signup response. AuthProvider's initAuth
                  has `/onboarding` in its public-route allowlist so
                  it doesn't race the page's own `login()` call.
                */}
                <Route path="/onboarding" element={<OnboardingPage />} />
                {/*
                  `/verify-email` is intentionally outside ProtectedRoute.
                  The `?token=` value IS the auth for the verify call,
                  so requiring a session would lock out users who click
                  the link in a different browser from the one they
                  signed up in. The page does still consult `useAuth`
                  to show a one-click resend button when a session
                  happens to be available — initAuth's session-restore
                  branch is gated on sessionStorage and is a no-op for
                  fresh tabs from email links.
                */}
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/setup" element={<SetupWizard />} />
                <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <DashboardLayout />
                    </ProtectedRoute>
                  }
                >
                  {/* Default route: admin -> dashboard, user -> projects */}
                  <Route index element={<DefaultRedirect />} />

                  {/* Admin-only routes */}
                  <Route
                    path="dashboard"
                    element={
                      <AdminRoute>
                        <DashboardPage />
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="users"
                    element={
                      <AdminRoute>
                        <UsersPage />
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="system-health"
                    element={
                      <AdminRoute>
                        <HealthPage />
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="settings"
                    element={
                      <AdminRoute>
                        <SettingsPage />
                      </AdminRoute>
                    }
                  />
                  {/*
                    Audit logs are accessible to platform admins and
                    org owners/admins. Backend handles auth + scoping;
                    the page renders a localized error state when the
                    user lacks access.
                  */}
                  <Route path="audit-logs" element={<AuditLogsPage />} />

                  <Route
                    path="integrations"
                    element={
                      <AdminRoute>
                        <IntegrationsOverview />
                      </AdminRoute>
                    }
                  />

                  <Route
                    path="integrations/create"
                    element={
                      <AdminRoute>
                        <CreateIntegration />
                      </AdminRoute>
                    }
                  />

                  <Route
                    path="integrations/:type"
                    element={
                      <AdminRoute>
                        <IntegrationConfigPage />
                      </AdminRoute>
                    }
                  />

                  <Route
                    path="integrations/:type/edit"
                    element={
                      <AdminRoute>
                        <IntegrationEditPage />
                      </AdminRoute>
                    }
                  />

                  <Route
                    path="integrations/:platform/:projectId/rules"
                    element={<IntegrationRulesPage />}
                  />

                  <Route path="api-keys" element={<ApiKeysPage />} />

                  {/* Platform admin: Organizations (SaaS only) */}
                  <Route
                    path="organizations"
                    element={
                      <AdminRoute>
                        <SaaSRoute>
                          <OrganizationsPage />
                        </SaaSRoute>
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="organizations/:id"
                    element={
                      <AdminRoute>
                        <SaaSRoute>
                          <OrganizationDetailPage />
                        </SaaSRoute>
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="organization-requests"
                    element={
                      <AdminRoute>
                        <SaaSRoute>
                          <OrganizationRequestsPage />
                        </SaaSRoute>
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="organizations/retention"
                    element={
                      <AdminRoute>
                        <SaaSRoute>
                          <OrgRetentionPage />
                        </SaaSRoute>
                      </AdminRoute>
                    }
                  />

                  {/* Org self-service */}
                  <Route
                    path="my-organization"
                    element={
                      <OrgRoute>
                        <MyOrganizationPage />
                      </OrgRoute>
                    }
                  />
                  <Route
                    path="my-organization/members"
                    element={
                      <OrgRoute>
                        <OrgMembersPage />
                      </OrgRoute>
                    }
                  />
                  <Route
                    path="my-organization/usage"
                    element={
                      <OrgRoute>
                        <SaaSRoute>
                          <OrgUsagePage />
                        </SaaSRoute>
                      </OrgRoute>
                    }
                  />
                  <Route
                    path="my-organization/billing"
                    element={
                      <OrgRoute>
                        <SaaSRoute>
                          <OrgBillingPage />
                        </SaaSRoute>
                      </OrgRoute>
                    }
                  />
                  <Route
                    path="my-organization/invoices"
                    element={
                      <OrgRoute>
                        <SaaSRoute>
                          <OrgInvoicesPage />
                        </SaaSRoute>
                      </OrgRoute>
                    }
                  />
                  <Route
                    path="my-organization/invoices/:invoiceId"
                    element={
                      <OrgRoute>
                        <SaaSRoute>
                          <OrgInvoiceDetailPage />
                        </SaaSRoute>
                      </OrgRoute>
                    }
                  />
                  <Route
                    path="my-organization/legal-details"
                    element={
                      <OrgRoute>
                        <SaaSRoute>
                          <OrgLegalDetailsPage />
                        </SaaSRoute>
                      </OrgRoute>
                    }
                  />
                  <Route
                    path="my-organization/intelligence"
                    element={
                      <OrgRoute>
                        <OrgIntelligencePage />
                      </OrgRoute>
                    }
                  />

                  {/* All users */}
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route
                    path="projects/:projectId/integrations"
                    element={<ProjectIntegrationsPage />}
                  />
                  <Route
                    path="projects/:projectId/integrations/:platform/configure"
                    element={<ProjectIntegrationConfigPage />}
                  />
                  <Route path="projects/:projectId/members" element={<ProjectMembersPage />} />
                  <Route
                    path="projects/:projectId/data-residency"
                    element={<ProjectDataResidencyPage />}
                  />
                  <Route path="bug-reports" element={<BugReportsPage />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                </Route>
              </Routes>
            </OrganizationProvider>
            <Toaster position="top-right" richColors />
          </AuthProvider>
        </Router>
      </DeploymentProvider>
    </I18nextProvider>
  );
}

export default App;
