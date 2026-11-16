// T19: الإعدادات والموظفون والعناوين، بجلسة الأدمن (RLS والدوال). لا مفتاح خادم بالمتصفح:
// إعادة ضبط الرمز وإنشاء الحسابات عبر Edge Functions بـ JWT الأدمن.
import { parseFunctionError, toStoredPhone, normalizeIraqiPhone } from '@mukhdar/shared';
import type { MukhdarClient } from '@mukhdar/shared';
import type { SettingsPayload, UserRole } from './forms';

export const adminKeys = {
  settings: ['admin', 'settings'] as const,
  stuck: ['admin', 'stuck-notifications'] as const,
  staff: ['admin', 'staff'] as const,
  search: (phone: string) => ['admin', 'search', phone] as const,
  me: ['admin', 'me'] as const,
  addresses: ['admin', 'addresses'] as const,
};

async function unwrap<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

// ---------------------------------------------------------------- الإعدادات

export interface AppSettings extends SettingsPayload {
  updated_at: string;
}

export function fetchSettings(supabase: MukhdarClient): Promise<AppSettings> {
  return unwrap<AppSettings>(
    supabase
      .from('app_settings')
      .select(
        'delivery_fee_iqd, min_order_iqd, max_active_orders, store_open, closed_message, updated_at',
      )
      .eq('id', 1)
      .single(),
  );
}

export function saveSettings(supabase: MukhdarClient, p: SettingsPayload): Promise<unknown> {
  return unwrap(supabase.rpc('update_app_settings', { p: { ...p } }));
}

export interface NotificationHealth {
  /** عالقة: لم تُرسل وما زالت قابلة لإعادة المحاولة (attempts < 5) وأقدم من 5 دقائق: المرسِل متوقف أو بطيء. */
  stuck: number;
  /** فاشلة نهائياً: استنفدت المحاولات (5) ولم يصرفها الأدمن: غالباً رمز جهاز تالف، لا تعني توقف المرسِل. */
  failed: number;
}

export async function fetchNotificationHealth(
  supabase: MukhdarClient,
): Promise<NotificationHealth> {
  const [stuck, failed] = await Promise.all([
    unwrap<number>(supabase.rpc('stuck_notifications_count')),
    unwrap<number>(supabase.rpc('failed_notifications_count')),
  ]);
  return { stuck, failed };
}

/** الأدمن يصرف الفاشلة نهائياً (تبقى بالجدول بـ dismissed_at ويُسجَّل بـ admin_audit). */
export function dismissFailedNotifications(supabase: MukhdarClient): Promise<number> {
  return unwrap<number>(supabase.rpc('dismiss_failed_notifications'));
}

// ---------------------------------------------------------------- الموظفون

export interface UserRow {
  id: string;
  role: UserRole;
  phone: string | null;
  full_name: string | null;
  is_active: boolean;
  must_change_pin: boolean;
}

const USER_COLUMNS = 'id, role, phone, full_name, is_active, must_change_pin';
const ROLE_ORDER: Record<UserRole, number> = { admin: 0, staff: 1, driver: 2, customer: 3 };

/** كل من دوره غير customer (أعدادهم صغيرة: حد 500). */
export async function fetchStaff(supabase: MukhdarClient): Promise<UserRow[]> {
  const rows = await unwrap<UserRow[]>(
    supabase.from('profiles').select(USER_COLUMNS).neq('role', 'customer').limit(500),
  );
  return rows.sort(
    (a, b) =>
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      Number(b.is_active) - Number(a.is_active) ||
      (a.full_name ?? '').localeCompare(b.full_name ?? '', 'ar'),
  );
}

/** حساب برقم (أي صيغة)؛ null إن لم يوجد. يرمي 'PHONE_INVALID' لرقم غير صالح. */
export async function findByPhone(supabase: MukhdarClient, input: string): Promise<UserRow | null> {
  const e164 = normalizeIraqiPhone(input);
  if (!e164) throw new Error('PHONE_INVALID');
  return unwrap<UserRow | null>(
    supabase.from('profiles').select(USER_COLUMNS).eq('phone', toStoredPhone(e164)).maybeSingle(),
  );
}

export function setUserRole(
  supabase: MukhdarClient,
  userId: string,
  role: UserRole,
  isActive: boolean,
): Promise<unknown> {
  return unwrap(
    supabase.rpc('set_user_role', { p_user_id: userId, p_role: role, p_is_active: isActive }),
  );
}

export async function currentUserId(supabase: MukhdarClient): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Edge Function برمز الخطأ المقروء من الجسم ({error, detail}). */
async function invoke<T>(supabase: MukhdarClient, name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const parsed = await parseFunctionError(error);
    throw Object.assign(new Error(parsed.code ?? parsed.message), parsed);
  }
  return data as T;
}

export function resetPin(supabase: MukhdarClient, userId: string, pin: string): Promise<unknown> {
  return invoke(supabase, 'admin-reset-pin', { user_id: userId, new_pin: pin });
}

export function createStaffUser(
  supabase: MukhdarClient,
  input: { phone: string; full_name: string; role: 'staff' | 'driver'; pin: string },
): Promise<{ user_id: string }> {
  return invoke(supabase, 'admin-create-user', input);
}

// ---------------------------------------------------------------- العناوين

export interface BuildingRow {
  id: number;
  number: string;
  sort_order: number;
  is_active: boolean;
}
export interface SubsectionRow {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
  buildings: BuildingRow[];
}
export interface SectorRow {
  id: number;
  city_id: number | null;
  name: string;
  sort_order: number;
  is_active: boolean;
  subsections: SubsectionRow[];
}

const bySort = <T extends { sort_order: number; id: number }>(a: T, b: T) =>
  a.sort_order - b.sort_order || a.id - b.id;

/** الشجرة كاملة (قطاعان، 17 وحدة، ~1700 عمارة): استعلام واحد متداخل. */
export async function fetchAddressTree(supabase: MukhdarClient): Promise<SectorRow[]> {
  const rows = await unwrap<SectorRow[]>(
    supabase
      .from('sectors')
      .select(
        'id, city_id, name, sort_order, is_active, subsections(id, name, sort_order, is_active, buildings(id, number, sort_order, is_active))',
      )
      .order('sort_order')
      .order('id')
      .limit(100), // حد الصفوف (max_rows) على القطاعات فقط، لا على الوحدات والعمارات المتداخلة
  );
  return rows.sort(bySort).map((s) => ({
    ...s,
    subsections: [...s.subsections].sort(bySort).map((u) => ({
      ...u,
      buildings: [...u.buildings].sort(bySort),
    })),
  }));
}

export type AddressTable = 'sectors' | 'subsections' | 'buildings';

/** عدد عناوين الزبائن المحفوظة تحت قطاع/وحدة/عمارة: إعادة التسمية تغيّر نصها عندهم كلهم. */
export function fetchAddressUsage(
  supabase: MukhdarClient,
  table: AddressTable,
  id: number,
): Promise<number> {
  return unwrap<number>(supabase.rpc('address_usage', { p_kind: table, p_id: id }));
}

export function updateAddressRow(
  supabase: MukhdarClient,
  table: AddressTable,
  id: number,
  patch: { name?: string; number?: string; is_active?: boolean; sort_order?: number },
): Promise<unknown> {
  // الأعمدة تختلف بين الجداول (name أو number)؛ المتصل يمرر ما يخص الجدول فقط
  return unwrap(
    supabase
      .from(table)
      .update(patch as never)
      .eq('id', id),
  );
}

export async function reorderAddressRows(
  supabase: MukhdarClient,
  table: AddressTable,
  ids: readonly number[],
  current: ReadonlyMap<number, number>,
): Promise<void> {
  // تحديث المتغيّر فقط (sort_order = الموضع 1، 2، …)
  for (const [i, id] of ids.entries()) {
    if (current.get(id) !== i + 1)
      await updateAddressRow(supabase, table, id, { sort_order: i + 1 });
  }
}

/** قطاع جديد بنفس مدينة القطاعات الموجودة (بسماية). */
export function createSector(
  supabase: MukhdarClient,
  name: string,
  sortOrder: number,
  cityId: number | null,
) {
  return unwrap(supabase.from('sectors').insert({ name, sort_order: sortOrder, city_id: cityId }));
}

export function createSubsection(
  supabase: MukhdarClient,
  sectorId: number,
  name: string,
  sortOrder: number,
) {
  return unwrap(
    supabase.from('subsections').insert({ sector_id: sectorId, name, sort_order: sortOrder }),
  );
}

export function addBuildings(
  supabase: MukhdarClient,
  subsectionId: number,
  numbers: string[],
): Promise<number> {
  return unwrap<number>(
    supabase.rpc('add_buildings', { p_subsection_id: subsectionId, p_numbers: numbers }),
  );
}
