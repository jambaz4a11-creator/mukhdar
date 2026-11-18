#!/usr/bin/env node
// بيانات عرض للتطوير (T05). للتطوير فقط: يرفض أي مشروع غير mukhdar-dev أو المحلي.
//
//   pnpm seed:demo                  -> المحلي (supabase start)
//   pnpm seed:demo -- --remote      -> mukhdar-dev
//   pnpm seed:demo -- --scale=load  -> + 1000 زبون لاختبار الحمل (T22)
//   pnpm seed:demo -- --no-images   -> بدون رفع صور المنتجات
//   pnpm seed:demo -- --images-only -> الصور فقط (يحتاج SUPABASE_SERVICE_ROLE_KEY بـ .env.local)
//
// ينشئ: أدمن، موظف، 3 سائقين، 20 زبوناً بعناوين، و500 طلب موزعة على 30 يوماً.
// الدخول: رقم المستخدم + DEMO_PIN (scripts/lib/demo.mjs، للتطوير فقط؛ RUNBOOK §6).
// T23 C1: الأدمن والموظف يحتاجان رمز TOTP؛ لهما عامل مُفعَّل بالسر التجريبي DEV_TOTP_SECRET
// (scripts/lib/totp.mjs، أو E2E_TOTP_SECRET) حتى تدخل e2e بـ aal2. للتطوير فقط: هذا السكربت يرفض الإنتاج.
// الطلبات وتحويلاتها تمر حصراً عبر place_order / set_order_status / accept_order /
// assign_driver / rate_order (لا إدخال مباشر)، لذلك daily_stats محسوبة بنفس منطق الإنتاج.
// بعدها تُرجَع الطوابع الزمنية لليوم المقصود، وتُنقل مساهمة اليوم من daily_stats لذلك اليوم.
// الافتراض: المنتجات والعناوين من supabase/seed.sql موجودة.
import { assertSafeTarget, connectDev, describe, resolveTarget } from './lib/db.mjs';
import {
  DEMO_PHONE_PREFIX,
  DEMO_PIN,
  DRIVER_DEMO_PIN,
  LOAD_PHONE_PREFIX,
  STATS_MISMATCH_SQL,
  phone,
} from './lib/demo.mjs';
import { DEV_TOTP_SECRET } from './lib/totp.mjs';
import { uploadProductImages } from './lib/images.mjs';

const args = process.argv.slice(2);
const target = resolveTarget(args);
assertSafeTarget(target);
const LOAD = args.includes('--scale=load');
const IMAGES = !args.includes('--no-images');
const IMAGES_ONLY = args.includes('--images-only');
const DAYS = 30;
const ORDERS = 500;
const LOAD_CUSTOMERS = 1000;
const MAX_OPEN_PER_CUSTOMER = 3;

// ---------------------------------------------------------------- عشوائية قابلة للتكرار
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261111);
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const minutes = (d, m) => new Date(d.getTime() + m * 60_000);

const CUSTOMER_NAMES = [
  'أحمد كريم',
  'زينب علي',
  'محمد جاسم',
  'فاطمة حسين',
  'علي عبد الله',
  'مريم سعد',
  'حسن فاضل',
  'نور الهدى',
  'مصطفى عادل',
  'سارة محمود',
  'يوسف قاسم',
  'رقية جواد',
  'عمر صباح',
  'آيات حيدر',
  'كرار سلام',
  'هدى ناصر',
  'سجاد رعد',
  'بتول ماجد',
  'إبراهيم خالد',
  'دعاء طارق',
];
const COMMENTS = [
  'ممتاز، الخضرة طازجة',
  'وصل بسرعة',
  'شكراً',
  'الطماطة كانت ممتازة',
  'التوصيل تأخر شوية',
  null,
  null,
  null,
];

// ---------------------------------------------------------------- SQL
// كل مستخدمي العرض يدخلون بالهاتف + DEMO_PIN (ADR 0001). bcrypt مرة واحدة للكل (تطوير فقط):
// 1000 hash منفصل لـ --scale=load يأخذ دقيقة بلا فائدة. GoTrue يقبل صيغة $2a$ من pgcrypto.
const CREATE_USERS_SQL = `
with pw as (
  select extensions.crypt($2::text, extensions.gen_salt('bf', 10)) as hash
), u as (
  insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token,
                          recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
                          email_change_token_current, reauthentication_token, is_sso_user, is_anonymous)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', x.phone,
         now(), pw.hash, '{"provider":"phone","providers":["phone"]}', '{}', now(), now(), '', '', '', '', '', '',
         '', '', false, false
    from unnest($1::text[]) as x(phone) cross join pw
  returning id, phone
), i as (
  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  select id::text, id, jsonb_build_object('sub', id::text, 'phone', phone, 'phone_verified', true), 'phone', now(), now()
    from u
)
select id, phone from u`;

// T23 C1: عامل TOTP مُفعَّل لحسابي الأدمن والموظف (السر التجريبي؛ GoTrue يقبل السر غير المشفّر).
const DEMO_MFA_SQL = `
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), u, 'لوحة المخضر (dev)', 'totp', 'verified', now(), now(), $2::text
  from unnest($1::uuid[]) as u`;

// يُنشأ لهذه الجلسة فقط (pg_temp)، ولا يبقى بقاعدة البيانات.
// ينفّذ مواصفات طلبات يوم كامل عبر دوال RPC، كل طلب بمعاملة فرعية مستقلة.
const RUNNER_SQL = `
create or replace function pg_temp.demo_run(p_specs jsonb) returns jsonb language plpgsql as $$
declare
  s jsonb; st jsonb; r jsonb; v_id uuid; v_out jsonb := '[]';
begin
  for s in select * from jsonb_array_elements(p_specs) loop
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', s ->> 'customer', 'role', 'authenticated', 'aal', 'aal2')::text, true);
      r := public.place_order((s ->> 'address')::uuid, s -> 'items', gen_random_uuid(), s ->> 'note');
      v_id := (r ->> 'order_id')::uuid;
      for st in select * from jsonb_array_elements(s -> 'steps') loop
        perform set_config('request.jwt.claims', json_build_object('sub', st ->> 'actor', 'role', 'authenticated', 'aal', 'aal2')::text, true);
        case st ->> 'action'
          when 'status' then perform public.set_order_status(v_id, (st ->> 'arg')::public.order_status, st ->> 'reason');
          when 'accept' then perform public.accept_order(v_id);
          when 'assign' then perform public.assign_driver(v_id, (st ->> 'arg')::uuid);
          when 'rate'   then perform public.rate_order(v_id, (st ->> 'arg')::int, st ->> 'comment');
        end case;
      end loop;
      v_out := v_out || jsonb_build_object('i', s -> 'i', 'id', v_id);
    exception when others then
      v_out := v_out || jsonb_build_object('i', s -> 'i', 'error', sqlerrm);
    end;
  end loop;
  perform set_config('request.jwt.claims', '{}', true);
  return v_out;
end $$`;

const SHIFT_SQL = [
  `update public.orders o set created_at = t.created,
          preparing_at = case when o.preparing_at is not null then t.prep end,
          ready_at = case when o.ready_at is not null then t.ready end,
          assigned_at = case when o.assigned_at is not null then t.assigned end,
          out_for_delivery_at = case when o.out_for_delivery_at is not null then t.ofd end,
          delivered_at = case when o.delivered_at is not null then t.delivered end,
          cancelled_at = case when o.cancelled_at is not null then t.cancelled end
     from jsonb_to_recordset($1) as t(id uuid, created timestamptz, prep timestamptz, ready timestamptz, assigned timestamptz,
                                      ofd timestamptz, delivered timestamptz, cancelled timestamptz, rated timestamptz)
    where o.id = t.id`,
  `update public.order_status_history h set created_at = case
          when h.note in ('driver_accepted', 'driver_assigned') then t.assigned
          when h.to_status = 'pending' then t.created
          when h.to_status = 'preparing' then t.prep
          when h.to_status = 'ready' then t.ready
          when h.to_status = 'out_for_delivery' then t.ofd
          when h.to_status = 'delivered' then t.delivered
          else t.cancelled end
     from jsonb_to_recordset($1) as t(id uuid, created timestamptz, prep timestamptz, ready timestamptz, assigned timestamptz,
                                      ofd timestamptz, delivered timestamptz, cancelled timestamptz)
    where h.order_id = t.id`,
  `update public.inventory_movements m
      set created_at = case when m.type = 'cancel_return' then t.cancelled else t.created end
     from jsonb_to_recordset($1) as t(id uuid, created timestamptz, cancelled timestamptz)
    where m.order_id = t.id`,
  `update public.ratings r set created_at = t.rated
     from jsonb_to_recordset($1) as t(id uuid, rated timestamptz)
    where r.order_id = t.id and t.rated is not null`,
  // إشعارات العرض تُعلَّم كمرسلة حتى لا يرسلها push-dispatch لاحقاً
  `update public.notification_outbox n set
          created_at = coalesce(case
            when n.data ->> 'type' = 'assigned' then t.assigned
            when n.data ->> 'status' = 'preparing' then t.prep
            when n.data ->> 'status' = 'ready' or n.data ->> 'type' = 'ready'
                 or (n.audience = 'drivers' and n.data ->> 'type' = 'new_order') then t.ready
            when n.data ->> 'status' = 'out_for_delivery' then t.ofd
            when n.data ->> 'status' = 'delivered' then t.delivered
            when n.data ->> 'status' = 'cancelled' then t.cancelled end, t.created)
     from jsonb_to_recordset($1) as t(id uuid, created timestamptz, prep timestamptz, ready timestamptz, assigned timestamptz,
                                      ofd timestamptz, delivered timestamptz, cancelled timestamptz)
    where n.data ->> 'order_id' = t.id::text`,
];

const STAT_COLS = [
  'delivered_count',
  'cancelled_count',
  'revenue_iqd',
  'delivery_fees_iqd',
  'cost_iqd',
  'gross_profit_iqd',
];

// ---------------------------------------------------------------- main
const client = await connectDev(target);
const q = (text, params) => client.query(text, params);
console.log(`seed:demo -> ${describe(target)}`);

try {
  if (IMAGES_ONLY) {
    await uploadProductImages(client, target);
  } else {
    await seedAll();
  }
} catch (err) {
  await q('rollback').catch(() => {});
  console.error(`seed:demo failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

async function seedAll() {
  const { rows: existing } = await q(
    `select count(*) filter (where phone like $1)::int as demo, count(*) filter (where phone like $2)::int as load
       from public.profiles`,
    [`${DEMO_PHONE_PREFIX}%`, `${LOAD_PHONE_PREFIX}%`],
  );
  const { rows: catalog } = await q(
    `select (select count(*) from public.products where is_active)::int as products,
            (select count(*) from public.buildings where is_active)::int as buildings`,
  );
  if (catalog[0].products < 10 || catalog[0].buildings < 10) {
    throw new Error('Catalog/addresses missing: apply supabase/seed.sql first (RUNBOOK §10).');
  }

  if (existing[0].demo > 0) {
    if (!LOAD || existing[0].load > 0) {
      throw new Error('Demo data already exists. Run `pnpm seed:reset` first.');
    }
    console.log('demo data exists; adding load-test customers only');
  } else {
    await seedDemo();
  }
  if (LOAD && existing[0].load === 0) await seedLoadCustomers();
  if (IMAGES) await uploadProductImages(client, target);

  const { rows: mismatches } = await q(STATS_MISMATCH_SQL);
  if (mismatches.length) {
    console.error(
      'daily_stats does NOT match orders:',
      JSON.stringify(mismatches.slice(0, 5), null, 2),
    );
    process.exitCode = 1;
  } else {
    console.log('check: daily_stats matches delivered/cancelled orders for every day');
  }
}

// ---------------------------------------------------------------- الأجزاء
async function createUsers(specs) {
  const { rows } = await q(CREATE_USERS_SQL, [specs.map((s) => s.phone), DEMO_PIN]);
  await q(
    `update public.profiles p set role = x.role::public.user_role, full_name = x.name
       from unnest($1::text[], $2::text[], $3::text[]) as x(phone, role, name) where p.phone = x.phone`,
    [specs.map((s) => s.phone), specs.map((s) => s.role), specs.map((s) => s.name)],
  );
  // T23 L6: السائقون التجريبيون برمزهم الخاص (لا DEMO_PIN، فلا يدخل مطوّر السائق بحساب أدمن العرض)
  const driverPhones = specs.filter((s) => s.role === 'driver').map((s) => s.phone);
  if (driverPhones.length > 0) {
    await q(
      `update auth.users set encrypted_password = extensions.crypt($2::text, extensions.gen_salt('bf', 10))
        where phone = any($1::text[])`,
      [driverPhones, DRIVER_DEMO_PIN],
    );
  }
  const byPhone = new Map(rows.map((r) => [r.phone, r.id]));
  return specs.map((s) => ({ ...s, id: byPhone.get(s.phone) }));
}

async function seedDemo() {
  await q('begin');
  const people = await createUsers([
    { phone: phone(DEMO_PHONE_PREFIX, 1), role: 'admin', name: 'مدير العرض' },
    { phone: phone(DEMO_PHONE_PREFIX, 2), role: 'staff', name: 'موظف التحضير' },
    { phone: phone(DEMO_PHONE_PREFIX, 11), role: 'driver', name: 'حيدر (سائق)' },
    { phone: phone(DEMO_PHONE_PREFIX, 12), role: 'driver', name: 'علي (سائق)' },
    { phone: phone(DEMO_PHONE_PREFIX, 13), role: 'driver', name: 'مصطفى (سائق)' },
    ...CUSTOMER_NAMES.map((name, i) => ({
      phone: phone(DEMO_PHONE_PREFIX, 101 + i),
      role: 'customer',
      name,
    })),
  ]);
  const admin = people.find((p) => p.role === 'admin');
  const staff = people.find((p) => p.role === 'staff');
  // عامل TOTP مُفعَّل (كما يكتبه GoTrue بعد التحقق) بالسر التجريبي: dev والمحلي فقط
  await q(DEMO_MFA_SQL, [[admin.id, staff.id], process.env.E2E_TOTP_SECRET || DEV_TOTP_SECRET]);
  const drivers = people.filter((p) => p.role === 'driver');
  const customers = people.filter((p) => p.role === 'customer');

  const { rows: buildings } = await q(
    `select b.id from public.buildings b join public.subsections ss on ss.id = b.subsection_id
       join public.sectors s on s.id = ss.sector_id where b.is_active and ss.is_active and s.is_active`,
  );
  for (const c of customers) {
    const count = chance(0.25) ? 2 : 1;
    const { rows } = await q(
      `insert into public.addresses (customer_id, building_id, apartment, label, is_default, floor)
       select $1, b, a, l, d, f
         from unnest($2::int[], $3::text[], $4::text[], $5::bool[], $6::smallint[]) as x(b, a, l, d, f)
       returning id`,
      [
        c.id,
        Array.from({ length: count }, () => pick(buildings).id),
        Array.from({ length: count }, () => String(randInt(1, 40))),
        ['البيت', 'بيت أهلي'].slice(0, count),
        [true, false].slice(0, count),
        Array.from({ length: count }, () => randInt(0, 9)), // الطابق (2026-11-18): 0 = الأرضي
      ],
    );
    c.addresses = rows.map((r) => r.id);
  }
  await q('commit');
  console.log(
    `users: 1 admin, 1 staff, ${drivers.length} drivers, ${customers.length} customers (with addresses)`,
  );
  console.log(
    `sign in (dev only): admin 0${people[0].phone.slice(3)}, staff 0${people[1].phone.slice(3)}, ` +
      `drivers 0${drivers[0].phone.slice(3)}.., customers 0${customers[0].phone.slice(3)}.. with PIN ${DEMO_PIN} (demo drivers 0${drivers[0].phone.slice(3)}.. with ${DRIVER_DEMO_PIN}); ` +
      `admin/staff 2FA: the dev-only TOTP secret (scripts/lib/totp.mjs)`,
  );

  const { rows: products } = await q('select id, price_iqd from public.products where is_active');
  const priceOf = new Map(products.map((p) => [p.id, Number(p.price_iqd)]));
  // T23 F M3: حد قيمة طلب الحساب الجديد (حتى أول تسليم). place_order يرفض ما فوقه، فالمولّد يقصّ أول طلب للزبون
  // ليبقى تحته (المجموع مع التوصيل)، بدل تخفيف الحد بقاعدة البيانات.
  const { rows: caps } = await q(
    `select delivery_fee_iqd::bigint as fee, least(max_order_iqd, new_account_max_order_iqd)::bigint as new_cap,
            max_order_iqd::bigint as max_cap
       from public.app_settings`,
  );
  const fee = Number(caps[0].fee);
  const established = new Set(); // زبائن لهم طلب مسلَّم بهذا التشغيل (البيانات قبل التشغيل: لا طلبات عرض)
  const fitCap = (items, cap) => {
    const total = () =>
      items.reduce((sum, it) => sum + priceOf.get(it.product_id) * it.qty, 0) + fee;
    while (total() > cap) {
      const big = items.reduce((a, b) =>
        priceOf.get(b.product_id) * b.qty > priceOf.get(a.product_id) * a.qty ? b : a,
      );
      if (big.qty > 1) big.qty--;
      else if (items.length > 1) items.splice(items.indexOf(big), 1);
      else break;
    }
  };
  await q(RUNNER_SQL);

  // توزيع 500 طلب على 30 يوماً (أكثر قليلاً بنهاية الأسبوع: الخميس والجمعة)
  const { rows: todayRow } = await q(`select public.baghdad_today()::text as today`);
  const today = new Date(`${todayRow[0].today}T00:00:00+03:00`);
  const weights = Array.from({ length: DAYS }, (_, d) => {
    const dow = new Date(today.getTime() - (DAYS - 1 - d) * 86_400_000).getUTCDay();
    return dow === 4 || dow === 5 ? 1.4 : 1;
  });
  const wsum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((w / wsum) * ORDERS));
  for (let i = 0; counts.reduce((a, b) => a + b, 0) < ORDERS; i = (i + 1) % DAYS) counts[i]++;

  let created = 0;
  let failed = 0;
  // طلبات اليوم تبقى مفتوحة: لا أكثر من الحد لكل زبون (app_settings.max_active_orders، افتراضي 3)
  const openToday = new Map();
  let firstError = null;
  for (let d = 0; d < DAYS; d++) {
    const daysAgo = DAYS - 1 - d;
    const isToday = daysAgo === 0;
    const day = new Date(today.getTime() - daysAgo * 86_400_000);
    const specs = [];
    const times = [];

    for (let i = 0; i < counts[d]; i++) {
      let cust = pick(customers);
      if (isToday) {
        while ((openToday.get(cust.id) ?? 0) >= MAX_OPEN_PER_CUSTOMER) cust = pick(customers);
        openToday.set(cust.id, (openToday.get(cust.id) ?? 0) + 1);
      }
      const driver = pick(drivers);
      const items = [];
      const chosen = new Set();
      const lines = randInt(1, 5);
      while (chosen.size < lines) chosen.add(pick(products).id);
      for (const id of chosen) items.push({ product_id: id, qty: randInt(1, 6) });
      fitCap(items, established.has(cust.id) ? Number(caps[0].max_cap) : Number(caps[0].new_cap));

      const steps = [];
      const t = {};
      const takeDriver = () =>
        chance(0.7)
          ? steps.push({ actor: driver.id, action: 'accept' })
          : steps.push({ actor: staff.id, action: 'assign', arg: driver.id });

      // السائق يقبل طلباً 'ready' فقط؛ الموظف يعيّن من preparing أو ready
      const toReady = () => {
        steps.push({ actor: staff.id, action: 'status', arg: 'preparing' });
        steps.push({ actor: staff.id, action: 'status', arg: 'ready' });
      };

      if (isToday) {
        // طلبات اليوم نشطة فقط: قيد الانتظار / التحضير / جاهز / بالطريق
        t.created = minutes(new Date(), -randInt(20, 150));
        t.prep = minutes(t.created, 5);
        t.ready = minutes(t.prep, 5);
        t.assigned = minutes(t.ready, 3);
        t.ofd = minutes(t.assigned, 5);
        const state = rand();
        if (state < 0.3) {
          // pending: لا سائق قبل التحضير
        } else if (state < 0.5) {
          steps.push({ actor: staff.id, action: 'status', arg: 'preparing' });
          if (chance(0.3)) {
            t.assigned = minutes(t.prep, 3);
            steps.push({ actor: staff.id, action: 'assign', arg: driver.id });
          }
        } else if (state < 0.7) {
          toReady(); // أغلبها بانتظار سائق (تظهر بـ available_orders)
          if (chance(0.3)) takeDriver();
        } else {
          toReady();
          takeDriver();
          steps.push({ actor: driver.id, action: 'status', arg: 'out_for_delivery' });
        }
      } else {
        // 08:00..21:00 بتوقيت بغداد، والتسليم بنفس اليوم
        t.created = minutes(day, randInt(8 * 60, 21 * 60));
        t.prep = minutes(t.created, randInt(3, 15));
        t.ready = minutes(t.prep, randInt(5, 15));
        t.assigned = minutes(t.ready, randInt(1, 10));
        t.ofd = minutes(t.assigned, randInt(2, 10));
        t.delivered = minutes(t.ofd, randInt(10, 40));
        if (chance(0.12)) {
          if (chance(0.4)) {
            t.cancelled = minutes(t.created, randInt(2, 10));
            steps.push({
              actor: cust.id,
              action: 'status',
              arg: 'cancelled',
              reason: 'غيّرت رأيي',
            });
          } else if (chance(0.7)) {
            t.cancelled = minutes(t.prep, randInt(2, 15));
            steps.push({ actor: staff.id, action: 'status', arg: 'preparing' });
            steps.push({ actor: staff.id, action: 'status', arg: 'cancelled', reason: 'نفاد صنف' });
          } else {
            t.cancelled = minutes(t.ready, randInt(5, 20));
            toReady();
            steps.push({
              actor: staff.id,
              action: 'status',
              arg: 'cancelled',
              reason: 'لا يوجد سائق متاح',
            });
          }
        } else {
          toReady();
          takeDriver();
          steps.push({ actor: driver.id, action: 'status', arg: 'out_for_delivery' });
          steps.push({ actor: driver.id, action: 'status', arg: 'delivered' });
          if (chance(0.55)) {
            const stars = pick([5, 5, 5, 5, 5, 4, 4, 4, 3, 2]);
            t.rated = minutes(t.delivered, randInt(30, 300));
            steps.push({ actor: cust.id, action: 'rate', arg: stars, comment: pick(COMMENTS) });
          }
        }
      }
      if (steps.some((st) => st.action === 'status' && st.arg === 'delivered'))
        established.add(cust.id);
      specs.push({
        i,
        customer: cust.id,
        address: pick(cust.addresses),
        items,
        steps,
        note: chance(0.15) ? 'رجاءً اتصل قبل الوصول' : null,
      });
      times.push(t);
    }

    await q('begin');
    const before = await statsRow();
    // تعبئة صباحية: كل منتج رصيده أقل من 60 يُكمَّل لـ 150 (عبر adjust_stock، تسوية موجبة بملاحظة:
    // لا تغيّر سعر الشراء، بخلاف 'purchase' التي تتطلب سعراً منذ T18)
    await q(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin.id, role: 'authenticated', aal: 'aal2' }),
    ]);
    await q(
      `select public.adjust_stock(product_id, 150 - qty, 'adjust', 'تعبئة صباحية (عرض)') from public.stock where qty < 60`,
    );
    await q(`select set_config('request.jwt.claims', '{}', true)`);

    const { rows } = await q('select pg_temp.demo_run($1) as out', [JSON.stringify(specs)]);
    const results = rows[0].out;
    const shift = [];
    for (const r of results) {
      if (r.error) {
        failed++;
        firstError ??= r.error;
        continue;
      }
      created++;
      shift.push({ id: r.id, ...times[r.i] });
    }
    for (const sql of SHIFT_SQL) await q(sql, [JSON.stringify(shift)]);
    await q(
      `update public.notification_outbox set sent_at = created_at
              where sent_at is null and data ->> 'order_id' = any ($1::text[])`,
      [shift.map((s) => s.id)],
    );
    await q(
      `update public.inventory_movements set created_at = $1
              where order_id is null and created_by = $2 and created_at = now()`,
      [minutes(day, 7 * 60), admin.id],
    );

    if (!isToday) await moveTodaysStats(before, day);
    await q('commit');
    process.stdout.write(`\rorders: ${created} created, ${failed} skipped (day ${d + 1}/${DAYS})`);
  }
  console.log();
  if (failed > 0) {
    console.error(`${failed} orders failed (first error: ${firstError})`);
    process.exitCode = 1;
  }
}

async function statsRow() {
  const { rows } = await q(
    `select ${STAT_COLS.join(', ')} from public.daily_stats where day = public.baghdad_today()`,
  );
  return rows[0] ?? null;
}

// ما أضافته دوال RPC لصف "اليوم" يُنقل لليوم المقصود
async function moveTodaysStats(before, day) {
  const after = await statsRow();
  if (!after) return;
  const delta = STAT_COLS.map((c) => Number(after[c]) - Number(before?.[c] ?? 0));
  if (delta.every((v) => v === 0)) return;
  if (before) {
    await q(
      `update public.daily_stats set ${STAT_COLS.map((c) => `${c} = $${STAT_COLS.indexOf(c) + 1}`).join(', ')}
        where day = public.baghdad_today()`,
      STAT_COLS.map((c) => before[c]),
    );
  } else {
    await q('delete from public.daily_stats where day = public.baghdad_today()');
  }
  const dayStr = new Date(day.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  await q(
    `insert into public.daily_stats as s (day, ${STAT_COLS.join(', ')})
     values ($1, ${STAT_COLS.map((_, i) => `$${i + 2}`).join(', ')})
     on conflict (day) do update set ${STAT_COLS.map((c) => `${c} = s.${c} + excluded.${c}`).join(', ')},
                                    updated_at = now()`,
    [dayStr, ...delta],
  );
}

async function seedLoadCustomers() {
  await q('begin');
  const specs = Array.from({ length: LOAD_CUSTOMERS }, (_, i) => ({
    phone: phone(LOAD_PHONE_PREFIX, i + 1),
    role: 'customer',
    name: `زبون حمل ${i + 1}`,
  }));
  const users = await createUsers(specs);
  await q(
    `with b as (select array_agg(id) as ids from public.buildings where is_active)
     insert into public.addresses (customer_id, building_id, apartment, is_default, floor)
     select u, b.ids[1 + floor(random() * array_length(b.ids, 1))::int], (1 + floor(random() * 40))::text, true,
            floor(random() * 10)::smallint
       from unnest($1::uuid[]) as u, b`,
    [users.map((u) => u.id)],
  );
  await q('commit');
  console.log(`load: ${LOAD_CUSTOMERS} customers with addresses`);
}
