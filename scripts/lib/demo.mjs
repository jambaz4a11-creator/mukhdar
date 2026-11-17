// ثوابت البيانات التجريبية (T05)، مشتركة بين seed-demo و seed-reset.
//
// كل مستخدمي العرض أرقامهم تبدأ بـ 9647000 (عرض) أو 9647001 (حمل، --scale=load).
// البادئة 7000/7001 ليست لأي شركة اتصالات عراقية، فلا تصطدم بأرقام حقيقية.
// seed:reset يحذف بهذه البادئات فقط.
export const DEMO_PHONE_PREFIX = '9647000';
export const LOAD_PHONE_PREFIX = '9647001';
export const DEMO_PHONE_LIKE = [`${DEMO_PHONE_PREFIX}%`, `${LOAD_PHONE_PREFIX}%`];

// رمز PIN لكل مستخدمي العرض والحمل (تطوير فقط، ADR 0001). ليس سهل التخمين حسب validatePin،
// لكنه منشور بالـ repo: لا يُستخدم أبداً بمشروع الإنتاج (seed:demo يرفض غير التطوير أصلاً).
export const DEMO_PIN = '482915';

// رمز حسابات السائقين التجريبية 07000000011..13 فقط (T23 L6). هذا الرمز (لا DEMO_PIN) هو ما يُسلَّم لمطوّر تطبيق
// السائق الخارجي، فلا يستطيع الدخول بحساب أدمن أو موظف العرض. تطوير فقط مثل DEMO_PIN. يمكن تدويره بلا commit:
// DRIVER_DEMO_PIN=<6 أرقام> قبل seed:demo (يُعاد تعيينه للسائقين الثلاثة عند كل تشغيل).
const FROM_ENV = process.env.DRIVER_DEMO_PIN;
if (FROM_ENV !== undefined && !/^\d{6}$/.test(FROM_ENV)) {
  throw new Error('DRIVER_DEMO_PIN must be exactly 6 digits');
}
export const DRIVER_DEMO_PIN = FROM_ENV ?? '739164';

export const phone = (prefix, n) => `${prefix}${String(n).padStart(6, '0')}`;

// يرجع الأيام التي لا يطابق فيها daily_stats الطلبات الفعلية (المسلّمة والملغاة) بتوقيت بغداد.
// فارغ = متطابق. نفس القاعدة يفحصها supabase/tests/09_daily_stats.sql.
export const STATS_MISMATCH_SQL = `
with order_costs as (
  select i.order_id, sum(c.cost_snapshot_iqd * i.qty)::bigint as cost
    from public.order_items i join public.order_item_costs c on c.order_item_id = i.id
   group by i.order_id
),
delivered as (
  select (o.delivered_at at time zone 'Asia/Baghdad')::date as day, count(*)::int as n,
         sum(o.subtotal_iqd)::bigint as revenue, sum(o.delivery_fee_iqd)::bigint as fees,
         coalesce(sum(oc.cost), 0)::bigint as cost
    from public.orders o left join order_costs oc on oc.order_id = o.id
   where o.status = 'delivered' group by 1
),
cancelled as (
  select (cancelled_at at time zone 'Asia/Baghdad')::date as day, count(*)::int as n
    from public.orders where status = 'cancelled' group by 1
),
expected as (
  select coalesce(d.day, c.day) as day, coalesce(d.n, 0) as delivered_count, coalesce(c.n, 0) as cancelled_count,
         coalesce(d.revenue, 0) as revenue_iqd, coalesce(d.fees, 0) as delivery_fees_iqd,
         coalesce(d.cost, 0) as cost_iqd, coalesce(d.revenue, 0) - coalesce(d.cost, 0) as gross_profit_iqd
    from delivered d full join cancelled c on c.day = d.day
),
actual as (
  select day, delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd
    from public.daily_stats
   where (delivered_count, cancelled_count, revenue_iqd, delivery_fees_iqd, cost_iqd, gross_profit_iqd)
         <> (0, 0, 0, 0, 0, 0)
)
select coalesce(e.day, a.day) as day, to_jsonb(e) - 'day' as expected, to_jsonb(a) - 'day' as actual
  from expected e full join actual a on a.day = e.day
 where (to_jsonb(e) - 'day') is distinct from (to_jsonb(a) - 'day')
 order by 1`;
