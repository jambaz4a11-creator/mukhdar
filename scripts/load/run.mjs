#!/usr/bin/env node
// T22: اختبار الحمل والإجهاد على mukhdar-dev فقط (بيانات مؤقتة تُحذف بالنهاية). انظر README.md.
//
//   pnpm load:run                 # الاختبار الكامل (~55 دقيقة، أغلبها انتظار حد الدخول)
//   pnpm load:run -- --smoke      # فحص سريع للسكربت بحجم صغير (~6 دقائق)
//   pnpm load:cleanup             # تنظيف يدوي إن انقطع التشغيل
//
// الحجم: 60 زبوناً متزامناً (تصفح + طلبات ≈ 200 طلب/ساعة)، 3 سائقين، لوحتان (أدمن على الرئيسية وموظف على الطلبات،
// Realtime + استطلاع)، ثم ذروة x3 (180 زبوناً، 9 سائقين، 600 طلب/ساعة). قبلها مرحلة صحة (A): سباق آخر رصيد،
// حدود الطلبات، تكرار المفتاح، المتجر مغلق، سباق قبول السائقين. بعد التصريف: فحوص الدفتر والإشعارات والتقارير.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { connect, resolveTarget } from '../lib/db.mjs';
import { STATS_MISMATCH_SQL } from '../lib/demo.mjs';
import { checkOversell, expectedRaceOutcome, verifyDatabase, verifyReports } from './checks.mjs';
import {
  LOAD_PHONE_PREFIX,
  Metrics,
  RUN_DIR,
  RateLimiter,
  RealtimeSocket,
  THRESHOLDS,
  classify,
  evaluate,
  assertLoadDbTarget,
  confirmProdTarget,
  expDelay,
  http,
  loadEnv,
  loadTargetMode,
  upgradeToAal2,
  percentile,
  pick,
  rnd,
  rndInt,
  shuffle,
  sleep,
} from './lib.mjs';
import {
  LT_NAME,
  cleanup,
  loadBefore,
  saveBefore,
  setStoreOpen,
  takeSnapshot,
  verifyClean,
} from './state.mjs';

// ---------------------------------------------------------------------
// الإعدادات
// ---------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const SMOKE = argv.includes('--smoke');
const CFG = {
  customers: flag('customers', SMOKE ? 6 : 60), // الحمل الأساسي
  factor: flag('factor', SMOKE ? 2 : 3), // هامش الأمان للذروة
  drivers: flag('drivers', SMOKE ? 2 : 3),
  ordersPerHour: flag('orders-per-hour', SMOKE ? 120 : 200),
  baseMin: flag('base-min', SMOKE ? 1.5 : 15),
  spikeMin: flag('spike-min', SMOKE ? 1 : 3),
  drainMin: flag('drain-min', SMOKE ? 4 : 10),
  signinPer5Min: flag('signin-per-5min', 27), // حد Supabase الافتراضي 30 لكل IP كل 5 دقائق
  raceN: flag('race', SMOKE ? 5 : 24),
  thinkMin: flag('think-min-ms', 5000),
  thinkMax: flag('think-max-ms', 12000),
};
CFG.spikeCustomers = CFG.customers * CFG.factor;
CFG.spikeDrivers = CFG.drivers * CFG.factor;
const RUN_ID = crypto.randomBytes(3).toString('hex');
const sleepA = async (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (abort.flag) throw new Error(abort.reason ?? 'aborted');
    await sleep(Math.min(1000, end - Date.now()));
  }
};
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------------
// الحالة العامة
// ---------------------------------------------------------------------
// T23 H3: dev افتراضياً؛ الإنتاج فقط بـ --target=prod + تأكيد مكتوب (لا ref إنتاج بقائمة التطوير أبداً)
const MODE = loadTargetMode(argv);
const env = loadEnv({ mode: MODE });
if (MODE === 'prod') await confirmProdTarget(env.ref);
const target = resolveTarget(['--remote']);
assertLoadDbTarget(target, MODE, env.ref);
const metrics = new Metrics();
let phase = 'setup';
let quiesced = false; // بعد انتهاء الفحوص: لا طلبات جديدة (قبل التنظيف الذي يحذف المستخدمين)
const lag = { max: {}, over500: 0 }; // تأخر حلقة الأحداث بجهاز الاختبار (تمييز توقف العميل عن توقف الخادم)
const rt = {
  open: 0,
  peak: 0,
  joinErrors: 0,
  closedUnexpected: 0,
  events: { admin: 0, staff: 0, customer: 0 },
};
const tracked = new Set(); // أرقام طلبات الحمل
const manual = new Set(); // طلبات تُدار يدوياً بمرحلة A (لا أتمتة)
const issuedAt = new Map(); // `${orderId}:${status}` -> { t, phase }
const seenAt = { admin: new Map(), staff: new Map(), customer: new Map() };
const orderLog = []; // نتائج place_order للتقرير
const corr = []; // نتائج فحوص الصحة { name, ok, detail }
const abort = { flag: false, reason: null };
const samples = []; // عينات قاعدة البيانات
let db; // اتصال الأدمن (postgres)
let monitor; // اتصال المراقبة
let before = null;
let monitorTimer = null;
let lagTimer = null;
const U = { admin: null, staff: null, drivers: [], customers: [] };
let products = { regular: [], scarce: null, cheap: null };
let realNames = [];
let addressByCustomer = new Map();
let maxActive = 3;

const mkUser = (key, role) => ({
  key,
  role,
  phone: `${LOAD_PHONE_PREFIX}${String(usersCreated++).padStart(6, '0')}`,
  pin: Array.from({ length: 6 }, () => crypto.randomInt(0, 10)).join(''),
  id: null,
  access: null,
  refresh: null,
  expiresAt: 0,
  ready: null,
  open: 0,
  busy: false,
});
let usersCreated = 1;

// ---------------------------------------------------------------------
// المصادقة (إنشاء عبر Admin API: لا يمس حد التسجيل؛ الدخول بوتيرة ≤ 27/5 دقائق)
// ---------------------------------------------------------------------
const signinLimiter = new RateLimiter(CFG.signinPer5Min, 5 * 60_000);
const authCounters = { signins: 0, refreshes: 0, rate429: 0 };

async function signIn(u) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await signinLimiter.acquire();
    const r = await http('POST', `${env.base}/auth/v1/token?grant_type=password`, {
      key: env.anonKey,
      token: null,
      body: { phone: `+${u.phone}`, password: u.pin },
    });
    authCounters.signins++;
    if (r.status === 200) {
      u.access = r.json.access_token;
      u.refresh = r.json.refresh_token;
      u.expiresAt = Date.now() + (r.json.expires_in ?? 3600) * 1000;
      // T23 C1: لوحتا الأدمن والموظف بـ aal2 (تطبيق مصادقة)، كما باللوحة الحقيقية
      if (u.role === 'admin' || u.role === 'staff')
        await upgradeToAal2(http, env.base, env.anonKey, u);
      return;
    }
    if (r.status === 429) {
      authCounters.rate429++;
      log(`sign-in 429 (${u.key}); backing off 60s`);
      await sleep(60_000);
      continue;
    }
    throw new Error(`sign-in failed for ${u.key}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  throw new Error(`sign-in kept hitting 429 for ${u.key}`);
}

async function token(u) {
  if (Date.now() > u.expiresAt - 5 * 60_000 && u.refresh) {
    const r = await http('POST', `${env.base}/auth/v1/token?grant_type=refresh_token`, {
      key: env.anonKey,
      token: null,
      body: { refresh_token: u.refresh },
    });
    authCounters.refreshes++;
    if (r.status === 200) {
      u.access = r.json.access_token;
      u.refresh = r.json.refresh_token;
      u.expiresAt = Date.now() + (r.json.expires_in ?? 3600) * 1000;
    }
  }
  return u.access;
}

async function createUsers(all) {
  for (let i = 0; i < all.length; i += 8) {
    await Promise.all(
      all.slice(i, i + 8).map(async (u) => {
        const r = await http('POST', `${env.base}/auth/v1/admin/users`, {
          key: env.serviceKey,
          body: {
            phone: u.phone,
            password: u.pin,
            phone_confirm: true,
            user_metadata: { purpose: `T22 load test ${RUN_ID}` },
          },
        });
        if (r.status !== 200)
          throw new Error(`createUser ${u.key}: ${r.status} ${JSON.stringify(r.json)}`);
        u.id = r.json.id;
      }),
    );
  }
}

// ---------------------------------------------------------------------
// استدعاءات REST/RPC بقياس وتصنيف
// ---------------------------------------------------------------------
async function call(op, u, method, pathAndQuery, body, { rpc = null, headers } = {}) {
  if (quiesced) return { status: 0, json: null, ms: 0, networkError: 'quiesced' };
  const tag = phase;
  const res = await http(method, `${env.base}/rest/v1/${pathAndQuery}`, {
    key: env.anonKey,
    token: u ? await token(u) : null,
    body,
    headers,
  });
  metrics.record(tag, op, res.ms, classify(rpc ?? op, res));
  return res;
}
const rpc = (_unused, u, fn, args) =>
  call(`rpc.${fn}`, u, 'POST', `rpc/${fn}`, args ?? {}, { rpc: fn });
const errCode = (r) =>
  r.status >= 200 && r.status < 300 ? 'OK' : (r.json?.message ?? `HTTP_${r.status}`);

const PRODUCT_COLS =
  'id,category_id,name,description,unit,price_iqd,image_path,in_stock,sort_order';
const LIST_COLS =
  'id,order_number,status,created_at,customer_name,customer_phone,address_snapshot,total_iqd,driver_id';
let categories = [];

// ---------------------------------------------------------------------
// تسجيل أحداث Realtime مقابل لحظة إصدار الإجراء (بلا مزامنة ساعات)
// ---------------------------------------------------------------------
const markIssued = (orderId, status, t) => issuedAt.set(`${orderId}:${status}`, { t, phase });
const markSeen = (who, orderId, status, t) => {
  rt.events[who]++;
  const k = `${orderId}:${status}`;
  if (!seenAt[who].has(k)) seenAt[who].set(k, t);
};

async function openPanelSocket(who, user) {
  const sock = new RealtimeSocket(env, {
    stats: rt,
    onEvent: (e) => {
      const id = e.record?.id;
      if (id) markSeen(who, id, e.record.status, e.at); // بلا فلتر tracked: INSERT قد يصل قبل رد place_order
      panelHooks[who]?.();
    },
  });
  await sock.connect();
  await sock.join(
    `panel-${who}`,
    [
      { event: 'INSERT', schema: 'public', table: 'orders' },
      { event: 'UPDATE', schema: 'public', table: 'orders' },
    ],
    await token(user),
  );
  return sock;
}
const panelHooks = {};

/** debounce بسقف انتظار (كما بلوحة الأدمن: 500ms / 2s). */
function maxWaitDebounce(fn, waitMs, maxMs) {
  let timer = null;
  let first = 0;
  return () => {
    const now = Date.now();
    if (!timer) first = now;
    clearTimeout(timer);
    const delay = Math.max(0, Math.min(waitMs, first + maxMs - now));
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
}

// ---------------------------------------------------------------------
// لوحة الأدمن (الرئيسية) ولوحة الموظف (الطلبات + أتمتة التحضير)
// ---------------------------------------------------------------------
const dayStartIso = () => new Date(Date.now() - 24 * 3600_000).toISOString();
let panels = { stop: false, sockets: [] };

async function adminPanelRefresh() {
  await Promise.all([
    rpc(null, U.admin, 'dashboard_today'),
    call(
      'panel.today_orders',
      U.admin,
      'GET',
      `orders?select=${LIST_COLS}&created_at=gte.${dayStartIso()}&order=created_at.desc&limit=50`,
    ),
  ]);
}

async function startAdminPanel() {
  const refresh = maxWaitDebounce(() => void adminPanelRefresh(), 500, 2000);
  panelHooks.admin = refresh;
  panels.sockets.push(await openPanelSocket('admin', U.admin));
  await adminPanelRefresh();
  (async () => {
    while (!panels.stop) {
      await sleep(60_000); // استطلاع الرئيسية كل دقيقة
      if (panels.stop) break;
      await Promise.all([
        adminPanelRefresh(),
        call('panel.store_open', U.admin, 'GET', 'app_settings?select=store_open&limit=1'),
      ]);
    }
  })();
}

const staffScheduled = new Set();
let staffAutomation = false;

async function staffAct(orderId, status) {
  const t0 = performance.now();
  const r = await rpc(null, U.staff, 'set_order_status', { p_order_id: orderId, p_status: status });
  if (r.status === 200) markIssued(orderId, status, t0);
}

async function staffRefresh() {
  const r = await call(
    'panel.orders_list',
    U.staff,
    'GET',
    `orders?select=${LIST_COLS}&status=in.(pending,preparing)&order=created_at.desc&limit=50`,
  );
  if (!staffAutomation || r.status !== 200) return;
  for (const o of r.json) {
    if (!tracked.has(o.id) || manual.has(o.id)) continue;
    const key = `${o.id}:${o.status}`;
    if (staffScheduled.has(key)) continue;
    staffScheduled.add(key);
    if (o.status === 'pending') {
      setTimeout(() => void staffAct(o.id, 'preparing'), rnd(3000, 12_000));
    } else {
      setTimeout(
        async () => {
          // 20%: يُسند سائق مسبقاً أثناء التحضير (مسار "جاهز لسائقه فقط")
          const drivers = U.drivers.filter((d) => d.id && d.started);
          if (Math.random() < 0.2 && drivers.length) {
            await rpc(null, U.staff, 'assign_driver', {
              p_order_id: o.id,
              p_driver_id: pick(drivers).id,
            });
          }
          await staffAct(o.id, 'ready');
        },
        rnd(5000, 15_000),
      );
    }
  }
}

async function startStaffPanel() {
  const refresh = maxWaitDebounce(() => void staffRefresh(), 500, 2000);
  panelHooks.staff = refresh;
  panels.sockets.push(await openPanelSocket('staff', U.staff));
  await staffRefresh();
  (async () => {
    while (!panels.stop) {
      await sleep(5000);
      if (panels.stop) break;
      await staffRefresh();
    }
  })();
}

// ---------------------------------------------------------------------
// السائقون
// ---------------------------------------------------------------------
const driverScheduled = new Set();
async function driverLoop(d) {
  d.started = true;
  await sleep(rnd(0, 3000));
  while (!panels.stop) {
    const [avail, mine] = await Promise.all([
      rpc(null, d, 'available_orders', { p_limit: 20 }),
      call(
        'driver.my_orders',
        d,
        'GET',
        `orders?select=id,status&driver_id=eq.${d.id}&status=in.(ready,out_for_delivery)`,
      ),
    ]);
    const mineList = mine.status === 200 ? mine.json : [];
    for (const o of mineList) {
      if (!tracked.has(o.id)) continue;
      const key = `${o.id}:${o.status}`;
      if (driverScheduled.has(key)) continue;
      driverScheduled.add(key);
      const next = o.status === 'ready' ? 'out_for_delivery' : 'delivered';
      setTimeout(
        async () => {
          const t0 = performance.now();
          const r = await rpc(null, d, 'set_order_status', { p_order_id: o.id, p_status: next });
          if (r.status === 200) markIssued(o.id, next, t0);
        },
        o.status === 'ready' ? rnd(3000, 8000) : rnd(8000, 20_000),
      );
    }
    if (avail.status === 200 && mineList.length < 2) {
      // كل السائقين يختارون الأقدم (أعلى تنافس ممكن). لا نقبل إلا طلبات الحمل.
      const first = avail.json.find((o) => tracked.has(o.id) && !manual.has(o.id));
      if (first) await rpc(null, d, 'accept_order', { p_order_id: first.id });
    }
    await sleep(rnd(3000, 6000));
    if (panels.stop) break;
  }
}

// ---------------------------------------------------------------------
// الزبائن: تصفح مستمر + جدولة طلبات + تتبع Realtime
// ---------------------------------------------------------------------
async function browseOnce(c) {
  const r = Math.random();
  if (r < 0.15 || categories.length === 0) {
    const res = await call(
      'browse.categories',
      c,
      'GET',
      'categories?select=id,name,sort_order&is_active=eq.true&order=sort_order,id',
    );
    if (res.status === 200 && res.json.length) categories = res.json;
  } else if (r < 0.7) {
    const cat = pick(categories);
    const page = Math.random() < 0.7 ? 0 : 1;
    await call(
      'browse.products',
      c,
      'GET',
      `products?select=${PRODUCT_COLS}&is_active=eq.true&category_id=eq.${cat.id}&order=sort_order.asc,id.asc&limit=30&offset=${page * 30}`,
    );
  } else if (r < 0.85) {
    const term = encodeURIComponent(`*${pick(realNames).slice(0, 4)}*`);
    await call(
      'browse.search',
      c,
      'GET',
      `products?select=${PRODUCT_COLS}&is_active=eq.true&name=ilike.${term}&order=sort_order,id&limit=30`,
    );
  } else {
    await call(
      'orders.mine',
      c,
      'GET',
      'orders?select=id,order_number,status,total_iqd,created_at&order=created_at.desc&limit=20',
    );
  }
}

async function browseLoop(c, ctl) {
  await sleep(rnd(0, CFG.thinkMax));
  while (!ctl.stop && !abort.flag) {
    await browseOnce(c);
    await sleep(rnd(CFG.thinkMin, CFG.thinkMax));
  }
}

function randomCart() {
  const n = rndInt(1, 8);
  return shuffle(products.regular)
    .slice(0, n)
    .map((p) => ({ product_id: p.id, qty: rndInt(1, 4) }));
}

/** ينفّذ place_order ويسجّل. يرجع { code, json }. */
async function placeOrder(c, items, { key = crypto.randomUUID(), checkout = false } = {}) {
  if (checkout) {
    await Promise.all([
      call('checkout.settings', c, 'GET', 'app_settings?select=min_order_iqd,store_open&limit=1'),
      call(
        'checkout.addresses',
        c,
        'GET',
        'addresses?select=id,building_id,apartment,label,is_default&order=is_default.desc&limit=20',
      ),
    ]);
  }
  const t0 = performance.now();
  const args = {
    p_address_id: addressByCustomer.get(c.id),
    p_items: items,
    p_idempotency_key: key,
    p_note: `LOADTEST ${RUN_ID}`,
  };
  let r = await rpc(null, c, 'place_order', args);
  if (r.networkError) r = await rpc(null, c, 'place_order', args); // كالتطبيق: إعادة المحاولة بنفس المفتاح
  const code = errCode(r);
  if (code === 'OK' && !tracked.has(r.json.order_id)) {
    const id = r.json.order_id;
    tracked.add(id);
    markIssued(id, 'pending', t0);
    orderLog.push({ id, phase, replayed: !!r.json.replayed });
    c.open++;
    trackOrder(c, id);
  }
  return { code, json: r.json, status: r.status };
}

const FINAL = new Set(['delivered', 'cancelled']);
async function trackOrder(c, orderId) {
  const done = () => {
    c.open = Math.max(0, c.open - 1);
  };
  let sock = null;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    sock?.close();
    done();
  };
  const onStatus = (status) => {
    if (status === 'delivered' && Math.random() < 0.5 && !c.rated?.has(orderId)) {
      (c.rated ??= new Set()).add(orderId);
      setTimeout(
        () =>
          void rpc(null, c, 'rate_order', {
            p_order_id: orderId,
            p_stars: rndInt(1, 5),
            p_comment: null,
          }),
        rnd(2000, 8000),
      );
    }
    if (FINAL.has(status)) finish();
  };
  try {
    sock = new RealtimeSocket(env, {
      stats: rt,
      onEvent: (e) => {
        if (e.record?.id === orderId) {
          markSeen('customer', orderId, e.record.status, e.at);
          onStatus(e.record.status);
        }
      },
    });
    await sock.connect();
    await sock.join(
      `order-${orderId}`,
      [{ event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }],
      await token(c),
    );
  } catch {
    rt.joinErrors++;
    sock?.close();
    sock = null;
    // بديل: استطلاع (كما يفعل التطبيق عند فشل الاشتراك)
    (async () => {
      for (let i = 0; i < 40 && !finished; i++) {
        await sleep(8000);
        const r = await call('orders.poll', c, 'GET', `orders?select=id,status&id=eq.${orderId}`);
        if (r.status === 200 && r.json[0]) onStatus(r.json[0].status);
      }
      finish();
    })();
  }
  if (Math.random() < 0.03) {
    setTimeout(
      async () => {
        const t0 = performance.now();
        // رفض الإلغاء بعد بدء التحضير (NOT_ALLOWED/INVALID_TRANSITION) رفض تجاري متوقع للزبون فقط
        const r = await call(
          'rpc.cancel_order',
          c,
          'POST',
          'rpc/set_order_status',
          { p_order_id: orderId, p_status: 'cancelled', p_reason: 'LOADTEST' },
          { rpc: 'cancel_order' },
        );
        if (r.status === 200) markIssued(orderId, 'cancelled', t0);
      },
      rnd(1000, 4000),
    );
  }
  setTimeout(finish, 6 * 60_000); // سقف
}

/** جدولة طلبات بوتيرة بواسون: كل مرة زبون خامل عشوائي (أقل من الحد المفتوح). */
async function orderScheduler(getActive, ratePerHour, ctl) {
  const mean = 3_600_000 / ratePerHour;
  while (!ctl.stop && !abort.flag) {
    await sleep(expDelay(mean));
    if (ctl.stop) break;
    const eligible = getActive().filter((c) => !c.busy && c.open < maxActive);
    if (!eligible.length) continue;
    const c = pick(eligible);
    c.busy = true;
    placeOrder(c, randomCart(), { checkout: true }).finally(() => (c.busy = false));
  }
}

// ---------------------------------------------------------------------
// مرحلة A: الصحة تحت التزامن
// ---------------------------------------------------------------------
const addCheck = (name, errors, okDetail) =>
  corr.push({
    name,
    ok: errors.length === 0,
    detail: errors.length ? errors.join('; ') : okDetail,
  });
const stockOf = async (id) =>
  Number((await db.query('select qty from public.stock where product_id = $1', [id])).rows[0].qty);

async function phaseA() {
  const cs = U.customers;
  const raceN = Math.min(CFG.raceN, Math.floor(cs.length / 2));
  log(`phase A: correctness (race ${raceN} customers)`);

  // A0) سباق على آخر رصيد: كل زبون طلب واحد بكمية 1 أو 2، بنفس اللحظة
  const initial = await stockOf(products.scarce.id);
  const racers = cs.slice(0, raceN);
  const res0 = await Promise.all(
    racers.map((c, i) => {
      const qty = i % 3 === 0 ? 2 : 1;
      return placeOrder(c, [{ product_id: products.scarce.id, qty }]).then((r) => ({
        qty,
        result: r.code,
      }));
    }),
  );
  const finalStock = await stockOf(products.scarce.id);
  addCheck(
    `A0 oversell race: ${raceN} customers, stock ${initial}`,
    checkOversell({ initial, finalStock, requests: res0 }),
    `${res0.filter((r) => r.result === 'OK').length} won (${res0.filter((r) => r.result === 'OK').reduce((a, r) => a + r.qty, 0)} units), ` +
      `${res0.filter((r) => r.result === 'INSUFFICIENT_STOCK').length} refused INSUFFICIENT_STOCK, final stock ${finalStock}`,
  );

  // A1) حد الطلبات المفتوحة: 6 طلبات متوازية لزبون واحد (مفاتيح مختلفة) ← بالضبط max_active_orders تنجح
  const c1 = cs[raceN];
  const res1 = await Promise.all(
    Array.from({ length: maxActive + 3 }, () =>
      placeOrder(c1, [{ product_id: products.cheap.id, qty: 1 }]),
    ),
  );
  const ok1 = res1.filter((r) => r.code === 'OK').length;
  const lim1 = res1.filter((r) => r.code === 'TOO_MANY_ACTIVE_ORDERS').length;
  addCheck(
    `A1 max open orders: ${maxActive + 3} parallel place_order for one customer`,
    ok1 === maxActive && lim1 === 3
      ? []
      : [
          `expected ${maxActive} OK + 3 TOO_MANY_ACTIVE_ORDERS, got ${JSON.stringify(res1.map((r) => r.code))}`,
        ],
    `${ok1} OK, ${lim1} TOO_MANY_ACTIVE_ORDERS`,
  );

  // A2) تكرار المفتاح: 4 طلبات متوازية بنفس المفتاح ← طلب واحد فقط
  const c2 = cs[raceN + 1];
  const key = crypto.randomUUID();
  const res2 = await Promise.all(
    Array.from({ length: 4 }, () =>
      placeOrder(c2, [{ product_id: products.cheap.id, qty: 1 }], { key }),
    ),
  );
  const ids = new Set(res2.filter((r) => r.code === 'OK').map((r) => r.json.order_id));
  const cnt = Number(
    (
      await db.query(
        'select count(*)::int n from public.orders where customer_id = $1 and idempotency_key = $2',
        [c2.id, key],
      )
    ).rows[0].n,
  );
  const fresh = res2.filter((r) => r.code === 'OK' && !r.json.replayed).length;
  addCheck(
    'A2 idempotency: 4 parallel place_order with the same key',
    ids.size === 1 && cnt === 1 && fresh === 1 && res2.every((r) => r.code === 'OK')
      ? []
      : [
          `ids=${ids.size} dbRows=${cnt} fresh=${fresh} codes=${JSON.stringify(res2.map((r) => r.code))}`,
        ],
    '1 order created, 3 replays returned the same order',
  );

  // A3) المتجر مغلق: كل الطلبات ترفض STORE_CLOSED، ولا طلب ولا حركة مخزون
  const closedN = Math.min(10, cs.length - 2);
  const closers = cs.filter((c) => c.open < maxActive).slice(0, closedN);
  const cheapBefore = await stockOf(products.cheap.id);
  const ordersBefore = Number(
    (
      await db.query('select count(*)::int n from public.orders where customer_id = any ($1)', [
        closers.map((c) => c.id),
      ])
    ).rows[0].n,
  );
  await setStoreOpen(db, false);
  let res3;
  try {
    res3 = await Promise.all(
      closers.map((c) => placeOrder(c, [{ product_id: products.cheap.id, qty: 1 }])),
    );
  } finally {
    await setStoreOpen(db, before.appSettings[0].store_open);
  }
  const cheapAfter = await stockOf(products.cheap.id);
  const ordersAfter = Number(
    (
      await db.query('select count(*)::int n from public.orders where customer_id = any ($1)', [
        closers.map((c) => c.id),
      ])
    ).rows[0].n,
  );
  addCheck(
    `A3 store closed: ${closedN} concurrent place_order`,
    res3.every((r) => r.code === 'STORE_CLOSED') &&
      cheapBefore === cheapAfter &&
      ordersBefore === ordersAfter
      ? []
      : [
          `codes=${JSON.stringify(res3.map((r) => r.code))} stock ${cheapBefore}->${cheapAfter} orders ${ordersBefore}->${ordersAfter}`,
        ],
    `all STORE_CLOSED; no order created, stock unchanged; store restored to open=${before.appSettings[0].store_open}`,
  );

  // A4) سباق قبول السائقين: الموظف يجهّز 4 طلبات ثم كل السائقين يقبلون كل طلب بنفس اللحظة
  const raceOrders = [];
  const base = raceN + 2;
  for (let i = 0; i < 4 && base + i < cs.length; i++) {
    const r = await placeOrder(cs[base + i], [{ product_id: products.cheap.id, qty: 1 }]);
    if (r.code === 'OK') {
      manual.add(r.json.order_id);
      raceOrders.push(r.json.order_id);
    }
  }
  for (const id of raceOrders) {
    await rpc(null, U.staff, 'set_order_status', { p_order_id: id, p_status: 'preparing' });
    await rpc(null, U.staff, 'set_order_status', { p_order_id: id, p_status: 'ready' });
  }
  const drivers = U.drivers.slice(0, CFG.drivers);
  const raceErrors = [];
  const attempts = await Promise.all(
    raceOrders.map((id) =>
      Promise.all(
        drivers.map((d) => rpc(null, d, 'accept_order', { p_order_id: id }).then(errCode)),
      ),
    ),
  );
  attempts.forEach((results, i) =>
    raceErrors.push(...expectedRaceOutcome(results).map((e) => `order ${i}: ${e}`)),
  );
  const owners = (
    await db.query('select id, driver_id from public.orders where id = any ($1)', [raceOrders])
  ).rows;
  if (owners.some((o) => !o.driver_id)) raceErrors.push('an order ended with no driver');
  addCheck(
    `A4 driver accept race: ${raceOrders.length} orders x ${drivers.length} drivers simultaneously`,
    raceErrors,
    `each order: exactly 1 winner, ${drivers.length - 1} ORDER_NOT_AVAILABLE; every order has one driver`,
  );
  raceOrders.forEach((id) => manual.delete(id)); // تكمل بالأتمتة (السائق الفائز يوصّلها)
  log(
    'phase A done:',
    corr.map((c) => `${c.ok ? 'ok' : 'FAIL'} ${c.name.split(':')[0]}`).join(' | '),
  );
}

// ---------------------------------------------------------------------
// إعداد البيانات
// ---------------------------------------------------------------------
async function setup() {
  const cat = (
    await db.query(`insert into public.categories (name) values ($1) returning id`, [
      `${LT_NAME} ${RUN_ID}`,
    ])
  ).rows[0].id;
  const defs = Array.from({ length: 30 }, (_, i) => ({
    name: `${LT_NAME} ${RUN_ID} ${i + 1}`,
    unit: i % 6 === 5 ? 'باقة' : 'نص كيلو',
    price: 250 * (2 + (i % 11)),
  }));
  defs.push({ name: `${LT_NAME} ${RUN_ID} scarce`, unit: 'نص كيلو', price: 1000 });
  const ins = await db.query(
    `insert into public.products (category_id, name, unit, price_iqd)
     select $1, n, u, p from unnest($2::text[], $3::text[], $4::bigint[]) as t(n, u, p) returning id, name, price_iqd`,
    [cat, defs.map((d) => d.name), defs.map((d) => d.unit), defs.map((d) => d.price)],
  );
  const scarce = ins.rows.find((r) => r.name.endsWith('scarce'));
  const regular = ins.rows.filter((r) => r !== scarce);
  products = { regular, scarce, cheap: regular[0] };
  // رصيد وتكلفة عبر نفس مسار المخزون (حركة شراء بالدفتر: الدفتر = الرصيد)
  for (const p of ins.rows) {
    const qty = p === scarce ? 7 : 100000;
    await db.query(`select private.apply_stock_movement($1, $2, 'purchase', null, $3, $4)`, [
      p.id,
      qty,
      Math.max(250, Number(p.price_iqd) - 250),
      U.admin.id,
    ]);
  }
  // عناوين: عمارة نشطة موجودة (تُحذف العناوين بالتنظيف)
  const b = await db.query(
    `select b.id from public.buildings b join public.subsections s on s.id = b.subsection_id join public.sectors c on c.id = s.sector_id
      where b.is_active and s.is_active and c.is_active order by b.id limit 1`,
  );
  if (!b.rows.length) throw new Error('no active building found for addresses');
  const rows = await db.query(
    `insert into public.addresses (customer_id, building_id, apartment, is_default)
     select unnest($1::uuid[]), $2, 'LT', true returning id, customer_id`,
    [U.customers.map((c) => c.id), b.rows[0].id],
  );
  addressByCustomer = new Map(rows.rows.map((r) => [r.customer_id, r.id]));
  // أدوار
  const roleSql = `update public.profiles set role = $2::public.user_role, full_name = $3 where id = any ($1)`;
  await db.query(roleSql, [[U.admin.id], 'admin', `${LT_NAME} admin`]);
  await db.query(roleSql, [[U.staff.id], 'staff', `${LT_NAME} staff`]);
  await db.query(roleSql, [U.drivers.map((d) => d.id), 'driver', `${LT_NAME} driver`]);
  await db.query(`update public.profiles set full_name = $2 where id = any ($1)`, [
    U.customers.map((c) => c.id),
    `${LT_NAME} customer`,
  ]);
  realNames = (
    await db.query(`select name from public.products where name not like $1 limit 60`, [
      `${LT_NAME}%`,
    ])
  ).rows.map((r) => r.name);
  if (!realNames.length) realNames = ['خيار'];
}

// ---------------------------------------------------------------------
// مراقبة قاعدة البيانات
// ---------------------------------------------------------------------
async function sampleDb() {
  try {
    const [a, d, t] = await Promise.all([
      monitor.query(
        `select count(*)::int total, count(*) filter (where state = 'active')::int active,
                count(*) filter (where wait_event_type = 'Lock')::int lock_wait
           from pg_stat_activity where datname = current_database()`,
      ),
      monitor.query(
        `select deadlocks, xact_commit, xact_rollback from pg_stat_database where datname = current_database()`,
      ),
      monitor.query(`select count(*)::int n from public.push_tokens`),
    ]);
    samples.push({
      t: Date.now(),
      phase,
      ...a.rows[0],
      ...d.rows[0],
      pushTokens: t.rows[0].n,
      sockets: rt.open,
    });
    if (t.rows[0].n > before.pushTokens && !abort.flag) {
      abort.flag = true;
      abort.reason = `push_tokens rose to ${t.rows[0].n} (was ${before.pushTokens}): a real device registered during the test`;
      log(`ABORT: ${abort.reason}`);
    }
  } catch (err) {
    log('monitor sample failed:', err.message);
  }
}

const statements = async (c) =>
  (
    await c.query(
      `select queryid::text id, calls::bigint calls, total_exec_time, rows::bigint rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 150) q
         from pg_stat_statements where dbid = (select oid from pg_database where datname = current_database())`,
    )
  ).rows;

// ---------------------------------------------------------------------
// التشغيل
// ---------------------------------------------------------------------
async function main() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  let last = performance.now();
  lagTimer = setInterval(() => {
    const now = performance.now();
    const d = now - last - 100;
    last = now;
    if (d > (lag.max[phase] ?? 0)) lag.max[phase] = d;
    if (d > 500) lag.over500++;
  }, 100);
  log(`T22 load test ${RUN_ID} on mukhdar-dev (${env.ref}); smoke=${SMOKE}`);
  log('config', JSON.stringify(CFG));
  db = await connect(target);
  monitor = await connect(target);

  // --- فحوص مسبقة ---
  const leftover = Number(
    (
      await db.query(`select count(*)::int n from auth.users where phone like $1`, [
        `${LOAD_PHONE_PREFIX}%`,
      ])
    ).rows[0].n,
  );
  if (leftover)
    throw new Error(`${leftover} leftover load users exist; run pnpm load:cleanup first`);
  const pre = await db.query(
    `select (select count(*)::int from public.push_tokens) tokens, (select max_active_orders from public.app_settings) mx, (select store_open from public.app_settings) open`,
  );
  if (pre.rows[0].tokens > 0)
    throw new Error(
      `Refusing: ${pre.rows[0].tokens} push_tokens exist on dev; a real device could receive pushes. Nothing was changed.`,
    );
  if (!pre.rows[0].open)
    throw new Error(
      'Refusing: store is currently closed; the test must restore the original state, not guess it.',
    );
  maxActive = pre.rows[0].mx;

  before = await takeSnapshot(db);
  saveBefore(before, { runId: RUN_ID });
  log(
    `snapshot taken: ${Object.keys(before.counts).length} tables counted, outbox max id ${before.outboxMax}`,
  );

  // --- المستخدمون ---
  U.admin = mkUser('admin', 'admin');
  U.staff = mkUser('staff', 'staff');
  U.drivers = Array.from({ length: CFG.spikeDrivers }, (_, i) =>
    mkUser(`driver${i + 1}`, 'driver'),
  );
  U.customers = Array.from({ length: CFG.spikeCustomers }, (_, i) =>
    mkUser(`cust${i + 1}`, 'customer'),
  );
  const all = [U.admin, U.staff, ...U.drivers, ...U.customers];
  log(`creating ${all.length} throwaway users (phone prefix ${LOAD_PHONE_PREFIX}) via Admin API`);
  await createUsers(all);
  await setup();
  log(
    `setup done: ${products.regular.length + 1} products (scarce stock 7), ${addressByCustomer.size} addresses`,
  );

  // خط الأساس للشبكة: طلب خفيف جداً (قراءة صف واحد) قبل أي حمل
  const floor = [];
  for (let i = 0; i < 15; i++) {
    const r = await http('GET', `${env.base}/rest/v1/app_settings?select=store_open&limit=1`, {
      key: env.anonKey,
    });
    if (r.status === 200) floor.push(r.ms);
    await sleep(200);
  }

  // --- مراقبة ---
  const stmtBefore = await statements(monitor);
  const dbStart = (
    await monitor.query(
      `select deadlocks, xact_commit from pg_stat_database where datname = current_database()`,
    )
  ).rows[0];
  monitorTimer = setInterval(() => void sampleDb(), 5000);

  // --- مضخة الدخول (بترتيب الاحتياج) ---
  const order = [
    U.admin,
    U.staff,
    ...U.drivers.slice(0, CFG.drivers),
    ...U.customers,
    ...U.drivers.slice(CFG.drivers),
  ];
  const ready = new Map(order.map((u) => [u, null]));
  const pump = (async () => {
    for (const u of order) {
      await signIn(u);
      ready.set(u, true);
    }
  })();
  pump.catch((e) => {
    abort.flag = true;
    abort.reason = `sign-in pump failed: ${e.message}`;
  });
  const waitReady = async (users) => {
    while (!users.every((u) => ready.get(u))) {
      if (abort.flag) throw new Error(abort.reason);
      await sleep(1000);
    }
  };

  const raceN = Math.min(CFG.raceN, Math.floor(CFG.customers / 2));
  const aCustomers = U.customers.slice(0, raceN + 6);
  log(
    `signing in at <= ${CFG.signinPer5Min}/5min (expect ~${Math.ceil((order.length / CFG.signinPer5Min) * 5)} min for all ${order.length})`,
  );
  await waitReady([U.admin, U.staff, ...U.drivers.slice(0, CFG.drivers), ...aCustomers]);

  // --- اللوحتان (Realtime) ---
  await startAdminPanel();
  await startStaffPanel();
  log('panels connected (admin on Home, staff on Orders)');

  // --- مرحلة A ---
  phase = 'A';
  await phaseA();

  // --- تشغيل الأتمتة والسائقين ---
  staffAutomation = true;
  U.drivers.slice(0, CFG.drivers).forEach((d) => void driverLoop(d));
  await staffRefresh();

  // --- الحمل الأساسي ---
  await waitReady(U.customers.slice(0, CFG.customers));
  phase = 'base';
  log(
    `BASE: ${CFG.customers} customers, ${CFG.ordersPerHour} orders/h, ${CFG.drivers} drivers, ${CFG.baseMin} min`,
  );
  const ctlBase = { stop: false };
  const baseUsers = U.customers.slice(0, CFG.customers);
  baseUsers.forEach((c) => void browseLoop(c, ctlBase));
  void orderScheduler(() => baseUsers, CFG.ordersPerHour, ctlBase);
  await sleepA(CFG.baseMin * 60_000);
  ctlBase.stop = true;
  log('BASE finished');

  // --- الانتظار حتى يكتمل الدخول للذروة (والأتمتة تصرّف ما بقي) ---
  phase = 'idle';
  log('waiting for remaining sign-ins before the spike (sims keep draining orders)');
  await waitReady(order);
  await sleep(10_000);

  // --- الذروة x3 ---
  phase = 'spike';
  log(
    `SPIKE x${CFG.factor}: ${CFG.spikeCustomers} customers, ${CFG.ordersPerHour * CFG.factor} orders/h, ${CFG.spikeDrivers} drivers, ${CFG.spikeMin} min`,
  );
  U.drivers.slice(CFG.drivers).forEach((d) => void driverLoop(d));
  const ctlSpike = { stop: false };
  const spikeUsers = U.customers;
  spikeUsers.forEach((c) => void browseLoop(c, ctlSpike));
  void orderScheduler(() => spikeUsers, CFG.ordersPerHour * CFG.factor, ctlSpike);
  await sleepA(CFG.spikeMin * 60_000);
  ctlSpike.stop = true;
  log('SPIKE finished');

  // --- تصريف ---
  phase = 'drain';
  const deadline = Date.now() + CFG.drainMin * 60_000;
  for (;;) {
    const open = Number(
      (
        await db.query(
          `select count(*)::int n from public.orders where id = any ($1) and status not in ('delivered','cancelled')`,
          [[...tracked]],
        )
      ).rows[0].n,
    );
    if (open === 0 || Date.now() > deadline) {
      log(`drain: ${open} open load orders remain`);
      break;
    }
    log(`drain: ${open} open orders...`);
    await sleepA(10_000);
  }
  await sleepA(15_000); // أحداث Realtime المتأخرة
  clearInterval(monitorTimer);
  panels.stop = true;
  await sleep(6000);
  panels.sockets.forEach((s) => s.close());

  // --- الفحوص ---
  phase = 'verify';
  const orderIds = [...tracked];
  const productIds = [...products.regular.map((p) => p.id), products.scarce.id];
  corr.push(...(await verifyDatabase(db, { orderIds, productIds })));
  const dash = await rpc(null, U.admin, 'dashboard_today');
  const day = (await db.query(`select public.baghdad_today()::text d`)).rows[0].d;
  const rep = await rpc(null, U.admin, 'report_summary', { p_from: day, p_to: day });
  corr.push(
    ...(await verifyReports(db, {
      dashboard: dash.json,
      reportSummary: rep.json,
      statsMismatchSql: STATS_MISMATCH_SQL,
    })),
  );
  corr.push({
    name: 'no real push device could be reached (push_tokens stayed at baseline)',
    ok: !abort.flag && samples.every((s) => s.pushTokens === before.pushTokens),
    detail: `push_tokens = ${before.pushTokens} before and during`,
  });

  // --- DB: deadlocks وأثقل الاستعلامات ---
  const dbEnd = (
    await monitor.query(
      `select deadlocks, xact_commit from pg_stat_database where datname = current_database()`,
    )
  ).rows[0];
  const deadlocks = Number(dbEnd.deadlocks) - Number(dbStart.deadlocks);
  corr.push({
    name: 'zero deadlocks during the run (pg_stat_database)',
    ok: deadlocks === 0,
    detail: `${deadlocks} deadlocks`,
  });
  const stmtAfter = await statements(monitor);
  const prev = new Map(stmtBefore.map((s) => [s.id, s]));
  const topStatements = stmtAfter
    .map((s) => ({
      q: s.q,
      calls: Number(s.calls) - Number(prev.get(s.id)?.calls ?? 0),
      totalMs: Number(s.total_exec_time) - Number(prev.get(s.id)?.total_exec_time ?? 0),
    }))
    .filter((s) => s.calls > 0 && !/pg_stat_|pg_catalog|information_schema|LOADTEST/.test(s.q))
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 8)
    .map((s) => ({ ...s, meanMs: s.totalMs / s.calls }));
  const placeStmt = stmtAfter.find(
    (s) => /place_order/.test(s.q) && /select/i.test(s.q) && !/pg_proc/.test(s.q),
  );

  // --- زمن Realtime ---
  for (const who of ['admin', 'staff', 'customer']) {
    let seen = 0;
    let expected = 0;
    for (const [k, iss] of issuedAt) {
      expected++;
      const s = seenAt[who].get(k);
      if (s !== undefined) {
        seen++;
        metrics.record(iss.phase, `realtime.event.${who}`, Math.max(0, s - iss.t), { kind: 'ok' });
      }
    }
    rt[`${who}Delivered`] = `${seen}/${expected}`;
  }
  const lostKeys = [...issuedAt.keys()].filter((k) => !seenAt.admin.has(k));
  const lostAdmin = lostKeys.length;
  rt.lostKeys = lostKeys.map((k) => ({
    key: k,
    phase: issuedAt.get(k).phase,
    seenByStaff: seenAt.staff.has(k),
    seenByCustomer: seenAt.customer.has(k),
  }));
  corr.push({
    name: 'Realtime: admin panel received every order INSERT/status UPDATE',
    ok: lostAdmin === 0,
    detail:
      lostAdmin === 0
        ? `${issuedAt.size} events all delivered`
        : `${lostAdmin} of ${issuedAt.size} events not received (possible Realtime drop; see report)`,
  });

  return {
    floor,
    topStatements,
    deadlocks,
    placeStmtMeanMs: placeStmt ? Number(placeStmt.total_exec_time) / Number(placeStmt.calls) : null,
  };
}

// ---------------------------------------------------------------------
// تقرير
// ---------------------------------------------------------------------
function report(extra, cleanProblems, thr) {
  const rows = metrics.summary();
  const fmt = (n) => (n === null ? '-' : String(Math.round(n)).padStart(5));
  const lines = [];
  lines.push('\n==== latency (client-side, ms) ====');
  lines.push('phase  op                          n    ok  refused  errors   p50   p95   p99   max');
  for (const r of rows) {
    lines.push(
      `${r.phase.padEnd(6)} ${r.op.padEnd(27)} ${String(r.n).padStart(4)} ${String(r.ok).padStart(5)} ${String(r.refusedCount).padStart(8)} ${String(r.errorCount).padStart(7)} ` +
        `${fmt(r.p50)} ${fmt(r.p95)} ${fmt(r.p99)} ${fmt(r.max)}`,
    );
  }
  const refusals = rows
    .filter((r) => r.refusedCount)
    .map((r) => `${r.phase}/${r.op}: ${JSON.stringify(r.refused)}`);
  const errors = rows
    .filter((r) => r.errorCount)
    .map((r) => `${r.phase}/${r.op}: ${JSON.stringify(r.errors)}`);
  lines.push(
    '\nexpected business refusals:',
    ...(refusals.length ? refusals.map((x) => '  ' + x) : ['  none']),
  );
  lines.push('unexpected errors:', ...(errors.length ? errors.map((x) => '  ' + x) : ['  none']));
  const peak = (k) => Math.max(0, ...samples.map((s) => Number(s[k])));
  lines.push(
    `\nnetwork floor (GET 1 row, idle): p50 ${fmt(percentile(extra.floor, 50))} ms  p95 ${fmt(percentile(extra.floor, 95))} ms`,
    `DB connections (pg_stat_activity, max_connections 60): peak total ${peak('total')}, peak active ${peak('active')}, peak lock-waiting ${peak('lock_wait')}`,
    `Realtime: peak open sockets ${rt.peak} (incl. 2 panels), join errors ${rt.joinErrors}, unexpected closes ${rt.closedUnexpected}, ` +
      `events delivered admin ${rt.adminDelivered} / staff ${rt.staffDelivered} (customers watch only their own order: ${rt.events.customer} events received)`,
    `client event-loop lag (test machine), max per phase ms: ${JSON.stringify(Object.fromEntries(Object.entries(lag.max).map(([k, v]) => [k, Math.round(v)])))}; stalls > 500ms: ${lag.over500}`,
    `Realtime lost events: ${JSON.stringify(rt.lostKeys ?? [])}`,
    `auth: ${authCounters.signins} sign-ins (limit ${CFG.signinPer5Min}/5min), ${authCounters.refreshes} refreshes, ${authCounters.rate429} x 429`,
    `deadlocks: ${extra.deadlocks}; place_order server-side mean (pg_stat_statements): ${extra.placeStmtMeanMs === null ? '-' : extra.placeStmtMeanMs.toFixed(1) + ' ms'}`,
    `orders placed: ${orderLog.length} (A ${orderLog.filter((o) => o.phase === 'A').length}, base ${orderLog.filter((o) => o.phase === 'base').length}, spike ${orderLog.filter((o) => o.phase === 'spike').length}); replayed ${orderLog.filter((o) => o.replayed).length}`,
  );
  lines.push('\ntop statements by total time (delta over the run):');
  for (const s of extra.topStatements.slice(0, 5))
    lines.push(
      `  ${s.totalMs.toFixed(0).padStart(7)} ms total  ${String(s.calls).padStart(6)} calls  ${s.meanMs.toFixed(2).padStart(7)} ms mean  ${s.q.slice(0, 90)}`,
    );
  lines.push('\n==== correctness ====');
  for (const c of corr) lines.push(`${c.ok ? 'ok    ' : 'FAIL  '} ${c.name}: ${c.detail}`);
  lines.push('\n==== thresholds ====');
  lines.push(
    `base: p95 < ${THRESHOLDS.base.p95Ms} ms, spike: p95 < ${THRESHOLDS.spike.p95Ms} ms, unexpected errors < ${THRESHOLDS.base.errorRate * 100}%`,
  );
  const info = rows
    .filter((r) => r.phase === 'base' && THRESHOLDS.prodTargetsMs[r.op])
    .map(
      (r) =>
        `${r.op} p95 ${Math.round(r.p95)} ms vs prod target ${THRESHOLDS.prodTargetsMs[r.op]} ms`,
    );
  lines.push(`info (prod targets, not gating on free tier): ${info.join('; ') || '-'}`);
  for (const f of thr.failures) lines.push(`FAIL  ${f}`);
  for (const n of thr.notes) lines.push(`note  ${n}`);
  lines.push('\n==== cleanup ====');
  lines.push(
    cleanProblems.length
      ? cleanProblems.map((p) => `FAIL  ${p}`).join('\n')
      : 'ok    zero leftovers; settings, stock, daily_stats, row counts and content hashes match the pre-run snapshot',
  );
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------
let extra = null;
let mainError = null;
process.on('SIGINT', () => {
  abort.flag = true;
  abort.reason = 'SIGINT';
  log('SIGINT: stopping, cleaning up...');
});
try {
  extra = await main();
} catch (err) {
  mainError = err;
  console.error('\nRUN FAILED:', err.stack ?? err);
} finally {
  clearInterval(monitorTimer);
  panels.stop = true;
  panels.sockets.forEach((s) => s.close());
}

quiesced = true;
clearInterval(lagTimer);
let cleanProblems;
try {
  if (!db) db = await connect(target);
  log('cleaning up...');
  const snap = before ?? loadBefore();
  await cleanup(db, env, snap, log);
  cleanProblems = await verifyClean(db, snap);
} catch (err) {
  cleanProblems = [`cleanup crashed: ${err.message}`];
  console.error(err.stack ?? err);
}

const thr = evaluate(metrics.summary());
if (extra) report(extra, cleanProblems, thr);
const resultFile = path.join(RUN_DIR, `results-${RUN_ID}.json`);
fs.writeFileSync(
  resultFile,
  JSON.stringify(
    {
      lag,
      runId: RUN_ID,
      cfg: CFG,
      summary: metrics.summary(),
      correctness: corr,
      thresholds: thr,
      rt,
      authCounters,
      samples,
      extra,
      cleanProblems,
      mainError: mainError?.message ?? null,
    },
    null,
    2,
  ),
);
log(`results saved to ${resultFile}`);
await db?.end().catch(() => {});
await monitor?.end().catch(() => {});
const failed =
  !!mainError || corr.some((c) => !c.ok) || thr.failures.length > 0 || cleanProblems.length > 0;
console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
process.exit(failed ? 1 : 0);
