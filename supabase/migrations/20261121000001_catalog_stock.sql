-- =====================================================================
-- T18: المنتجات والمخزون (SPEC-backend §12.1، §12.2، §12.5؛ SPEC-admin §2.2، §2.3، §2.9)
--   1) كلفة الوحدة على كل حركة مخزون (inventory_movements.unit_cost_iqd) + backfill.
--   2) رصيد افتتاحي بالدفتر: stock.qty = Σ inventory_movements.qty لكل منتج (ثابت).
--   3) daily_stats: كلفة الهدر وخسارة التسويات وصافي الربح، وإعادة البناء recompute_daily_stats.
--   4) حد النقص لكل منتج + إشعار واحد للأدمن فقط عند العبور تحت الحد (جمهور admins_only).
--   5) adjust_stock (سعر شراء للمشتريات، ملاحظة للتسوية) وadjust_stock_bulk (هدر اليوم).
--   6) admin_save_product، set_product_price، reorder_products، وسحب الكتابة المباشرة على
--      products وproduct_costs من authenticated.
-- الكميات بوحدات البيع (أنصاف الكيلو) والمبالغ لكل وحدة بيع: الكيلو تحويل باللوحة فقط (§12.5).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) كلفة الوحدة لكل حركة + backfill (الحركات القديمة من سعر الشراء الحالي)
-- ---------------------------------------------------------------------
alter table public.inventory_movements
  add column unit_cost_iqd bigint check (unit_cost_iqd >= 0);

update public.inventory_movements m
   set unit_cost_iqd = coalesce((select pc.cost_iqd from public.product_costs pc
                                  where pc.product_id = m.product_id), 0);

-- 2) رصيد افتتاحي: الفرق بين الرصيد وصافي الدفتر (رصيد كُتب مباشرة قبل T18) حركة 'adjust'
insert into public.inventory_movements (product_id, qty, type, note, unit_cost_iqd, created_at)
select s.product_id, s.qty - coalesce(m.net, 0), 'adjust', 'رصيد افتتاحي (T18)',
       coalesce(pc.cost_iqd, 0), p.created_at
  from public.stock s
  join public.products p on p.id = s.product_id
  left join (select product_id, sum(qty)::int as net from public.inventory_movements group by product_id) m
         on m.product_id = s.product_id
  left join public.product_costs pc on pc.product_id = s.product_id
 where s.qty <> coalesce(m.net, 0);

alter table public.inventory_movements alter column unit_cost_iqd set not null;

-- ---------------------------------------------------------------------
-- 3) daily_stats: الهدر والتسويات وصافي الربح
-- ---------------------------------------------------------------------
alter table public.daily_stats
  add column waste_cost_iqd  bigint not null default 0 check (waste_cost_iqd >= 0),
  add column adjust_loss_iqd bigint not null default 0 check (adjust_loss_iqd >= 0),
  add column net_profit_iqd  bigint generated always as
    (gross_profit_iqd - waste_cost_iqd - adjust_loss_iqd) stored;

-- ---------------------------------------------------------------------
-- 4) حد النقص + جمهور إشعار للأدمن فقط
-- ---------------------------------------------------------------------
alter table public.stock
  add column low_stock_threshold int not null default 5
    check (low_stock_threshold between 0 and 10000);

-- 'admins' = الأدمن والموظفون (الطلب الجديد)؛ 'admins_only' = الأدمن وحده (نقص المخزون)
alter table public.notification_outbox drop constraint notification_outbox_audience_check;
alter table public.notification_outbox add constraint notification_outbox_audience_check
  check (audience in ('user', 'drivers', 'admins', 'admins_only'));

create or replace function public.claim_push_notifications(p_limit int default 200)
returns table (id bigint, title text, body text, data jsonb, attempts int, recipients jsonb)
language sql volatile security invoker set search_path = ''
as $$
  with picked as (
    select o.id
      from public.notification_outbox o
     where o.sent_at is null and o.attempts < 5
       and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
     order by o.created_at, o.id
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
       for update skip locked
  ), claimed as (
    update public.notification_outbox o set claimed_at = now()
      from picked where o.id = picked.id
    returning o.id, o.audience, o.user_id, o.title, o.body, o.data, o.attempts
  )
  select c.id, c.title, c.body, c.data, c.attempts,
         coalesce((select jsonb_agg(jsonb_build_object('token', t.token, 'provider', t.provider,
                                                       'platform', t.platform) order by t.id)
                     from public.push_tokens t
                     join public.profiles p on p.id = t.user_id
                    where p.is_active
                      and case c.audience
                            when 'user'        then t.user_id = c.user_id
                            when 'drivers'     then p.role = 'driver'
                            when 'admins'      then p.role in ('admin', 'staff')
                            when 'admins_only' then p.role = 'admin'
                            else false
                          end), '[]'::jsonb)
    from claimed c
   order by c.id
$$;

-- ---------------------------------------------------------------------
-- 5) دوال داخلية (private، غير قابلة للاستدعاء من التطبيقات)
-- ---------------------------------------------------------------------
-- عدد صحيح من jsonb (رقم بلا كسور، حتى 12 خانة)، أو null
create function private.json_int(v jsonb)
returns bigint language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(v) = 'number' and (v #>> '{}') ~ '^-?[0-9]{1,12}$'
              then (v #>> '{}')::bigint end
$$;

-- نص الكمية بالإشعار كما تعرضه اللوحة: "2.5 كيلو" لنص الكيلو، "3 باقة" للباقي
create function private.admin_qty_text(p_qty int, p_unit text)
returns text language sql immutable set search_path = ''
as $$
  select case when p_unit = 'نص كيلو' then trim_scale(p_qty / 2.0)::text || ' كيلو'
              else p_qty::text || ' ' || p_unit end
$$;

create function private.bump_daily_losses(p_day date, p_waste bigint, p_adjust bigint)
returns void language sql security definer set search_path = ''
as $$
  insert into public.daily_stats as d (day, waste_cost_iqd, adjust_loss_iqd)
  values (p_day, p_waste, p_adjust)
  on conflict (day) do update set
    waste_cost_iqd  = d.waste_cost_iqd  + excluded.waste_cost_iqd,
    adjust_loss_iqd = d.adjust_loss_iqd + excluded.adjust_loss_iqd,
    updated_at      = now()
$$;

-- إعادة بناء أيام daily_stats من المصدر (orders، order_item_costs، inventory_movements).
-- مطابقة للتحديث التراكمي: التسليم والإلغاء بيوم الانتقال (بغداد)، والخسائر بيوم الحركة.
create function private.rebuild_daily_stats(p_from date, p_to date)
returns int language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  delete from public.daily_stats where day between p_from and p_to;

  with oc as (
    select i.order_id, sum(ic.cost_snapshot_iqd * i.qty)::bigint as k
      from public.order_items i
      join public.order_item_costs ic on ic.order_item_id = i.id
     group by i.order_id
  ), dl as (
    select (o.delivered_at at time zone 'Asia/Baghdad')::date as d,
           count(*)::int as c, sum(o.subtotal_iqd)::bigint as r, sum(o.delivery_fee_iqd)::bigint as f,
           coalesce(sum(oc.k), 0)::bigint as k
      from public.orders o
      left join oc on oc.order_id = o.id
     where o.status = 'delivered' and o.delivered_at is not null
       and (o.delivered_at at time zone 'Asia/Baghdad')::date between p_from and p_to
     group by 1
  ), cn as (
    select (o.cancelled_at at time zone 'Asia/Baghdad')::date as d, count(*)::int as c
      from public.orders o
     where o.status = 'cancelled' and o.cancelled_at is not null
       and (o.cancelled_at at time zone 'Asia/Baghdad')::date between p_from and p_to
     group by 1
  ), ls as (
    select (m.created_at at time zone 'Asia/Baghdad')::date as d,
           coalesce(sum(-m.qty::bigint * m.unit_cost_iqd) filter (where m.type = 'waste'), 0)::bigint as w,
           coalesce(sum(-m.qty::bigint * m.unit_cost_iqd) filter (where m.type = 'adjust'), 0)::bigint as a
      from public.inventory_movements m
     where m.qty < 0 and m.type in ('waste', 'adjust')
       and (m.created_at at time zone 'Asia/Baghdad')::date between p_from and p_to
     group by 1
  ), days as (
    select d from dl union select d from cn union select d from ls
  )
  insert into public.daily_stats (day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd,
                                  cost_iqd, gross_profit_iqd, waste_cost_iqd, adjust_loss_iqd)
  select days.d, coalesce(dl.c, 0), coalesce(cn.c, 0), coalesce(dl.r, 0), coalesce(dl.f, 0),
         coalesce(dl.k, 0), coalesce(dl.r, 0) - coalesce(dl.k, 0), coalesce(ls.w, 0), coalesce(ls.a, 0)
    from days
    left join dl on dl.d = days.d
    left join cn on cn.d = days.d
    left join ls on ls.d = days.d
   where coalesce(dl.c, 0) + coalesce(cn.c, 0) > 0 or coalesce(ls.w, 0) + coalesce(ls.a, 0) > 0;
  get diagnostics n = row_count;
  return n;
end
$$;

-- حركة مخزون يدوية واحدة (الأقفال والتحقق هنا؛ الصلاحية عند المستدعي).
--   purchase: موجب، سعر شراء للوحدة إلزامي (مضاعف 250) يصير سعر الشراء الحالي.
--   waste: سالب؛ adjust: أي إشارة بملاحظة إلزامية. كلفتهما من product_costs (trigger).
create function private.apply_stock_movement(
  p_product_id uuid, p_qty int, p_type public.movement_type, p_note text, p_unit_cost bigint, p_by uuid)
returns int language plpgsql security definer set search_path = ''
as $$
declare
  v_new  int;
  v_note text := left(nullif(btrim(p_note), ''), 300);
begin
  if p_type is null or p_type not in ('purchase', 'waste', 'adjust')
     or p_qty is null or p_qty = 0 or p_qty not between -100000 and 100000
     or (p_type = 'purchase' and p_qty < 0) or (p_type = 'waste' and p_qty > 0)
     or (p_type = 'purchase' and (p_unit_cost is null or p_unit_cost <= 0 or p_unit_cost % 250 <> 0))
     or (p_type = 'adjust' and v_note is null) then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001', detail = coalesce(p_product_id::text, '');
  end if;

  select s.qty + p_qty into v_new from public.stock s where s.product_id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001', detail = coalesce(p_product_id::text, '');
  end if;
  if v_new < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001', detail = p_product_id::text;
  end if;

  if p_type = 'purchase' then
    insert into public.product_costs (product_id, cost_iqd, updated_at)
    values (p_product_id, p_unit_cost, now())
    on conflict (product_id) do update set cost_iqd = excluded.cost_iqd, updated_at = now();
  end if;

  update public.stock set qty = v_new, updated_at = now() where product_id = p_product_id;
  insert into public.inventory_movements (product_id, qty, type, created_by, note, unit_cost_iqd)
  values (p_product_id, p_qty, p_type, p_by, v_note,
          case when p_type = 'purchase' then p_unit_cost end);
  return v_new;
end
$$;

revoke all on function private.json_int(jsonb), private.admin_qty_text(int, text),
  private.bump_daily_losses(date, bigint, bigint), private.rebuild_daily_stats(date, date),
  private.apply_stock_movement(uuid, int, public.movement_type, text, bigint, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6) triggers: كلفة الحركة، الخسائر اليومية، تنبيه النقص (كل المسارات: البيع، الإلغاء، الحركات)
-- ---------------------------------------------------------------------
-- كلفة الوحدة: المُدخلة (المشتريات) أو سعر الشراء الحالي لحظة الحركة (0 إن لم يوجد)
create function private.tg_movement_unit_cost()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_cost bigint;
begin
  if new.unit_cost_iqd is null then
    select pc.cost_iqd into v_cost from public.product_costs pc where pc.product_id = new.product_id;
    new.unit_cost_iqd := coalesce(v_cost, 0);
  end if;
  return new;
end
$$;
create trigger movements_unit_cost before insert on public.inventory_movements
  for each row execute function private.tg_movement_unit_cost();

-- الهدر والتسوية السالبة ← daily_stats بيوم الحركة (بغداد)
create function private.tg_movement_losses()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_loss bigint := (-new.qty)::bigint * new.unit_cost_iqd;
begin
  if v_loss > 0 then
    perform private.bump_daily_losses((new.created_at at time zone 'Asia/Baghdad')::date,
                                      case when new.type = 'waste' then v_loss else 0 end,
                                      case when new.type = 'adjust' then v_loss else 0 end);
  end if;
  return new;
end
$$;
create trigger movements_losses after insert on public.inventory_movements
  for each row when (new.qty < 0 and new.type in ('waste', 'adjust'))
  execute function private.tg_movement_losses();

-- نزول من ≥ الحد إلى < الحد ← إشعار واحد للأدمن (لا يتكرر حتى يرتفع للحد ثم ينزل من جديد)
create function private.tg_stock_low_alert()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_name text; v_unit text;
begin
  select p.name, p.unit into v_name, v_unit
    from public.products p where p.id = new.product_id and p.is_active;
  if found then
    perform public._notify('admins_only', null, 'نقص مخزون: ' || v_name,
                           'الرصيد ' || private.admin_qty_text(new.qty, v_unit)
                           || ' (الحد ' || private.admin_qty_text(new.low_stock_threshold, v_unit) || ')',
                           jsonb_build_object('type', 'low_stock', 'product_id', new.product_id));
  end if;
  return new;
end
$$;
create trigger stock_low_alert after update of qty on public.stock
  for each row when (old.qty >= new.low_stock_threshold and new.qty < new.low_stock_threshold)
  execute function private.tg_stock_low_alert();

revoke all on function private.tg_movement_unit_cost(), private.tg_movement_losses(),
  private.tg_stock_low_alert() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) RPC المخزون (أدمن)
-- ---------------------------------------------------------------------
drop function public.adjust_stock(uuid, int, public.movement_type, text);

create function public.adjust_stock(
  p_product_id uuid, p_qty int, p_type public.movement_type,
  p_note text default null, p_unit_cost_iqd bigint default null)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return private.apply_stock_movement(p_product_id, p_qty, p_type, p_note, p_unit_cost_iqd, auth.uid());
end
$$;

-- دفعة حركات بمعاملة واحدة (هدر اليوم، أو مشتريات بالجملة):
--   p_items: [{"product_id": "<uuid>", "qty": -3, "unit_cost_iqd": 1500?}, ...]
--   أقفال stock بترتيب product_id؛ أي بند خاطئ يُفشل الكل (detail = المنتج). يرجع عدد البنود.
create function public.adjust_stock_bulk(p_items jsonb, p_type public.movement_type, p_note text default null)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_bad jsonb;
  v_n   int := 0;
  r     record;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500 then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001';
  end if;

  select e into v_bad
    from jsonb_array_elements(p_items) e
   where jsonb_typeof(e) <> 'object'
      or jsonb_typeof(e -> 'product_id') is distinct from 'string'
      or (e ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or private.json_int(e -> 'qty') is null
      or abs(private.json_int(e -> 'qty')) > 100000
      or (coalesce(jsonb_typeof(e -> 'unit_cost_iqd'), 'null') <> 'null'
          and private.json_int(e -> 'unit_cost_iqd') is null)
   limit 1;
  if found then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001',
          detail = left(coalesce(case when jsonb_typeof(v_bad) = 'object' then v_bad ->> 'product_id' end, ''), 64);
  end if;

  if (select count(distinct (e ->> 'product_id')::uuid) from jsonb_array_elements(p_items) e)
     <> jsonb_array_length(p_items) then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001', detail = 'duplicate product_id';
  end if;

  perform 1 from public.stock
   where product_id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(p_items) e)
   order by product_id for update;

  for r in
    select (e ->> 'product_id')::uuid as pid, private.json_int(e -> 'qty')::int as q,
           private.json_int(e -> 'unit_cost_iqd') as c
      from jsonb_array_elements(p_items) e
     order by 1
  loop
    perform private.apply_stock_movement(r.pid, r.q, p_type, p_note, r.c, auth.uid());
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- إعادة بناء التقارير اليومية لمدى (أدمن أو service_role)، حتى 367 يوماً
create function public.recompute_daily_stats(p_from date, p_to date)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;
  return private.rebuild_daily_stats(p_from, p_to);
end
$$;

-- ---------------------------------------------------------------------
-- 8) RPC المنتجات (أدمن). الأخطاء: NOT_ALLOWED، INVALID_PRODUCT (detail = الحقل)، PRODUCT_NOT_FOUND
-- ---------------------------------------------------------------------
-- إنشاء (بلا id) أو تعديل (مع id: الحقول الموجودة فقط تتغير) بمعاملة واحدة:
--   name، description، category_id، unit (SALE_UNITS)، price_iqd، image_path، is_active، sort_order،
--   cost_iqd (سعر الشراء؛ للتصحيح اليدوي، null = بلا تغيير)، low_stock_threshold.
create function public.admin_save_product(p jsonb)
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
    if v_unit is null or v_unit not in ('نص كيلو', 'باقة', 'حبة', 'علبة', 'قنينة', 'سلة') then
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

-- التعديل السريع لسعر البيع (لكل وحدة بيع، مضاعف 250)
create function public.set_product_price(p_product_id uuid, p_price_iqd bigint)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_price_iqd is null or p_price_iqd <= 0 or p_price_iqd % 250 <> 0 then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'price_iqd';
  end if;
  update public.products set price_iqd = p_price_iqd where id = p_product_id;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001', detail = coalesce(p_product_id::text, '');
  end if;
end
$$;

-- الترتيب: sort_order = موضع المنتج بالقائمة (1، 2، ...). منتج غير موجود يُفشل الكل.
create function public.reorder_products(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_missing uuid;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 1000
     or array_position(p_ids, null) is not null
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'INVALID_PRODUCT' using errcode = 'P0001', detail = 'ids';
  end if;
  select x into v_missing from unnest(p_ids) x
   where not exists (select 1 from public.products where id = x) limit 1;
  if found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001', detail = v_missing::text;
  end if;
  update public.products p set sort_order = o.ord
    from unnest(p_ids) with ordinality o(id, ord)
   where p.id = o.id and p.sort_order is distinct from o.ord::int;
end
$$;

-- ---------------------------------------------------------------------
-- 9) الصلاحيات: الكتابة على المنتجات وأسعار الشراء عبر الدوال فقط (التعطيل بدل الحذف)
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.products, public.product_costs from authenticated;

revoke all on function
  public.adjust_stock(uuid, int, public.movement_type, text, bigint),
  public.adjust_stock_bulk(jsonb, public.movement_type, text),
  public.recompute_daily_stats(date, date),
  public.admin_save_product(jsonb),
  public.set_product_price(uuid, bigint),
  public.reorder_products(uuid[])
  from public, anon;
grant execute on function
  public.adjust_stock(uuid, int, public.movement_type, text, bigint),
  public.adjust_stock_bulk(jsonb, public.movement_type, text),
  public.recompute_daily_stats(date, date),
  public.admin_save_product(jsonb),
  public.set_product_price(uuid, bigint),
  public.reorder_products(uuid[])
  to authenticated;
grant execute on function public.recompute_daily_stats(date, date) to service_role;

-- ---------------------------------------------------------------------
-- 10) backfill التقارير: كل الأيام من أول نشاط حتى اليوم (الهدر والتسويات القديمة تدخل)
-- ---------------------------------------------------------------------
select private.rebuild_daily_stats(
  least((select min(day) from public.daily_stats),
        (select min((created_at at time zone 'Asia/Baghdad')::date) from public.orders),
        (select min((created_at at time zone 'Asia/Baghdad')::date) from public.inventory_movements),
        public.baghdad_today()),
  public.baghdad_today());
