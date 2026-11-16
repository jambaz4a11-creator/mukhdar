-- =====================================================================
-- T26: التقييمات (SPEC-admin §2.8، SPEC-backend §12.3) + شارة الإشعارات العالقة بالرئيسية.
--   1) rate_order: الزبون النشط فقط (لا معطّل ولا رمز مؤقت)، طلبه المسلّم فقط، مرة واحدة، 1..5،
--      التعليق نص صرف: يُقصّ (مسافات وأسطر) وتُزال محارف التحكم، وأكثر من 500 حرفاً يُرفض COMMENT_TOO_LONG.
--   2) ratings_stats / ratings_summary / ratings_list: مصدر واحد للمتوسط والتوزيع والتعليقات بتوقيت بغداد
--      (شاشة التقييمات وبطاقات التقارير report_summary وتعليقاتها تستدعيها، فلا اختلاف بين الأرقام).
--      موظف وأدمن. لا إخفاء ولا إدارة تعليقات بالتصميم المعتمد، فلا admin_audit هنا.
--   3) الإشعارات العالقة: تعريف واحد private.stuck_count (stuck_notifications_count والرئيسية تستدعيانه)،
--      وdashboard_today تُرجع stuck_notifications للأدمن (null للموظف).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) rate_order
-- ---------------------------------------------------------------------
create or replace function public.rate_order(p_order_id uuid, p_stars int, p_comment text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_active  boolean;
  v_flagged boolean;
  v_comment text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select is_active, must_change_pin into v_active, v_flagged from public.profiles where id = v_uid;
  if v_active is distinct from true then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_flagged then
    raise exception 'PIN_CHANGE_REQUIRED' using errcode = '42501';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'INVALID_STARS' using errcode = 'P0001';
  end if;
  -- نص صرف: بلا محارف تحكم (عدا السطر الجديد والجدولة)، مقصوص، والفارغ يصير null
  v_comment := nullif(btrim(regexp_replace(coalesce(p_comment, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'),
                            E' \t\r\n'), '');
  if char_length(v_comment) > 500 then
    raise exception 'COMMENT_TOO_LONG' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.orders
                  where id = p_order_id and customer_id = v_uid and status = 'delivered') then
    raise exception 'ORDER_NOT_RATEABLE' using errcode = 'P0001';
  end if;
  insert into public.ratings (order_id, customer_id, stars, comment)
  values (p_order_id, v_uid, p_stars, v_comment)
  on conflict (order_id) do nothing;
  if not found then
    raise exception 'ALREADY_RATED' using errcode = 'P0001';
  end if;
end
$$;

-- التعليق المخزَّن مقصوص وغير فارغ (للكتابات الجديدة؛ not valid لا يفحص الصفوف القديمة)
alter table public.ratings add constraint ratings_comment_plain
  check (comment is null or (comment = btrim(comment, E' \t\r\n') and comment <> '')) not valid;

-- القراءة بالصفحات (keyset)
create index ratings_keyset_idx on public.ratings (created_at desc, order_id desc);

-- ---------------------------------------------------------------------
-- 2) الأرقام والقائمة. p_to حصري. الفلاتر: نطاق زمني، نجوم من..إلى، وبتعليق فقط.
-- ---------------------------------------------------------------------
create function private.ratings_stats(
  p_from timestamptz, p_to timestamptz, p_min int, p_max int, p_with_comment boolean)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'count', count(*)::int,
           'avg',   round(avg(r.stars), 1),
           'distribution', jsonb_build_object(
             '1', (count(*) filter (where r.stars = 1))::int, '2', (count(*) filter (where r.stars = 2))::int,
             '3', (count(*) filter (where r.stars = 3))::int, '4', (count(*) filter (where r.stars = 4))::int,
             '5', (count(*) filter (where r.stars = 5))::int))
    from public.ratings r
   where (p_from is null or r.created_at >= p_from)
     and (p_to   is null or r.created_at <  p_to)
     and r.stars between p_min and p_max
     and (not p_with_comment or r.comment is not null)
$$;

create function private.ratings_guard(p_from date, p_to date, p_min int, p_max int)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select private.is_staff_or_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_min is null or p_max is null or p_min < 1 or p_max > 5 or p_min > p_max then
    raise exception 'INVALID_STARS' using errcode = 'P0001';
  end if;
  if p_from is not null and p_to is not null and (p_from > p_to or p_to - p_from > 3650) then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;
end
$$;

create function public.ratings_summary(
  p_from date default null, p_to date default null,
  p_min_stars int default 1, p_max_stars int default 5, p_with_comment boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.ratings_guard(p_from, p_to, p_min_stars, p_max_stars);
  return private.ratings_stats(
           case when p_from is not null then private.baghdad_start(p_from) end,
           case when p_to   is not null then private.baghdad_start(p_to + 1) end,
           p_min_stars, p_max_stars, coalesce(p_with_comment, false));
end
$$;

-- القائمة: الأحدث أولاً، keyset على (created_at, order_id)؛ p_limit 1..100 (الافتراضي 50)
create function public.ratings_list(
  p_from date default null, p_to date default null,
  p_min_stars int default 1, p_max_stars int default 5, p_with_comment boolean default false,
  p_before_created timestamptz default null, p_before_order uuid default null, p_limit int default 50)
returns table (
  order_id uuid, order_number bigint, customer_name text, stars smallint, comment text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.ratings_guard(p_from, p_to, p_min_stars, p_max_stars);
  return query
    select r.order_id, o.order_number, o.customer_name, r.stars, r.comment, r.created_at
      from public.ratings r
      join public.orders o on o.id = r.order_id
     where (p_from is null or r.created_at >= private.baghdad_start(p_from))
       and (p_to   is null or r.created_at <  private.baghdad_start(p_to + 1))
       and r.stars between p_min_stars and p_max_stars
       and (not coalesce(p_with_comment, false) or r.comment is not null)
       and (p_before_created is null or p_before_order is null
            or (r.created_at, r.order_id) < (p_before_created, p_before_order))
     order by r.created_at desc, r.order_id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

revoke all on function private.ratings_stats(timestamptz, timestamptz, int, int, boolean),
  private.ratings_guard(date, date, int, int) from public, anon, authenticated;
revoke all on function public.ratings_summary(date, date, int, int, boolean),
  public.ratings_list(date, date, int, int, boolean, timestamptz, uuid, int) from public, anon;
grant execute on function public.ratings_summary(date, date, int, int, boolean),
  public.ratings_list(date, date, int, int, boolean, timestamptz, uuid, int) to authenticated;

-- بطاقات التقارير تستعمل نفس الحساب (T20 report_summary: التقييمات فقط تتغير)
create or replace function public.report_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.report_guard(p_from, p_to);

  select jsonb_build_object(
           'from', p_from, 'to', p_to,
           'placed_count',      (select coalesce(sum(placed_count), 0)::int from private.orders_placed(p_from, p_to)),
           'delivered_count',   coalesce(sum(s.delivered_count), 0)::int,
           'cancelled_count',   coalesce(sum(s.cancelled_count), 0)::int,
           'sales_iqd',         coalesce(sum(s.revenue_iqd), 0)::bigint,
           'delivery_fees_iqd', coalesce(sum(s.delivery_fees_iqd), 0)::bigint,
           'cost_iqd',          coalesce(sum(s.cost_iqd), 0)::bigint,
           'gross_profit_iqd',  coalesce(sum(s.gross_profit_iqd), 0)::bigint,
           'waste_cost_iqd',    coalesce(sum(s.waste_cost_iqd), 0)::bigint,
           'adjust_loss_iqd',   coalesce(sum(s.adjust_loss_iqd), 0)::bigint,
           'net_profit_iqd',    coalesce(sum(s.net_profit_iqd), 0)::bigint,
           'avg_order_iqd',     case when coalesce(sum(s.delivered_count), 0) > 0
                                     then round(sum(s.revenue_iqd)::numeric / sum(s.delivered_count))::bigint end)
    into v
    from public.daily_stats s
   where s.day between p_from and p_to;

  select v || jsonb_build_object(
           'rating_count', (x.s ->> 'count')::int,
           'rating_avg',   x.s -> 'avg')
    into v
    from (select private.ratings_stats(private.baghdad_start(p_from), private.baghdad_start(p_to + 1),
                                       1, 5, false) as s) x;

  return v;
end
$$;

-- ---------------------------------------------------------------------
-- 3) الإشعارات العالقة: تعريف واحد (SPEC-admin §2.7): لم تُرسل، قابلة لإعادة المحاولة (attempts < 5)،
--    لم تُصرف، وأقدم من 5 دقائق.
-- ---------------------------------------------------------------------
create function private.stuck_count()
returns int
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.notification_outbox
   where sent_at is null and attempts < 5 and dismissed_at is null
     and created_at < now() - interval '5 minutes'
$$;
revoke all on function private.stuck_count() from public, anon, authenticated;

create or replace function public.stuck_notifications_count()
returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return private.stuck_count();
end
$$;

-- الرئيسية (T25): نفس الدالة مع المفتاح stuck_notifications (أدمن فقط، null للموظف)
create or replace function private.dashboard_at(p_now timestamptz, p_money boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day      date        := (p_now at time zone 'Asia/Baghdad')::date;
  v_t0       timestamptz := private.baghdad_start(v_day);
  v_y0       timestamptz := private.baghdad_start(v_day - 1);
  v_cut      timestamptz := date_trunc('minute', p_now) + interval '1 minute';
  v_y_cut    timestamptz := v_y0 + (v_cut - v_t0);
  v_sales    bigint;
  v_sales_p  bigint;
  v_del      int;
  v_del_p    int;
  v_can      int;
  v_can_p    int;
  v_plc      int;
  v_plc_p    int;
  v_open     jsonb;
  v_low      jsonb;
  v_low_n    int;
  v_today    public.daily_stats;
  v_yday     public.daily_stats;
  v_stuck    int;
begin
  select count(*)::int, coalesce(sum(subtotal_iqd), 0)::bigint into v_del, v_sales
    from public.orders where status = 'delivered' and delivered_at >= v_t0 and delivered_at < v_cut;
  select count(*)::int, coalesce(sum(subtotal_iqd), 0)::bigint into v_del_p, v_sales_p
    from public.orders where status = 'delivered' and delivered_at >= v_y0 and delivered_at < v_y_cut;
  select count(*)::int into v_can
    from public.orders where status = 'cancelled' and cancelled_at >= v_t0 and cancelled_at < v_cut;
  select count(*)::int into v_can_p
    from public.orders where status = 'cancelled' and cancelled_at >= v_y0 and cancelled_at < v_y_cut;
  select count(*)::int into v_plc from public.orders where created_at >= v_t0 and created_at < v_cut;
  select count(*)::int into v_plc_p from public.orders where created_at >= v_y0 and created_at < v_y_cut;

  select jsonb_build_object(
           'pending',          count(*) filter (where status = 'pending'),
           'preparing',        count(*) filter (where status = 'preparing'),
           'ready',            count(*) filter (where status = 'ready'),
           'out_for_delivery', count(*) filter (where status = 'out_for_delivery'))
    into v_open
    from public.orders where status in ('pending', 'preparing', 'ready', 'out_for_delivery');

  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object(
                    'product_id', t.product_id, 'name', t.name, 'unit', t.unit,
                    'qty', t.qty, 'threshold', t.low_stock_threshold)
                  order by t.qty, t.name) filter (where t.rn <= 8), '[]'::jsonb)
    into v_low_n, v_low
    from (select s.product_id, p.name, p.unit, s.qty, s.low_stock_threshold,
                 row_number() over (order by s.qty, p.name) as rn
            from public.stock s join public.products p on p.id = s.product_id
           where p.is_active and s.qty < s.low_stock_threshold) t;

  if p_money then v_stuck := private.stuck_count(); end if;
  select * into v_today from public.daily_stats where day = v_day;
  select * into v_yday  from public.daily_stats where day = v_day - 1;

  return jsonb_build_object(
    'day',                  v_day,
    'as_of',                p_now,
    'delivered_count',      v_del,    'delivered_count_prev', v_del_p,
    'cancelled_count',      v_can,    'cancelled_count_prev', v_can_p,
    'placed_count',         v_plc,    'placed_count_prev',    v_plc_p,
    'open',                 v_open,
    'low_stock_count',      v_low_n,
    'low_stock_items',      v_low,
    'sales_iqd',            case when p_money then v_sales end,
    'sales_prev_iqd',       case when p_money then v_sales_p end,
    'avg_order_iqd',        case when p_money and v_del > 0 then round(v_sales::numeric / v_del)::bigint end,
    'avg_order_prev_iqd',   case when p_money and v_del_p > 0 then round(v_sales_p::numeric / v_del_p)::bigint end,
    'waste_cost_iqd',       case when p_money then coalesce(v_today.waste_cost_iqd, 0) end,
    'net_profit_iqd',       case when p_money then coalesce(v_today.net_profit_iqd, 0) end,
    'net_profit_prev_iqd',  case when p_money then v_yday.net_profit_iqd end,
    'stuck_notifications',  v_stuck);
end
$$;
