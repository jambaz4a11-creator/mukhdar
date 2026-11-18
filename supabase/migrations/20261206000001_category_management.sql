-- إدارة الأقسام (قرار المالك 2026-11-18): الأدمن فقط، كتابة عبر دوال قاعدة البيانات، تدقيق بـ admin_audit.
--   1) admin_audit.action يقبل 'category'.
--   2) قيود الاسم: غير فارغ (بعد التقليم) وأقصاه 80، وفريد (بلا فرق بحالة الأحرف).
--   3) admin_save_category (إضافة/تعديل الاسم والصورة والترتيب والإظهار)، delete_category (فقط لقسم بلا منتجات،
--      وإلا CATEGORY_HAS_PRODUCTS ← يُخفى بدل الحذف)، reorder_categories (ترتيب ذرّي لكل الأقسام).
--   4) سحب الكتابة المباشرة على categories من authenticated (كالمنتجات): الدوال فقط.
--   5) القسم المخفي ومنتجاته يختفيان عن الزبون: سياسة قراءة products تشترط قسماً ظاهراً، و place_order يرفض
--      منتجاً بقسم مخفي (PRODUCT_UNAVAILABLE). الأدمن والموظف يرون كل شيء كما قبل.
-- لا تعديل لـ migration قديمة. بلا تغيير بيانات.

-- ---------------------------------------------------------------------
-- 1) التدقيق
-- ---------------------------------------------------------------------
alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check
  check (action in ('user_role', 'settings', 'order_driver', 'notifications_dismissed', 'address', 'mfa_reset',
                    'customer_lockdown', 'category'));

-- ---------------------------------------------------------------------
-- 2) قيود الاسم
-- ---------------------------------------------------------------------
alter table public.categories
  add constraint categories_name_len check (char_length(btrim(name)) between 1 and 80);
create unique index categories_name_unique on public.categories (lower(btrim(name)));

-- ---------------------------------------------------------------------
-- 3) الدوال
-- ---------------------------------------------------------------------
create function public.admin_save_category(p jsonb)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id    int;
  v_old   public.categories;
  v_name  text;
  v_img   text;
  v_act   boolean;
  v_sort  int;
  v_new   public.categories;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'payload';
  end if;
  if exists (select 1 from jsonb_object_keys(p) k
              where k not in ('id', 'name', 'image_path', 'is_active', 'sort_order')) then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'keys';
  end if;

  if p ? 'name' then
    if jsonb_typeof(p -> 'name') <> 'string' then
      raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'name';
    end if;
    v_name := btrim(p ->> 'name');
    if char_length(v_name) < 1 or char_length(v_name) > 40 then
      raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'name';
    end if;
  end if;
  if p ? 'is_active' then
    if jsonb_typeof(p -> 'is_active') <> 'boolean' then
      raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'is_active';
    end if;
    v_act := (p ->> 'is_active')::boolean;
  end if;
  if p ? 'sort_order' then
    if jsonb_typeof(p -> 'sort_order') <> 'number' or (p ->> 'sort_order') !~ '^[0-9]{1,6}$' then
      raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'sort_order';
    end if;
    v_sort := (p ->> 'sort_order')::int;
  end if;

  if p ? 'id' then
    if jsonb_typeof(p -> 'id') <> 'number' or (p ->> 'id') !~ '^[0-9]{1,9}$' then
      raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'id';
    end if;
    v_id := (p ->> 'id')::int;
    select * into v_old from public.categories where id = v_id for update;
    if not found then
      raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- الصورة: null (إزالة) أو مسار هذا القسم نفسه تحت categories/<id>/
    if p ? 'image_path' then
      if jsonb_typeof(p -> 'image_path') = 'null' then
        v_img := null;
      elsif jsonb_typeof(p -> 'image_path') = 'string'
            and (p ->> 'image_path') ~ ('^categories/' || v_id::text || '/[A-Za-z0-9._-]{1,80}$') then
        v_img := p ->> 'image_path';
      else
        raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'image_path';
      end if;
    else
      v_img := v_old.image_path;
    end if;

    update public.categories
       set name       = coalesce(v_name, v_old.name),
           image_path = v_img,
           is_active  = coalesce(v_act, v_old.is_active),
           sort_order = coalesce(v_sort, v_old.sort_order)
     where id = v_id
     returning * into v_new;

    if (v_new.name, v_new.image_path, v_new.is_active, v_new.sort_order)
       is distinct from (v_old.name, v_old.image_path, v_old.is_active, v_old.sort_order) then
      insert into public.admin_audit (actor, action, before, after)
      values (auth.uid(), 'category',
              jsonb_build_object('op', 'update', 'id', v_id, 'name', v_old.name, 'is_active', v_old.is_active,
                                 'sort_order', v_old.sort_order, 'image_path', v_old.image_path),
              jsonb_build_object('op', 'update', 'id', v_id, 'name', v_new.name, 'is_active', v_new.is_active,
                                 'sort_order', v_new.sort_order, 'image_path', v_new.image_path));
    end if;
    return v_id;
  end if;

  -- إنشاء: الاسم إلزامي؛ الصورة تُضاف بعد الإنشاء (مسارها يحمل المعرّف)
  if v_name is null then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'name';
  end if;
  if p ? 'image_path' and jsonb_typeof(p -> 'image_path') <> 'null' then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'image_path';
  end if;
  perform 1 from public.categories order by id for update;
  insert into public.categories (name, is_active, sort_order)
  values (v_name, coalesce(v_act, true),
          coalesce(v_sort, (select coalesce(max(sort_order), 0) + 1 from public.categories)))
  returning * into v_new;
  insert into public.admin_audit (actor, action, before, after)
  values (auth.uid(), 'category', '{}'::jsonb,
          jsonb_build_object('op', 'create', 'id', v_new.id, 'name', v_new.name, 'is_active', v_new.is_active,
                             'sort_order', v_new.sort_order));
  return v_new.id;
exception
  when unique_violation then
    raise exception 'CATEGORY_NAME_TAKEN' using errcode = 'P0001';
end
$$;

-- يرجع مسار صورة القسم المحذوف (ليحذف التطبيق ملفها من Storage)، أو null.
create function public.delete_category(p_id int)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_old   public.categories;
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select * into v_old from public.categories where id = p_id for update;
  if not found then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;
  select count(*)::int into v_count from public.products where category_id = p_id;
  if v_count > 0 then
    -- لا حذف لقسم فيه منتجات (حتى الموقوفة والتي لها تاريخ): يُخفى بدل الحذف
    raise exception 'CATEGORY_HAS_PRODUCTS' using errcode = 'P0001', detail = v_count::text;
  end if;
  delete from public.categories where id = p_id;
  insert into public.admin_audit (actor, action, before, after)
  values (auth.uid(), 'category',
          jsonb_build_object('op', 'delete', 'id', v_old.id, 'name', v_old.name, 'is_active', v_old.is_active,
                             'sort_order', v_old.sort_order, 'image_path', v_old.image_path),
          '{}'::jsonb);
  return v_old.image_path;
end
$$;

create function public.reorder_categories(p_ids int[])
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_before int[];
  v_changed int;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or array_position(p_ids, null) is not null
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'ids';
  end if;
  perform 1 from public.categories order by id for update;
  -- لازم القائمة هي كل الأقسام بالضبط (ترتيب ذرّي، لا يترك قسماً بترتيب قديم)
  if (select count(*) from public.categories) <> cardinality(p_ids)
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.categories c where c.id = x)) then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001', detail = 'ids';
  end if;
  select array_agg(id order by sort_order, id) into v_before from public.categories;
  update public.categories c set sort_order = o.ord::int
    from unnest(p_ids) with ordinality o(id, ord)
   where c.id = o.id and c.sort_order is distinct from o.ord::int;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    insert into public.admin_audit (actor, action, before, after)
    values (auth.uid(), 'category',
            jsonb_build_object('op', 'reorder', 'order', to_jsonb(v_before)),
            jsonb_build_object('op', 'reorder', 'order', to_jsonb(p_ids)));
  end if;
end
$$;

revoke all on function public.admin_save_category(jsonb), public.delete_category(int),
  public.reorder_categories(int[]) from public, anon;
grant execute on function public.admin_save_category(jsonb), public.delete_category(int),
  public.reorder_categories(int[]) to authenticated;

-- ---------------------------------------------------------------------
-- 4) الكتابة المباشرة على categories من authenticated: ممنوعة (الدوال فقط)
-- ---------------------------------------------------------------------
drop policy categories_insert on public.categories;
drop policy categories_update on public.categories;
drop policy categories_delete on public.categories;
revoke insert, update, delete on public.categories from authenticated;

-- ---------------------------------------------------------------------
-- 5) القسم المخفي ومنتجاته يختفيان عن الزبون
-- ---------------------------------------------------------------------
-- الزبون وanon يقرآن categories النشطة فقط (سياسة categories_read)، فالتحقق يجري بنفس صلاحية القارئ.
drop policy products_read on public.products;
create policy products_read on public.products for select using (
  (select private.is_staff_or_admin())
  or (is_active and exists (select 1 from public.categories c where c.id = category_id and c.is_active))
);

-- place_order (SECURITY DEFINER فيتجاوز RLS): نضيف شرط القسم الظاهر لفحص توفر المنتج بتبديل حرفي لموضع
-- واحد فقط، ويفشل بوضوح إن لم يوجد أو تكرر (بدل نسخ الدالة كاملة).
do $$
declare
  v_def text;
  v_new text;
  v_old constant text := 'left join public.products p on p.id = c.pid and p.is_active';
  v_rep constant text := 'left join public.products p on p.id = c.pid and p.is_active'
    || ' and exists (select 1 from public.categories k where k.id = p.category_id and k.is_active)';
begin
  v_def := pg_get_functiondef('public.place_order(uuid, jsonb, uuid, text)'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'category management: expected exactly one availability join in place_order';
  end if;
  v_new := replace(v_def, v_old, v_rep);
  execute v_new;
end $$;
