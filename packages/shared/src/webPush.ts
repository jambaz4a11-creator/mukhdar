// منطق Web Push بالعميل المشترك بين PWA السائق والزبون (T38، SPEC-webpush §5.2 و§5.6).
// بلا React ولا expo، ولا يلمس أي API متصفح عند الاستيراد (التطبيقات الأصلية تستورد الحزمة): كل شيء عبر `browser`
// المحقون (`defaultWebPushBrowser()` يبنيه من `navigator`/`Notification` وقت الاستدعاء).
// قواعد: لا طلب إذن إلا بـ `register(..., {ask: true})` من لمسة مستخدم؛ الـ endpoint سر (لا يُسجَّل ولا يُطبع) ولا
// يُخزَّن إلا عند تأجيل حذفه بلا شبكة، ومشفَّراً عبر `storage`.
import type { MukhdarClient } from './supabase';

export type WebPushState =
  'unsupported' | 'needs-install' | 'default' | 'denied' | 'granted-unregistered' | 'registered';

export type WebPushPermission = 'default' | 'granted' | 'denied';

export interface WebPushEnv {
  /** iOS خارج الـ PWA المثبَّت (الإشعارات تعمل بعد التثبيت فقط، SPEC-webpush §3.2) */
  needsInstall: boolean;
  /** serviceWorker + PushManager + Notification موجودة */
  supported: boolean;
  permission: WebPushPermission;
  /** `pushManager.getSubscription()` يرجع اشتراكاً */
  subscribed: boolean;
  /** سُجّل هذا الاشتراك بالخادم خلال هذا التشغيل */
  registered: boolean;
}

/** آلة الحالات (§5.6). `denied` تغلب كل شيء بعد التثبيت؛ `needs-install` تغلب `unsupported` (سفاري بتبويب بلا PushManager). */
export function webPushState(env: WebPushEnv): WebPushState {
  if (env.needsInstall) return 'needs-install';
  if (!env.supported) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  if (env.permission === 'default') return 'default';
  return env.subscribed && env.registered ? 'registered' : 'granted-unregistered';
}

/** مفتاح VAPID العام (base64url بلا حشو) ← بايتات `applicationServerKey`. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface WebPushSubscription {
  endpoint: string;
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  unsubscribe(): Promise<boolean>;
}

export interface WebPushRegistration {
  pushManager: {
    getSubscription(): Promise<WebPushSubscription | null>;
    subscribe(options: {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    }): Promise<WebPushSubscription>;
  };
}

export interface WebPushBrowser {
  isSupported(): boolean;
  permission(): WebPushPermission;
  requestPermission(): Promise<WebPushPermission>;
  /** يسجّل `/sw.js` إن لزم وينتظر جاهزيته. */
  registration(): Promise<WebPushRegistration | null>;
  /** التسجيل الحالي فقط (للخروج: لا نسجّل SW جديداً أثناء الخروج). */
  existingRegistration(): Promise<WebPushRegistration | null>;
}

export interface WebPushStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type WebPushRegisterResult =
  'registered' | 'unsupported' | 'denied' | 'pin-required' | 'failed';

/** "مو هسه" يخفي بطاقة التمهيد 7 أيام. */
export const PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

interface BrowserGlobals {
  navigator?: {
    serviceWorker?: {
      register(url: string, o?: { scope?: string }): Promise<unknown>;
      ready: Promise<unknown>;
      getRegistration(): Promise<unknown>;
    };
  };
  Notification?: {
    permission: string;
    requestPermission(): Promise<string>;
  };
  PushManager?: unknown;
}

function asPermission(p: string): WebPushPermission {
  return p === 'granted' || p === 'denied' ? p : 'default';
}

export function defaultWebPushBrowser(): WebPushBrowser {
  const g = globalThis as unknown as BrowserGlobals;
  const sw = () => g.navigator?.serviceWorker;
  return {
    isSupported: () => !!sw() && g.PushManager !== undefined && !!g.Notification,
    permission: () => asPermission(g.Notification?.permission ?? 'default'),
    requestPermission: async () =>
      asPermission((await g.Notification?.requestPermission()) ?? 'default'),
    registration: async () => {
      const container = sw();
      if (!container) return null;
      await container.register('/sw.js', { scope: '/' });
      return (await container.ready) as WebPushRegistration;
    },
    existingRegistration: async () => {
      const container = sw();
      if (!container) return null;
      return ((await container.getRegistration()) as WebPushRegistration | undefined) ?? null;
    },
  };
}

export interface WebPushConfig {
  /** `EXPO_PUBLIC_VAPID_PUBLIC_KEY` (عام). غير مضبوط ← كل شيء `unsupported`. */
  vapidPublicKey: string | undefined;
  /** تخزين الويب المشفَّر (secureStorage.web) */
  storage: WebPushStorage;
  /** حذف مؤجَّل لاشتراك خرج صاحبه بلا شبكة */
  pendingKey: string;
  snoozeKey: string;
  browser?: WebPushBrowser;
  now?: () => number;
}

export interface WebPushController {
  getState(needsInstall: boolean): Promise<WebPushState>;
  register(client: MukhdarClient, opts: { ask: boolean }): Promise<WebPushRegisterResult>;
  /** للخروج: حذف الصف ← unsubscribe. لا يرمي أبداً. */
  remove(client: MukhdarClient): Promise<void>;
  retryPending(client: MukhdarClient): Promise<void>;
  isSnoozed(): Promise<boolean>;
  snooze(): Promise<void>;
}

export function createWebPush(config: WebPushConfig): WebPushController {
  const browser = config.browser ?? defaultWebPushBrowser();
  const now = config.now ?? (() => Date.now());
  const { storage, pendingKey, snoozeKey } = config;
  let registered = false;

  async function currentSubscription(
    existingOnly: boolean,
  ): Promise<{ reg: WebPushRegistration; sub: WebPushSubscription | null } | null> {
    try {
      const reg = existingOnly
        ? await browser.existingRegistration()
        : await browser.registration();
      if (!reg) return null;
      return { reg, sub: await reg.pushManager.getSubscription() };
    } catch {
      return null;
    }
  }

  async function deleteRow(client: MukhdarClient, endpoint: string): Promise<boolean> {
    try {
      const { error } = await client.from('push_tokens').delete().eq('token', endpoint);
      return !error;
    } catch {
      return false;
    }
  }

  return {
    async getState(needsInstall) {
      const supported = browser.isSupported();
      let subscribed = false;
      if (supported && !needsInstall && browser.permission() === 'granted') {
        subscribed = (await currentSubscription(true))?.sub != null;
      }
      return webPushState({
        needsInstall,
        supported,
        permission: supported ? browser.permission() : 'default',
        subscribed,
        registered,
      });
    },

    async register(client, { ask }) {
      if (!config.vapidPublicKey || !browser.isSupported()) return 'unsupported';
      try {
        let permission = browser.permission();
        // الطلب فقط من لمسة مستخدم (ask)، ولا يُعاد عند الرفض (المتصفح لا يسمح)
        if (permission === 'default' && ask) permission = await browser.requestPermission();
        if (permission !== 'granted') return 'denied';
        const found = await currentSubscription(false);
        if (!found) return 'failed';
        const sub =
          found.sub ??
          (await found.reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
          }));
        const json = sub.toJSON();
        const p256dh = json.keys?.p256dh;
        const auth = json.keys?.auth;
        if (!p256dh || !auth) return 'failed';
        const { error } = await client.rpc('register_web_push', {
          p_endpoint: sub.endpoint,
          p_p256dh: p256dh,
          p_auth: auth,
        });
        if (error) {
          return /PIN_CHANGE_REQUIRED/.test(String(error.message)) ? 'pin-required' : 'failed';
        }
        registered = true;
        // سُجّل من جديد: حذفه المؤجَّل القديم صار خطأً (يحذف صفاً حياً)
        if ((await storage.getItem(pendingKey)) === sub.endpoint)
          await storage.removeItem(pendingKey);
        return 'registered';
      } catch {
        return 'failed';
      }
    },

    async remove(client) {
      registered = false;
      try {
        const found = await currentSubscription(true);
        const sub = found?.sub;
        if (!sub) return;
        const endpoint = sub.endpoint;
        if (!(await deleteRow(client, endpoint))) {
          try {
            await storage.setItem(pendingKey, endpoint);
          } catch {
            // الإبطال أدناه هو الضمان: الـ push service يرجّع 410 فيحذف المرسِل الصف
          }
        }
        try {
          await sub.unsubscribe();
        } catch {
          // لا شيء: الخروج لا يتعطل بسبب الإشعارات
        }
      } catch {
        // لا يرمي أبداً
      }
    },

    async retryPending(client) {
      try {
        const endpoint = await storage.getItem(pendingKey);
        if (!endpoint) return;
        // RLS تحذف صف المالك فقط: إن كان الـ endpoint لحساب آخر لا يُحذف شيء (ويُنظَّف عند 410)
        if (await deleteRow(client, endpoint)) await storage.removeItem(pendingKey);
      } catch {
        // تُعاد المحاولة عند الرجوع التالي
      }
    },

    async isSnoozed() {
      try {
        const until = Number(await storage.getItem(snoozeKey));
        return Number.isFinite(until) && until > now();
      } catch {
        return false;
      }
    },

    async snooze() {
      try {
        await storage.setItem(snoozeKey, String(now() + PROMPT_SNOOZE_MS));
      } catch {
        // الإخفاء بهذه الجلسة تتولاه الواجهة
      }
    },
  };
}
