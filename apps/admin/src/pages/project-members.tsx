import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { projectMemberService, projectService, userService } from '../services/api';
import { handleApiError } from '../lib/api-client';
import { useProjectPermissions } from '../hooks/use-project-permissions';
import { formatDateShort } from '../utils/format';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select } from '../components/ui/select';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { ArrowLeft, UserPlus, Trash2, Crown, Shield, User, Eye } from 'lucide-react';
import type { ProjectMemberRole } from '../types';

export default function ProjectMembersPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canManageMembers } = useProjectPermissions(projectId);
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{
    userId: string;
    userName: string;
  } | null>(null);

  if (!projectId) {
    navigate('/projects');
    return null;
  }

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectService.getById(projectId),
  });

  const { data: members, isLoading } = useQuery({
    queryKey: ['projectMembers', projectId],
    queryFn: () => projectMemberService.getMembers(projectId),
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await userService.getAll({ page: 1, limit: 100 });
      return response.users;
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' | 'viewer' }) =>
      projectMemberService.addMember(projectId, { user_id: userId, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
      toast.success('Member added successfully');
      setShowAddForm(false);
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' | 'viewer' }) =>
      projectMemberService.updateMemberRole(projectId, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
      toast.success('Member role updated successfully');
    },
    onError: (error) => {
      toast.error(handleApiError(error));
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => projectMemberService.removeMember(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectMembers', projectId] });
      toast.success('Member removed successfully');
      setConfirmRemove(null);
    },
    onError: (error) => {
      toast.error(handleApiError(error));
      setConfirmRemove(null);
    },
  });

  const handleRemoveMember = useCallback((userId: string, userName: string) => {
    setConfirmRemove({ userId, userName });
  }, []);

  // Get available users (not already members)
  const availableUsers =
    allUsers?.filter((user) => !members?.some((member) => member.user_id === user.id)) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/projects')} aria-label="Back to projects">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Project Members</h1>
          <p className="text-gray-500 mt-1">{project?.name || 'Loading...'}</p>
        </div>
        <Button onClick={() => setShowAddForm(!showAddForm)} disabled={!canManageMembers}>
          <UserPlus className="w-4 h-4 mr-2" aria-hidden="true" />
          Add Member
        </Button>
      </div>

      {/* Add Member Form */}
      {showAddForm && (
        <AddMemberForm
          availableUsers={availableUsers}
          onSubmit={(userId, role) => addMemberMutation.mutate({ userId, role })}
          onCancel={() => setShowAddForm(false)}
          isLoading={addMemberMutation.isPending}
        />
      )}

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <div
                className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"
                role="status"
                aria-live="polite"
              >
                <span className="sr-only">Loading members...</span>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">
                    Project team members with their roles and management actions
                  </caption>
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4">User</th>
                      <th className="text-left py-3 px-4">Role</th>
                      <th className="text-left py-3 px-4">Added</th>
                      <th className="text-right py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members?.map((member) => (
                      <tr key={member.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4">
                          <div>
                            <div className="font-medium">{member.user_name || 'Unknown'}</div>
                            <div className="text-sm text-gray-500">{member.user_email}</div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <RoleBadge role={member.role} />
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {formatDateShort(member.created_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {member.role === 'owner' ? (
                            <span className="text-sm text-gray-500">Project Owner</span>
                          ) : (
                            <div className="flex gap-2 justify-end">
                              <RoleSelector
                                currentRole={member.role}
                                onChange={(role) =>
                                  updateMemberMutation.mutate({ userId: member.user_id, role })
                                }
                                disabled={!canManageMembers || updateMemberMutation.isPending}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  handleRemoveMember(member.user_id, member.user_name || 'User')
                                }
                                disabled={!canManageMembers}
                                isLoading={removeMemberMutation.isPending}
                                aria-label={`Remove ${member.user_name || 'user'} from project`}
                              >
                                <Trash2 className="w-4 h-4 text-red-600" aria-hidden="true" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {members?.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No members yet. Add team members to collaborate on this project.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Confirm Remove Dialog */}
      <ConfirmDialog
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) {
            removeMemberMutation.mutate(confirmRemove.userId);
          }
        }}
        title="Remove Team Member"
        message={`Are you sure you want to remove ${confirmRemove?.userName || 'this user'} from the project? They will lose access to all project data.`}
        confirmText="Remove Member"
        cancelText="Cancel"
        variant="danger"
        isLoading={removeMemberMutation.isPending}
      />
    </div>
  );
}

function AddMemberForm({
  availableUsers,
  onSubmit,
  onCancel,
  isLoading,
}: {
  availableUsers: Array<{ id: string; email: string; name: string }>;
  onSubmit: (userId: string, role: 'admin' | 'member' | 'viewer') => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'member' | 'viewer'>('member');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) {
      toast.error(t('errors.pleaseSelectUser'));
      return;
    }
    onSubmit(selectedUser, selectedRole);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Team Member</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="user-select" className="block text-sm font-medium mb-2">
              User
            </label>
            <Select
              id="user-select"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              required
            >
              <option value="">Select a user...</option>
              {availableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </Select>
            {availableUsers.length === 0 && (
              <p className="text-sm text-gray-500 mt-2">
                All users are already members of this project.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="role-select" className="block text-sm font-medium mb-2">
              Role
            </label>
            <Select
              id="role-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as 'admin' | 'member' | 'viewer')}
              required
            >
              <option value="admin">Admin - Can manage project and members</option>
              <option value="member">Member - Can view and manage bug reports</option>
              <option value="viewer">Viewer - Can only view bug reports</option>
            </Select>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={isLoading}
              disabled={availableUsers.length === 0 || !selectedUser}
            >
              Add Member
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function RoleBadge({ role }: { role: ProjectMemberRole }) {
  const config = {
    owner: { icon: Crown, color: 'text-purple-800', bg: 'bg-purple-100', label: 'Owner' },
    admin: { icon: Shield, color: 'text-red-800', bg: 'bg-red-100', label: 'Admin' },
    member: { icon: User, color: 'text-blue-800', bg: 'bg-blue-100', label: 'Member' },
    viewer: { icon: Eye, color: 'text-gray-800', bg: 'bg-gray-100', label: 'Viewer' },
  };

  const { icon: Icon, color, bg, label } = config[role];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${bg} ${color}`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function RoleSelector({
  currentRole,
  onChange,
  disabled,
}: {
  currentRole: ProjectMemberRole;
  onChange: (role: 'admin' | 'member' | 'viewer') => void;
  disabled: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (disabled) {
      setIsEditing(false);
    }
  }, [disabled]);

  if (currentRole === 'owner') {
    return null;
  }

  if (!isEditing) {
    return (
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsEditing(true)}
        disabled={disabled}
        aria-label={`Change role from ${currentRole}`}
      >
        Change Role
      </Button>
    );
  }

  return (
    <div className="flex gap-1">
      <Select
        value={currentRole}
        onChange={(e) => {
          const newRole = e.target.value as 'admin' | 'member' | 'viewer';
          onChange(newRole);
          setIsEditing(false);
        }}
        className="text-sm"
        disabled={disabled}
        aria-label="Select new role"
      >
        <option value="admin">Admin</option>
        <option value="member">Member</option>
        <option value="viewer">Viewer</option>
      </Select>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setIsEditing(false)}
        disabled={disabled}
        aria-label="Cancel role change"
      >
        ✕
      </Button>
    </div>
  );
}
