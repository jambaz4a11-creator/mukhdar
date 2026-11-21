// Web Push بتطبيق السائق (T38): بطاقة التمهيد وحالات الإذن وإخفاء 7 أيام والتسجيل والخروج، على Chromium (أندرويد).
// Notification وPushManager مُحاكاة (إشعار حقيقي يدوي، T38 §8)، وSupabase كله مُعترَض بـ page.route: لا شبكة ولا كتابة.
// يحتاج بناء بـ EXPO_PUBLIC_VAPID_PUBLIC_KEY (مفتاح عام، CI يضبط قيمة وهمية)، وإلا يتخطّى.
import { expect, type Page, test } from '@playwright/test';
import { collectErrors } from './helpers';

const USER_ID = '11111111-2222-4333-8444-555555555555';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-fake-endpoint';

function fakeJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', exp: 4102444800 })}.sig`;
}

interface Seen {
  rpc: { name: string; body: unknown }[];
  deletes: string[];
}

/** يعترض Supabase كله: دخول ناجح كسائق فعّال، لا طلبات جاهزة، وتسجيل/حذف الاشتراك يُسجَّل. */
async function mockSupabase(page: Page): Promise<Seen> {
  const seen: Seen = { rpc: [], deletes: [] };
  const user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    phone: '9647000000011',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  await page.route('**/*.supabase.co/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    }
    if (url.pathname === '/auth/v1/token') {
      return json({
        access_token: fakeJwt(),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 4102444800,
        refresh_token: 'refresh-e2e',
        user,
      });
    }
    if (url.pathname === '/auth/v1/user') return json(user);
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (url.pathname === '/rest/v1/profiles') {
      return json({
        role: 'driver',
        is_active: true,
        must_change_pin: false,
        full_name: 'سائق تجريبي',
        phone: '9647000000011',
      });
    }
    if (url.pathname === '/rest/v1/rpc/available_orders') return json([]);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      seen.rpc.push({
        name: url.pathname.split('/').pop() ?? '',
        body: req.postDataJSON() as unknown,
      });
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.pathname === '/rest/v1/push_tokens' && req.method() === 'DELETE') {
      seen.deletes.push(decodeURIComponent(url.search));
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    return json({});
  });
  return seen;
}

/** Notification وPushManager مُحاكاة. permission يبدأ بقيمة الاختبار؛ العدّادات بـ window.__push. */
async function simulatePush(page: Page, permission: 'default' | 'granted' | 'denied') {
  await page.addInitScript(
    ({ initial, endpoint }) => {
      const state = { permission: initial, asked: 0, subscribed: 0, unsubscribed: 0, sub: false };
      (window as unknown as { __push: typeof state }).__push = state;
      const FakeNotification = {
        get permission() {
          return state.permission;
        },
        requestPermission() {
          state.asked += 1;
          state.permission = 'granted';
          return Promise.resolve('granted');
        },
      };
      Object.defineProperty(window, 'Notification', {
        value: FakeNotification,
        configurable: true,
      });
      const makeSub = () => ({
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-e2e', auth: 'auth-e2e' } }),
        unsubscribe: () => {
          state.unsubscribed += 1;
          state.sub = false;
          return Promise.resolve(true);
        },
      });
      const proto = (window as unknown as { PushManager: { prototype: object } }).PushManager
        .prototype as Record<string, unknown>;
      proto.getSubscription = () => Promise.resolve(state.sub ? makeSub() : null);
      proto.subscribe = () => {
        state.subscribed += 1;
        state.sub = true;
        return Promise.resolve(makeSub());
      };
    },
    { initial: permission, endpoint: ENDPOINT },
  );
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByTestId('phone-input').fill('07000000011');
  await page.getByTestId('pin-input').fill('739164');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('ready-list')).toBeVisible({ timeout: 30_000 });
}

const push = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __push: { asked: number; subscribed: number; unsubscribed: number } })
        .__push,
  );

test.describe('driver Web Push (Chromium, simulated Notification/PushManager)', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Chromium only (WebKit has no Web Push on desktop)',
  );

  test('sw.js is served, scoped to the root, never cached, and clean of fetch/cache', async ({
    request,
  }) => {
    const res = await request.get('/sw.js');
    expect(res.ok()).toBe(true);
    expect(res.headers()['cache-control']).toBe('no-cache');
    expect(res.headers()['content-type']).toMatch(/javascript/);
    const code = await res.text();
    expect(code).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(code).toContain('showNotification');
  });

  test('default: card after login, no permission request until the tap, then registered', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const seen = await mockSupabase(page);
    await simulatePush(page, 'default');
    await login(page);
    test.skip(
      !(await page.getByTestId('push-prompt').isVisible()),
      'build has no VAPID public key',
    );

    expect((await push(page)).asked).toBe(0); // لا طلب إذن عند التحميل ولا عند الدخول
    await page.getByTestId('push-enable').click();
    await expect(page.getByTestId('push-prompt')).toBeHidden();

    expect((await push(page)).asked).toBe(1);
    expect((await push(page)).subscribed).toBe(1);
    const reg = seen.rpc.find((r) => r.name === 'register_web_push');
    expect(reg?.body).toEqual({
      p_endpoint: ENDPOINT,
      p_p256dh: 'p256dh-e2e',
      p_auth: 'auth-e2e',
    });
    expect(errors).toEqual([]);
  });

  test('"not now" hides the card and it stays hidden after a reload (7 days)', async ({ page }) => {
    await mockSupabase(page);
    await simulatePush(page, 'default');
    await login(page);
    test.skip(
      !(await page.getByTestId('push-prompt').isVisible()),
      'build has no VAPID public key',
    );
    await page.getByTestId('push-later').click();
    await expect(page.getByTestId('push-prompt')).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('ready-list')).toBeVisible();
    await expect(page.getByTestId('push-prompt')).toBeHidden();
    expect((await push(page)).asked).toBe(0);
  });

  test('denied: shows the "notifications are off" bar with how to enable, no enable button', async ({
    page,
  }) => {
    await mockSupabase(page);
    await simulatePush(page, 'denied');
    await login(page);
    test.skip(
      !(await page.getByTestId('push-denied-banner').isVisible()),
      'build has no VAPID public key',
    );
    await expect(page.getByTestId('push-enable')).toHaveCount(0);
    expect((await push(page)).asked).toBe(0);
  });

  test('granted before: registers silently at startup without any prompt', async ({ page }) => {
    const seen = await mockSupabase(page);
    await simulatePush(page, 'granted');
    await login(page);
    await expect.poll(() => seen.rpc.some((r) => r.name === 'register_web_push')).toBeTruthy();
    expect((await push(page)).asked).toBe(0);
    await expect(page.getByTestId('push-prompt')).toHaveCount(0);
  });

  test('sign-out removes the subscription row first, then unsubscribes the browser', async ({
    page,
  }) => {
    const seen = await mockSupabase(page);
    await simulatePush(page, 'granted');
    await login(page);
    await expect.poll(() => seen.rpc.some((r) => r.name === 'register_web_push')).toBeTruthy();
    await page.getByRole('tab', { name: 'حسابي' }).click();
    await page.getByTestId('account-sign-out').click();
    await expect(page.getByTestId('login-submit')).toBeVisible({ timeout: 20_000 });
    expect(seen.deletes.some((q) => q.includes(`token=eq.${ENDPOINT}`))).toBe(true);
    expect((await push(page)).unsubscribed).toBe(1);
  });
});
