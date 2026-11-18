// العناوين (T12، SPEC-customer §2.5): البلوك (قطاع + وحدة معاً، 2026-11-18) ← البناية ← الطابق ← الشقة.
// الشجرة بقاعدة البيانات كما هي: قطاع ← وحدة ← عمارة؛ "البلوك" = الوحدة مع قطاعها (A1..A9، B1..B8).
// القوائم الهرمية مقروءة للجميع (النشطة فقط بـ RLS). العناوين CRUD مباشر على addresses، وRLS يحصرها بصاحبها.
// عنوان افتراضي واحد لكل زبون (فهرس unique جزئي): التعيين عبر RPC set_default_address بمعاملة واحدة.
import type { MukhdarClient } from '@mukhdar/shared';

export const APARTMENT_MAX = 20;
export const NOTE_MAX = 200;
export const BUILDING_MAX_DIGITS = 3;
/** الطابق 0 (الأرضي) .. 20، مثل قيد addresses_floor_range. */
export const FLOOR_MAX = 20;
export const LABEL_MAX = 20;

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
/** بلوك = وحدة نشطة بقطاع نشط، مرتّبة بترتيب القطاع ثم الوحدة. */
export interface BlockRow {
  id: number;
  name: string;
  sector: { id: number; name: string };
}
export interface BuildingRow {
  id: number;
  number: string;
}

/** عنوان الزبون مع أسماء القطاع والوحدة والعمارة. building = null: العمارة أوقفها الأدمن (لا تُقرأ). */
export interface CustomerAddress {
  id: string;
  apartment: string;
  /** null: عنوان قديم قبل حقل الطابق (2026-11-18). */
  floor: number | null;
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
  floor: number;
  apartment: string;
  note: string | null;
  label: string | null;
  is_default: boolean;
}

export const addressKeys = {
  sectors: ['address', 'sectors'] as const,
  blocks: ['address', 'blocks'] as const,
  subsections: (sectorId: number) => ['address', 'subsections', sectorId] as const,
  buildings: (subsectionId: number) => ['address', 'buildings', subsectionId] as const,
  /** عناوين المستخدم الحالي (الـ id بالمفتاح حتى لا تظهر عناوين حساب سابق بعد تبديل الحساب). */
  mine: (userId: string) => ['addresses', userId] as const,
};

const ADDRESS_COLUMNS =
  'id, apartment, floor, note, label, is_default, created_at, ' +
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

interface BlockQueryRow {
  id: number;
  name: string;
  sort_order: number;
  sector: { id: number; name: string; sort_order: number } | null;
}

/** كل البلوكات (الوحدات النشطة بقطاعات نشطة) بطلب واحد: 17 صفاً. */
export async function fetchBlocks(client: MukhdarClient): Promise<BlockRow[]> {
  const { data, error } = await client
    .from('subsections')
    .select('id, name, sort_order, sector:sectors!inner(id, name, sort_order)')
    .eq('is_active', true)
    .eq('sector.is_active', true);
  if (error) throw error;
  return sortBlocks(data as unknown as BlockQueryRow[]);
}

export function sortBlocks(rows: BlockQueryRow[]): BlockRow[] {
  return rows
    .filter(
      (r): r is BlockQueryRow & { sector: NonNullable<BlockQueryRow['sector']> } => !!r.sector,
    )
    .sort(
      (a, b) =>
        a.sector.sort_order - b.sector.sort_order ||
        a.sector.id - b.sector.id ||
        a.sort_order - b.sort_order ||
        a.id - b.id,
    )
    .map((r) => ({ id: r.id, name: r.name, sector: { id: r.sector.id, name: r.sector.name } }));
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

/**
 * يجعل العنوان افتراضياً بمعاملة واحدة (RPC set_default_address، migration 20261118000001):
 * يلغي الافتراضي القديم ويعيّن الجديد معاً، فلا يبقى الزبون بلا افتراضي ولا بافتراضيين.
 */
export async function setDefaultAddress(client: MukhdarClient, id: string): Promise<void> {
  const { error } = await client.rpc('set_default_address', { p_address_id: id });
  if (error) throw error;
}

/** يضيف العنوان (غير افتراضي)، ثم يجعله افتراضياً بالـ RPC إن طُلب. */
export async function createAddress(
  client: MukhdarClient,
  userId: string,
  input: AddressInput,
): Promise<string> {
  const { is_default: makeDefault, ...fields } = input;
  const { data, error } = await client
    .from('addresses')
    .insert({ ...fields, customer_id: userId, is_default: false })
    .select('id')
    .single();
  if (error) throw error;
  if (makeDefault) await setDefaultAddress(client, data.id);
  return data.id;
}

/** يعدّل حقول العنوان؛ "افتراضي" فقط عبر الـ RPC (لا يُلغى الافتراضي من هنا). */
export async function updateAddress(
  client: MukhdarClient,
  id: string,
  input: AddressInput,
): Promise<void> {
  const { is_default: makeDefault, ...fields } = input;
  const { error } = await client.from('addresses').update(fields).eq('id', id);
  if (error) throw error;
  if (makeDefault) await setDefaultAddress(client, id);
}

/** حذف العنوان. إن كان الافتراضي وبقيت عناوين، يصير أحدثها افتراضياً (افتراض T12). */
export async function deleteAddress(
  client: MukhdarClient,
  address: Pick<CustomerAddress, 'id' | 'is_default'>,
  remaining: Pick<CustomerAddress, 'id' | 'created_at'>[],
): Promise<void> {
  const { error } = await client.from('addresses').delete().eq('id', address.id);
  if (error) throw error;
  const others = remaining.filter((a) => a.id !== address.id);
  if (address.is_default && others.length > 0) {
    const newest = [...others].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (newest) await setDefaultAddress(client, newest.id);
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

/** كتابة الطابق: أرقام لاتينية، رقمان على الأكثر، بلا أصفار بالبداية ("03" ← "3"، "0" يبقى). */
export function normalizeFloorInput(raw: string): string {
  const digits = toLatinDigits(raw).replace(/\D/g, '').slice(0, 2);
  return digits.replace(/^0+(?=\d)/, '');
}

/** الطابق كرقم صالح 0..FLOOR_MAX، أو null (فارغ أو خارج المدى). */
export function parseFloor(text: string): number | null {
  if (text === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n <= FLOOR_MAX ? n : null;
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
  return {
    sector: sector.name,
    subsection: sub.name,
    building: b.number,
    floor: a.floor,
    apartment: a.apartment,
  };
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
