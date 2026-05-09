import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { projectService } from '../services/api';
import { organizationService } from '../services/organization-service';
import { useAuth } from '../contexts/auth-context';
import { useOrgFilter } from '../hooks/use-org-filter';
import { handleApiError } from '../lib/api-client';
import { formatDateShort } from '../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { FolderPlus, Trash2, Users, Settings, ShieldCheck, Search, Building2 } from 'lucide-react';
import { isPlatformAdmin } from '../types';
import type { Project } from '../types';

type SortField = 'name' | 'created_at' | 'report_count';
type SortOrder = 'asc' | 'desc';

export default function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = isPlatformAdmin(user);
  /** Platform admins can always create/delete; viewers cannot (backend enforces this too) */
  const canCreateProject = isAdmin || (!!user && user.role !== 'viewer');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOrgId, setFilterOrgId] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const queryClient = useQueryClient();

  const { data: organizations } = useQuery({
    queryKey: isAdmin ? ['all-organizations'] : ['my-organizations'],
    queryFn: () =>
      isAdmin
        ? organizationService.list({ limit: 100 }).then((res) => res.data)
        : organizationService.mine(),
    enabled: user !== null,
  });

  const { selectedOrgId: adminOrgScope } = useOrgFilter();

  // Auto-select org for the Create form. Two seeding triggers:
  //   1. Sidebar admin filter is set AND the org actually exists in the
  //      dropdown AND either it CHANGED or the form is still empty.
  //      - "in dropdown" gate is critical: a non-admin pasting a foreign
  //        `?organizationId=` (orgs they don't belong to) would otherwise
  //        seed `selectedOrgId` to a value with no matching `<SelectItem>`,
  //        and an admin with >100 orgs deep-linking past index 100 would
  //        hit the same trap (sidebar fetches 500, this page fetches 100).
  //        Bailing here keeps the form coherent with the dropdown.
  //      - "changed" gate stops a background refetch of `organizations`
  //        (window focus / staleTime expiry) from clobbering a manual
  //        selection.
  //      - "empty" fallback covers the deep-link case
  //        (`/projects?organizationId=X` on first load) — without it,
  //        `previousAdminOrgScope.current` would already equal
  //        `adminOrgScope` and the form would open blank.
  //   2. Sole org membership — one-time initialisation when the user
  //      belongs to exactly one org and the form is still blank.
  const previousAdminOrgScope = useRef<string | null>(null);
  useEffect(() => {
    const scopeIsKnown = !!adminOrgScope && !!organizations?.some((o) => o.id === adminOrgScope);
    if (scopeIsKnown && (adminOrgScope !== previousAdminOrgScope.current || !selectedOrgId)) {
      setSelectedOrgId(adminOrgScope!);
      previousAdminOrgScope.current = adminOrgScope;
      return;
    }
    previousAdminOrgScope.current = adminOrgScope;
    if (organizations?.length === 1) {
      setSelectedOrgId((current) => current || organizations[0].id);
    }
  }, [organizations, adminOrgScope, selectedOrgId]);
  const { data: projects, isLoading } = useQuery({
    // Separate namespace from the unscoped `['projects']` key used by
    // notification dialogs / channels-list etc. (see `use-onboarding-status`
    // for the convention). The latter dedups across consumers that all
    // fetch the user's projects via `projectService.getAll()`; this page
    // fetches admin-scoped data via `projectService.getAll(adminOrgScope)`,
    // which is fundamentally different data and needs its own cache space.
    // Mutations below invalidate BOTH keys so a created/deleted project
    // flushes the cache regardless of which surface triggered the change.
    queryKey: ['admin-projects', adminOrgScope],
    queryFn: () => projectService.getAll(adminOrgScope),
  });

  // Derive org filter options from actual projects (works for admins who see all projects)
  const projectOrgs = useMemo(() => {
    if (!projects || !organizations) {
      return [];
    }
    const orgIds = new Set(
      projects.map((p: Project) => p.organization_id).filter((id): id is string => !!id)
    );
    return organizations.filter((org) => orgIds.has(org.id));
  }, [projects, organizations]);

  // Reset org filter if the selected org is no longer in the list
  useEffect(() => {
    if (filterOrgId && !projectOrgs.some((o) => o.id === filterOrgId)) {
      setFilterOrgId('');
    }
  }, [projectOrgs, filterOrgId]);

  const filteredProjects = useMemo(() => {
    if (!projects) {
      return [];
    }

    let result = projects;

    // Filter by organization
    if (filterOrgId) {
      result = result.filter((p: Project) => p.organization_id === filterOrgId);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((p: Project) => p.name.toLowerCase().includes(query));
    }

    // Sort
    result = [...result].sort((a: Project, b: Project) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === 'created_at') {
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      } else if (sortField === 'report_count') {
        cmp = (a.report_count ?? 0) - (b.report_count ?? 0);
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [projects, filterOrgId, searchQuery, sortField, sortOrder]);

  const createMutation = useMutation({
    mutationFn: ({ name, orgId }: { name: string; orgId?: string }) =>
      projectService.create(name, orgId),
    onSuccess: () => {
      // Invalidate both the unscoped key (notification dialogs / channels-list /
      // useOnboardingStatus indirectly) and the admin-scoped key this page reads.
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['admin-projects'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-projects'] });
      toast.success(t('projects.projectCreatedSuccess'));
      setProjectName('');
      setShowCreateForm(false);
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: projectService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['admin-projects'] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-projects'] });
      toast.success(t('projects.projectDeletedSuccess'));
      setDeleteConfirm(null);
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const hasOrgs = organizations && organizations.length > 0;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) {
      return;
    }
    createMutation.mutate({
      name: projectName,
      orgId: selectedOrgId || undefined,
    });
  };

  const handleDelete = (id: string) => {
    if (deleteConfirm === id) {
      deleteMutation.mutate(id);
    } else {
      setDeleteConfirm(id);
      setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'name' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('projects.title')}</h1>
          <p className="text-gray-500 mt-1">{t('projects.description')}</p>
        </div>
        <Button
          onClick={() => setShowCreateForm(!showCreateForm)}
          disabled={!canCreateProject}
          data-testid="new-project-button"
        >
          <FolderPlus className="w-4 h-4 mr-2" aria-hidden="true" />
          {t('projects.newProject')}
        </Button>
      </div>

      {showCreateForm && (
        <Card data-testid="create-project-form">
          <CardHeader>
            <CardTitle>{t('projects.createNewProject')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              {hasOrgs && (
                <Select
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}
                  label={t('projects.organization')}
                  data-testid="project-org-select"
                  required
                >
                  <option value="">{t('projects.selectOrganization')}</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                label={t('projects.projectName')}
                placeholder={t('projects.projectNamePlaceholder')}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                data-testid="project-name-input"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  isLoading={createMutation.isPending}
                  disabled={hasOrgs && !selectedOrgId}
                  data-testid="create-project-submit"
                >
                  {t('projects.create')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreateForm(false)}
                  data-testid="cancel-create-project"
                >
                  {t('projects.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-end">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            aria-hidden="true"
          />
          <Input
            type="text"
            role="searchbox"
            aria-label={t('projects.searchLabel')}
            placeholder={t('projects.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="projects-search"
          />
        </div>
        {projectOrgs.length > 1 && (
          <div className="relative">
            <Building2
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
              aria-hidden="true"
            />
            <Select
              value={filterOrgId}
              onChange={(e) => setFilterOrgId(e.target.value)}
              aria-label={t('projects.filterByOrganization')}
              className="pl-10 min-w-[200px]"
              data-testid="projects-org-filter"
            >
              <option value="">{t('projects.allOrganizations')}</option>
              {projectOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={sortField === 'name' ? 'primary' : 'outline'}
            onClick={() => handleSortChange('name')}
            aria-label={t('projects.sortByName')}
            aria-pressed={sortField === 'name'}
            data-testid="sort-by-name"
          >
            {t('projects.sortName')} {sortField === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sortField === 'created_at' ? 'primary' : 'outline'}
            onClick={() => handleSortChange('created_at')}
            aria-label={t('projects.sortByDate')}
            aria-pressed={sortField === 'created_at'}
            data-testid="sort-by-date"
          >
            {t('projects.sortDate')}{' '}
            {sortField === 'created_at' && (sortOrder === 'asc' ? '↑' : '↓')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={sortField === 'report_count' ? 'primary' : 'outline'}
            onClick={() => handleSortChange('report_count')}
            aria-label={t('projects.sortByReports')}
            aria-pressed={sortField === 'report_count'}
            data-testid="sort-by-reports"
          >
            {t('projects.sortReports')}{' '}
            {sortField === 'report_count' && (sortOrder === 'asc' ? '↑' : '↓')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div
          className="flex items-center justify-center min-h-[400px]"
          data-testid="projects-loading"
        >
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredProjects.map((project) => (
            <Card key={project.id} data-testid={`project-card-${project.id}`}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3
                      className="text-xl font-semibold mb-2"
                      data-testid={`project-name-${project.id}`}
                    >
                      {project.name}
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="text-gray-600">
                        {t('projects.created')}: {formatDateShort(project.created_at)}
                      </div>
                      <div className="text-gray-600">
                        {t('projects.reports')}: {project.report_count}
                      </div>
                      <div className="text-gray-500 text-xs mt-2">
                        {t('projects.manageApiKeys')}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/projects/${project.id}/integrations`)}
                      aria-label={t('projects.manageIntegrations', { name: project.name })}
                    >
                      <Settings className="w-4 h-4 mr-1" aria-hidden="true" />
                      {t('projects.integrations')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/projects/${project.id}/data-residency`)}
                      aria-label={t('projects.manageDataResidency', { name: project.name })}
                    >
                      <ShieldCheck className="w-4 h-4 mr-1" aria-hidden="true" />
                      {t('projects.dataResidency')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/projects/${project.id}/members`)}
                      aria-label={t('projects.manageMembers', { name: project.name })}
                    >
                      <Users className="w-4 h-4 mr-1" aria-hidden="true" />
                      {t('projects.members')}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(project.id)}
                      disabled={!user || (!isAdmin && user.role === 'viewer')}
                      isLoading={deleteMutation.isPending && deleteConfirm === project.id}
                      data-testid={`delete-project-${project.id}`}
                    >
                      <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />
                      {deleteConfirm === project.id
                        ? t('projects.confirmDelete')
                        : t('projects.delete')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filteredProjects.length === 0 && projects && projects.length > 0 && (
            <Card data-testid="projects-no-results">
              <CardContent className="pt-6 text-center text-gray-500">
                {t('projects.noSearchResults')}
              </CardContent>
            </Card>
          )}
          {projects?.length === 0 && (
            <Card data-testid="projects-empty">
              <CardContent className="pt-6 text-center text-gray-500">
                {t('pages.no.projects')}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
