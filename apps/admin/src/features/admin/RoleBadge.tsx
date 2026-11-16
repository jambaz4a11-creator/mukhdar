// شارة الدور بألوان التصميم المعتمد (شاشة "Settings").
import { ROLE_LABELS, type UserRole } from './forms';

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-primary-soft text-primary',
  staff: 'bg-[#E3EEFB] text-[#1C4F8A]',
  driver: 'bg-[#EFE6FA] text-[#5B2E91]',
  customer: 'bg-background text-text-muted',
};

export function RoleBadge({ role, inactive }: { role: UserRole; inactive?: boolean }) {
  return (
    <span
      data-testid="role-badge"
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
        inactive ? 'bg-danger-soft text-danger' : ROLE_COLORS[role]
      }`}
    >
      {inactive ? `${ROLE_LABELS[role]} · معطّل` : ROLE_LABELS[role]}
    </span>
  );
}
