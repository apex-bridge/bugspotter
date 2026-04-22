import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/auth-context';
import { isPlatformAdmin } from '../types';
import { useOrganization } from '../contexts/organization-context';
import { useIsSaaS } from '../contexts/deployment-context';
import { useTranslation } from 'react-i18next';
import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LanguageSwitcher } from './language-switcher';
import {
  Activity,
  Settings,
  FolderKanban,
  LogOut,
  Bug,
  LayoutDashboard,
  Users,
  FileText,
  Bell,
  Plug,
  Key,
  Building2,
  BarChart3,
  CreditCard,
  ClipboardList,
  Brain,
  Trash2,
  LucideIcon,
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  saasOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard, adminOnly: true },
  { path: '/users', label: 'nav.userManagement', icon: Users, adminOnly: true },
  {
    path: '/organizations',
    label: 'nav.organizations',
    icon: Building2,
    adminOnly: true,
    saasOnly: true,
  },
  {
    path: '/organization-requests',
    label: 'nav.organizationRequests',
    icon: ClipboardList,
    adminOnly: true,
    saasOnly: true,
  },
  {
    path: '/organizations/retention',
    label: 'nav.orgRetention',
    icon: Trash2,
    adminOnly: true,
    saasOnly: true,
  },
  { path: '/system-health', label: 'nav.health', icon: Activity, adminOnly: true },
  { path: '/audit-logs', label: 'nav.auditLogs', icon: FileText },
  { path: '/projects', label: 'nav.projects', icon: FolderKanban },
  { path: '/bug-reports', label: 'nav.bugReports', icon: Bug },
  { path: '/api-keys', label: 'nav.apiKeys', icon: Key },
  { path: '/integrations', label: 'nav.integrations', icon: Plug, adminOnly: true },
  { path: '/notifications', label: 'nav.notifications', icon: Bell },
  { path: '/settings', label: 'nav.settings', icon: Settings, adminOnly: true },
];

const ORG_NAV_ITEMS: NavItem[] = [
  { path: '/my-organization', label: 'nav.myOrganization', icon: Building2 },
  { path: '/my-organization/members', label: 'nav.team', icon: Users },
  { path: '/my-organization/usage', label: 'nav.usage', icon: BarChart3, saasOnly: true },
  { path: '/my-organization/billing', label: 'nav.billing', icon: CreditCard, saasOnly: true },
  { path: '/my-organization/invoices', label: 'nav.invoices', icon: FileText, saasOnly: true },
  {
    path: '/my-organization/legal-details',
    label: 'nav.legalDetails',
    icon: ClipboardList,
    saasOnly: true,
  },
  { path: '/my-organization/intelligence', label: 'nav.intelligence', icon: Brain },
];

// Matches ROLE_COLORS in organizations/role-badge.tsx
const getRoleBadgeStyles = (label: string) => {
  switch (label) {
    case 'platform admin':
    case 'admin':
      return 'bg-red-100 text-red-700';
    case 'owner':
      return 'bg-purple-100 text-purple-700';
    default:
      return 'bg-green-100 text-green-700';
  }
};

export default function DashboardLayout() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { hasOrganization, currentOrganization } = useOrganization();
  const isSaaS = useIsSaaS();

  // Lightweight org role query — only fetches permissions, not full member list
  const { data: permissionsData } = useQuery({
    queryKey: ['permissions', undefined, currentOrganization?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { api, API_ENDPOINTS } = await import('../lib/api-client');
      const response = await api.get<{ data: { organization?: { role: string } } }>(
        API_ENDPOINTS.permissions.me(),
        { params: { organizationId: currentOrganization?.id } }
      );
      return response.data.data;
    },
    enabled: !!currentOrganization?.id && !!user,
  });
  const myOrgRole = permissionsData?.organization?.role;
  const location = useLocation();
  const { pathname } = location;

  // Memoize path array - only recreated if nav items change (never, they're constants)
  const allPaths = useMemo(
    () => [...NAV_ITEMS.map((i) => i.path), ...ORG_NAV_ITEMS.map((i) => i.path)],
    []
  );

  // Memoize isActive function - only recreated when pathname or allPaths change
  const isActive = useCallback(
    (path: string) => {
      if (pathname === path) {
        return true;
      }
      if (!pathname.startsWith(path + '/')) {
        return false;
      }
      // Don't match parent if a more specific child path matches
      const hasMoreSpecificMatch = allPaths.some(
        (p) =>
          p !== path &&
          p.startsWith(path + '/') &&
          pathname.startsWith(p) &&
          (pathname.length === p.length || pathname[p.length] === '/')
      );
      return !hasMoreSpecificMatch;
    },
    [pathname, allPaths]
  );

  const isAdmin = isPlatformAdmin(user);
  const adminLabel = isSaaS ? 'platform admin' : 'admin';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-64 bg-white border-r border-gray-200">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-gray-200">
            <h1 className="text-2xl font-bold text-primary">BugSpotter</h1>
            <p className="text-sm text-gray-500 mt-1">{t('nav.adminPanel')}</p>
          </div>

          {/* Navigation — overflow-y-auto so a long list of items (platform
              admin + org sections together can be 20+) scrolls INSIDE the
              sidebar rather than pushing the user info + logout button
              below the viewport on shorter screens. */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              if (item.adminOnly && !isAdmin) {
                return null;
              }
              if (item.saasOnly && !isSaaS) {
                return null;
              }
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
                    isActive(item.path)
                      ? 'bg-primary text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-5 h-5 mr-3" />
                  {t(item.label)}
                </Link>
              );
            })}
            {hasOrganization && (
              <>
                <div className="pt-4 pb-1">
                  <p className="px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    {t('nav.organizationSection')}
                  </p>
                </div>
                {ORG_NAV_ITEMS.map((item) => {
                  if (item.saasOnly && !isSaaS) {
                    return null;
                  }
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`flex items-center px-4 py-3 rounded-lg transition-colors ${
                        isActive(item.path)
                          ? 'bg-primary text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <Icon className="w-5 h-5 mr-3" />
                      {t(item.label)}
                    </Link>
                  );
                })}
              </>
            )}
          </nav>

          {/* User Info */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate flex-shrink">
                    {user?.name || 'User'}
                  </p>
                  {(isAdmin || myOrgRole) && (
                    <span
                      role="status"
                      aria-label={`Role: ${isAdmin ? adminLabel : myOrgRole}`}
                      className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${getRoleBadgeStyles(isAdmin ? adminLabel : myOrgRole!)}`}
                    >
                      {isAdmin ? adminLabel : myOrgRole}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
              <button
                onClick={logout}
                className="ml-2 p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="ml-64">
        {/* Header with Language Switcher */}
        <div className="bg-white border-b border-gray-200 px-8 py-4">
          <div className="flex justify-end">
            <LanguageSwitcher />
          </div>
        </div>
        <main className="p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
