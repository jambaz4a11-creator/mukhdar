-- =====================================================================
-- T43: دعم المواد الغذائية والمنظفات: وحدتا بيع جديدتان "كيس" و"عبوة".
--   1) إعادة إنشاء قيد products_unit_allowed بالقائمة الجديدة (مطابقة لـ SALE_UNITS بـ packages/shared).
--   2) admin_save_product بالقائمة نفسها (create or replace: الصلاحيات الموجودة تبقى).
-- بلا تغيير ببيانات أو إعدادات. order_items.unit_snapshot بلا قيد.
-- =====================================================================
alter table public.products drop constraint products_unit_allowed;
alter table public.products add constraint products_unit_allowed
  check (unit in ('نص كيلو', 'باقة', 'حبة', 'علبة', 'قنينة', 'سلة', 'كيس', 'عبوة'));

create or replace function public.admin_save_product(p jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_new    boolean;
  v_name   text;
  v_desc   text;
  v_cat    bigint;
  v_unit   text;
  v_price  bigint;
  v_img    text;
  v_active boolean;
  v_sort   bigint;
  v_cost   bigint;
  v_thr    bigint;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p -> 'id') = 'string' then
    if (p ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'id';
    end if;
    v_id := (p ->> 'id')::uuid;
  elsif coalesce(jsonb_typeof(p -> 'id'), 'null') <> 'null' then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'id';
  end if;
  v_new := v_id is null;

  if p ? 'name' then
    v_name := case when jsonb_typeof(p -> 'name') = 'string' then btrim(p ->> 'name') end;
    if v_name is null or char_length(v_name) not between 1 and 80 then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'name';
    end if;
  elsif v_new then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'name';
  end if;

  if p ? 'description' then
    if coalesce(jsonb_typeof(p -> 'description'), 'null') not in ('null', 'string')
       or char_length(p ->> 'description') > 500 then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'description';
    end if;
    v_desc := nullif(btrim(p ->> 'description'), '');
  end if;

  if p ? 'category_id' or v_new then
    v_cat := private.json_int(p -> 'category_id');
    if v_cat is null or not exists (select 1 from public.categories where id = v_cat) then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'category_id';
    end if;
  end if;

  if p ? 'unit' or v_new then
    v_unit := case when jsonb_typeof(p -> 'unit') = 'string' then btrim(p ->> 'unit') end;
    -- مطابقة لقيد products_unit_allowed و SALE_UNITS
    if v_unit is null or v_unit not in ('نص كيلو', 'باقة', 'حبة', 'علبة', 'قنينة', 'سلة', 'كيس', 'عبوة') then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'unit';
    end if;
  end if;

  if p ? 'price_iqd' or v_new then
    v_price := private.json_int(p -> 'price_iqd');
    if v_price is null or v_price <= 0 or v_price % 250 <> 0 then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'price_iqd';
    end if;
  end if;

  if p ? 'image_path' then
    if coalesce(jsonb_typeof(p -> 'image_path'), 'null') not in ('null', 'string')
       or char_length(p ->> 'image_path') > 300 or (p ->> 'image_path') like '%..%' then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'image_path';
    end if;
    v_img := nullif(btrim(p ->> 'image_path'), '');
  end if;

  if p ? 'is_active' then
    if jsonb_typeof(p -> 'is_active') is distinct from 'boolean' then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'is_active';
    end if;
    v_active := (p ->> 'is_active')::boolean;
  end if;

  if p ? 'sort_order' then
    v_sort := private.json_int(p -> 'sort_order');
    if v_sort is null or v_sort not between -1000000 and 1000000 then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'sort_order';
    end if;
  end if;

  if coalesce(jsonb_typeof(p -> 'cost_iqd'), 'null') <> 'null' then
    v_cost := private.json_int(p -> 'cost_iqd');
    if v_cost is null or v_cost < 0 or v_cost % 250 <> 0 then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'cost_iqd';
    end if;
  end if;

  if p ? 'low_stock_threshold' then
    v_thr := private.json_int(p -> 'low_stock_threshold');
    if v_thr is null or v_thr not between 0 and 10000 then
      raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'low_stock_threshold';
    end if;
  end if;

  if v_new then
    insert into public.products (category_id, city_id, name, description, unit, price_iqd, image_path,
                                 is_active, sort_order)
    values (v_cat, (select id from public.cities order by id limit 1), v_name, v_desc, v_unit, v_price, v_img,
            coalesce(v_active, true),
            coalesce(v_sort, (select coalesce(max(sort_order), 0) + 1 from public.products where category_id = v_cat)))
    returning id into v_id;
  else
    update public.products set
      name        = case when p ? 'name'        then v_name   else name        end,
      description = case when p ? 'description' then v_desc   else description end,
      category_id = case when p ? 'category_id' then v_cat    else category_id end,
      unit        = case when p ? 'unit'        then v_unit   else unit        end,
      price_iqd   = case when p ? 'price_iqd'   then v_price  else price_iqd   end,
      image_path  = case when p ? 'image_path'  then v_img    else image_path  end,
      is_active   = case when p ? 'is_active'   then v_active else is_active   end,
      sort_order  = case when p ? 'sort_order'  then v_sort   else sort_order  end
     where id = v_id;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001', detail = v_id::text;
    end if;
  end if;

  if v_cost is not null then
    insert into public.product_costs (product_id, cost_iqd, updated_at) values (v_id, v_cost, now())
    on conflict (product_id) do update set cost_iqd = excluded.cost_iqd, updated_at = now();
  end if;
  if v_thr is not null then
    update public.stock set low_stock_threshold = v_thr where product_id = v_id;
  end if;
  return v_id;
end
$$;
