'use client';
// الإعدادات (أدمن، SPEC-admin §2.7، تصميم "Settings"): فتح/غلق المتجر ورسالته، الأجرة، الحد الأدنى،
// حد الطلبات المفتوحة؛ الحفظ بـ update_app_settings فقط. مؤشر الإشعارات العالقة، وبطاقتا الموظفين
// والعناوين (روابط لصفحتيهما).
import { errorMessage, formatSector } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { FeeSettingsCard } from '@/features/cash/FeeSettingsCard';
import { inputClass } from '@/features/catalog/ui';
import {
  adminKeys,
  fetchAddressTree,
  fetchSettings,
  fetchStaff,
  dismissFailedNotifications,
  fetchNotificationHealth,
  saveSettings,
  type AppSettings,
} from './api';
import { validateSettings, type SettingsErrors, type SettingsValues } from './forms';
import { RoleBadge } from './RoleBadge';

function toValues(s: AppSettings): SettingsValues {
  return {
    delivery_fee_iqd: String(s.delivery_fee_iqd),
    min_order_iqd: String(s.min_order_iqd),
    max_active_orders: String(s.max_active_orders),
    new_account_max_active_orders: String(s.new_account_max_active_orders),
    max_line_qty: String(s.max_line_qty),
    max_order_lines: String(s.max_order_lines),
    max_order_iqd: String(s.max_order_iqd),
    new_account_max_order_iqd: String(s.new_account_max_order_iqd),
    store_open: s.store_open,
    closed_message: s.closed_message ?? '',
  };
}

const cardClass = 'flex flex-col gap-3.5 rounded-card border border-border bg-surface p-[18px]';

export function SettingsScreen() {
  const { supabase } = usePanel();
  const settings = useQuery({
    queryKey: adminKeys.settings,
    queryFn: () => fetchSettings(supabase),
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 text-[26px] font-bold">الإعدادات والموظفون</h1>
      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        {settings.data ? (
          // بلا key: الحفظ يعيد الجلب، والنموذج يبقى (ورسالة "انحفظت" معه)
          <SettingsForm initial={settings.data} />
        ) : (
          <section className={cardClass} aria-label="إعدادات المتجر">
            <h2 className="m-0 text-[17px] font-bold">إعدادات المتجر</h2>
            <p className="m-0 text-sm text-text-muted">
              {settings.error ? errorMessage(settings.error) : 'جارٍ التحميل…'}
            </p>
          </section>
        )}
        <FeeSettingsCard />
        <StaffSummary />
      </div>
      <AddressSummary />
    </div>
  );
}

function SettingsForm({ initial }: { initial: AppSettings }) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const [values, setValues] = useState<SettingsValues>(() => toValues(initial));
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) => {
    setSaved(false);
    setValues((s) => ({ ...s, [k]: v }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const r = validateSettings(values);
      setErrors(r.errors ?? {});
      if (!r.payload) return false;
      await saveSettings(supabase, r.payload);
      return true;
    },
    onSuccess: async (ok) => {
      if (!ok) return;
      setSaved(true);
      await qc.invalidateQueries({ queryKey: adminKeys.settings });
    },
  });

  const numberField = (
    key:
      | 'delivery_fee_iqd'
      | 'min_order_iqd'
      | 'max_active_orders'
      | 'new_account_max_active_orders'
      | 'max_line_qty'
      | 'max_order_lines'
      | 'max_order_iqd'
      | 'new_account_max_order_iqd',
    label: string,
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={`s-${key}`} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={`s-${key}`}
        inputMode="numeric"
        className={`${inputClass} num min-w-0 ${errors[key] ? 'border-danger' : ''}`}
        value={values[key]}
        aria-invalid={errors[key] ? 'true' : undefined}
        onChange={(e) => set(key, e.target.value)}
      />
      {errors[key] && (
        <span role="alert" className="text-xs text-danger" data-testid={`error-${key}`}>
          {errors[key]}
        </span>
      )}
    </div>
  );

  return (
    <section aria-label="إعدادات المتجر" className={cardClass}>
      <h2 className="m-0 text-[17px] font-bold">إعدادات المتجر</h2>
      <form
        className="flex flex-col gap-3.5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label
          className={`flex min-h-[52px] cursor-pointer items-center justify-between gap-3 rounded-control px-3.5 ${
            values.store_open ? 'bg-primary-soft' : 'bg-warning-soft'
          }`}
        >
          <span className="flex flex-col">
            <span
              className={`text-[15px] font-bold ${values.store_open ? 'text-primary' : 'text-warning-text'}`}
            >
              {values.store_open ? 'المتجر مفتوح' : 'المتجر مغلق'}
            </span>
            <span className="text-xs text-text-muted">
              {values.store_open
                ? 'الزبائن يكدرون يطلبون هسه'
                : 'التطبيق يعرض رسالة الإغلاق ويمنع الطلب'}
            </span>
          </span>
          <input
            type="checkbox"
            checked={values.store_open}
            onChange={(e) => set('store_open', e.target.checked)}
            aria-label="المتجر مفتوح"
            className="h-[22px] w-[22px] accent-primary"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="s-closed_message" className="text-sm font-semibold">
            رسالة الإغلاق
          </label>
          <input
            id="s-closed_message"
            className={inputClass}
            maxLength={200}
            placeholder="مثلاً: نستقبل الطلبات من 8 صباحاً"
            value={values.closed_message}
            onChange={(e) => set('closed_message', e.target.value)}
          />
          {errors.closed_message && (
            <span role="alert" className="text-xs text-danger">
              {errors.closed_message}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {numberField('delivery_fee_iqd', 'أجرة التوصيل (د.ع)')}
          {numberField('min_order_iqd', 'الحد الأدنى للطلب')}
          {numberField('max_active_orders', 'حد الطلبات المفتوحة للزبون')}
          {numberField('new_account_max_active_orders', 'حد الطلبات المفتوحة للحساب الجديد')}
          {numberField('max_line_qty', 'أقصى كمية لكل منتج بالطلب')}
          {numberField('max_order_lines', 'أقصى عدد منتجات بالطلب')}
          {numberField('max_order_iqd', 'أقصى مجموع للطلب (د.ع)')}
          {numberField('new_account_max_order_iqd', 'أقصى مجموع لطلب الحساب الجديد (د.ع)')}
        </div>
        <span className="text-xs text-text-muted">
          المبالغ لازم تكون من مضاعفات 250. الكمية بوحدة البيع: 20 = 10 كيلو للخضار والفواكه (نص
          كيلو). الحساب الجديد (بلا طلب مُسلَّم بعد) يُطبَّق عليه حد الحساب الجديد ثم الحد العادي.
          المجموع يشمل أجرة التوصيل.
        </span>
        {save.error && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {errorMessage(save.error)}
          </p>
        )}
        {saved && !save.error && (
          <p
            role="status"
            data-testid="settings-saved"
            className="m-0 rounded-control bg-primary-soft px-3 py-2 text-sm text-primary"
          >
            انحفظت الإعدادات
          </p>
        )}
        <button
          type="submit"
          disabled={save.isPending}
          className="h-12 rounded-control bg-primary text-[15px] font-bold text-white disabled:opacity-60"
        >
          {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
        </button>
      </form>
      <StuckIndicator />
    </section>
  );
}

/**
 * حالة الإشعارات (SPEC-admin §2.7): "عالق" = قابل لإعادة المحاولة وأقدم من 5 دقائق (المرسِل متوقف أو بطيء)،
 * و"فشل نهائياً" = استنفد المحاولات (رمز جهاز تالف مثلاً) ويصرفه الأدمن بزر "تجاهل"، فلا يبقى المؤشر أحمر للأبد.
 */
function StuckIndicator() {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const health = useQuery({
    queryKey: adminKeys.stuck,
    queryFn: () => fetchNotificationHealth(supabase),
    refetchInterval: 60_000,
  });
  const dismiss = useMutation({
    mutationFn: () => dismissFailedNotifications(supabase),
    onSettled: () => qc.invalidateQueries({ queryKey: adminKeys.stuck }),
  });
  if (health.isPending) return <span className="text-[13px] text-text-muted">فحص الإشعارات…</span>;
  if (health.error)
    return (
      <span role="status" className="text-[13px] text-danger">
        تعذّر فحص الإشعارات
      </span>
    );
  const { stuck: n, failed } = health.data;
  return (
    <div id="notifications" className="flex scroll-mt-4 flex-col gap-2">
      <StuckLine n={n} />
      {failed > 0 && (
        <div
          role="status"
          data-testid="failed-notifications"
          className="flex flex-wrap items-center gap-2 rounded-control border border-border px-3 py-2 text-[13px] text-text-muted"
        >
          <span>
            <span className="num">{failed}</span> إشعار فشل نهائياً (استنفد المحاولات، غالباً جهاز
            لا يستلم). هذا لا يعني أن الإرسال متوقف.
          </span>
          <button
            type="button"
            data-testid="dismiss-failed"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate()}
            className="h-8 rounded-md border border-border bg-surface px-3 text-xs font-bold text-text disabled:opacity-60"
          >
            {dismiss.isPending ? 'جارٍ التجاهل…' : 'تجاهل'}
          </button>
          {dismiss.error && (
            <span role="alert" className="basis-full text-xs text-danger">
              {errorMessage(dismiss.error)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StuckLine({ n }: { n: number }) {
  return n > 0 ? (
    <div
      role="status"
      data-testid="stuck-notifications"
      className="flex items-center gap-2 rounded-control bg-warning-soft px-3 py-2 text-[13px] text-warning-text"
    >
      <span aria-hidden="true">!</span>
      <span>
        <span className="num">{n}</span> إشعار عالق (ما انرسل من أكثر من 5 دقايق وما زال يُعاد
        إرساله)
      </span>
    </div>
  ) : (
    <div
      role="status"
      data-testid="stuck-notifications"
      className="flex items-center gap-2 text-[13px] text-primary"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12l5 5 9-10" />
      </svg>
      الإشعارات شغّالة · ماكو إشعارات عالقة
    </div>
  );
}

function StaffSummary() {
  const { supabase } = usePanel();
  const staff = useQuery({ queryKey: adminKeys.staff, queryFn: () => fetchStaff(supabase) });
  const rows = (staff.data ?? []).filter((r) => r.is_active).slice(0, 6);
  return (
    <section aria-label="الموظفون والسائقون" className={cardClass}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[17px] font-bold">الموظفون والسائقون</h2>
        <Link
          href="/staff"
          className="flex h-10 items-center rounded-control border border-border px-3 text-sm text-text no-underline"
        >
          إدارة
        </Link>
      </div>
      <Link href="/driver-requests" className="text-sm font-semibold text-primary">
        طلبات السواق (تسجيل سائق جديد)
      </Link>
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2.5 border-t border-divider pt-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
            {(r.full_name ?? '؟').charAt(0)}
          </span>
          <span className="min-w-0 flex-1 text-[15px] font-semibold">
            {r.full_name ?? 'بلا اسم'}
          </span>
          <RoleBadge role={r.role} />
        </div>
      ))}
      {staff.isPending && <span className="text-sm text-text-muted">جارٍ التحميل…</span>}
      <span className="text-xs text-text-muted">
        إضافة موظف أو سائق، ترقية رقم، وتصفير الرمز (يطلّعه من كل الأجهزة) من صفحة الموظفين.
      </span>
    </section>
  );
}

function AddressSummary() {
  const { supabase } = usePanel();
  const tree = useQuery({
    queryKey: adminKeys.addresses,
    queryFn: () => fetchAddressTree(supabase),
  });
  return (
    <section aria-label="العناوين" className={cardClass}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[17px] font-bold">العناوين</h2>
        <Link
          href="/addresses"
          className="flex h-10 items-center rounded-control border border-border px-3 text-sm text-text no-underline"
        >
          إدارة العناوين
        </Link>
      </div>
      <div className="flex flex-wrap gap-3">
        {(tree.data ?? []).map((s) => {
          const units = s.subsections.filter((u) => u.is_active);
          const buildings = units.reduce(
            (n, u) => n + u.buildings.filter((b) => b.is_active).length,
            0,
          );
          return (
            <div
              key={s.id}
              className="flex flex-[1_1_260px] flex-col gap-1.5 rounded-control border border-border p-3.5"
            >
              <span className="text-[15px] font-bold">
                {formatSector(s.name)}
                {!s.is_active && (
                  <span className="text-xs font-normal text-text-muted"> (مخفي)</span>
                )}
              </span>
              <span className="num text-[13px] text-text-muted">
                {units.length} وحدات
                {units.length > 0 &&
                  ` (${units[0]?.name} إلى ${units[units.length - 1]?.name})`} · {buildings} بناية
              </span>
            </div>
          );
        })}
        {tree.isPending && <span className="text-sm text-text-muted">جارٍ التحميل…</span>}
      </div>
    </section>
  );
}
