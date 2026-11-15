// العناوين (T12، SPEC-customer §2.5): قطاع ← وحدة ← عمارة ← شقة.
// القوائم الهرمية مقروءة للجميع (النشطة فقط بـ RLS). العناوين CRUD مباشر على addresses، وRLS يحصرها بصاحبها.
// عنوان افتراضي واحد لكل زبون (فهرس unique جزئي): نلغي الافتراضي القديم قبل تعيين الجديد.
import type { MukhdarClient } from '@mukhdar/shared';

export const APARTMENT_MAX = 20;
export const NOTE_MAX = 200;
export const BUILDING_MAX_DIGITS = 3;

/** التسميات المقترحة بالتصميم (اختيارية). تُخزَّن نصاً بـ addresses.label. */
export const ADDRESS_LABELS = ['البيت', 'الشغل'] as const;

export interface SectorRow {
  id: number;
  name: string;
}
export interface SubsectionRow {
  id: number;
  name: string;
}
export interface BuildingRow {
  id: number;
  number: string;
}

/** عنوان الزبون مع أسماء القطاع والوحدة والعمارة. building = null: العمارة أوقفها الأدمن (لا تُقرأ). */
export interface CustomerAddress {
  id: string;
  apartment: string;
  note: string | null;
  label: string | null;
  is_default: boolean;
  created_at: string;
  building: {
    id: number;
    number: string;
    subsection: {
      id: number;
      name: string;
      sector: { id: number; name: string } | null;
    } | null;
  } | null;
}

export interface AddressInput {
  building_id: number;
  apartment: string;
  note: string | null;
  label: string | null;
  is_default: boolean;
}

export const addressKeys = {
  sectors: ['address', 'sectors'] as const,
  subsections: (sectorId: number) => ['address', 'subsections', sectorId] as const,
  buildings: (subsectionId: number) => ['address', 'buildings', subsectionId] as const,
  /** عناوين المستخدم الحالي (الـ id بالمفتاح حتى لا تظهر عناوين حساب سابق بعد تبديل الحساب). */
  mine: (userId: string) => ['addresses', userId] as const,
};

const ADDRESS_COLUMNS =
  'id, apartment, note, label, is_default, created_at, ' +
  'building:buildings(id, number, subsection:subsections(id, name, sector:sectors(id, name)))';

export async function fetchSectors(client: MukhdarClient): Promise<SectorRow[]> {
  const { data, error } = await client
    .from('sectors')
    .select('id, name')
    .eq('is_active', true)
    .order('sort_order')
    .order('id');
  if (error) throw error;
  return data;
}

export async function fetchSubsections(
  client: MukhdarClient,
  sectorId: number,
): Promise<SubsectionRow[]> {
  const { data, error } = await client
    .from('subsections')
    .select('id, name')
    .eq('sector_id', sectorId)
    .eq('is_active', true)
    .order('sort_order')
    .order('id');
  if (error) throw error;
  return data;
}

/** كل عمارات الوحدة النشطة (100 تقريباً، صف واحد صغير لكل عمارة). */
export async function fetchBuildings(
  client: MukhdarClient,
  subsectionId: number,
): Promise<BuildingRow[]> {
  const { data, error } = await client
    .from('buildings')
    .select('id, number')
    .eq('subsection_id', subsectionId)
    .eq('is_active', true)
    .order('sort_order')
    .order('id')
    .limit(1000);
  if (error) throw error;
  return data;
}

/** الافتراضي أولاً ثم الأحدث. */
export async function fetchMyAddresses(client: MukhdarClient): Promise<CustomerAddress[]> {
  const { data, error } = await client
    .from('addresses')
    .select(ADDRESS_COLUMNS)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as unknown as CustomerAddress[];
}

async function clearDefault(client: MukhdarClient, userId: string, exceptId?: string) {
  let q = client
    .from('addresses')
    .update({ is_default: false })
    .eq('customer_id', userId)
    .eq('is_default', true);
  if (exceptId) q = q.neq('id', exceptId);
  const { error } = await q;
  if (error) throw error;
}

export async function createAddress(
  client: MukhdarClient,
  userId: string,
  input: AddressInput,
): Promise<string> {
  if (input.is_default) await clearDefault(client, userId);
  const { data, error } = await client
    .from('addresses')
    .insert({ ...input, customer_id: userId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateAddress(
  client: MukhdarClient,
  userId: string,
  id: string,
  input: AddressInput,
): Promise<void> {
  if (input.is_default) await clearDefault(client, userId, id);
  const { error } = await client.from('addresses').update(input).eq('id', id);
  if (error) throw error;
}

export async function setDefaultAddress(
  client: MukhdarClient,
  userId: string,
  id: string,
): Promise<void> {
  await clearDefault(client, userId, id);
  const { error } = await client.from('addresses').update({ is_default: true }).eq('id', id);
  if (error) throw error;
}

/** حذف العنوان. إن كان الافتراضي وبقيت عناوين، يصير أحدثها افتراضياً (افتراض T12). */
export async function deleteAddress(
  client: MukhdarClient,
  userId: string,
  address: Pick<CustomerAddress, 'id' | 'is_default'>,
  remaining: Pick<CustomerAddress, 'id' | 'created_at'>[],
): Promise<void> {
  const { error } = await client.from('addresses').delete().eq('id', address.id);
  if (error) throw error;
  const others = remaining.filter((a) => a.id !== address.id);
  if (address.is_default && others.length > 0) {
    const newest = [...others].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (newest) await setDefaultAddress(client, userId, newest.id);
  }
}

// ------------------------------------------------------------------ مساعدات العرض والتحقق

/** ٤٥ ← 45 (لوحة المفاتيح العربية شائعة). */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** يحوّل كتابة المستخدم لرقم عمارة: أرقام لاتينية فقط، بلا أصفار بالبداية ("045" ← "45"). */
export function normalizeBuildingInput(raw: string): string {
  const digits = toLatinDigits(raw).replace(/\D/g, '').slice(0, BUILDING_MAX_DIGITS);
  return digits.replace(/^0+(?=\d)/, '');
}

/** فهرس رقم العمارة ← العمارة (بحث فوري بلا شبكة بعد تحميل الوحدة). */
export function indexBuildings(buildings: BuildingRow[]): Map<string, BuildingRow> {
  return new Map(buildings.map((b) => [b.number.trim(), b]));
}

/** الأجزاء المطلوبة لـ formatAddress/formatAddressShort من @mukhdar/shared. null إن تعذّر (عمارة موقوفة). */
export function addressParts(a: CustomerAddress) {
  const b = a.building;
  const sub = b?.subsection;
  const sector = sub?.sector;
  if (!b || !sub || !sector) return null;
  return { sector: sector.name, subsection: sub.name, building: b.number, apartment: a.apartment };
}

/** العنوان المختار للتوصيل: المختار إن وُجد، وإلا الافتراضي، وإلا الأحدث. */
export function pickDeliveryAddress(
  addresses: CustomerAddress[] | undefined,
  selectedId: string | null,
): CustomerAddress | null {
  if (!addresses || addresses.length === 0) return null;
  const usable = addresses.filter((a) => addressParts(a) !== null);
  return (
    usable.find((a) => a.id === selectedId) ?? usable.find((a) => a.is_default) ?? usable[0] ?? null
  );
}

/** هل للمستخدم عنوان واحد على الأقل؟ (بعد شاشة الاسم: لا عنوان ← إضافة أول عنوان). */
export async function hasAnyAddress(client: MukhdarClient): Promise<boolean> {
  const { data, error } = await client.from('addresses').select('id').limit(1);
  if (error) throw error;
  return data.length > 0;
}
