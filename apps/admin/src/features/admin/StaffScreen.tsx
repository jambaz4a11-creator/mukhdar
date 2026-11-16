'use client';
// الموظفون والسواق (أدمن، SPEC-admin §2.6): قائمة غير الزبائن، بحث بالهاتف لأي حساب (للترقية أو
// تصفير الرمز)، تغيير الدور والتفعيل (set_user_role؛ الأدمن لا يخفّض نفسه ولا يعطّلها: رفض
// CANNOT_DEMOTE_SELF من قاعدة البيانات يظهر كرسالة)، إضافة موظف أو سائق (admin-create-user)،
// وتصفير الرمز (admin-reset-pin؛ لا لحساب أدمن).
import { errorMessage } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { inputClass } from '@/features/catalog/ui';
import { displayPhone } from '@/features/orders/format';
import {
  adminKeys,
  currentUserId,
  fetchStaff,
  findByPhone,
  setUserRole,
  type UserRow,
} from './api';
import { ROLE_LABELS, type UserRole } from './forms';
import { CreateUserDialog, ResetPinDialog } from './PinDialogs';
import { RoleBadge } from './RoleBadge';

const ROLES: UserRole[] = ['admin', 'staff', 'driver', 'customer'];

export function StaffScreen() {
  const { supabase } = usePanel();
  const staff = useQuery({ queryKey: adminKeys.staff, queryFn: () => fetchStaff(supabase) });
  const me = useQuery({ queryKey: adminKeys.me, queryFn: () => currentUserId(supabase) });
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 text-[26px] font-bold">الموظفون والسواق</h1>
          <span className="text-sm text-text-muted">
            تصفير الرمز يطلّع الشخص من كل الأجهزة. الأدمن ما يكدر ينزّل دوره أو يعطّل نفسه.
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => searchRef.current?.focus()}
            className="h-11 rounded-control border border-border bg-surface px-3 text-sm"
          >
            + ترقية رقم
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="h-11 rounded-control bg-primary px-4 text-sm font-bold text-white"
          >
            + إضافة موظف أو سائق
          </button>
        </div>
      </header>

      <PhoneSearch
        inputRef={searchRef}
        value={search}
        onChange={setSearch}
        meId={me.data ?? null}
        onReset={setResetting}
      />

      <section
        aria-label="قائمة الموظفين والسواق"
        className="flex flex-col rounded-card border border-border bg-surface px-[18px] py-2"
        data-testid="staff-list"
      >
        {staff.isPending && <p className="text-sm text-text-muted">جارٍ التحميل…</p>}
        {staff.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(staff.error)}
          </p>
        )}
        {(staff.data ?? []).map((u, i) => (
          <UserLine
            key={u.id}
            user={u}
            isMe={u.id === me.data}
            first={i === 0}
            onReset={() => setResetting(u)}
          />
        ))}
        {staff.data?.length === 0 && <p className="text-sm text-text-muted">ماكو موظفين بعد</p>}
      </section>

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onPromote={(phone) => {
            setCreating(false);
            setSearch(displayPhone(phone));
            setTimeout(() => searchRef.current?.focus(), 0);
          }}
        />
      )}
      {resetting && <ResetPinDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function PhoneSearch({
  inputRef,
  value,
  onChange,
  meId,
  onReset,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  meId: string | null;
  onReset: (u: UserRow) => void;
}) {
  const { supabase } = usePanel();
  const [query, setQuery] = useState<string | null>(null);
  const result = useQuery({
    queryKey: adminKeys.search(query ?? ''),
    queryFn: () => findByPhone(supabase, query ?? ''),
    enabled: query !== null,
    retry: false,
  });
  return (
    <section
      aria-label="بحث برقم الهاتف"
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-[18px]"
    >
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(value.trim());
        }}
      >
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-sm font-semibold">
          بحث برقم الهاتف (أي حساب، للترقية أو تصفير الرمز)
          <input
            ref={inputRef}
            inputMode="tel"
            dir="ltr"
            placeholder="07XXXXXXXXX"
            className={`${inputClass} num text-right font-normal`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="h-11 rounded-control border border-border px-4 text-sm font-semibold"
        >
          بحث
        </button>
      </form>
      {query !== null && result.isFetching && (
        <span className="text-sm text-text-muted">جارٍ البحث…</span>
      )}
      {query !== null && result.error && (
        <span role="alert" className="text-sm text-danger">
          {errorMessage(result.error)}
        </span>
      )}
      {query !== null && result.isSuccess && !result.data && (
        <span role="status" className="text-sm text-text-muted" data-testid="search-empty">
          ماكو حساب بهذا الرقم. تكدر تسوي له حساب من "إضافة موظف أو سائق".
        </span>
      )}
      {result.data && (
        <div data-testid="search-result">
          <UserLine
            user={result.data}
            isMe={result.data.id === meId}
            first
            onReset={() => result.data && onReset(result.data)}
          />
        </div>
      )}
    </section>
  );
}

function UserLine({
  user,
  isMe,
  first,
  onReset,
}: {
  user: UserRow;
  isMe: boolean;
  first: boolean;
  onReset: () => void;
}) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const name = user.full_name ?? 'بلا اسم';
  const change = useMutation({
    mutationFn: (v: { role: UserRole; active: boolean }) =>
      setUserRole(supabase, user.id, v.role, v.active),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  // أثناء الحفظ: القيمة المطلوبة؛ بعد الرفض: قيمة الخادم (بلا تغيير)
  const shown = change.isPending && change.variables ? change.variables : null;
  const role = shown?.role ?? user.role;
  const active = shown?.active ?? user.is_active;

  return (
    <div
      data-user-phone={displayPhone(user.phone)}
      className={`flex flex-wrap items-center gap-2.5 py-2.5 ${first ? '' : 'border-t border-divider'}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
        {name.charAt(0)}
      </span>
      <span className="flex min-w-[140px] flex-1 flex-col">
        <span className="text-[15px] font-semibold">
          {name}
          {isMe && <span className="text-xs font-normal text-text-muted"> (أنت)</span>}
        </span>
        <span className="num text-[13px] text-text-muted" dir="ltr" style={{ textAlign: 'right' }}>
          {displayPhone(user.phone)}
        </span>
      </span>
      <RoleBadge role={user.role} inactive={!user.is_active} />
      <label className="flex items-center gap-1.5 text-[13px]">
        <span className="sr-only">الدور لـ{name}</span>
        <select
          value={role}
          disabled={change.isPending}
          onChange={(e) => change.mutate({ role: e.target.value as UserRole, active })}
          className="h-10 rounded-[10px] border border-border bg-surface px-2 text-[13px]"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-10 items-center gap-1.5 text-[13px]">
        <input
          type="checkbox"
          checked={active}
          disabled={change.isPending}
          onChange={(e) => change.mutate({ role, active: e.target.checked })}
          className="h-5 w-5 accent-primary"
          aria-label={`حساب ${name} مفعّل`}
        />
        مفعّل
      </label>
      {user.role !== 'admin' && (
        <button
          type="button"
          onClick={onReset}
          className="h-10 rounded-[10px] border border-border bg-surface px-2.5 text-[13px]"
        >
          تصفير الرمز
        </button>
      )}
      {change.error && (
        <span role="alert" className="basis-full text-[13px] text-danger" data-testid="role-error">
          {errorMessage(change.error)}
        </span>
      )}
    </div>
  );
}
