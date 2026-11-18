-- =====================================================================
-- العنوان: حقل "الطابق" (قرار المالك 2026-11-18، "مثل تطبيقات بسماية": البلوك ← البناية ← الطابق ← الشقة)
--
--   - addresses.floor smallint، 0..20 (0 = الطابق الأرضي). اختياري للعناوين القديمة (null)،
--     **إلزامي لكل عنوان جديد من التطبيق** (دور authenticated): FLOOR_REQUIRED. ولا يُمسح طابق مسجَّل.
--     سكربتات التطوير (seed، الحمل) بدور المالك غير مقيّدة به (تضع طابقاً على أي حال).
--   - الشجرة كما هي (قطاع ← وحدة ← عمارة): "البلوك" بالواجهة = القطاع + الوحدة معاً (A1..A9، B1..B8).
--   - orders.address_snapshot يأخذ "floor" من العنوان وقت الطلب (trigger قبل الإدراج، فلا تُعاد كتابة place_order).
--     تجهيل حساب محذوف (20261202000001) يبني اللقطة من sector وsubsection فقط، فيُحذف الطابق تلقائياً.
--   - available_orders بلا تغيير (لا شقة ولا طابق قبل القبول)؛ السائق يرى floor بلقطة طلبه بعد القبول.
-- =====================================================================

alter table public.addresses
  add column floor smallint
    constraint addresses_floor_range check (floor between 0 and 20);
comment on column public.addresses.floor is
  'Floor number, 0 = ground floor, up to 20. Required for new addresses from the app (FLOOR_REQUIRED); null only for addresses saved before 2026-11-18.';

grant insert (floor), update (floor) on public.addresses to authenticated;

-- نفس دالة 20261201000001 (definer منذ 20261203000001) + قاعدة الطابق
create or replace function private.tg_clean_address_text()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  -- الشقة إلزامية: فراغ بعد التنظيف يبقى '' فيرفضه قيد الجدول (23514) كما كان قبل التنظيف
  new.apartment := coalesce(private.clean_user_text(new.apartment, true), '');
  new.note  := private.clean_user_text(new.note);
  new.label := private.clean_user_text(new.label, true);
  if tg_op = 'INSERT' then
    -- حد 20 عنواناً لكل زبون (L3). القفل يمنع تجاوزه بإدخالات متزامنة.
    perform pg_advisory_xact_lock(hashtextextended('addresses:' || new.customer_id::text, 0));
    select count(*) into v_count from public.addresses where customer_id = new.customer_id;
    if v_count >= 20 then
      raise exception 'ADDRESS_LIMIT' using errcode = 'P0001', detail = '20';
    end if;
  end if;
  -- الطابق: إلزامي لعنوان جديد من التطبيق، ولا يُمسح بعد تسجيله (العنوان القديم بلا طابق يبقى يُعدَّل)
  if new.floor is null and current_setting('role', true) = 'authenticated'
     and (tg_op = 'INSERT' or old.floor is not null) then
    raise exception 'FLOOR_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end
$$;
revoke all on function private.tg_clean_address_text() from public, anon, authenticated, service_role;

drop trigger addresses_clean_text on public.addresses;
create trigger addresses_clean_text
  before insert or update of apartment, note, label, floor on public.addresses
  for each row execute function private.tg_clean_address_text();

-- اللقطة: الطابق من العنوان وقت الطلب (عنوان بلا طابق ← لا مفتاح floor)
create function private.tg_orders_snapshot_floor()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_floor smallint;
begin
  if new.address_id is not null and new.address_snapshot ? 'address_id' then
    select a.floor into v_floor from public.addresses a where a.id = new.address_id;
    if v_floor is not null then
      new.address_snapshot := new.address_snapshot || jsonb_build_object('floor', v_floor);
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.tg_orders_snapshot_floor() from public, anon, authenticated, service_role;

create trigger orders_snapshot_floor
  before insert on public.orders
  for each row execute function private.tg_orders_snapshot_floor();
