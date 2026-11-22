// الإشعارات (SPEC-driver §2.11): التسجيل، الحذف قبل الخروج، التوجيه حسب data.type.
import * as Notifications from 'expo-notifications';
import { routeForNotification } from '../features/notifications/routing';
import { getPermissionState, registerPushToken, unregisterPushToken } from '../lib/push';
import { createFakeSupabase, opArgs, type Call } from '../test-utils/fakeSupabase';

jest.mock('expo-device', () => ({ __esModule: true, isDevice: true }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: 'proj-1' } } },
    executionEnvironment: 'bare',
  },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

const UUID = '11111111-2222-4333-8444-555555555555';
const perm = (status: string) =>
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status } as never);
const token = (data: string) =>
  jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({ data } as never);

describe('routeForNotification (data.type)', () => {
  it.each([
    [{ type: 'new_order', order_id: UUID }, '/'],
    [{ type: 'ready', order_id: UUID }, `/order/${UUID}`],
    [{ type: 'assigned', order_id: UUID }, `/order/${UUID}`],
    [{ type: 'unassigned', order_id: UUID }, '/my-orders'],
    [{ type: 'cancelled', order_id: UUID, status: 'cancelled' }, '/my-orders'],
    [{ type: 'driver_request_approved' }, '/auth/pending'],
    // T42: تسليم الكاش ← سجل اليوم (لا يحتاج order_id)
    [{ type: 'cash_handover', handover_id: UUID }, '/today'],
    [{ type: 'cash_handover' }, '/today'],
  ])('%j -> %s', (data, route) => {
    expect(routeForNotification(data)).toBe(route);
  });
  it('unknown type, bad id, or junk -> null (no navigation)', () => {
    expect(routeForNotification({ type: 'weird' })).toBeNull();
    expect(routeForNotification({ type: 'ready', order_id: 'not-a-uuid' })).toBeNull();
    expect(routeForNotification(null)).toBeNull();
    expect(routeForNotification('x')).toBeNull();
  });
});

describe('registerPushToken', () => {
  beforeEach(() => token('ExponentPushToken[abc]'));

  it('granted: register_push_token(token, platform, expo)', async () => {
    perm('granted');
    const { client, calls } = createFakeSupabase(() => ({ data: null, error: null }));
    expect(await registerPushToken(client as never, { ask: false })).toBe('registered');
    const c = calls.find((x) => x.table === 'rpc:register_push_token') as Call;
    expect(opArgs(c, 'rpc')).toEqual([
      {
        p_token: 'ExponentPushToken[abc]',
        p_platform: expect.stringMatching(/^(ios|android)$/),
        p_provider: 'expo',
      },
    ]);
  });

  it('not granted and ask=false: no prompt, no registration', async () => {
    perm('undetermined');
    const { client, calls } = createFakeSupabase(() => ({ data: null, error: null }));
    expect(await registerPushToken(client as never, { ask: false })).toBe('denied');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('PIN_CHANGE_REQUIRED is reported, not thrown (register after the PIN change)', async () => {
    perm('granted');
    const { client } = createFakeSupabase(() => ({
      data: null,
      error: { message: 'PIN_CHANGE_REQUIRED', code: '42501' },
    }));
    expect(await registerPushToken(client as never, { ask: false })).toBe('pin-required');
  });

  it('other server error -> failed', async () => {
    perm('granted');
    const { client } = createFakeSupabase(() => ({ data: null, error: { message: 'boom' } }));
    expect(await registerPushToken(client as never, { ask: false })).toBe('failed');
  });

  it('permission state for the banner', async () => {
    perm('denied');
    expect(await getPermissionState()).toBe('denied');
    perm('granted');
    expect(await getPermissionState()).toBe('granted');
  });
});

describe('unregisterPushToken', () => {
  async function remember() {
    perm('granted');
    token('ExponentPushToken[abc]');
    const a = createFakeSupabase(() => ({ data: null, error: null }));
    await registerPushToken(a.client as never, { ask: false });
  }

  it('deletes this device row by token; a second call has nothing to delete', async () => {
    await remember();
    const b = createFakeSupabase(() => ({ data: null, error: null }));
    expect(await unregisterPushToken(b.client as never)).toBe(true);
    expect(b.calls[0]?.table).toBe('push_tokens');
    expect(b.calls[0]?.ops.map(([n]) => n)).toContain('delete');
    expect(opArgs(b.calls[0] as Call, 'eq')).toEqual(['token', 'ExponentPushToken[abc]']);
    const c = createFakeSupabase(() => ({ data: null, error: null }));
    expect(await unregisterPushToken(c.client as never)).toBe(true);
    expect(c.calls).toHaveLength(0);
  });

  it('server failure returns false (sign-out must not proceed silently)', async () => {
    await remember();
    const b = createFakeSupabase(() => ({
      data: null,
      error: { message: 'Network request failed' },
    }));
    expect(await unregisterPushToken(b.client as never)).toBe(false);
  });
});
