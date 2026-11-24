// Web Push للوحة الأدمن (T44، SPEC-admin-push §2 و§4): نفس متحكم createWebPush الذي يستعمله السائق والزبون
// (packages/shared/src/webPush.ts) فوق التخزين المشفَّر (webSecureStorage)، والمفتاح العام من دالة push-config وقت
// التشغيل (أو NEXT_PUBLIC_VAPID_PUBLIC_KEY إن ضُبط بالبناء). لا يلمس أي API متصفح عند الاستيراد.
// قواعد: الإذن يُطلب من لمسة فقط (enableDevicePush)؛ التسجيل الصامت لا يشترك من جديد أبداً (من أطفأ يبقى مطفأ)؛
// الـ endpoint سر: لا يُطبع ولا يُخزَّن إلا للحذف المؤجَّل مشفَّراً.
import {
  createWebPush,
  createWebSecureStorage,
  iosVersion,
  isIosDevice,
  type MukhdarClient,
  type WebPushController,
  type WebPushRegisterResult,
  type WebPushState,
  type WebPushStorage,
} from '@mukhdar/shared';

export const PENDING_DELETE_KEY = 'mukhdar.admin.pushPendingDelete';
export const SNOOZE_KEY = 'mukhdar.admin.pushSnoozeUntil';
const PUBLIC_KEY_SHAPE = /^B[A-Za-z0-9_-]{86}$/;
const MIN_IOS: [number, number] = [16, 4];

export type DeviceAlertState = WebPushState | 'not-configured' | 'ios-too-old';

export interface DeviceEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.standalone أو display-mode: standalone */
  standalone: boolean;
}

/** iPhone/iPad: الإشعارات للوحة المضافة للشاشة الرئيسية فقط (16.4+). غير iOS ← ok. */
export function iosPushGate(env: DeviceEnv): 'ok' | 'needs-install' | 'too-old' {
  if (!isIosDevice(env.userAgent, env.maxTouchPoints)) return 'ok';
  const v = iosVersion(env.userAgent);
  if (v && (v[0] < MIN_IOS[0] || (v[0] === MIN_IOS[0] && v[1] < MIN_IOS[1]))) return 'too-old';
  return env.standalone ? 'ok' : 'needs-install';
}

/**
 * مفتاح "نفس الحساب ونفس الجلسة" للتسجيل الصامت (R3 L4): الإرسال للأدمن/الموظف مربوط بجلسته (T23 F H1)، فدخول جديد
 * (جلسة جديدة) يُسجَّل فوراً ولا يُتخطى. من حمولة رمز الوصول (sub + session_id)؛ بلا تحقق توقيع (للتخطي فقط).
 */
export function sessionKey(accessToken: string | null | undefined): string | null {
  const part = accessToken?.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as {
      sub?: unknown;
      session_id?: unknown;
    };
    return typeof json.sub === 'string' && typeof json.session_id === 'string'
      ? `${json.sub}:${json.session_id}`
      : null;
  } catch {
    return null;
  }
}

/** المفتاح العام: متغير البناء إن وُجد، وإلا push-config. شكل غير صالح ← null (لا اشتراك بمفتاح تالف). */
export async function fetchVapidPublicKey(
  client: Pick<MukhdarClient, 'functions'>,
  buildValue: string | undefined = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
): Promise<string | null> {
  if (buildValue) return PUBLIC_KEY_SHAPE.test(buildValue) ? buildValue : null;
  try {
    const { data, error } = await client.functions.invoke<{ vapid_public_key?: unknown }>(
      'push-config',
      { method: 'POST' },
    );
    const key = error ? null : data?.vapid_public_key;
    return typeof key === 'string' && PUBLIC_KEY_SHAPE.test(key) ? key : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- المتصفح (يُستدعى من مكوّنات العميل فقط)

let storage: WebPushStorage | null = null;
let controller: WebPushController | null = null;
let keyRequest: Promise<string | null> | null = null;

function secure(): WebPushStorage {
  storage ??= createWebSecureStorage();
  return storage;
}

function deviceEnv(): DeviceEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone:
      nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
  };
}

function browserSupportsPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function getController(client: MukhdarClient): Promise<WebPushController | null> {
  if (controller) return controller;
  keyRequest ??= fetchVapidPublicKey(client);
  const key = await keyRequest;
  if (!key) {
    keyRequest = null; // تُعاد المحاولة بالمرة القادمة (شبكة، دالة لم تُنشر بعد)
    return null;
  }
  controller ??= createWebPush({
    vapidPublicKey: key,
    storage: secure(),
    pendingKey: PENDING_DELETE_KEY,
    snoozeKey: SNOOZE_KEY,
  });
  return controller;
}

async function currentSessionKey(client: MukhdarClient): Promise<string | null> {
  try {
    return sessionKey((await client.auth.getSession()).data.session?.access_token);
  } catch {
    return null;
  }
}

/** اشتراك موجود بهذا المتصفح (بلا تسجيل SW جديد). */
async function hasExistingSubscription(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    return (await reg?.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}

export async function readDeviceAlertState(client: MukhdarClient): Promise<DeviceAlertState> {
  const gate = iosPushGate(deviceEnv());
  if (gate === 'too-old') return 'ios-too-old';
  if (gate === 'needs-install') return 'needs-install';
  if (!browserSupportsPush()) return 'unsupported';
  const ctrl = await getController(client);
  if (!ctrl) return 'not-configured';
  return ctrl.getState(false);
}

/** زر "شغّل الإشعارات" (لمسة مستخدم: وحدها تطلب الإذن). */
export async function enableDevicePush(
  client: MukhdarClient,
): Promise<WebPushRegisterResult | 'not-configured'> {
  const ctrl = await getController(client);
  if (!ctrl) return 'not-configured';
  return ctrl.register(client, { ask: true, userId: await currentSessionKey(client) });
}

/** "أطفئ الإشعارات" وتسجيل الخروج: حذف الصف ← unsubscribe (حذف مؤجَّل بلا شبكة). لا يرمي ولا يحتاج المفتاح. */
export async function disableDevicePush(client: MukhdarClient): Promise<void> {
  try {
    const ctrl =
      controller ??
      createWebPush({
        vapidPublicKey: undefined,
        storage: secure(),
        pendingKey: PENDING_DELETE_KEY,
        snoozeKey: SNOOZE_KEY,
      });
    await ctrl.remove(client);
  } catch {
    // الخروج لا يتعطل بسبب الإشعارات
  }
}

/**
 * عند فتح اللوحة ورجوع التبويب: إعادة ربط اشتراك **موجود** بالجلسة الحالية، وإعادة حذف مؤجَّل. لا يشترك من جديد
 * ولا يطلب إذناً أبداً. يرجع true إن صار الجهاز مسجَّلاً.
 */
export async function silentReregister(client: MukhdarClient): Promise<boolean> {
  try {
    if (iosPushGate(deviceEnv()) !== 'ok' || !browserSupportsPush()) return false;
    const ctrl = await getController(client);
    if (!ctrl) return false;
    await ctrl.retryPending(client);
    if (Notification.permission !== 'granted' || !(await hasExistingSubscription())) return false;
    return (
      (await ctrl.register(client, { ask: false, userId: await currentSessionKey(client) })) ===
      'registered'
    );
  } catch {
    return false;
  }
}
