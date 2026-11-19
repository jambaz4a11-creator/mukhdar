-- =====================================================================
-- العنوان: نطاقات بسماية الفعلية (قرار المالك 2026-11-19)
--
--   - الطابق: G (يُخزَّن 0) و1..9 ← FLOOR_INVALID خارجها.
--   - الشقة: 1..12 أرقاماً لاتينية بلا أصفار بالبداية ← APARTMENT_INVALID خارجها (كلمات حرة و"٥" العربية مرفوضة).
--   - العمارة: لازم تكون فعّالة وببلوك فعّال بقطاع فعّال ← BUILDING_INACTIVE (بلوك مخفي، أو عمارة خارج 1..N للبلوك).
--     (العمارة تنتمي لبلوك واحد بالمفتاح الأجنبي؛ "عمارة لا تنتمي للبلوك" تعني عمارة غير موجودة بقائمة البلوك الفعّالة.)
--
--   تسري على **العنوان الجديد وعلى حقل عُدِّل فعلاً فقط** (insert، أو update غيّر الطابق/الشقة/العمارة).
--   العناوين القديمة غير الصالحة تبقى كما هي (طلباتها القديمة لا تُمس)، ويبقى تعديل ملاحظتها أو جعلها افتراضية
--   ممكناً بلا اعتراض؛ التطبيق يطلب من الزبون تصحيحها عند استخدامها أو تعديلها (SPEC-customer §2.5).
--   لا تعتمد على دور المستخدم: تسري على الجميع (سكربتات التطوير تضع قيماً صالحة).
--   قيد الجدول addresses_floor_range (0..20) يبقى لأنه يشمل صفوفاً قديمة؛ القاعدة الأضيق هنا بالـ trigger.
--   بيانات الشجرة نفسها (البلوكات والعمارات الفعّالة) لا تُغيَّر هنا: scripts/address-tree (قابل للإعادة).
-- نفس دالة 20261204000001 (definer) + القواعد أعلاه.
-- =====================================================================

create or replace function private.tg_clean_address_text()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
  v_ok boolean;
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

  -- نطاقات بسماية: للجديد وللحقل المعدَّل فقط (العنوان القديم غير الصالح لا يُعترض عليه بتعديل غيره)
  if new.floor is not null and (tg_op = 'INSERT' or new.floor is distinct from old.floor)
     and new.floor not between 0 and 9 then
    raise exception 'FLOOR_INVALID' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.apartment is distinct from old.apartment then
    -- أرقام لاتينية 1..12 فقط (regex صريح [0-9] لا \d حتى لا تمر أرقام يونيكود)
    if new.apartment !~ '^([1-9]|1[0-2])$' then
      raise exception 'APARTMENT_INVALID' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'INSERT' or new.building_id is distinct from old.building_id then
    select b.is_active and ss.is_active and s.is_active into v_ok
      from public.buildings b
      join public.subsections ss on ss.id = b.subsection_id
      join public.sectors s on s.id = ss.sector_id
     where b.id = new.building_id;
    if v_ok is not true then
      raise exception 'BUILDING_INACTIVE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.tg_clean_address_text() from public, anon, authenticated, service_role;

drop trigger addresses_clean_text on public.addresses;
create trigger addresses_clean_text
  before insert or update of apartment, note, label, floor, building_id on public.addresses
  for each row execute function private.tg_clean_address_text();
