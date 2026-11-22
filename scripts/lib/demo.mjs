// ثوابت البيانات التجريبية (T05)، مشتركة بين seed-demo و seed-reset.
//
// كل مستخدمي العرض أرقامهم تبدأ بـ 9647000 (عرض) أو 9647001 (حمل، --scale=load).
// البادئة 7000/7001 ليست لأي شركة اتصالات عراقية، فلا تصطدم بأرقام حقيقية.
// seed:reset يحذف بهذه البادئات فقط.
export const DEMO_PHONE_PREFIX = '9647000';
export const LOAD_PHONE_PREFIX = '9647001';
export const DEMO_PHONE_LIKE = [`${DEMO_PHONE_PREFIX}%`, `${LOAD_PHONE_PREFIX}%`];

// بيانات دخول العرض (قرار المالك 2026-11-22، تجهيز الـ repo ليصير عاماً): لا قيم حقيقية بالـ repo.
// - LOCAL_*: قيم **عامة معروفة** صالحة فقط للمكدس المحلي المؤقت (supabase start وCI). لا تُكتب أبداً على مشروع سحابي.
// - mukhdar-dev (--remote): القيم من البيئة أو .env.local (مُتجاهل بـ git): DEMO_PIN وDRIVER_DEMO_PIN وDEMO_TOTP_SECRET.
//   ناقصة أو تساوي القيم المحلية العامة ← خطأ يوقف السكربت (RUNBOOK §6).
// السائقون التجريبيون 07000000011..13 برمز خاص (T23 L6): هو ما يُسلَّم لمطوّر تطبيق السائق، فلا يدخل بحساب أدمن العرض.
export const LOCAL_DEMO_PIN = '482915';
export const LOCAL_DRIVER_DEMO_PIN = '739164';
export const LOCAL_TOTP_SECRET = 'MUKHDARDEVONLYTOTPSECRETNOTPROD2';

const BASE32_160 = /^[A-Z2-7]{32}$/;

function checkPin(name, value) {
  if (!/^\d{6}$/.test(value)) throw new Error(`${name} must be exactly 6 digits`);
  if (/^(\d)\1{5}$/.test(value) || '0123456789'.includes(value) || '9876543210'.includes(value)) {
    throw new Error(`${name} is too easy to guess`);
  }
}

/**
 * بيانات دخول العرض للهدف. local: البيئة أو القيم المحلية العامة. remote: البيئة/.env.local إلزامياً،
 * ومختلفة عن القيم العامة (القيم القديمة المنشورة لا تُكتب على mukhdar-dev من جديد).
 * @param {{kind: 'local' | 'remote'}} target
 * @param {(name: string) => string | undefined} read قارئ المتغيرات (البيئة ثم .env.local)
 */
export function demoCredentials(target, read = (n) => process.env[n]) {
  const remote = target.kind === 'remote';
  const get = (name, local) => {
    const v = read(name)?.trim();
    if (v) return v;
    if (remote) {
      throw new Error(
        `Refusing: ${name} is not set. For mukhdar-dev put DEMO_PIN, DRIVER_DEMO_PIN and DEMO_TOTP_SECRET ` +
          'in .env.local (never in git; RUNBOOK §6).',
      );
    }
    return local;
  };
  const pin = get('DEMO_PIN', LOCAL_DEMO_PIN);
  const driverPin = get('DRIVER_DEMO_PIN', LOCAL_DRIVER_DEMO_PIN);
  const totpSecret = get('DEMO_TOTP_SECRET', LOCAL_TOTP_SECRET).toUpperCase();
  checkPin('DEMO_PIN', pin);
  checkPin('DRIVER_DEMO_PIN', driverPin);
  if (pin === driverPin) throw new Error('DRIVER_DEMO_PIN must differ from DEMO_PIN');
  if (!BASE32_160.test(totpSecret)) {
    throw new Error('DEMO_TOTP_SECRET must be 32 base32 characters (A-Z, 2-7)');
  }
  if (remote) {
    const leaked = [
      ['DEMO_PIN', pin, LOCAL_DEMO_PIN],
      ['DRIVER_DEMO_PIN', driverPin, LOCAL_DRIVER_DEMO_PIN],
      ['DEMO_TOTP_SECRET', totpSecret, LOCAL_TOTP_SECRET],
    ].filter(
      ([, v]) => v === LOCAL_DEMO_PIN || v === LOCAL_DRIVER_DEMO_PIN || v === LOCAL_TOTP_SECRET,
    );
    if (leaked.length) {
      throw new Error(
        `Refusing: ${leaked.map(([n]) => n).join(', ')} equals a public local-only value (it is in the repo).`,
      );
    }
  }
  return { pin, driverPin, totpSecret };
}

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
