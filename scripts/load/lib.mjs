// T22: مساعدات اختبار الحمل (بلا اعتماديات خارج pg): إحصاءات، تصنيف النتائج، العتبات، HTTP، عميل Realtime.
// الأجزاء النقية (percentile/summarize/classify/evaluate/RateLimiter) مختبَرة بـ lib.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { assertSafeTarget, readEnvLocal, root, tempDir } from '../lib/db.mjs';
import { PROD_NAME, classifyRef, refFromPoolerUrl } from '../lib/projects.mjs';
import { freshTotp } from '../lib/totp.mjs';

// ---------------------------------------------------------------------
// الإحصاءات
// ---------------------------------------------------------------------

/** nearest-rank على مصفوفة أرقام (لا يعدّلها). null إن كانت فارغة. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * رموز الرفض التجاري المتوقعة لكل عملية: ليست أخطاء (تُحصى منفصلة).
 * أي رمز آخر، أو 5xx أو 429 أو انقطاع أو مهلة = خطأ غير متوقع.
 */
export const EXPECTED_REFUSALS = {
  place_order: new Set([
    'INSUFFICIENT_STOCK', // سباق على آخر رصيد
    'TOO_MANY_ACTIVE_ORDERS', // حد الطلبات المفتوحة
    'STORE_CLOSED', // فقط بمرحلة "المتجر مغلق"
  ]),
  accept_order: new Set(['ORDER_NOT_AVAILABLE']), // خسر السباق
  set_order_status: new Set(['INVALID_TRANSITION']),
  // إلغاء الزبون سباق مع تحضير الموظف: الزبون يلغي وهو pending فقط
  cancel_order: new Set(['INVALID_TRANSITION', 'NOT_ALLOWED']), // إلغاء الزبون مقابل تحضير الموظف
  assign_driver: new Set(['INVALID_TRANSITION', 'ORDER_NOT_AVAILABLE']),
};

/**
 * يصنّف نتيجة HTTP: { kind: 'ok' | 'refused' | 'error', code }.
 * res = { status, json, networkError? }
 */
export function classify(op, res) {
  if (res.networkError) return { kind: 'error', code: `NETWORK:${res.networkError}` };
  if (res.status >= 200 && res.status < 300) return { kind: 'ok', code: null };
  const msg = typeof res.json?.message === 'string' ? res.json.message : null;
  if (res.status >= 400 && res.status < 500 && msg && EXPECTED_REFUSALS[op]?.has(msg)) {
    return { kind: 'refused', code: msg };
  }
  return { kind: 'error', code: msg ? `${res.status}:${msg}` : `HTTP_${res.status}` };
}

export class Metrics {
  constructor() {
    /** @type {Map<string, {ms: number[], ok: number, refused: Record<string, number>, errors: Record<string, number>}>} */
    this.series = new Map();
  }

  record(phase, op, ms, outcome) {
    const key = `${phase}|${op}`;
    let s = this.series.get(key);
    if (!s) {
      s = { ms: [], ok: 0, refused: {}, errors: {} };
      this.series.set(key, s);
    }
    s.ms.push(ms);
    if (outcome.kind === 'ok') s.ok++;
    else if (outcome.kind === 'refused')
      s.refused[outcome.code] = (s.refused[outcome.code] ?? 0) + 1;
    else s.errors[outcome.code] = (s.errors[outcome.code] ?? 0) + 1;
  }

  /** صفوف ملخّصة: { phase, op, n, ok, refused, errors, errorCount, errorRate, p50, p95, p99, max } */
  summary() {
    const rows = [];
    for (const [key, s] of this.series) {
      const [phase, op] = key.split('|');
      const refusedCount = Object.values(s.refused).reduce((a, b) => a + b, 0);
      const errorCount = Object.values(s.errors).reduce((a, b) => a + b, 0);
      const n = s.ms.length;
      rows.push({
        phase,
        op,
        n,
        ok: s.ok,
        refused: s.refused,
        refusedCount,
        errors: s.errors,
        errorCount,
        errorRate: n === 0 ? 0 : errorCount / n,
        p50: percentile(s.ms, 50),
        p95: percentile(s.ms, 95),
        p99: percentile(s.ms, 99),
        max: s.ms.length ? Math.max(...s.ms) : null,
      });
    }
    return rows.sort((a, b) => (a.phase + a.op).localeCompare(b.phase + b.op));
  }
}

// ---------------------------------------------------------------------
// العتبات (نجاح/فشل)
// ---------------------------------------------------------------------

/**
 * عتبات القبول. القياس من جهاز الاختبار إلى مشروع التطوير المجاني بسنغافورة (WAN + Nano compute)،
 * فهي متساهلة قياساً بأهداف الإنتاج (T22: place_order p95 < 500ms، الكتالوج < 300ms: تُسجَّل كمعلومة فقط).
 *  - الحمل الأساسي: p95 < 1000ms لكل عملية، والأخطاء غير المتوقعة < 1%.
 *  - الذروة (x3): p95 < 2000ms (تدهور مقبول)، والأخطاء غير المتوقعة < 1%.
 *  - الصحة (الأهم): أي انتهاك لثوابت الصحة = فشل مطلق بغض النظر عن السرعة.
 */
export const THRESHOLDS = {
  base: { p95Ms: 1000, errorRate: 0.01 },
  spike: { p95Ms: 2000, errorRate: 0.01 },
  prodTargetsMs: { 'rpc.place_order': 500, 'browse.products': 300, 'browse.categories': 300 },
  minSamples: 20, // أقل من هذا لا تُحكم النسب المئوية (تُسجَّل وتُعلَّم "عينة صغيرة")
};

/** يقيّم صفوف summary() للمرحلتين base/spike. يرجع { failures: string[], notes: string[] }. */
export function evaluate(rows, thresholds = THRESHOLDS) {
  const failures = [];
  const notes = [];
  for (const r of rows) {
    const t = thresholds[r.phase];
    if (!t || r.op.startsWith('realtime.')) continue;
    const label = `${r.phase}/${r.op}`;
    if (r.n >= thresholds.minSamples && r.p95 > t.p95Ms) {
      failures.push(`${label}: p95 ${Math.round(r.p95)}ms > ${t.p95Ms}ms (n=${r.n})`);
    } else if (r.n < thresholds.minSamples) {
      notes.push(`${label}: only ${r.n} samples, percentiles not judged`);
    }
    if (r.errorRate > t.errorRate) {
      failures.push(
        `${label}: unexpected error rate ${(r.errorRate * 100).toFixed(2)}% > ${t.errorRate * 100}% ` +
          `(${JSON.stringify(r.errors)})`,
      );
    }
  }
  return { failures, notes };
}

// ---------------------------------------------------------------------
// أدوات صغيرة
// ---------------------------------------------------------------------

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rnd = (min, max) => min + Math.random() * (max - min);
export const rndInt = (min, max) => Math.floor(rnd(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/** زمن انتظار أسّي (عملية بواسون) بمتوسط meanMs. */
export const expDelay = (meanMs) => -Math.log(1 - Math.random()) * meanMs;

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** حد معدل بنافذة منزلقة: لا أكثر من `max` أحداث بأي `windowMs`. acquire() ينتظر الدور. */
export class RateLimiter {
  constructor(max, windowMs, now = () => Date.now()) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.stamps = [];
  }

  /** ms للانتظار قبل السماح التالي (0 = الآن). لا يحجز. */
  waitMs() {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs);
    if (this.stamps.length < this.max) return 0;
    return this.stamps[0] + this.windowMs - t + 1;
  }

  async acquire() {
    for (;;) {
      const w = this.waitMs();
      if (w <= 0) break;
      await sleep(Math.min(w, 5000));
    }
    this.stamps.push(this.now());
  }
}

// ---------------------------------------------------------------------
// البيئة والاتصال
// ---------------------------------------------------------------------

export const LOAD_PHONE_PREFIX = '9647006'; // بادئة مستخدمي T22 فقط (ليست 9647000/1/2/7)
export const RUN_DIR = path.join(root, 'scripts', 'load', '.run');

/**
 * T23 H3: الهدف صريح. بلا وسيط = mukhdar-dev فقط. الإنتاج **فقط** بـ --target=prod (ثم ref مصنَّف إنتاجاً
 * بـ projects.mjs + تأكيد مكتوب بطرفية حقيقية، confirmProdTarget). لا يُضاف ref الإنتاج لقائمة التطوير أبداً.
 */
export function loadTargetMode(argv) {
  const t = argv.filter((a) => a.startsWith('--target='));
  if (t.length === 0) return 'dev';
  if (t.length === 1 && (t[0] === '--target=prod' || t[0] === '--target=dev')) return t[0].slice(9);
  throw new Error(
    `Refusing: unknown ${t.join(' ')} (use --target=prod for production, nothing for dev).`,
  );
}

/** يتحقق من المشروع المربوط مقابل الوضع: dev ← مشروع تطوير؛ prod ← مشروع إنتاج مسجّل (لا placeholder). */
export function assertLoadRef(ref, mode, lists) {
  const kind = lists ? classifyRef(ref, lists.dev, lists.prod) : classifyRef(ref);
  if (mode === 'prod') {
    if (kind !== 'prod') {
      throw new Error(
        `Refusing: --target=prod but the linked project ${ref ?? '(none)'} is not the registered ` +
          `production project (${kind}). Register it in scripts/lib/projects.mjs and link the prod checkout.`,
      );
    }
    return;
  }
  if (kind === 'prod' || kind === 'placeholder') {
    throw new Error(
      `Refusing: the linked project ${ref} is PRODUCTION. The load test on production needs ` +
        'the explicit path: pnpm load:run -- --target=prod (typed confirmation).',
    );
  }
  if (kind !== 'dev') {
    throw new Error(
      `Refusing: linked project ${ref} is not mukhdar-dev. Without --target=prod T22 runs on dev only.`,
    );
  }
}

/** هدف قاعدة البيانات (resolveTarget --remote) لنفس المشروع وبنفس الوضع. */
export function assertLoadDbTarget(target, mode, ref) {
  if (mode !== 'prod') return assertSafeTarget(target);
  assertLoadRef(target.projectRef, 'prod');
  if (target.projectRef !== ref || refFromPoolerUrl(target.poolerUrl) !== ref) {
    throw new Error(
      `Refusing: the database link (${target.projectRef}, pooler ${refFromPoolerUrl(target.poolerUrl)}) ` +
        `does not match the linked production project ${ref}.`,
    );
  }
}

/** تأكيد مكتوب للإنتاج: طرفية حقيقية فقط، ويكتب المستخدم الـ ref حرفياً. */
export async function confirmProdTarget(
  ref,
  { input = process.stdin, output = process.stderr } = {},
) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      'Refusing: the production load test needs an interactive terminal (typed confirmation).',
    );
  }
  output.write(
    `\n*** PRODUCTION *** ${PROD_NAME} (${ref}): this creates throwaway users/products/orders on production ` +
      'and deletes them at the end.\n',
  );
  const rl = readline.createInterface({ input, output });
  const answer = await new Promise((r) =>
    rl.question(`Type the production ref (${ref}) to continue: `, r),
  );
  rl.close();
  if (answer.trim() !== ref)
    throw new Error('Refusing: confirmation did not match the production ref.');
}

export function loadEnv({ mode = 'dev' } = {}) {
  const linkedPath = path.join(tempDir(), 'linked-project.json');
  const ref = JSON.parse(fs.readFileSync(linkedPath, 'utf8')).ref;
  assertLoadRef(ref, mode);
  const serviceKey = readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (.env.local)');
  const appEnv = fs.readFileSync(path.join(root, 'apps', 'customer', '.env'), 'utf8');
  const anonKey = /^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)$/m.exec(appEnv)?.[1]?.trim();
  if (!anonKey)
    throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing (apps/customer/.env)');
  return { ref, serviceKey, anonKey, base: `https://${ref}.supabase.co` };
}

/**
 * T23 C1: الأدمن والموظف يحتاجان جلسة aal2. يسجّل عامل TOTP بسر عشوائي (أول مرة) ثم challenge + verify عبر
 * Auth API، ويستبدل رموز الجلسة برموز aal2 (التحديث بعدها يبقى aal2). u.totpSecret يُحفظ لإعادة الدخول.
 */
export async function upgradeToAal2(httpFn, base, anonKey, u) {
  const auth = { key: anonKey, token: u.access };
  if (!u.factorId) {
    const e = await httpFn('POST', `${base}/auth/v1/factors`, {
      ...auth,
      body: { factor_type: 'totp', friendly_name: `load ${u.key}`, issuer: 'Mukhdar load' },
    });
    if (e.status !== 200 || !e.json?.id) {
      throw new Error(`MFA enroll failed for ${u.key}: ${e.status} ${JSON.stringify(e.json)}`);
    }
    u.factorId = e.json.id;
    u.totpSecret = e.json.totp?.secret;
  }
  if (!u.totpSecret) throw new Error(`MFA enroll for ${u.key} returned no TOTP secret`);
  const c = await httpFn('POST', `${base}/auth/v1/factors/${u.factorId}/challenge`, {
    ...auth,
    body: {},
  });
  if (c.status !== 200 || !c.json?.id) {
    throw new Error(`MFA challenge failed for ${u.key}: ${c.status} ${JSON.stringify(c.json)}`);
  }
  const v = await httpFn('POST', `${base}/auth/v1/factors/${u.factorId}/verify`, {
    ...auth,
    body: { challenge_id: c.json.id, code: await freshTotp(u.totpSecret) },
  });
  if (v.status !== 200 || !v.json?.access_token) {
    throw new Error(`MFA verify failed for ${u.key}: ${v.status} ${JSON.stringify(v.json)}`);
  }
  u.access = v.json.access_token;
  u.refresh = v.json.refresh_token;
  u.expiresAt = Date.now() + (v.json.expires_in ?? 3600) * 1000;
}

/** طلب HTTP مع قياس الزمن. لا يرمي أبداً: الأخطاء بـ networkError. */
export async function http(
  method,
  url,
  { key, token, body, headers = {}, timeoutMs = 20_000 } = {},
) {
  const h = { apikey: key, 'Content-Type': 'application/json', ...headers };
  if (token !== null) h.Authorization = `Bearer ${token ?? key}`;
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, ms: performance.now() - t0, headers: res.headers };
  } catch (err) {
    const kind =
      err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message ?? 'fetch');
    return { status: 0, json: null, ms: performance.now() - t0, networkError: String(kind) };
  }
}

// ---------------------------------------------------------------------
// عميل Realtime (بروتوكول Phoenix 1.0.0، بلا اعتماديات؛ WebSocket مدمج بـ Node 22+)
// ---------------------------------------------------------------------

export class RealtimeSocket {
  /**
   * @param {{ref: string, anonKey: string}} env
   * @param {{onEvent?: Function, onClose?: Function, stats?: {open: number, peak: number, joinErrors: number, closedUnexpected: number}}} opts
   */
  constructor(env, { onEvent, stats } = {}) {
    this.env = env;
    this.onEvent = onEvent;
    this.stats = stats;
    this.ws = null;
    this.refCounter = 0;
    this.pending = new Map();
    this.hb = null;
    this.closedByUs = false;
  }

  connect(timeoutMs = 10_000) {
    const url = `wss://${this.env.ref}.supabase.co/realtime/v1/websocket?apikey=${this.env.anonKey}&vsn=1.0.0`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error('realtime connect timeout'));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        if (this.stats) {
          this.stats.open++;
          this.stats.peak = Math.max(this.stats.peak, this.stats.open);
        }
        this.hb = setInterval(() => this.#send('phoenix', 'heartbeat', {}), 25_000);
        this.hb.unref?.();
        resolve();
      });
      ws.addEventListener('message', (m) => this.#onMessage(m.data));
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('realtime socket error'));
      });
      ws.addEventListener('close', () => {
        clearTimeout(timer);
        clearInterval(this.hb);
        if (this.stats) {
          this.stats.open--;
          if (!this.closedByUs) this.stats.closedUnexpected++;
        }
        for (const p of this.pending.values()) p.reject(new Error('socket closed'));
        this.pending.clear();
      });
    });
  }

  #send(topic, event, payload) {
    const ref = String(++this.refCounter);
    this.ws.send(JSON.stringify({ topic, event, payload, ref }));
    return ref;
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.event === 'phx_reply' && this.pending.has(msg.ref)) {
      const p = this.pending.get(msg.ref);
      this.pending.delete(msg.ref);
      if (msg.payload?.status === 'ok') p.resolve(msg.payload.response);
      else
        p.reject(new Error(`join failed: ${JSON.stringify(msg.payload?.response ?? msg.payload)}`));
    } else if (msg.event === 'postgres_changes') {
      const d = msg.payload?.data;
      if (d)
        this.onEvent?.({
          topic: msg.topic,
          type: d.type,
          record: d.record,
          old: d.old_record,
          at: performance.now(),
        });
    }
  }

  /** ينضم لقناة بتغييرات postgres. يحلّ عند الـ ok (بعدها الأحداث تصل). */
  join(name, changes, accessToken, timeoutMs = 10_000) {
    const topic = `realtime:${name}`;
    const payload = {
      config: {
        broadcast: { ack: false, self: false },
        presence: { key: '', enabled: false },
        postgres_changes: changes,
        private: false,
      },
      access_token: accessToken,
    };
    return new Promise((resolve, reject) => {
      const ref = String(++this.refCounter);
      const timer = setTimeout(() => {
        this.pending.delete(ref);
        reject(new Error('realtime join timeout'));
      }, timeoutMs);
      this.pending.set(ref, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ topic, event: 'phx_join', payload, ref, join_ref: ref }));
    });
  }

  close() {
    this.closedByUs = true;
    clearInterval(this.hb);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
