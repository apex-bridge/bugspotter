import type { OrgMemberRole } from '../../types/organization';

const ROLE_COLORS: Record<OrgMemberRole, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-red-100 text-red-700',
  member: 'bg-green-100 text-green-700',
};

interface Props {
  role: OrgMemberRole;
}

export function RoleBadge({ role }: Props) {
  return (
    <span
      role="status"
      aria-label={`Member role: ${role}`}
      data-testid={`role-badge-${role}`}
      className={`px-2 py-1 text-xs font-medium rounded-full ${ROLE_COLORS[role]}`}
    >
      {role}
    </span>
  );
}
