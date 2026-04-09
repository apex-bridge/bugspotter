import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { userService, projectMemberService } from '../services/api';
import { formatDateShort } from '../utils/format';
import { useModalFocus } from '../hooks/use-modal-focus';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Plus, Search, Trash2, Edit2, ChevronLeft, ChevronRight, FolderOpen } from 'lucide-react';
import type { User, CreateUserRequest, UpdateUserRequest, UserRole } from '../types';

export default function UsersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [searchEmail, setSearchEmail] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [viewingProjectsUser, setViewingProjectsUser] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, searchEmail, roleFilter],
    queryFn: () =>
      userService.getAll({
        page,
        limit: 20,
        ...(searchEmail && { email: searchEmail }),
        ...(roleFilter && { role: roleFilter }),
      }),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateUserRequest) => userService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('users.userCreatedSuccess'));
      setShowModal(false);
    },
    onError: () => toast.error(t('errors.failedToCreateUser')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserRequest }) =>
      userService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('users.userUpdatedSuccess'));
      setShowModal(false);
      setEditingUser(null);
    },
    onError: () => toast.error(t('errors.failedToUpdateUser')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => userService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success(t('users.userDeletedSuccess'));
    },
    onError: () => toast.error(t('errors.failedToDeleteUser')),
  });

  const handleCreate = () => {
    setEditingUser(null);
    setShowModal(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setShowModal(true);
  };

  const handleDelete = useCallback(
    (id: string) => {
      if (window.confirm(t('users.deleteConfirm'))) {
        deleteMutation.mutate(id);
      }
    },
    [deleteMutation, t]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{t('users.title')}</h1>
        <Button onClick={handleCreate} data-testid="add-user-button">
          <Plus className="w-4 h-4 mr-2" />
          {t('users.addUser')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="search-email"
                className="text-sm font-medium text-gray-700 block mb-2"
              >
                {t('users.searchByEmail')}
              </label>
              <div className="relative">
                <Search
                  className="absolute left-3 top-3 w-4 h-4 text-gray-400"
                  aria-hidden="true"
                />
                <Input
                  id="search-email"
                  placeholder={t('users.searchPlaceholder')}
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select
              label={t('common.role')}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as UserRole | '')}
            >
              <option value="">{t('users.allRoles')}</option>
              <option value="admin">{t('users.roleAdmin')}</option>
              <option value="user">{t('users.roleUser')}</option>
              <option value="viewer">{t('users.roleViewer')}</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div
              className="text-center py-8"
              role="status"
              aria-live="polite"
              data-testid="users-loading"
            >
              {t('users.loadingUsers')}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full" data-testid="users-table">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">{t('common.email')}</th>
                      <th className="text-left py-3 px-4">{t('common.name')}</th>
                      <th className="text-left py-3 px-4">{t('common.role')}</th>
                      <th className="text-left py-3 px-4">{t('common.provider')}</th>
                      <th className="text-right py-3 px-4">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.users.map((user) => (
                      <tr
                        key={user.id}
                        className="border-b hover:bg-gray-50"
                        data-testid={`user-row-${user.id}`}
                      >
                        <td className="py-3 px-4" data-testid={`user-email-${user.id}`}>
                          {user.email}
                        </td>
                        <td className="py-3 px-4">{user.name}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                              user.role === 'admin'
                                ? 'bg-red-100 text-red-800'
                                : user.role === 'user'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {user.role}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {user.oauth_provider || t('users.passwordProvider')}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setViewingProjectsUser({ id: user.id, name: user.name })}
                            title={t('users.viewProjects')}
                            aria-label={t('users.viewProjects')}
                          >
                            <FolderOpen className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEdit(user)}
                            aria-label={t('common.edit')}
                          >
                            <Edit2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(user.id)}
                            aria-label={t('common.delete')}
                            data-testid={`delete-user-${user.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" aria-hidden="true" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data && (
                <div className="flex justify-between items-center mt-4">
                  <div className="text-sm text-gray-600">
                    {t('users.showingUsers', {
                      from: (page - 1) * 20 + 1,
                      to: Math.min(page * 20, data.pagination.total),
                      total: data.pagination.total,
                    })}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="px-3 py-1">
                      {t('common.page')} {page} {t('common.of')} {data.pagination.totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={page >= data.pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {showModal && (
        <UserFormModal
          user={editingUser}
          onClose={() => {
            setShowModal(false);
            setEditingUser(null);
          }}
          onCreate={(data) => createMutation.mutate(data)}
          onUpdate={(id, data) => updateMutation.mutate({ id, data })}
        />
      )}

      {viewingProjectsUser && (
        <UserProjectsModal
          userId={viewingProjectsUser.id}
          userName={viewingProjectsUser.name}
          onClose={() => setViewingProjectsUser(null)}
        />
      )}
    </div>
  );
}

function UserFormModal({
  user,
  onClose,
  onCreate,
  onUpdate,
}: {
  user: User | null;
  onClose: () => void;
  onCreate?: (data: CreateUserRequest) => void;
  onUpdate?: (id: string, data: UpdateUserRequest) => void;
}) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    email: user?.email || '',
    name: user?.name || '',
    password: '',
    role: (user?.role || 'user') as UserRole,
  });

  // Focus management, body scroll lock, and ESC key handler
  useModalFocus(modalRef, true, onClose);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (user && onUpdate) {
      // Edit mode - only send changed fields
      onUpdate(user.id, {
        name: formData.name,
        email: formData.email,
        role: formData.role,
      });
    } else if (onCreate) {
      // Create mode - send all fields including password
      onCreate({
        email: formData.email,
        name: formData.name,
        password: formData.password,
        role: formData.role,
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        ref={modalRef}
        className="bg-white rounded-lg p-6 w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-form-modal-title"
        tabIndex={-1}
        data-testid="user-form-modal"
      >
        <h2 id="user-form-modal-title" className="text-xl font-bold mb-4">
          {user ? t('users.editUser') : t('users.createUser')}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t('common.email')}
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            data-testid="user-email-input"
          />
          <Input
            label={t('common.name')}
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            data-testid="user-name-input"
          />
          {!user && (
            <Input
              label={t('common.password')}
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              minLength={8}
              maxLength={128}
              required
              helperText={t('users.minimumCharacters')}
              data-testid="user-password-input"
            />
          )}
          <Select
            label={t('common.role')}
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
            required
          >
            <option value="user">{t('users.roleUser')}</option>
            <option value="admin">{t('users.roleAdmin')}</option>
            <option value="viewer">{t('users.roleViewer')}</option>
          </Select>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" data-testid="user-form-submit">
              {user ? t('common.update') : t('common.create')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UserProjectsModal({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  const { data: projects, isLoading } = useQuery({
    queryKey: ['userProjects', userId],
    queryFn: () => projectMemberService.getUserProjects(userId),
  });

  // Focus management, body scroll lock, and ESC key handler
  useModalFocus(modalRef, true, onClose);

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="projects-modal-title"
        tabIndex={-1}
      >
        <h2 id="projects-modal-title" className="text-xl font-bold mb-4">
          {t('users.projectsTitle', { name: userName })}
        </h2>

        {isLoading ? (
          <div className="text-center py-8">
            <div
              className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"
              role="status"
              aria-live="polite"
            >
              <span className="sr-only">{t('users.loadingProjects')}</span>
            </div>
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="space-y-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className="border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50"
              >
                <div>
                  <h3 className="font-medium">{project.name}</h3>
                  <p className="text-sm text-gray-500">
                    {project.role === 'owner' && '👑 '}
                    {project.role === 'owner'
                      ? t('users.owner')
                      : project.role.charAt(0).toUpperCase() + project.role.slice(1)}
                  </p>
                </div>
                <div className="text-sm text-gray-500">
                  {t('common.joined')}: {formatDateShort(project.created_at)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">{t('users.noProjects')}</div>
        )}

        <div className="flex justify-end mt-6">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
