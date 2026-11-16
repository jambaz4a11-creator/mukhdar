-- =====================================================================
-- T20: التقارير (SPEC-admin §2.5، SPEC-backend §12.3). أدمن فقط، بتوقيت بغداد، مدى أقصى 366 يوماً.
--   تعريفات المال (CLAUDE.md، SPEC-backend §2):
--     المبيعات      = Σ subtotal للطلبات المسلّمة بيوم delivered_at (بغداد)، بدون أجرة التوصيل.
--     الربح الإجمالي = المبيعات − كلفة البضاعة المباعة (order_item_costs: الكلفة لحظة الطلب).
--     صافي الربح    = الربح الإجمالي − كلفة الهدر − كلفة تسويات الجرد السالبة (كلفة الوحدة على كل حركة).
--   الطلب الملغى لا يدخل أي مبلغ، إلا هدر "الإلغاء بلا إرجاع" (حركة waste بكلفة الطلب، T18/جلسة A).
--   المجاميع تُحسب هنا (لا بالمتصفح). المؤشرات اليومية من daily_stats؛ الواردة والمنتجات والسائقون
--   والهدر استعلامات مباشرة محدودة بالمدى، بفهارس (أدناه).
--   الكميات بوحدات البيع (أنصاف الكيلو)؛ التحويل للكيلو باللوحة فقط (adminUnits، SPEC-admin §2.9).
-- + مراجعة AB، L4(a): منتج له تاريخ (بنود طلبات أو حركات مخزون) لا يُحذف حذفاً فعلياً (التعطيل هو البديل)،
--   فلا تخسر التقارير صفوفاً ولا تُصبح بنود الطلبات بلا منتج.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) L4(a): لا حذف فعلي لمنتج له تاريخ
--   inventory_movements كان on delete cascade (يمسح الهدر والحركات مع المنتج)، وorder_items كان
--   on delete set null (يفصل البنود عن المنتج فيضيع الهدر عند الإلغاء بلا إرجاع). الآن restrict:
--   حذف منتج له أي بند أو حركة يُرفض (23503) حتى لـ postgres/service_role. منتج بلا تاريخ يبقى قابلاً
--   للحذف (stock وproduct_costs تُحذف معه). authenticated لا يملك delete أصلاً (T18).
-- ---------------------------------------------------------------------
alter table public.inventory_movements drop constraint inventory_movements_product_id_fkey;
alter table public.inventory_movements add constraint inventory_movements_product_id_fkey
  foreign key (product_id) references public.products (id) on delete restrict;

alter table public.order_items drop constraint order_items_product_id_fkey;
alter table public.order_items add constraint order_items_product_id_fkey
  foreign key (product_id) references public.products (id) on delete restrict;

-- ---------------------------------------------------------------------
-- 2) الفهارس (مسح بالمدى فقط؛ فُحصت بـ scripts/report-perf.mjs على حجم كبير)
-- ---------------------------------------------------------------------
-- المسلّمة بيوم التسليم: أكثر المنتجات مبيعاً والسائقون (والرئيسية لاحقاً، T25)
create index orders_delivered_at_idx on public.orders (delivered_at) where status = 'delivered';
-- الهدر والتسويات السالبة بيوم الحركة: تقرير الهدر
create index movements_losses_created_idx on public.inventory_movements (created_at)
  where qty < 0 and type in ('waste', 'adjust');
-- الواردة: orders_created_idx (created_at) موجود. التقييمات: ratings_created_idx موجود.

-- ---------------------------------------------------------------------
-- 3) دوال داخلية
-- ---------------------------------------------------------------------
-- الصلاحية والمدى: أدمن نشط (برمز غير مؤقت)، والمدى 1..366 يوماً
create function private.report_guard(p_from date, p_to date)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 365 then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'P0001';
  end if;
end
$$;

-- بداية يوم بغداد كلحظة زمنية (العراق بلا توقيت صيفي، لكن التحويل عبر المنطقة الزمنية لا +03 ثابتة)
create function private.baghdad_start(p_day date)
returns timestamptz language sql stable set search_path = ''
as $$
  select p_day::timestamp at time zone 'Asia/Baghdad'
$$;

-- الطلبات الواردة لكل يوم (أي حالة، بيوم created_at)، كل أيام المدى ولو صفراً
create function private.orders_placed(p_from date, p_to date)
returns table (day date, placed_count int)
language sql stable security definer set search_path = ''
as $$
  with c as (
    select (o.created_at at time zone 'Asia/Baghdad')::date as d, count(*)::int as n
      from public.orders o
     where o.created_at >= private.baghdad_start(p_from)
       and o.created_at <  private.baghdad_start(p_to + 1)
     group by 1
  )
  select g.d::date, coalesce(c.n, 0)
    from generate_series(p_from, p_to, interval '1 day') g(d)
    left join c on c.d = g.d::date
   order by 1
$$;

revoke all on function private.report_guard(date, date), private.baghdad_start(date),
  private.orders_placed(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) RPC التقارير (أدمن). الأخطاء: NOT_ALLOWED (42501)، INVALID_DATE_RANGE
-- ---------------------------------------------------------------------

-- بطاقات المدى: مجاميع daily_stats + الواردة + التقييمات. كل المبالغ أعداد صحيحة بالدينار.
-- متوسط الطلب = المبيعات ÷ المسلّمة، مقرّباً لأقرب دينار (null بلا تسليم).
create function public.report_summary(p_from date, p_to date)
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
           'rating_count', count(*)::int,
           'rating_avg',   round(avg(r.stars), 1))
    into v
    from public.ratings r
   where r.created_at >= private.baghdad_start(p_from)
     and r.created_at <  private.baghdad_start(p_to + 1);

  return v;
end
$$;

-- لكل يوم بالمدى (ولو صفراً): للرسم اليومي وتصدير CSV
create function public.report_daily(p_from date, p_to date)
returns table (
  day date, placed_count int, delivered_count int, cancelled_count int,
  sales_iqd bigint, delivery_fees_iqd bigint, cost_iqd bigint, gross_profit_iqd bigint,
  waste_cost_iqd bigint, adjust_loss_iqd bigint, net_profit_iqd bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.report_guard(p_from, p_to);
  return query
    select p.day, p.placed_count,
           coalesce(s.delivered_count, 0), coalesce(s.cancelled_count, 0),
           coalesce(s.revenue_iqd, 0)::bigint, coalesce(s.delivery_fees_iqd, 0)::bigint,
           coalesce(s.cost_iqd, 0)::bigint, coalesce(s.gross_profit_iqd, 0)::bigint,
           coalesce(s.waste_cost_iqd, 0)::bigint, coalesce(s.adjust_loss_iqd, 0)::bigint,
           coalesce(s.net_profit_iqd, 0)::bigint
      from private.orders_placed(p_from, p_to) p
      left join public.daily_stats s on s.day = p.day
     order by p.day;
end
$$;

-- الطلبات الواردة لكل يوم (بيوم created_at، أي حالة)
create function public.report_orders_placed(p_from date, p_to date)
returns table (day date, placed_count int)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.report_guard(p_from, p_to);
  return query select o.day, o.placed_count from private.orders_placed(p_from, p_to) o;
end
$$;

-- أكثر المنتجات مبيعاً: بنود الطلبات المسلّمة بيوم التسليم. الصف = منتج + وحدة البند وقت الطلب
-- (تغيير وحدة منتج لاحقاً لا يخلط أنصاف الكيلو بالباقات). الترتيب بالمبيعات ثم الكمية. p_limit 1..100.
create function public.report_top_products(p_from date, p_to date, p_limit int default 20)
returns table (
  product_id uuid, name text, unit text, qty bigint,
  sales_iqd bigint, cost_iqd bigint, gross_profit_iqd bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.report_guard(p_from, p_to);
  return query
    select i.product_id, coalesce(max(p.name), max(i.name_snapshot)), i.unit_snapshot,
           sum(i.qty)::bigint,
           sum(i.line_total_iqd)::bigint,
           coalesce(sum(c.cost_snapshot_iqd * i.qty), 0)::bigint,
           (sum(i.line_total_iqd) - coalesce(sum(c.cost_snapshot_iqd * i.qty), 0))::bigint
      from public.orders o
      join public.order_items i on i.order_id = o.id
      left join public.order_item_costs c on c.order_item_id = i.id
      left join public.products p on p.id = i.product_id
     where o.status = 'delivered'
       and o.delivered_at >= private.baghdad_start(p_from)
       and o.delivered_at <  private.baghdad_start(p_to + 1)
     group by i.product_id, i.unit_snapshot
     order by 5 desc, 4 desc, 2
     limit least(greatest(coalesce(p_limit, 20), 1), 100);
end
$$;

-- أداء السائقين: المسلّمة لكل سائق بيوم التسليم، وأجور توصيلها (للسائق، للعلم)
create function public.report_drivers(p_from date, p_to date)
returns table (driver_id uuid, name text, delivered_count int, delivery_fees_iqd bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.report_guard(p_from, p_to);
  return query
    select o.driver_id, max(pr.full_name), count(*)::int, sum(o.delivery_fee_iqd)::bigint
      from public.orders o
      left join public.profiles pr on pr.id = o.driver_id
     where o.status = 'delivered'
       and o.delivered_at >= private.baghdad_start(p_from)
       and o.delivered_at <  private.baghdad_start(p_to + 1)
     group by o.driver_id
     order by 3 desc, 2;
end
$$;

-- تقرير الهدر: لكل منتج كمية وكلفة الهدر (ومنه الإلغاء بلا إرجاع) والتسويات السالبة (النقص)، بيوم
-- الحركة، بكلفة الوحدة المحفوظة على كل حركة. الكميات موجبة بوحدات البيع. مرتّب بالكلفة الكلية.
create function public.report_waste(p_from date, p_to date)
returns table (
  product_id uuid, name text, unit text,
  waste_qty bigint, waste_cost_iqd bigint, shortage_qty bigint, shortage_cost_iqd bigint, total_cost_iqd bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.report_guard(p_from, p_to);
  return query
    select m.product_id, p.name, p.unit,
           coalesce(sum(-m.qty) filter (where m.type = 'waste'), 0)::bigint,
           coalesce(sum(-m.qty::bigint * m.unit_cost_iqd) filter (where m.type = 'waste'), 0)::bigint,
           coalesce(sum(-m.qty) filter (where m.type = 'adjust'), 0)::bigint,
           coalesce(sum(-m.qty::bigint * m.unit_cost_iqd) filter (where m.type = 'adjust'), 0)::bigint,
           sum(-m.qty::bigint * m.unit_cost_iqd)::bigint
      from public.inventory_movements m
      join public.products p on p.id = m.product_id
     where m.qty < 0 and m.type in ('waste', 'adjust')
       and m.created_at >= private.baghdad_start(p_from)
       and m.created_at <  private.baghdad_start(p_to + 1)
     group by m.product_id, p.name, p.unit
     order by sum(-m.qty::bigint * m.unit_cost_iqd) desc, sum(-m.qty) desc, p.name;
end
$$;

revoke all on function
  public.report_summary(date, date),
  public.report_daily(date, date),
  public.report_orders_placed(date, date),
  public.report_top_products(date, date, int),
  public.report_drivers(date, date),
  public.report_waste(date, date)
  from public, anon;
grant execute on function
  public.report_summary(date, date),
  public.report_daily(date, date),
  public.report_orders_placed(date, date),
  public.report_top_products(date, date, int),
  public.report_drivers(date, date),
  public.report_waste(date, date)
  to authenticated;
