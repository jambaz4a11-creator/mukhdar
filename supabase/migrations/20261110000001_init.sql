-- =====================================================================
-- المخضر — المخطط الأساسي (المرحلة 1: مسودة للمراجعة)
-- Postgres 15+ على Supabase. يعتمد على auth.users و auth.uid().
-- المبادئ:
--   * كل المبالغ bigint بالدينار العراقي (أعداد صحيحة فقط).
--   * الطلب وتغيير حالته ونقص المخزون تتم داخل دوال قاعدة البيانات فقط.
--   * RLS مفعّل على كل جدول، والصلاحيات تُمنح بشكل صريح (لا شيء افتراضي).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) الأنواع
-- ---------------------------------------------------------------------
create type public.user_role     as enum ('customer', 'driver', 'staff', 'admin');
create type public.order_status  as enum ('pending', 'preparing', 'out_for_delivery', 'delivered', 'cancelled');
create type public.movement_type as enum ('purchase', 'sale', 'waste', 'adjust', 'cancel_return');
create type public.push_platform as enum ('ios', 'android');

-- تقريب لأقرب 250 دينار (نصف للأعلى). للقيم غير السالبة.
create or replace function public.round_iqd(amount bigint)
returns bigint
language sql immutable strict parallel safe
as $$ select ((amount + 125) / 250) * 250 $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- 1) جاهزية التوسع (مدن وبائعين) — غير مستخدمة بالمرحلة الأولى
-- ---------------------------------------------------------------------
create table public.cities (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  is_active  boolean not null default true
);

create table public.vendors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'produce',   -- produce | market | restaurant | wholesale (لاحقاً)
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) المستخدمون والإعدادات
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       public.user_role not null default 'customer',
  phone      text,
  full_name  text check (full_name is null or char_length(full_name) between 1 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- صف واحد فقط (id = 1)
create table public.app_settings (
  id               smallint primary key default 1 check (id = 1),
  delivery_fee_iqd bigint  not null default 1000 check (delivery_fee_iqd >= 0 and delivery_fee_iqd % 250 = 0),
  min_order_iqd    bigint  not null default 0    check (min_order_iqd >= 0),
  store_open       boolean not null default true,
  closed_message   text,
  updated_at       timestamptz not null default now()
);
insert into public.app_settings (id) values (1);
create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3) العنوان الهرمي: قطاع ← قسم فرعي ← بناية ← (شقة نصاً بالعنوان)
-- ---------------------------------------------------------------------
create table public.sectors (
  id         int generated always as identity primary key,
  city_id    smallint references public.cities (id),
  name       text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  unique (city_id, name)
);

create table public.subsections (
  id         int generated always as identity primary key,
  sector_id  int not null references public.sectors (id),
  name       text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  unique (sector_id, name)
);

create table public.buildings (
  id            int generated always as identity primary key,
  subsection_id int  not null references public.subsections (id),
  number        text not null,              -- نص لأن بعض الأرقام قد تحوي حروفاً
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  unique (subsection_id, number)
);

create table public.addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  building_id int  not null references public.buildings (id),
  apartment   text not null check (char_length(apartment) between 1 and 20),
  note        text check (note is null or char_length(note) <= 200),
  label       text check (label is null or char_length(label) <= 30),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4) الكتالوج والمخزون
-- ---------------------------------------------------------------------
create table public.categories (
  id         int generated always as identity primary key,
  vendor_id  uuid references public.vendors (id),
  name       text not null,
  image_path text,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

create table public.products (
  id          uuid primary key default gen_random_uuid(),
  category_id int  not null references public.categories (id),
  vendor_id   uuid references public.vendors (id),
  city_id     smallint references public.cities (id),
  kind        text not null default 'produce',
  name        text not null check (char_length(name) between 1 and 80),
  description text,
  unit        text not null,                 -- مثل: كيلو، حبة، باقة، كارتون
  price_iqd   bigint not null check (price_iqd > 0 and price_iqd % 250 = 0),
  image_path  text,
  in_stock    boolean not null default false, -- يُحدَّث تلقائياً من جدول stock (الزبون يرى هذا فقط)
  is_active   boolean not null default true,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- سعر الشراء: للأدمن فقط
create table public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost_iqd   bigint not null check (cost_iqd >= 0),
  updated_at timestamptz not null default now()
);

-- الرصيد الحالي (يتغير فقط عبر دوال قاعدة البيانات)
create table public.stock (
  product_id uuid primary key references public.products (id) on delete cascade,
  qty        int not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now()
);

-- سجل الحركات (دفتر الأستاذ للمخزون)
create table public.inventory_movements (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  qty        int  not null check (qty <> 0),  -- موجب = دخول، سالب = خروج
  type       public.movement_type not null,
  order_id   uuid,
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- كل منتج جديد يحصل على صف مخزون بصفر
create or replace function public.tg_products_create_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.stock (product_id, qty) values (new.id, 0) on conflict do nothing;
  return new;
end $$;
create trigger products_create_stock after insert on public.products
  for each row execute function public.tg_products_create_stock();

-- products.in_stock يتبع الرصيد
create or replace function public.tg_stock_sync_in_stock()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.products set in_stock = (new.qty > 0)
   where id = new.product_id and in_stock is distinct from (new.qty > 0);
  return new;
end $$;
create trigger stock_sync_in_stock after insert or update of qty on public.stock
  for each row execute function public.tg_stock_sync_in_stock();

-- ---------------------------------------------------------------------
-- 5) الطلبات
-- ---------------------------------------------------------------------
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        bigint generated always as identity unique,   -- رقم يظهر للناس
  customer_id         uuid references public.profiles (id) on delete set null,
  address_id          uuid references public.addresses (id) on delete set null,
  address_snapshot    jsonb not null,
  customer_name       text,
  customer_phone      text,
  city_id             smallint references public.cities (id),
  vendor_id           uuid references public.vendors (id),
  status              public.order_status not null default 'pending',
  subtotal_iqd        bigint not null check (subtotal_iqd >= 0),
  delivery_fee_iqd    bigint not null check (delivery_fee_iqd >= 0),
  total_iqd           bigint not null check (total_iqd = subtotal_iqd + delivery_fee_iqd),
  note                text check (note is null or char_length(note) <= 300),
  driver_id           uuid references public.profiles (id) on delete set null,
  idempotency_key     uuid not null,
  created_at          timestamptz not null default now(),
  assigned_at         timestamptz,
  preparing_at        timestamptz,
  out_for_delivery_at timestamptz,
  delivered_at        timestamptz,
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.profiles (id) on delete set null,
  cancel_reason       text,
  unique (customer_id, idempotency_key)
);

create table public.order_items (
  id                 bigint generated always as identity primary key,
  order_id           uuid not null references public.orders (id) on delete cascade,
  product_id         uuid references public.products (id) on delete set null,
  name_snapshot      text   not null,
  unit_snapshot      text   not null,
  price_snapshot_iqd bigint not null check (price_snapshot_iqd >= 0),
  qty                int    not null check (qty between 1 and 99),
  line_total_iqd     bigint not null check (line_total_iqd = price_snapshot_iqd * qty)
);

-- تكلفة البند لحظة الطلب: للأدمن فقط (لحساب الأرباح بدقة حتى لو تغير سعر الشراء)
create table public.order_item_costs (
  order_item_id     bigint primary key references public.order_items (id) on delete cascade,
  cost_snapshot_iqd bigint not null check (cost_snapshot_iqd >= 0)
);

create table public.order_status_history (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);

create table public.ratings (
  order_id    uuid primary key references public.orders (id) on delete cascade,
  customer_id uuid references public.profiles (id) on delete set null,
  stars       smallint not null check (stars between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 500),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6) الإشعارات والتقارير
-- ---------------------------------------------------------------------
create table public.push_tokens (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  token        text not null unique,
  platform     public.push_platform not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- صندوق صادر: الدوال تكتب هنا، و Edge Function (push-dispatch) ترسل عبر Expo Push
create table public.notification_outbox (
  id         bigint generated always as identity primary key,
  audience   text not null check (audience in ('user', 'drivers', 'admins')),
  user_id    uuid references public.profiles (id) on delete cascade,
  title      text not null,
  body       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  attempts   int not null default 0,
  last_error text,
  check ((audience = 'user') = (user_id is not null))
);

-- تقارير مجمّعة يومياً (بتوقيت بغداد). تُحدَّث عند التسليم والإلغاء فقط.
create table public.daily_stats (
  day               date primary key,
  delivered_count   int    not null default 0,
  cancelled_count   int    not null default 0,
  revenue_iqd       bigint not null default 0,  -- مجموع subtotal للطلبات المسلّمة
  delivery_fees_iqd bigint not null default 0,
  cost_iqd          bigint not null default 0,
  gross_profit_iqd  bigint not null default 0,  -- revenue - cost
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7) دوال مساعدة للأدوار (تُستخدم داخل سياسات RLS)
-- ---------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.is_staff_or_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.current_user_role() in ('staff', 'admin'), false)
$$;

create or replace function public.baghdad_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Baghdad')::date
$$;

-- إنشاء profile تلقائياً عند التسجيل برقم الهاتف
create or replace function public.tg_handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, phone) values (new.id, new.phone) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.tg_handle_new_user();

-- داخلي: إضافة إشعار للصندوق الصادر
create or replace function public._notify(p_audience text, p_user_id uuid, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notification_outbox (audience, user_id, title, body, data)
  values (p_audience, p_user_id, p_title, p_body, coalesce(p_data, '{}'::jsonb))
$$;

-- داخلي: تحديث التقارير اليومية
create or replace function public._bump_daily_stats(
  p_day date, p_delivered int, p_cancelled int, p_revenue bigint, p_fees bigint, p_cost bigint)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.daily_stats as d
    (day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd)
  values (p_day, p_delivered, p_cancelled, p_revenue, p_fees, p_cost, p_revenue - p_cost)
  on conflict (day) do update set
    delivered_count   = d.delivered_count   + excluded.delivered_count,
    cancelled_count   = d.cancelled_count   + excluded.cancelled_count,
    revenue_iqd       = d.revenue_iqd       + excluded.revenue_iqd,
    delivery_fees_iqd = d.delivery_fees_iqd + excluded.delivery_fees_iqd,
    cost_iqd          = d.cost_iqd          + excluded.cost_iqd,
    gross_profit_iqd  = d.gross_profit_iqd  + excluded.gross_profit_iqd,
    updated_at        = now()
$$;

-- ---------------------------------------------------------------------
-- 8) place_order: الطلب كاملاً بمعاملة واحدة
--   p_items: [{"product_id": "<uuid>", "qty": 2}, ...]
--   الأسعار تُقرأ من الجدول، والتطبيق لا يرسل أي سعر.
--   أخطاء (message): NOT_AUTHENTICATED, NOT_CUSTOMER, IDEMPOTENCY_KEY_REQUIRED,
--     STORE_CLOSED, ADDRESS_NOT_FOUND, EMPTY_CART, TOO_MANY_ITEMS, INVALID_QTY,
--     PRODUCT_UNAVAILABLE (detail = product_id), INSUFFICIENT_STOCK (detail = product_id),
--     BELOW_MIN_ORDER
-- ---------------------------------------------------------------------
create or replace function public.place_order(
  p_address_id      uuid,
  p_items           jsonb,
  p_idempotency_key uuid,
  p_note            text default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  public.profiles;
  v_settings public.app_settings;
  v_order    public.orders;
  v_address  jsonb;
  v_ids      uuid[];
  v_qtys     int[];
  v_bad      uuid;
  v_subtotal bigint;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.is_active or v_profile.role <> 'customer' then
    raise exception 'NOT_CUSTOMER' using errcode = '42501';
  end if;

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;

  -- منع التكرار: نفس المفتاح يرجع نفس الطلب (إعادة المحاولة بعد انقطاع الشبكة آمنة)
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key::text, 0));
  select * into v_order from public.orders
   where customer_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                              'total_iqd', v_order.total_iqd, 'status', v_order.status, 'replayed', true);
  end if;

  select * into v_settings from public.app_settings where id = 1;
  if not v_settings.store_open then
    raise exception 'STORE_CLOSED' using errcode = 'P0001';
  end if;

  -- العنوان يجب أن يكون للزبون نفسه، ونأخذ نسخة منه للطلب
  select jsonb_build_object(
           'address_id', a.id, 'sector', s.name, 'subsection', ss.name,
           'building', b.number, 'apartment', a.apartment, 'note', a.note)
    into v_address
    from public.addresses a
    join public.buildings   b  on b.id  = a.building_id
    join public.subsections ss on ss.id = b.subsection_id
    join public.sectors     s  on s.id  = ss.sector_id
   where a.id = p_address_id and a.customer_id = v_uid;
  if v_address is null then
    raise exception 'ADDRESS_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- قراءة السلة ودمج التكرار
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'TOO_MANY_ITEMS' using errcode = 'P0001';
  end if;

  select array_agg(pid order by pid), array_agg(q order by pid)
    into v_ids, v_qtys
    from (select (e ->> 'product_id')::uuid as pid, sum((e ->> 'qty')::int)::int as q
            from jsonb_array_elements(p_items) e
           group by 1) t;

  if exists (select 1 from unnest(v_ids, v_qtys) c(pid, q)
              where pid is null or q is null or q < 1 or q > 99) then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;

  -- قفل صفوف المخزون بترتيب ثابت (يمنع الـ deadlock ويمنع بيع نفس الحبة مرتين)
  perform 1 from public.stock where product_id = any (v_ids) order by product_id for update;

  select c.pid into v_bad
    from unnest(v_ids, v_qtys) c(pid, q)
    left join public.products p on p.id = c.pid and p.is_active
   where p.id is null
   limit 1;
  if v_bad is not null then
    raise exception 'PRODUCT_UNAVAILABLE' using errcode = 'P0001', detail = v_bad::text;
  end if;

  select c.pid into v_bad
    from unnest(v_ids, v_qtys) c(pid, q)
    left join public.stock s on s.product_id = c.pid
   where coalesce(s.qty, 0) < c.q
   limit 1;
  if v_bad is not null then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001', detail = v_bad::text;
  end if;

  select public.round_iqd(sum(p.price_iqd * c.q)::bigint) into v_subtotal
    from unnest(v_ids, v_qtys) c(pid, q)
    join public.products p on p.id = c.pid;

  if v_subtotal < v_settings.min_order_iqd then
    raise exception 'BELOW_MIN_ORDER' using errcode = 'P0001', detail = v_settings.min_order_iqd::text;
  end if;

  insert into public.orders (customer_id, address_id, address_snapshot, customer_name, customer_phone,
                             subtotal_iqd, delivery_fee_iqd, total_iqd, note, idempotency_key)
  values (v_uid, p_address_id, v_address, v_profile.full_name, v_profile.phone,
          v_subtotal, v_settings.delivery_fee_iqd, v_subtotal + v_settings.delivery_fee_iqd,
          nullif(trim(p_note), ''), p_idempotency_key)
  returning * into v_order;

  with ins as (
    insert into public.order_items (order_id, product_id, name_snapshot, unit_snapshot,
                                    price_snapshot_iqd, qty, line_total_iqd)
    select v_order.id, p.id, p.name, p.unit, p.price_iqd, c.q, p.price_iqd * c.q
      from unnest(v_ids, v_qtys) c(pid, q)
      join public.products p on p.id = c.pid
    returning id, product_id
  )
  insert into public.order_item_costs (order_item_id, cost_snapshot_iqd)
  select ins.id, coalesce(pc.cost_iqd, 0)
    from ins left join public.product_costs pc on pc.product_id = ins.product_id;

  update public.stock s
     set qty = s.qty - c.q, updated_at = now()
    from unnest(v_ids, v_qtys) c(pid, q)
   where s.product_id = c.pid;

  insert into public.inventory_movements (product_id, qty, type, order_id, created_by)
  select c.pid, -c.q, 'sale', v_order.id, v_uid from unnest(v_ids, v_qtys) c(pid, q);

  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (v_order.id, null, 'pending', v_uid);

  -- إشعار تلقائي للسائقين والأدمن (بدون موافقة أدمن)
  perform public._notify('drivers', null, 'طلب جديد #' || v_order.order_number,
                         'بناية ' || (v_address ->> 'building') || ' - ' || (v_address ->> 'subsection'),
                         jsonb_build_object('order_id', v_order.id, 'type', 'new_order'));
  perform public._notify('admins', null, 'طلب جديد #' || v_order.order_number,
                         'المجموع ' || v_order.total_iqd || ' د.ع',
                         jsonb_build_object('order_id', v_order.id, 'type', 'new_order'));

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number,
                            'total_iqd', v_order.total_iqd, 'status', v_order.status, 'replayed', false);
end
$$;

-- ---------------------------------------------------------------------
-- 9) set_order_status: كل تحويلات الحالة تمر من هنا
--   pending → preparing | cancelled
--   preparing → out_for_delivery | cancelled
--   out_for_delivery → delivered | cancelled (أدمن فقط)
--   delivered و cancelled نهائيتان.
-- الصلاحيات:
--   admin: أي تحويل صحيح. staff: → preparing، والإلغاء قبل الخروج.
--   driver (المعيَّن فقط): → out_for_delivery و → delivered.
--   customer (صاحب الطلب): إلغاء وهو pending فقط.
-- ---------------------------------------------------------------------
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_reason   text default null
)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_order   public.orders;
  v_prev    public.order_status;
  v_allowed boolean;
  v_cost    bigint;
begin
  if v_uid is null or v_role is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_prev := v_order.status;

  if not ((v_prev = 'pending'          and p_status in ('preparing', 'cancelled'))
       or (v_prev = 'preparing'        and p_status in ('out_for_delivery', 'cancelled'))
       or (v_prev = 'out_for_delivery' and p_status in ('delivered', 'cancelled'))) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
          detail = v_prev::text || ' -> ' || p_status::text;
  end if;

  v_allowed := case v_role
    when 'admin'    then true
    when 'staff'    then p_status = 'preparing'
                         or (p_status = 'cancelled' and v_prev in ('pending', 'preparing'))
    when 'driver'   then v_order.driver_id = v_uid and p_status in ('out_for_delivery', 'delivered')
    when 'customer' then v_order.customer_id = v_uid and v_prev = 'pending' and p_status = 'cancelled'
    else false
  end;
  if not coalesce(v_allowed, false) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if p_status = 'out_for_delivery' and v_order.driver_id is null then
    raise exception 'NO_DRIVER_ASSIGNED' using errcode = 'P0001';
  end if;

  update public.orders set
    status              = p_status,
    preparing_at        = case when p_status = 'preparing'        then now() else preparing_at end,
    out_for_delivery_at = case when p_status = 'out_for_delivery' then now() else out_for_delivery_at end,
    delivered_at        = case when p_status = 'delivered'        then now() else delivered_at end,
    cancelled_at        = case when p_status = 'cancelled'        then now() else cancelled_at end,
    cancelled_by        = case when p_status = 'cancelled'        then v_uid else cancelled_by end,
    cancel_reason       = case when p_status = 'cancelled'        then nullif(trim(p_reason), '') else cancel_reason end
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_prev, p_status, v_uid, nullif(trim(p_reason), ''));

  if p_status = 'cancelled' then
    -- إرجاع المخزون (قفل بنفس الترتيب الثابت)
    perform 1 from public.stock
     where product_id in (select product_id from public.order_items where order_id = p_order_id)
     order by product_id for update;

    update public.stock s
       set qty = s.qty + oi.qty, updated_at = now()
      from (select product_id, sum(qty)::int as qty from public.order_items
             where order_id = p_order_id and product_id is not null group by product_id) oi
     where s.product_id = oi.product_id;

    insert into public.inventory_movements (product_id, qty, type, order_id, created_by, note)
    select product_id, sum(qty)::int, 'cancel_return', p_order_id, v_uid, 'إلغاء طلب'
      from public.order_items where order_id = p_order_id and product_id is not null
     group by product_id;

    perform public._bump_daily_stats(public.baghdad_today(), 0, 1, 0, 0, 0);
    perform public._notify('user', v_order.customer_id, 'تم إلغاء طلبك',
                           'الطلب #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;

  elsif p_status = 'delivered' then
    select coalesce(sum(c.cost_snapshot_iqd * i.qty), 0)::bigint into v_cost
      from public.order_items i join public.order_item_costs c on c.order_item_id = i.id
     where i.order_id = p_order_id;

    perform public._bump_daily_stats(public.baghdad_today(), 1, 0,
                                     v_order.subtotal_iqd, v_order.delivery_fee_iqd, v_cost);
    perform public._notify('user', v_order.customer_id, 'تم توصيل طلبك',
                           'شكراً لك! قيّم طلبك #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;

  else
    perform public._notify('user', v_order.customer_id,
                           case p_status when 'preparing' then 'طلبك قيد التحضير'
                                         else 'طلبك بالطريق إليك' end,
                           'الطلب #' || v_order.order_number,
                           jsonb_build_object('order_id', p_order_id, 'status', p_status))
      where v_order.customer_id is not null;
  end if;

  return v_order;
end
$$;

-- ---------------------------------------------------------------------
-- 10) دوال السائق
-- ---------------------------------------------------------------------
-- الطلبات المتاحة (بدون رقم هاتف الزبون حتى يقبل السائق الطلب)
create or replace function public.available_orders(p_limit int default 20)
returns table (id uuid, order_number bigint, status public.order_status, sector text,
               subsection text, building text, item_count bigint, total_iqd bigint, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if coalesce(public.current_user_role() <> 'driver', true) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return query
    select o.id, o.order_number, o.status,
           o.address_snapshot ->> 'sector', o.address_snapshot ->> 'subsection', o.address_snapshot ->> 'building',
           (select sum(i.qty) from public.order_items i where i.order_id = o.id), o.total_iqd, o.created_at
      from public.orders o
     where o.driver_id is null and o.status in ('pending', 'preparing')
     order by o.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end
$$;

-- السائق يقبل الطلب؛ أول من يقبل يأخذه
create or replace function public.accept_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_order public.orders;
begin
  if coalesce(public.current_user_role() <> 'driver', true) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  update public.orders set driver_id = v_uid, assigned_at = now()
   where id = p_order_id and driver_id is null and status in ('pending', 'preparing')
  returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_order.status, v_order.status, v_uid, 'driver_accepted');
  return v_order;
end
$$;

-- الأدمن/الموظف يعيّن أو يغيّر السائق يدوياً
create or replace function public.assign_driver(p_order_id uuid, p_driver_id uuid)
returns public.orders
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order public.orders;
begin
  if not public.is_staff_or_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_driver_id and role = 'driver' and is_active) then
    raise exception 'DRIVER_NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.orders set driver_id = p_driver_id, assigned_at = now()
   where id = p_order_id and status in ('pending', 'preparing', 'out_for_delivery')
  returning * into v_order;
  if not found then
    raise exception 'ORDER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_order.status, v_order.status, auth.uid(), 'driver_assigned');
  perform public._notify('user', p_driver_id, 'تم تعيين طلب لك #' || v_order.order_number,
                         'بناية ' || (v_order.address_snapshot ->> 'building'),
                         jsonb_build_object('order_id', p_order_id, 'type', 'assigned'));
  return v_order;
end
$$;

-- ---------------------------------------------------------------------
-- 11) دوال الزبون الأخرى
-- ---------------------------------------------------------------------
create or replace function public.rate_order(p_order_id uuid, p_stars int, p_comment text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'INVALID_STARS' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.orders
                  where id = p_order_id and customer_id = auth.uid() and status = 'delivered') then
    raise exception 'ORDER_NOT_RATEABLE' using errcode = 'P0001';
  end if;
  insert into public.ratings (order_id, customer_id, stars, comment)
  values (p_order_id, auth.uid(), p_stars, nullif(trim(p_comment), ''))
  on conflict (order_id) do nothing;
  if not found then
    raise exception 'ALREADY_RATED' using errcode = 'P0001';
  end if;
end
$$;

-- تسجيل رمز الإشعارات (لو انتقل الجهاز لحساب آخر، الرمز ينتقل معه)
create or replace function public.register_push_token(p_token text, p_platform public.push_platform)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  insert into public.push_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now();
end
$$;

-- ---------------------------------------------------------------------
-- 12) دوال الأدمن
-- ---------------------------------------------------------------------
-- حركة مخزون يدوية: purchase (موجب)، waste (سالب)، adjust (أي إشارة)
create or replace function public.adjust_stock(
  p_product_id uuid, p_qty int, p_type public.movement_type, p_note text default null)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_new int;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_type not in ('purchase', 'waste', 'adjust') or p_qty is null or p_qty = 0
     or (p_type = 'purchase' and p_qty < 0) or (p_type = 'waste' and p_qty > 0) then
    raise exception 'INVALID_MOVEMENT' using errcode = 'P0001';
  end if;

  select qty + p_qty into v_new from public.stock where product_id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_new < 0 then
    raise exception 'INSUFFICIENT_STOCK' using errcode = 'P0001', detail = p_product_id::text;
  end if;

  update public.stock set qty = v_new, updated_at = now() where product_id = p_product_id;
  insert into public.inventory_movements (product_id, qty, type, created_by, note)
  values (p_product_id, p_qty, p_type, auth.uid(), nullif(trim(p_note), ''));
  return v_new;
end
$$;

create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role, p_is_active boolean default true)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or not p_is_active) then
    raise exception 'CANNOT_DEMOTE_SELF' using errcode = 'P0001';
  end if;
  update public.profiles set role = p_role, is_active = p_is_active where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 13) الفهارس
-- ---------------------------------------------------------------------
create index orders_customer_created_idx  on public.orders (customer_id, created_at desc);
create index orders_status_created_idx    on public.orders (status, created_at);
create index orders_driver_status_idx     on public.orders (driver_id, status);
create index orders_unassigned_idx        on public.orders (created_at)
  where driver_id is null and status in ('pending', 'preparing');
create index orders_created_idx           on public.orders (created_at desc);
create index order_items_order_idx        on public.order_items (order_id);
create index order_items_product_idx      on public.order_items (product_id);
create index order_history_order_idx      on public.order_status_history (order_id, created_at);
create index products_category_active_idx on public.products (category_id, is_active, sort_order);
create index categories_active_idx        on public.categories (is_active, sort_order);
create index movements_product_idx        on public.inventory_movements (product_id, created_at desc);
create index movements_order_idx          on public.inventory_movements (order_id) where order_id is not null;
create index addresses_customer_idx       on public.addresses (customer_id);
create index subsections_sector_idx       on public.subsections (sector_id);
create index buildings_subsection_idx     on public.buildings (subsection_id);
create index push_tokens_user_idx         on public.push_tokens (user_id);
create index outbox_pending_idx           on public.notification_outbox (created_at) where sent_at is null;
create index profiles_role_idx            on public.profiles (role) where is_active;
create index ratings_created_idx          on public.ratings (created_at desc);

-- ---------------------------------------------------------------------
-- 14) RLS
-- ---------------------------------------------------------------------
alter table public.cities               enable row level security;
alter table public.vendors              enable row level security;
alter table public.profiles             enable row level security;
alter table public.app_settings         enable row level security;
alter table public.sectors              enable row level security;
alter table public.subsections          enable row level security;
alter table public.buildings            enable row level security;
alter table public.addresses            enable row level security;
alter table public.categories           enable row level security;
alter table public.products             enable row level security;
alter table public.product_costs        enable row level security;
alter table public.stock                enable row level security;
alter table public.inventory_movements  enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_item_costs     enable row level security;
alter table public.order_status_history enable row level security;
alter table public.ratings              enable row level security;
alter table public.push_tokens          enable row level security;
alter table public.notification_outbox  enable row level security;  -- بدون سياسات: service_role فقط
alter table public.daily_stats          enable row level security;

-- الكتالوج والعناوين: قراءة للجميع (حتى قبل الدخول) للنشط فقط، والأدمن يدير كل شيء
create policy cities_read      on public.cities      for select using (is_active or public.is_admin());
create policy cities_admin     on public.cities      for all using (public.is_admin()) with check (public.is_admin());
create policy vendors_read     on public.vendors     for select using (is_active or public.is_admin());
create policy vendors_admin    on public.vendors     for all using (public.is_admin()) with check (public.is_admin());
create policy sectors_read     on public.sectors     for select using (is_active or public.is_admin());
create policy sectors_admin    on public.sectors     for all using (public.is_admin()) with check (public.is_admin());
create policy subsections_read on public.subsections for select using (is_active or public.is_admin());
create policy subsections_admin on public.subsections for all using (public.is_admin()) with check (public.is_admin());
create policy buildings_read   on public.buildings   for select using (is_active or public.is_admin());
create policy buildings_admin  on public.buildings   for all using (public.is_admin()) with check (public.is_admin());
create policy categories_read  on public.categories  for select using (is_active or public.is_staff_or_admin());
create policy categories_admin on public.categories  for all using (public.is_admin()) with check (public.is_admin());
create policy products_read    on public.products    for select using (is_active or public.is_staff_or_admin());
create policy products_admin   on public.products    for all using (public.is_admin()) with check (public.is_admin());

create policy settings_read  on public.app_settings for select using (true);
create policy settings_admin on public.app_settings for update using (public.is_admin()) with check (public.is_admin());

-- بيانات الأدمن فقط
create policy product_costs_admin    on public.product_costs       for all using (public.is_admin()) with check (public.is_admin());
create policy stock_read_staff       on public.stock               for select using (public.is_staff_or_admin());
create policy movements_read_admin   on public.inventory_movements for select using (public.is_admin());
create policy item_costs_read_admin  on public.order_item_costs    for select using (public.is_admin());
create policy daily_stats_read_admin on public.daily_stats         for select using (public.is_admin());

-- الملف الشخصي
create policy profiles_read_own   on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- عناوين الزبون
create policy addresses_own        on public.addresses for all
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy addresses_read_admin on public.addresses for select using (public.is_admin());

-- الطلبات: قراءة فقط. الكتابة عبر الدوال.
create policy orders_read on public.orders for select using (
  customer_id = auth.uid() or driver_id = auth.uid() or public.is_staff_or_admin());
create policy order_items_read on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id));      -- يرث RLS الطلبات
create policy order_history_read on public.order_status_history for select using (
  exists (select 1 from public.orders o where o.id = order_id));
create policy ratings_read on public.ratings for select using (
  customer_id = auth.uid() or public.is_staff_or_admin());

create policy push_tokens_own on public.push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 15) الصلاحيات (Grants): نسحب كل شيء ثم نمنح المطلوب فقط
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant usage on all sequences in schema public to authenticated;

-- قراءة الكتالوج للجميع
grant select on public.cities, public.vendors, public.sectors, public.subsections, public.buildings,
               public.categories, public.products, public.app_settings
  to anon, authenticated;

-- إدارة الكتالوج (RLS يحصرها بالأدمن)
grant insert, update, delete on public.cities, public.vendors, public.sectors, public.subsections,
                                public.buildings, public.categories, public.products, public.product_costs
  to authenticated;
grant select on public.product_costs, public.stock, public.inventory_movements,
               public.order_item_costs, public.daily_stats
  to authenticated;
grant update (delivery_fee_iqd, min_order_iqd, store_open, closed_message) on public.app_settings to authenticated;

-- الزبون يعدّل اسمه فقط (لا الدور ولا الهاتف ولا التفعيل)
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select, insert, update, delete on public.addresses, public.push_tokens to authenticated;
grant select on public.orders, public.order_items, public.order_status_history, public.ratings to authenticated;

-- الدوال المساعدة المستخدمة داخل السياسات
grant execute on function public.current_user_role(), public.is_admin(), public.is_staff_or_admin(),
                          public.round_iqd(bigint), public.baghdad_today()
  to anon, authenticated;

-- دوال RPC المسموحة للتطبيقات
grant execute on function
  public.place_order(uuid, jsonb, uuid, text),
  public.set_order_status(uuid, public.order_status, text),
  public.available_orders(int),
  public.accept_order(uuid),
  public.assign_driver(uuid, uuid),
  public.rate_order(uuid, int, text),
  public.register_push_token(text, public.push_platform),
  public.adjust_stock(uuid, int, public.movement_type, text),
  public.set_user_role(uuid, public.user_role, boolean)
to authenticated;

-- ---------------------------------------------------------------------
-- 16) Realtime: الزبون يشترك بطلبه الحالي فقط (filter id=eq.<order_id>)، و RLS يُطبَّق
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
