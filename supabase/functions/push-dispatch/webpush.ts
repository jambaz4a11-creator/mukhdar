// مُرسِل Web Push (SPEC-webpush §5.4). تشفير aes128gcm + VAPID من webpush_crypto.ts (WebCrypto فقط).
//
// الحماية:
//   * SSRF: الـ endpoint يأتي من العميل. https فقط، بلا منفذ ولا بيانات دخول، المضيف من القائمة البيضاء،
//     طول ≤ 1024، ولا تُتبع إعادة التوجيه (redirect: 'manual'). خارج ذلك ← فشل دائم بلا أي اتصال.
//   * الـ endpoint "قدرة" إرسال: لا يظهر بالسجلات ولا بـ last_error (المضيف + مقطع هاش فقط).
//
// التصنيف: 2xx ok؛ 404/410 dead (يُحذف)؛ 429/5xx/شبكة/مهلة 8 ثوانٍ error مؤقت (يُعاد بعد مهلة الحجز
// 5 دقائق، والمضيف الذي أرسل Retry-After لا يُتصل به قبل انقضائه داخل نفس الـ isolate)؛
// 400/401/403/413 وغيرها failed دائم (إعداد خاطئ: لا إعادة ولا حذف للرمز).
import type { PushMessage, Sender, SendOutcome } from './dispatch.ts';
import {
  encryptPayload,
  importVapidKeys,
  type VapidKeys,
  vapidAuthorization,
} from './webpush_crypto.ts';

export const WEBPUSH_TTL_SECONDS = 3600;
export const WEBPUSH_TIMEOUT_MS = 8000;
export const WEBPUSH_CONCURRENCY = 10;
export const WEBPUSH_MAX_PAYLOAD_BYTES = 1024;
export const WEBPUSH_MAX_ENDPOINT_LENGTH = 1024;
const MAX_RETRY_AFTER_MS = 3600 * 1000;
/** JWT الـ VAPID صالح 12 ساعة؛ يُجدَّد بعد 6 ساعات من إنشائه. */
const JWT_REUSE_SECONDS = 6 * 3600;

const EXACT_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com']);
const SUFFIX_HOSTS = ['.push.apple.com', '.notify.windows.com'];

export function isAllowedEndpoint(endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > WEBPUSH_MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname;
  if (EXACT_HOSTS.has(host)) return true;
  return SUFFIX_HOSTS.some((s) => host.endsWith(s) && host.length > s.length);
}

/** وصف آمن للسجلات: `host#<أول 8 hex من SHA-256 للـ endpoint>`. */
export async function endpointLabel(endpoint: string): Promise<string> {
  let host = 'invalid';
  try {
    host = new URL(endpoint).hostname || 'invalid';
  } catch {
    // يبقى invalid
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)),
  );
  const hex = [...digest.subarray(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${host}#${hex}`;
}

// customer_cancelled (T44، SPEC-admin-push §1): الموظف قد يكون يحضّر الطلب الآن. new_order للوحة أيضاً (نفس النوع).
const HIGH_URGENCY_TYPES = new Set([
  'new_order',
  'ready',
  'assigned',
  'unassigned',
  'customer_cancelled',
]);

/** high: إشعارات السائق (طلب جديد/جاهز/تعيين)، "جاهز" للزبون، وإلغاء الزبون للوحة؛ وإلا normal. */
export function urgencyFor(data: Record<string, unknown>): 'high' | 'normal' {
  if (typeof data.type === 'string' && HIGH_URGENCY_TYPES.has(data.type)) return 'high';
  if (data.status === 'ready') return 'high';
  return 'normal';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Topic لاستبدال إشعار نفس الطلب غير المسلَّم. RFC 8030 يحدّه بـ 32 حرفاً من أبجدية base64url،
 * و`order-<uuid>` (42) يتجاوزه فترفضه بعض الخدمات: نستعمل الـ UUID بلا شرطات (32 حرفاً بالضبط).
 */
export function topicFor(data: Record<string, unknown>): string | null {
  const id = data.order_id;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  return id.replaceAll('-', '').toLowerCase();
}

/** Retry-After (ثوانٍ أو تاريخ HTTP) ← ميلي ثانية من الآن، بحد أقصى ساعة. قيمة غير صالحة ← null. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const v = value.trim();
  let ms: number;
  if (/^\d+$/.test(v)) ms = Number(v) * 1000;
  else {
    const at = Date.parse(v);
    if (!/[a-z]/i.test(v) || Number.isNaN(at)) return null;
    ms = Math.max(0, at - nowMs);
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

export interface WebPushSenderOptions {
  publicKey: string;
  privateKey: string;
  subject: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  concurrency?: number;
  /** ميلي ثانية (للاختبار). */
  now?: () => number;
  /** سجل الإخفاقات: لا يُمرَّر له إلا المضيف + مقطع الهاش. */
  log?: (msg: string, extra?: unknown) => void;
}

/**
 * المرسِل من متغيرات البيئة: أي من VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT غائب أو فارغ ← null
 * (لا استثناء؛ dispatch يتخطى رموز webpush بملاحظة). مفاتيح تالفة تظهر كفشل دائم عند أول إرسال.
 */
export function webPushSenderFromEnv(
  env: (name: string) => string | undefined,
  extra: Omit<WebPushSenderOptions, 'publicKey' | 'privateKey' | 'subject'> = {},
): Sender | null {
  const publicKey = env('VAPID_PUBLIC_KEY')?.trim();
  const privateKey = env('VAPID_PRIVATE_KEY')?.trim();
  const subject = env('VAPID_SUBJECT')?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return createWebPushSender({ publicKey, privateKey, subject, ...extra });
}

const fail = (error: string): SendOutcome => ({ status: 'failed', error });
const transient = (error: string): SendOutcome => ({ status: 'error', error });

export function createWebPushSender(options: WebPushSenderOptions): Sender {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEBPUSH_TIMEOUT_MS;
  const concurrency = Math.max(1, options.concurrency ?? WEBPUSH_CONCURRENCY);
  const now = options.now ?? Date.now;
  const encoder = new TextEncoder();

  let keys: Promise<VapidKeys | null> | null = null;
  const vapidKeys = () =>
    (keys ??= importVapidKeys(options.publicKey, options.privateKey).catch(() => null));

  // الوعد نفسه يُخزَّن، فالطلبات المتزامنة لنفس الخدمة تشترك بتوقيع واحد
  const jwtCache = new Map<string, { header: Promise<string>; createdSec: number }>();
  function authorization(vk: VapidKeys, audience: string): Promise<string> {
    const nowSec = Math.floor(now() / 1000);
    const cached = jwtCache.get(audience);
    if (cached && nowSec - cached.createdSec < JWT_REUSE_SECONDS) return cached.header;
    const header = vapidAuthorization(vk, audience, options.subject, nowSec);
    jwtCache.set(audience, { header, createdSec: nowSec });
    header.catch(() => jwtCache.delete(audience));
    return header;
  }

  /** مضيف ← وقت انتهاء Retry-After (ms). يعيش بعمر الـ sender (الـ isolate). */
  const blockedUntil = new Map<string, number>();

  async function sendOne(m: PushMessage, vk: VapidKeys): Promise<SendOutcome> {
    if (!isAllowedEndpoint(m.to)) return fail('webpush: endpoint not allowed');
    const url = new URL(m.to);
    const host = url.hostname;

    const until = blockedUntil.get(host);
    if (until !== undefined) {
      if (now() < until) {
        const s = Math.ceil((until - now()) / 1000);
        return transient(`webpush: rate limited by ${host} (retry after ${s}s)`);
      }
      blockedUntil.delete(host);
    }

    if (!m.keys || typeof m.keys.p256dh !== 'string' || typeof m.keys.auth !== 'string') {
      return fail('webpush: missing subscription keys');
    }
    const payload = encoder.encode(JSON.stringify({ title: m.title, body: m.body, data: m.data }));
    if (payload.length > WEBPUSH_MAX_PAYLOAD_BYTES) return fail('webpush: payload too large');

    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await encryptPayload(payload, m.keys.p256dh, m.keys.auth);
    } catch {
      return fail('webpush: invalid subscription keys');
    }

    const headers: Record<string, string> = {
      Authorization: await authorization(vk, url.origin),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(WEBPUSH_TTL_SECONDS),
      Urgency: urgencyFor(m.data),
    };
    const topic = topicFor(m.data);
    if (topic) headers.Topic = topic;

    let res: Response;
    try {
      res = await doFetch(m.to, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // رسالة الخطأ الأصلية قد تحوي الـ URL: لا تُنقل أبداً
      const name = e instanceof Error ? e.name : '';
      return transient(
        name === 'TimeoutError' || name === 'AbortError'
          ? `webpush: timeout (${host})`
          : `webpush: network error (${host})`,
      );
    }
    await res.body?.cancel().catch(() => {});

    const status = res.status;
    if (status >= 200 && status < 300) return { status: 'ok' };
    if (status === 404 || status === 410) {
      return { status: 'dead', error: `webpush: HTTP ${status} (subscription gone)` };
    }
    if (status === 429 || status >= 500) {
      const wait = parseRetryAfter(res.headers.get('retry-after'), now());
      let note = '';
      if (wait !== null && wait > 0) {
        blockedUntil.set(host, now() + wait);
        note = `, retry after ${Math.ceil(wait / 1000)}s`;
      }
      return transient(`webpush: HTTP ${status} (${host}${note})`);
    }
    return fail(`webpush: HTTP ${status} (${host})`);
  }

  return async (messages) => {
    const out: SendOutcome[] = new Array(messages.length);
    const vk = await vapidKeys();
    if (!vk) return messages.map(() => fail('webpush: invalid VAPID key pair (check secrets)'));

    let next = 0;
    async function worker() {
      while (next < messages.length) {
        const i = next++;
        const m = messages[i] as PushMessage;
        let o: SendOutcome;
        try {
          o = await sendOne(m, vk as VapidKeys);
        } catch {
          o = transient('webpush: unexpected error');
        }
        out[i] = o;
        if (o.status !== 'ok' && options.log) {
          options.log('webpush send', {
            endpoint: await endpointLabel(m.to),
            outcome: o.status,
            error: o.error,
          });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, messages.length) }, worker));
    return out;
  };
}
