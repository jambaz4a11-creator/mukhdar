-- =====================================================================
-- T25: الرئيسية (SPEC-admin §2.0، SPEC-backend §12.3). دالة واحدة dashboard_today() (موظف وأدمن).
--   التعريفات (CLAUDE.md، SPEC-backend §2، نفس T20):
--     المبيعات = Σ subtotal للمسلّمة بيوم delivered_at (بغداد)، بدون أجرة التوصيل.
--     المسلّمة بـ delivered_at، الملغاة بـ cancelled_at، الواردة بـ created_at (أي حالة).
--     صافي الربح = daily_stats.net_profit_iqd (الإجمالي − الهدر − النقص)، اليوم وأمس كاملاً.
--   المقارنة: أمس من 00:00 حتى نفس الساعة والدقيقة (بغداد)، لا أمس كاملاً (ما عدا صافي الربح).
--   الموظف: كل حقول المال null (مفاتيحها موجودة بنفس الشكل)؛ الحذف هنا بالدالة لا بالواجهة.
--   الزبون والسائق والزائر والأدمن برمز مؤقت (must_change_pin) يُرفضون (NOT_ALLOWED).
-- =====================================================================

-- فهرس الملغاة بيوم الإلغاء (المسلّمة: orders_delivered_at_idx من T20؛ الواردة: orders_created_idx)
create index orders_cancelled_at_idx on public.orders (cancelled_at) where status = 'cancelled';

-- ---------------------------------------------------------------------
-- الحساب بلحظة "الآن" صريحة (للاختبار بوقت ثابت). لا يصل إليها authenticated؛ الواجهة العامة تمرر now().
--   p_money = false ← حقول المال null.
-- ---------------------------------------------------------------------
create function private.dashboard_at(p_now timestamptz, p_money boolean)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day      date        := (p_now at time zone 'Asia/Baghdad')::date;
  v_t0       timestamptz := private.baghdad_start(v_day);
  v_y0       timestamptz := private.baghdad_start(v_day - 1);
  -- نهاية الدقيقة الحالية؛ أمس يُقطع بنفس البعد عن بداية يومه (العراق بلا توقيت صيفي، فاليوم 24 ساعة)
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

  -- المفتوحة الآن (حالتها الحالية، لا بيوم)
  select jsonb_build_object(
           'pending',          count(*) filter (where status = 'pending'),
           'preparing',        count(*) filter (where status = 'preparing'),
           'ready',            count(*) filter (where status = 'ready'),
           'out_for_delivery', count(*) filter (where status = 'out_for_delivery'))
    into v_open
    from public.orders where status in ('pending', 'preparing', 'ready', 'out_for_delivery');

  -- تحت حد النقص: منتج نشط رصيده < حده (نفس شرط إشعار النقص وفلتر المخزون). الأرصدة بوحدات البيع بلا مبالغ.
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
    -- المال: أدمن فقط
    'sales_iqd',            case when p_money then v_sales end,
    'sales_prev_iqd',       case when p_money then v_sales_p end,
    'avg_order_iqd',        case when p_money and v_del > 0 then round(v_sales::numeric / v_del)::bigint end,
    'avg_order_prev_iqd',   case when p_money and v_del_p > 0 then round(v_sales_p::numeric / v_del_p)::bigint end,
    'waste_cost_iqd',       case when p_money then coalesce(v_today.waste_cost_iqd, 0) end,
    'net_profit_iqd',       case when p_money then coalesce(v_today.net_profit_iqd, 0) end,
    -- أمس كاملاً؛ null بلا صف أمس (لا بيانات ← "—" لا صفراً)
    'net_profit_prev_iqd',  case when p_money then v_yday.net_profit_iqd end);
end
$$;

revoke all on function private.dashboard_at(timestamptz, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- الواجهة: موظف وأدمن نشطان برمز غير مؤقت (private.current_user_role يستبعد المعطّل والمؤقت)
-- ---------------------------------------------------------------------
create function public.dashboard_today()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (select private.is_staff_or_admin()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  return private.dashboard_at(now(), (select private.is_admin()));
end
$$;

revoke all on function public.dashboard_today() from public, anon;
grant execute on function public.dashboard_today() to authenticated;
