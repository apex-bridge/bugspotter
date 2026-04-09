/**
 * My Organization — Team Members
 * List, add, and remove organization members.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { useOrganization } from '../../contexts/organization-context';
import { organizationService } from '../../services/organization-service';
import { userService } from '../../services/user-service';
import { useDebounce } from '../../hooks/use-debounce';
import { useOrgPermissions } from '../../hooks/use-org-permissions';
import { MembersTable } from '../../components/organizations/members-table';
import { InviteMemberForm } from '../../components/organizations/invite-member-form';
import { PendingInvitationsList } from '../../components/organizations/pending-invitations-list';
import type { OrgMemberRole, InvitationRole, EmailLocale } from '../../types/organization';

export default function OrgMembersPage() {
  const { t } = useTranslation();
  const { currentOrganization: org } = useOrganization();
  const queryClient = useQueryClient();
  const { members, isLoading, canManageMembers, canManageInvitations } = useOrgPermissions();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<Exclude<OrgMemberRole, 'owner'>>('member');
  const [userSearch, setUserSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounce search input to reduce API calls (waits 300ms after user stops typing)
  const debouncedSearch = useDebounce(userSearch, 300);

  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['users-search', debouncedSearch],
    queryFn: async () => {
      const response = await userService.getAll({ page: 1, limit: 20, email: debouncedSearch });
      return response.users;
    },
    enabled: showAddForm && debouncedSearch.length >= 2,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addMemberMutation = useMutation({
    mutationFn: () =>
      organizationService.addMember(org!.id, { user_id: selectedUserId, role: selectedRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members', org?.id] });
      toast.success(t('organization.memberAdded'));
      setShowAddForm(false);
      setSelectedUserId('');
      setSelectedRole('member');
      setUserSearch('');
    },
    onError: () => toast.error(t('organization.memberAddFailed')),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => organizationService.removeMember(org!.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members', org?.id] });
      toast.success(t('organization.memberRemoved'));
    },
    onError: () => toast.error(t('organization.memberRemoveFailed')),
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ['organization-invitations', org?.id],
    queryFn: () => organizationService.listInvitations(org!.id),
    enabled: !!org && canManageInvitations,
  });

  const inviteMutation = useMutation({
    mutationFn: ({
      email,
      role,
      locale,
    }: {
      email: string;
      role: InvitationRole;
      locale?: EmailLocale;
    }) => organizationService.createInvitation(org!.id, { email, role, locale }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invitations', org?.id] });
      toast.success(t('organizations.invitations.sent'));
    },
    onError: (error: Error) =>
      toast.error(error.message || t('organizations.invitations.sendFailed')),
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: (invitationId: string) =>
      organizationService.cancelInvitation(org!.id, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-invitations', org?.id] });
      toast.success(t('organizations.invitations.canceled'));
    },
    onError: () => toast.error(t('organizations.invitations.cancelFailed')),
  });

  if (!org) {
    return null;
  }

  const memberUserIds = new Set(members.map((m) => m.user_id));
  const availableUsers = searchResults?.filter((u) => !memberUserIds.has(u.id)) ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('organization.team')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('organization.teamDescription', { count: members.length })}
          </p>
        </div>
        {canManageMembers && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            {t('organization.addMember')}
          </button>
        )}
      </div>

      {/* Add member form — owner only (backend requires OWNER role) */}
      {showAddForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-end gap-4">
            <div className="flex-1 relative" ref={dropdownRef}>
              <label htmlFor="add-member-email" className="block text-xs text-gray-500 mb-1">
                {t('common.email')}
              </label>
              <input
                id="add-member-email"
                type="text"
                value={userSearch}
                onChange={(e) => {
                  setUserSearch(e.target.value);
                  setSelectedUserId('');
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder={t('organization.searchUserByEmail')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
              {showDropdown && userSearch.length >= 2 && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {isSearching || debouncedSearch !== userSearch ? (
                    <div className="px-3 py-2 text-sm text-gray-400">{t('common.loading')}</div>
                  ) : availableUsers.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">
                      {t('organization.noUsersFound')}
                    </div>
                  ) : (
                    availableUsers.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          setSelectedUserId(user.id);
                          setUserSearch(user.email);
                          setShowDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                      >
                        {user.email} {user.name ? `(${user.name})` : ''}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div>
              <label htmlFor="add-member-role" className="block text-xs text-gray-500 mb-1">
                {t('common.role')}
              </label>
              <select
                id="add-member-role"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as Exclude<OrgMemberRole, 'owner'>)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
            </div>
            <button
              onClick={() => addMemberMutation.mutate()}
              disabled={!selectedUserId || addMemberMutation.isPending}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50"
            >
              {t('common.add')}
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setUserSearch('');
                setSelectedUserId('');
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Members table */}
      {isLoading ? (
        <div role="status" aria-live="polite" className="text-center py-12 text-gray-500">
          {t('common.loading')}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <MembersTable
            members={members}
            onRemove={
              canManageMembers ? (userId) => removeMemberMutation.mutate(userId) : undefined
            }
          />
        </div>
      )}

      {/* Invite by email section — visible to admin + owner (backend allows both) */}
      {canManageInvitations && (
        <div className="mt-6 bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            {t('organizations.invitations.title')}
          </h3>
          <InviteMemberForm
            onSubmit={async (email, role, locale) => {
              await inviteMutation.mutateAsync({ email, role, locale });
            }}
            isLoading={inviteMutation.isPending}
          />
          <PendingInvitationsList
            invitations={invitations}
            onCancel={(invId) => cancelInvitationMutation.mutate(invId)}
            isCanceling={cancelInvitationMutation.isPending}
          />
        </div>
      )}
    </div>
  );
}
