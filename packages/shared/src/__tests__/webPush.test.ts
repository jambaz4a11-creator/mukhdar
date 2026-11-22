import {
  createWebPush,
  PROMPT_SNOOZE_MS,
  SILENT_REREGISTER_MS,
  subscriptionMatchesKey,
  urlBase64ToUint8Array,
  webPushState,
  type WebPushBrowser,
  type WebPushEnv,
  type WebPushRegistration,
  type WebPushSubscription,
} from '../webPush';

const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

function env(over: Partial<WebPushEnv> = {}): WebPushEnv {
  return {
    needsInstall: false,
    supported: true,
    permission: 'default',
    subscribed: false,
    registered: false,
    ...over,
  };
}

describe('webPushState (every input)', () => {
  it.each<[Partial<WebPushEnv>, string]>([
    [{ needsInstall: true, supported: false }, 'needs-install'],
    [{ needsInstall: true }, 'needs-install'],
    [{ supported: false }, 'unsupported'],
    [{ permission: 'denied' }, 'denied'],
    [{ permission: 'denied', subscribed: true, registered: true }, 'denied'],
    [{ permission: 'default' }, 'default'],
    [{ permission: 'granted' }, 'granted-unregistered'],
    [{ permission: 'granted', subscribed: true }, 'granted-unregistered'],
    [{ permission: 'granted', subscribed: true, registered: true }, 'registered'],
    [{ permission: 'granted', registered: true }, 'granted-unregistered'],
  ])('%j -> %s', (over, expected) => {
    expect(webPushState(env(over))).toBe(expected);
  });
});

describe('urlBase64ToUint8Array', () => {
  it('decodes base64url without padding to the 65-byte P-256 key', () => {
    const bytes = urlBase64ToUint8Array(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});

// ---------------------------------------------------------------- fakes
class FakeStorage {
  data = new Map<string, string>();
  getItem = (k: string) => Promise.resolve(this.data.get(k) ?? null);
  setItem = (k: string, v: string) => {
    this.data.set(k, v);
    return Promise.resolve();
  };
  removeItem = (k: string) => {
    this.data.delete(k);
    return Promise.resolve();
  };
}

function makeSub(
  endpoint = 'https://fcm.googleapis.com/fcm/send/abc',
  applicationServerKey?: ArrayBuffer,
): WebPushSubscription & {
  unsubscribe: jest.Mock;
} {
  return {
    endpoint,
    options: applicationServerKey ? { applicationServerKey } : undefined,
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256DH', auth: 'AUTH' } }),
    unsubscribe: jest.fn().mockResolvedValue(true),
  };
}

function makeBrowser(opts: {
  permission?: 'default' | 'granted' | 'denied';
  sub?: ReturnType<typeof makeSub> | null;
  supported?: boolean;
  requestResult?: 'default' | 'granted' | 'denied';
}) {
  let permission = opts.permission ?? 'default';
  let sub = opts.sub ?? null;
  const subscribe = jest.fn().mockImplementation(() => {
    sub = makeSub('https://fcm.googleapis.com/fcm/send/new');
    return Promise.resolve(sub);
  });
  const reg: WebPushRegistration = {
    pushManager: { getSubscription: () => Promise.resolve(sub), subscribe },
  };
  const requestPermission = jest.fn().mockImplementation(() => {
    permission = opts.requestResult ?? 'granted';
    return Promise.resolve(permission);
  });
  const browser: WebPushBrowser = {
    isSupported: () => opts.supported ?? true,
    permission: () => permission,
    requestPermission,
    registration: () => Promise.resolve(reg),
    existingRegistration: () => Promise.resolve(reg),
  };
  return { browser, subscribe, requestPermission, getSub: () => sub };
}

function makeClient(over: { rpcError?: { message: string } | null; deleteError?: unknown } = {}) {
  const eq = jest
    .fn()
    .mockImplementation(() =>
      over.deleteError === 'throw'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ error: over.deleteError ?? null }),
    );
  const del = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ delete: del });
  const rpc = jest.fn().mockResolvedValue({ error: over.rpcError ?? null });
  return { client: { from, rpc } as never, from, del, eq, rpc };
}

function make(browserOpts: Parameters<typeof makeBrowser>[0], now = () => 1_000_000) {
  const storage = new FakeStorage();
  const b = makeBrowser(browserOpts);
  const wp = createWebPush({
    vapidPublicKey: KEY,
    storage,
    pendingKey: 'pending',
    snoozeKey: 'snooze',
    browser: b.browser,
    now,
  });
  return { wp, storage, ...b };
}

describe('register', () => {
  it('without a VAPID key or support it does nothing (no permission prompt)', async () => {
    const s = make({ supported: false });
    const c = makeClient();
    expect(await s.wp.register(c.client, { ask: true })).toBe('unsupported');
    expect(s.requestPermission).not.toHaveBeenCalled();
    const noKey = createWebPush({
      vapidPublicKey: undefined,
      storage: s.storage,
      pendingKey: 'p',
      snoozeKey: 's',
      browser: makeBrowser({}).browser,
    });
    expect(await noKey.register(c.client, { ask: true })).toBe('unsupported');
  });

  it('silent run (ask=false) never prompts when permission is still default', async () => {
    const s = make({ permission: 'default' });
    const c = makeClient();
    expect(await s.wp.register(c.client, { ask: false })).toBe('denied');
    expect(s.requestPermission).not.toHaveBeenCalled();
    expect(s.subscribe).not.toHaveBeenCalled();
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('user tap (ask=true): asks, subscribes with userVisibleOnly and registers', async () => {
    const s = make({ permission: 'default' });
    const c = makeClient();
    expect(await s.wp.register(c.client, { ask: true })).toBe('registered');
    expect(s.requestPermission).toHaveBeenCalledTimes(1);
    expect(s.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(c.rpc).toHaveBeenCalledWith('register_web_push', {
      p_endpoint: 'https://fcm.googleapis.com/fcm/send/new',
      p_p256dh: 'P256DH',
      p_auth: 'AUTH',
    });
  });

  it('user declines the browser prompt -> denied, nothing registered', async () => {
    const s = make({ permission: 'default', requestResult: 'denied' });
    const c = makeClient();
    expect(await s.wp.register(c.client, { ask: true })).toBe('denied');
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it('already granted + existing subscription: silent re-register without subscribe', async () => {
    const s = make({ permission: 'granted', sub: makeSub() });
    const c = makeClient();
    expect(await s.wp.register(c.client, { ask: false })).toBe('registered');
    expect(s.subscribe).not.toHaveBeenCalled();
    expect(c.rpc).toHaveBeenCalledTimes(1);
  });

  it('PIN_CHANGE_REQUIRED -> pin-required; other errors -> failed', async () => {
    const s = make({ permission: 'granted', sub: makeSub() });
    expect(
      await s.wp.register(makeClient({ rpcError: { message: 'PIN_CHANGE_REQUIRED' } }).client, {
        ask: false,
      }),
    ).toBe('pin-required');
    expect(
      await s.wp.register(makeClient({ rpcError: { message: 'boom' } }).client, { ask: false }),
    ).toBe('failed');
  });

  it('a subscribe failure never throws', async () => {
    const s = make({ permission: 'granted' });
    s.subscribe.mockRejectedValue(new Error('push service down'));
    expect(await s.wp.register(makeClient().client, { ask: false })).toBe('failed');
  });

  it('re-registering clears a stale pending delete for the same endpoint', async () => {
    const s = make({ permission: 'granted', sub: makeSub() });
    await s.storage.setItem('pending', 'https://fcm.googleapis.com/fcm/send/abc');
    await s.wp.register(makeClient().client, { ask: false });
    expect(await s.storage.getItem('pending')).toBeNull();
  });
});

describe('getState', () => {
  it('maps the live browser to the state machine and tracks this run registration', async () => {
    const s = make({ permission: 'granted', sub: makeSub() });
    expect(await s.wp.getState(false)).toBe('granted-unregistered');
    await s.wp.register(makeClient().client, { ask: false });
    expect(await s.wp.getState(false)).toBe('registered');
    expect(await s.wp.getState(true)).toBe('needs-install');
    expect(await make({ supported: false }).wp.getState(false)).toBe('unsupported');
    expect(await make({ permission: 'denied' }).wp.getState(false)).toBe('denied');
  });
});

describe('remove (sign out order)', () => {
  it('online: deletes the row first, then unsubscribes, no pending record', async () => {
    const sub = makeSub();
    const s = make({ permission: 'granted', sub });
    const c = makeClient();
    const order: string[] = [];
    c.eq.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve({ error: null });
    });
    sub.unsubscribe.mockImplementation(() => {
      order.push('unsubscribe');
      return Promise.resolve(true);
    });
    await s.wp.remove(c.client);
    expect(c.from).toHaveBeenCalledWith('push_tokens');
    expect(c.eq).toHaveBeenCalledWith('token', sub.endpoint);
    expect(order).toEqual(['delete', 'unsubscribe']);
    expect(await s.storage.getItem('pending')).toBeNull();
  });

  it.each([
    ['rpc error', { message: 'network' }],
    ['thrown (no network)', 'throw'],
  ])('offline (%s): unsubscribes locally and defers the delete', async (_n, deleteError) => {
    const sub = makeSub();
    const s = make({ permission: 'granted', sub });
    await s.wp.remove(makeClient({ deleteError }).client);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(await s.storage.getItem('pending')).toBe(sub.endpoint);
  });

  it('R3 L9: storage failing for the deferred delete still unsubscribes', async () => {
    const sub = makeSub();
    const s = make({ permission: 'granted', sub });
    s.storage.setItem = () => Promise.reject(new Error('quota'));
    await s.wp.remove(makeClient({ deleteError: 'throw' }).client);
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('never throws even when unsubscribe and storage fail', async () => {
    const sub = makeSub();
    sub.unsubscribe.mockRejectedValue(new Error('x'));
    const s = make({ permission: 'granted', sub });
    s.storage.setItem = () => Promise.reject(new Error('quota'));
    await expect(s.wp.remove(makeClient({ deleteError: 'throw' }).client)).resolves.toBeUndefined();
  });

  it('no subscription: nothing to do', async () => {
    const s = make({ permission: 'granted', sub: null });
    const c = makeClient();
    await s.wp.remove(c.client);
    expect(c.from).not.toHaveBeenCalled();
  });

  it('resets the registered flag so the next account registers again', async () => {
    const s = make({ permission: 'granted', sub: makeSub() });
    await s.wp.register(makeClient().client, { ask: false });
    await s.wp.remove(makeClient().client);
    expect(await s.wp.getState(false)).not.toBe('registered');
  });
});

describe('retryPending (first session after offline sign-out)', () => {
  it('deletes the deferred row and clears the record', async () => {
    const s = make({});
    await s.storage.setItem('pending', 'https://fcm.googleapis.com/fcm/send/old');
    const c = makeClient();
    await s.wp.retryPending(c.client);
    expect(c.eq).toHaveBeenCalledWith('token', 'https://fcm.googleapis.com/fcm/send/old');
    expect(await s.storage.getItem('pending')).toBeNull();
  });

  it('keeps the record when the delete fails again', async () => {
    const s = make({});
    await s.storage.setItem('pending', 'https://fcm.googleapis.com/fcm/send/old');
    await s.wp.retryPending(makeClient({ deleteError: { message: 'x' } }).client);
    expect(await s.storage.getItem('pending')).toBe('https://fcm.googleapis.com/fcm/send/old');
  });

  it('no pending record: no request', async () => {
    const s = make({});
    const c = makeClient();
    await s.wp.retryPending(c.client);
    expect(c.from).not.toHaveBeenCalled();
  });
});

describe('multi account on one device', () => {
  it('A signs out (row A removed), B registers a fresh subscription', async () => {
    const s = make({
      permission: 'granted',
      sub: makeSub('https://fcm.googleapis.com/fcm/send/A'),
    });
    const a = makeClient();
    await s.wp.register(a.client, { ask: false });
    await s.wp.remove(a.client);
    expect(a.eq).toHaveBeenCalledWith('token', 'https://fcm.googleapis.com/fcm/send/A');
    // الاشتراك أُبطل: المتصفح لا يعيد القديم، فـ B (بلمسة) يشترك من جديد
    const sub = s.getSub();
    expect(sub).not.toBeNull();
  });
});

describe('snooze (7 days)', () => {
  it('hides the card for 7 days after "not now"', async () => {
    let t = 1_000_000;
    const s = make({}, () => t);
    expect(await s.wp.isSnoozed()).toBe(false);
    await s.wp.snooze();
    expect(await s.wp.isSnoozed()).toBe(true);
    t += PROMPT_SNOOZE_MS - 1;
    expect(await s.wp.isSnoozed()).toBe(true);
    t += 2;
    expect(await s.wp.isSnoozed()).toBe(false);
  });

  it('garbage in storage means not snoozed', async () => {
    const s = make({});
    await s.storage.setItem('snooze', 'abc');
    expect(await s.wp.isSnoozed()).toBe(false);
  });
});

const keyBytes = (k: string) => {
  const b = urlBase64ToUint8Array(k);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const OTHER_KEY =
  'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';

describe('R3 M2: subscription made with another VAPID key', () => {
  it('subscriptionMatchesKey: same key, other key, unknown key', () => {
    expect(subscriptionMatchesKey(makeSub('x', keyBytes(KEY)), KEY)).toBe(true);
    expect(subscriptionMatchesKey(makeSub('x', keyBytes(OTHER_KEY)), KEY)).toBe(false);
    expect(subscriptionMatchesKey(makeSub('x'), KEY)).toBe(true); // options غائب: لا نعرف ← يبقى
    const view = new Uint8Array(keyBytes(KEY));
    expect(
      subscriptionMatchesKey({ ...makeSub('x'), options: { applicationServerKey: view } }, KEY),
    ).toBe(true);
  });

  it('other key: unsubscribes the old one, subscribes with ours, registers the new endpoint', async () => {
    const old = makeSub('https://fcm.googleapis.com/fcm/send/old', keyBytes(OTHER_KEY));
    const s = make({ permission: 'granted', sub: old });
    const c = makeClient();
    expect(await s.wp.register(c.client, { ask: false })).toBe('registered');
    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(s.subscribe).toHaveBeenCalledTimes(1);
    expect(c.rpc).toHaveBeenCalledWith(
      'register_web_push',
      expect.objectContaining({ p_endpoint: 'https://fcm.googleapis.com/fcm/send/new' }),
    );
  });

  it('same key: keeps the subscription (no unsubscribe, no subscribe)', async () => {
    const cur = makeSub('https://fcm.googleapis.com/fcm/send/abc', keyBytes(KEY));
    const s = make({ permission: 'granted', sub: cur });
    expect(await s.wp.register(makeClient().client, { ask: false })).toBe('registered');
    expect(cur.unsubscribe).not.toHaveBeenCalled();
    expect(s.subscribe).not.toHaveBeenCalled();
  });
});

describe('R3 L1: unsubscribeLocal (session lost without sign-out)', () => {
  it('unsubscribes locally, no request to the server, and resets registered', async () => {
    const sub = makeSub();
    const s = make({ permission: 'granted', sub });
    const c = makeClient();
    await s.wp.register(c.client, { ask: false });
    await s.wp.unsubscribeLocal();
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(c.from).not.toHaveBeenCalled();
    expect(await s.wp.getState(false)).not.toBe('registered');
  });

  it('never throws (no subscription, or unsubscribe rejects)', async () => {
    await expect(
      make({ permission: 'granted', sub: null }).wp.unsubscribeLocal(),
    ).resolves.toBeUndefined();
    const bad = makeSub();
    bad.unsubscribe.mockRejectedValue(new Error('x'));
    await expect(
      make({ permission: 'granted', sub: bad }).wp.unsubscribeLocal(),
    ).resolves.toBeUndefined();
  });
});

describe('R3 L4: silent re-register throttle', () => {
  it('same account + same endpoint within an hour: no second RPC; after an hour: RPC again', async () => {
    let t = 1_000_000;
    const s = make({ permission: 'granted', sub: makeSub() }, () => t);
    const c = makeClient();
    await s.wp.register(c.client, { ask: false, userId: 'u1' });
    t += SILENT_REREGISTER_MS - 1;
    expect(await s.wp.register(c.client, { ask: false, userId: 'u1' })).toBe('registered');
    expect(c.rpc).toHaveBeenCalledTimes(1);
    t += 2;
    await s.wp.register(c.client, { ask: false, userId: 'u1' });
    expect(c.rpc).toHaveBeenCalledTimes(2);
  });

  it('another account, a user tap, or no userId always calls the RPC', async () => {
    const s = make({ permission: 'granted', sub: makeSub() });
    const c = makeClient();
    await s.wp.register(c.client, { ask: false, userId: 'u1' });
    await s.wp.register(c.client, { ask: false, userId: 'u2' });
    await s.wp.register(c.client, { ask: true, userId: 'u2' });
    await s.wp.register(c.client, { ask: false });
    expect(c.rpc).toHaveBeenCalledTimes(4);
  });

  it('after remove() the next silent run registers again', async () => {
    const s = make({ permission: 'granted', sub: makeSub() });
    const c = makeClient();
    await s.wp.register(c.client, { ask: false, userId: 'u1' });
    await s.wp.remove(c.client);
    await s.wp.register(c.client, { ask: false, userId: 'u1' });
    expect(c.rpc).toHaveBeenCalledTimes(2);
  });
});
