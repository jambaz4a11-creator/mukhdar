// pnpm test:functions — مرسِل Web Push: SSRF، التصنيف، المهلة، Retry-After، التزامن، السجلات. fetch مزيف.
import assert from 'node:assert/strict';
import {
  dispatchOnce,
  type OutboxRow,
  type PushMessage,
  type RowResult,
  type Store,
} from './dispatch.ts';
import {
  createWebPushSender,
  endpointLabel,
  isAllowedEndpoint,
  parseRetryAfter,
  topicFor,
  urgencyFor,
  WEBPUSH_CONCURRENCY,
  WEBPUSH_MAX_PAYLOAD_BYTES,
  WEBPUSH_TIMEOUT_MS,
  WEBPUSH_TTL_SECONDS,
  webPushSenderFromEnv,
} from './webpush.ts';
import { b64urlDecode, b64urlEncode } from './webpush_crypto.ts';

// ---------------------------------------------------------------- helpers
const ORDER = '3f2a1c9e-8b7d-4e6f-9a01-23456789abcd';

async function vapid() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: b64urlEncode(raw),
    privateKey: jwk.d as string,
    subject: 'mailto:ops@example.com',
  };
}

async function subscriptionKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    p256dh: b64urlEncode(raw),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const VAPID = await vapid();
const KEYS = await subscriptionKeys();

const FCM = 'https://fcm.googleapis.com/fcm/send/dXk3SECRET-PATH-abcdef0123456789';
const APPLE = 'https://web.push.apple.com/QGp5SECRET-APPLE-token';
const MOZ = 'https://updates.push.services.mozilla.com/wpush/v2/gAAAASECRET';
const WNS = 'https://wns2-par02p.notify.windows.com/w/?token=SECRETWNS';

function msg(
  to: string,
  data: Record<string, unknown> = { order_id: ORDER, type: 'new_order' },
): PushMessage {
  return { to, title: 'طلب جديد #12', body: 'بلوك A3 - بناية 4', data, keys: KEYS };
}

interface Call {
  url: string;
  init: RequestInit;
  headers: Headers;
}

function fakeFetch(
  respond: (call: Call, i: number) => Response | Promise<Response> = () =>
    new Response(null, { status: 201 }),
) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init, headers: new Headers(init.headers) };
    calls.push(call);
    return await respond(call, calls.length - 1);
  }) as typeof fetch;
  return { fn, calls };
}

function sender(
  fetchFn: typeof fetch,
  extra: Partial<Parameters<typeof createWebPushSender>[0]> = {},
) {
  return createWebPushSender({ ...VAPID, fetch: fetchFn, ...extra });
}

// ---------------------------------------------------------------- constants
Deno.test('webpush: limits from SPEC-webpush §5.4', () => {
  assert.equal(WEBPUSH_TTL_SECONDS, 3600);
  assert.equal(WEBPUSH_TIMEOUT_MS, 8000);
  assert.equal(WEBPUSH_CONCURRENCY, 10);
  assert.equal(WEBPUSH_MAX_PAYLOAD_BYTES, 1024);
});

// ---------------------------------------------------------------- SSRF
Deno.test('SSRF allowlist: only https push services, no port, no credentials', () => {
  for (const ok of [
    FCM,
    APPLE,
    MOZ,
    WNS,
    'https://api.push.apple.com/x',
    'https://FCM.googleapis.com/x',
  ]) {
    assert.ok(isAllowedEndpoint(ok), ok);
  }
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/x', // not https
    'https://fcm.googleapis.com:8443/x', // port
    'https://user:pw@fcm.googleapis.com/x', // credentials
    'https://evil.example.com/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evilpush.apple.com/x', // suffix without the dot
    'https://push.apple.com/x', // bare apex is not *.push.apple.com
    'https://notify.windows.com/x',
    'https://fcm.googleapis.com./x', // trailing dot
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x',
    'https://localhost/x',
    'file:///etc/passwd',
    'not a url',
    '',
    `https://fcm.googleapis.com/${'a'.repeat(1024)}`, // > 1024 chars
  ]) {
    assert.ok(!isAllowedEndpoint(bad), bad);
  }
});

Deno.test(
  'SSRF: an endpoint outside the allowlist is never requested (permanent failure)',
  async () => {
    const f = fakeFetch();
    const out = await sender(f.fn)([
      msg('https://169.254.169.254/latest/meta-data'),
      msg('http://fcm.googleapis.com/x'),
      msg('https://fcm.googleapis.com:444/x'),
    ]);
    assert.equal(f.calls.length, 0);
    for (const o of out) {
      assert.equal(o.status, 'failed');
      assert.match((o as { error: string }).error, /endpoint not allowed/);
    }
  },
);

Deno.test('SSRF: redirects are not followed', async () => {
  const f = fakeFetch(
    () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/' } }),
  );
  const [o] = await sender(f.fn)([msg(FCM)]);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.init.redirect, 'manual');
  assert.equal(o!.status, 'failed');
});

// ---------------------------------------------------------------- request shape
Deno.test('request: POST encrypted aes128gcm body with VAPID, TTL, Urgency, Topic', async () => {
  const f = fakeFetch();
  const out = await sender(f.fn)([msg(FCM)]);
  assert.deepEqual(out, [{ status: 'ok' }]);
  const c = f.calls[0]!;
  assert.equal(c.url, FCM);
  assert.equal(c.init.method, 'POST');
  assert.equal(c.headers.get('content-encoding'), 'aes128gcm');
  assert.equal(c.headers.get('content-type'), 'application/octet-stream');
  assert.equal(c.headers.get('ttl'), '3600');
  assert.equal(c.headers.get('urgency'), 'high');
  assert.equal(c.headers.get('topic'), ORDER.replaceAll('-', ''));
  const auth = c.headers.get('authorization') ?? '';
  assert.match(auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(auth.split('.')[1]!)));
  assert.equal(claims.aud, 'https://fcm.googleapis.com', 'aud = endpoint origin');
  const body = c.init.body as Uint8Array;
  assert.ok(body instanceof Uint8Array);
  assert.equal(body[20], 65, 'idlen = uncompressed P-256 key');
  assert.ok(c.init.signal instanceof AbortSignal, 'request has a timeout signal');
});

Deno.test('request: payload is exactly {title, body, data} (no extra fields)', async () => {
  // يُتحقق بفك التشفير بمفتاح المستلم ضمن webpush_crypto_test؛ هنا: الحجم مطابق لـ JSON الثلاثي فقط.
  const f = fakeFetch();
  const m = msg(FCM);
  await sender(f.fn)([m]);
  const json = JSON.stringify({ title: m.title, body: m.body, data: m.data });
  const body = f.calls[0]!.init.body as Uint8Array;
  // header 86 + plaintext + delimiter 1 + GCM tag 16
  assert.equal(body.length, 86 + new TextEncoder().encode(json).length + 1 + 16);
});

Deno.test('urgency: high for driver/new-order/ready, normal otherwise', () => {
  assert.equal(urgencyFor({ type: 'new_order', order_id: ORDER }), 'high');
  assert.equal(urgencyFor({ type: 'ready', order_id: ORDER }), 'high');
  assert.equal(urgencyFor({ type: 'assigned', order_id: ORDER }), 'high');
  assert.equal(urgencyFor({ type: 'unassigned', order_id: ORDER }), 'high');
  assert.equal(urgencyFor({ status: 'ready', order_id: ORDER }), 'high');
  assert.equal(urgencyFor({ status: 'preparing', order_id: ORDER }), 'normal');
  assert.equal(urgencyFor({ status: 'delivered', order_id: ORDER }), 'normal');
  assert.equal(urgencyFor({ type: 'low_stock' }), 'normal');
  assert.equal(urgencyFor({}), 'normal');
});

Deno.test(
  'topic: order UUID as 32 URL-safe chars (RFC 8030 limit); none without a valid UUID',
  () => {
    assert.equal(topicFor({ order_id: ORDER }), '3f2a1c9e8b7d4e6f9a0123456789abcd');
    assert.equal(topicFor({ order_id: ORDER })!.length, 32);
    assert.equal(topicFor({ order_id: 'o1' }), null);
    assert.equal(topicFor({ order_id: 42 }), null);
    assert.equal(topicFor({}), null);
  },
);

Deno.test('request: no Topic header when the data has no order UUID', async () => {
  const f = fakeFetch();
  await sender(f.fn)([msg(FCM, { type: 'low_stock', product_id: 'p' })]);
  assert.equal(f.calls[0]!.headers.get('topic'), null);
  assert.equal(f.calls[0]!.headers.get('urgency'), 'normal');
});

Deno.test('payload over 1KB: permanent failure, not sent', async () => {
  const f = fakeFetch();
  const big = { ...msg(FCM), body: 'x'.repeat(1100) };
  const [o] = await sender(f.fn)([big]);
  assert.equal(f.calls.length, 0);
  assert.equal(o!.status, 'failed');
  assert.match((o as { error: string }).error, /payload too large/);
});

Deno.test('missing or malformed subscription keys: permanent failure, not sent', async () => {
  const f = fakeFetch();
  const out = await sender(f.fn)([
    { ...msg(FCM), keys: undefined },
    { ...msg(FCM), keys: null },
    { ...msg(FCM), keys: { p256dh: 'bad', auth: KEYS.auth } },
  ]);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(
    out.map((o) => o.status),
    ['failed', 'failed', 'failed'],
  );
});

// ---------------------------------------------------------------- classification
Deno.test(
  'classification: 201 ok, 404/410 dead, 400/401/403/413 permanent, 429/5xx transient',
  async () => {
    const statuses = [201, 200, 202, 404, 410, 400, 401, 403, 413, 429, 500, 502, 503];
    const f = fakeFetch((_c, i) => new Response('', { status: statuses[i]! }));
    // تزامن 1 كي تطابق الردود ترتيب الرسائل
    const out = await sender(f.fn, { concurrency: 1 })(statuses.map((_, i) => msg(`${FCM}${i}`)));
    assert.deepEqual(
      out.map((o) => o.status),
      [
        'ok',
        'ok',
        'ok',
        'dead',
        'dead',
        'failed',
        'failed',
        'failed',
        'failed',
        'error',
        'error',
        'error',
        'error',
      ],
    );
    assert.match((out[5] as { error: string }).error, /HTTP 400/);
    assert.match((out[7] as { error: string }).error, /HTTP 403/);
  },
);

Deno.test('classification: network error and 8s timeout are transient', async () => {
  const net = fakeFetch(() =>
    Promise.reject(new TypeError(`error sending request for url (${FCM})`)),
  );
  const [a] = await sender(net.fn)([msg(FCM)]);
  assert.equal(a!.status, 'error');
  assert.match((a as { error: string }).error, /network/);

  const slow = fakeFetch(
    (c) =>
      new Promise<Response>((_res, rej) => {
        c.init.signal!.addEventListener('abort', () => rej(c.init.signal!.reason));
      }),
  );
  const started = Date.now();
  const [b] = await sender(slow.fn, { timeoutMs: 30 })([msg(FCM)]);
  assert.equal(b!.status, 'error');
  assert.match((b as { error: string }).error, /timeout/);
  assert.ok(Date.now() - started < 2000);
});

Deno.test(
  '400/401/403 keep the token: dispatch does not delete it and does not retry',
  async () => {
    const f = fakeFetch(() => new Response('', { status: 403 }));
    const store = new (class implements Store {
      finished: { results: RowResult[]; dead: string[] }[] = [];
      claim() {
        const row: OutboxRow = {
          id: 1,
          title: 't',
          body: 'b',
          data: { order_id: ORDER, type: 'ready' },
          attempts: 0,
          recipients: [{ token: FCM, provider: 'webpush', platform: 'web', keys: KEYS }],
        };
        return Promise.resolve([row]);
      }
      finish(results: RowResult[], dead: string[]) {
        this.finished.push({ results, dead });
        return Promise.resolve();
      }
    })();
    await dispatchOnce(store, { webpush: sender(f.fn) });
    const { results, dead } = store.finished[0]!;
    assert.deepEqual(dead, []);
    assert.equal(results[0]!.ok, false);
    assert.equal(results[0]!.final, true, 'config failure is not retried');
    assert.match(results[0]!.error ?? '', /permanent failure/);
    assert.match(results[0]!.error ?? '', /HTTP 403/);
    assert.ok(!(results[0]!.error ?? '').includes('SECRET'), 'last_error has no endpoint');
  },
);

Deno.test('410 deletes the token via the dead list', async () => {
  const f = fakeFetch(() => new Response('', { status: 410 }));
  const store = new (class implements Store {
    finished: { results: RowResult[]; dead: string[] }[] = [];
    claim() {
      return Promise.resolve([
        {
          id: 1,
          title: 't',
          body: 'b',
          data: {},
          attempts: 0,
          recipients: [{ token: FCM, provider: 'webpush' as const, platform: 'web', keys: KEYS }],
        },
      ]);
    }
    finish(results: RowResult[], dead: string[]) {
      this.finished.push({ results, dead });
      return Promise.resolve();
    }
  })();
  await dispatchOnce(store, { webpush: sender(f.fn) });
  assert.deepEqual(store.finished[0]!.dead, [FCM]);
});

// ---------------------------------------------------------------- dispatch integration
class OneRowStore implements Store {
  finished: { results: RowResult[]; dead: string[] }[] = [];
  constructor(private row: OutboxRow) {}
  claim() {
    return Promise.resolve([this.row]);
  }
  finish(results: RowResult[], dead: string[]) {
    this.finished.push({ results, dead });
    return Promise.resolve();
  }
}

const webRecipient = (token = FCM) => ({
  token,
  provider: 'webpush' as const,
  platform: 'web',
  keys: KEYS,
});
const expoRecipient = {
  token: 'ExponentPushToken[1]',
  provider: 'expo' as const,
  platform: 'android',
};

Deno.test(
  'dispatch: no webpush sender (VAPID secrets unset) → skipped with a clear note, Expo still sent',
  async () => {
    const store = new OneRowStore({
      id: 1,
      title: 't',
      body: 'b',
      data: {},
      attempts: 0,
      recipients: [webRecipient(), expoRecipient],
    });
    let expoCalls = 0;
    await dispatchOnce(store, {
      expo: (m) => {
        expoCalls += m.length;
        return Promise.resolve(m.map(() => ({ status: 'ok' as const })));
      },
    });
    const r = store.finished[0]!.results[0]!;
    assert.equal(expoCalls, 1);
    assert.equal(r.ok, true);
    assert.match(
      r.error ?? '',
      /webpush: 1 token\(s\) skipped \(sender not configured: VAPID secrets missing\)/,
    );
    assert.deepEqual(store.finished[0]!.dead, []);
  },
);

Deno.test(
  'dispatch: only webpush recipients and no sender → final failure, token kept',
  async () => {
    const store = new OneRowStore({
      id: 1,
      title: 't',
      body: 'b',
      data: {},
      attempts: 0,
      recipients: [webRecipient()],
    });
    await dispatchOnce(store, {});
    const r = store.finished[0]!.results[0]!;
    assert.equal(r.ok, false);
    assert.equal(r.final, true);
    assert.deepEqual(store.finished[0]!.dead, []);
  },
);

Deno.test('dispatch: webpush keys reach the sender; Expo messages carry no keys', async () => {
  const seen: PushMessage[] = [];
  const store = new OneRowStore({
    id: 1,
    title: 't',
    body: 'b',
    data: { order_id: ORDER, type: 'ready' },
    attempts: 0,
    recipients: [webRecipient(), expoRecipient],
  });
  const record = (m: PushMessage[]) => {
    seen.push(...m);
    return Promise.resolve(m.map(() => ({ status: 'ok' as const })));
  };
  await dispatchOnce(store, { webpush: record, expo: record });
  const web = seen.find((m) => m.to === FCM)!;
  const exp = seen.find((m) => m.to === expoRecipient.token)!;
  assert.deepEqual(web.keys, KEYS);
  assert.equal(exp.keys, undefined);
});

Deno.test(
  'dispatch: permanent + transient mix → retried (transient wins), note lists both',
  async () => {
    const store = new OneRowStore({
      id: 1,
      title: 't',
      body: 'b',
      data: {},
      attempts: 0,
      recipients: [webRecipient(`${FCM}a`), webRecipient(`${FCM}b`)],
    });
    await dispatchOnce(store, {
      webpush: (m) =>
        Promise.resolve(
          [
            { status: 'failed' as const, error: 'webpush: HTTP 403 (fcm.googleapis.com)' },
            { status: 'error' as const, error: 'webpush: HTTP 503 (fcm.googleapis.com)' },
          ].slice(0, m.length),
        ),
    });
    const r = store.finished[0]!.results[0]!;
    assert.equal(r.ok, false);
    assert.equal(r.final, false);
    assert.match(r.error ?? '', /1 permanent failure\(s\), token kept: webpush: HTTP 403/);
    assert.match(r.error ?? '', /1 send error\(s\): webpush: HTTP 503/);
  },
);

// ---------------------------------------------------------------- Retry-After
Deno.test('parseRetryAfter: seconds or HTTP date, capped at 1 hour, junk ignored', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  assert.equal(parseRetryAfter('120', now), 120_000);
  assert.equal(parseRetryAfter('0', now), 0);
  assert.equal(parseRetryAfter(new Date(now + 30_000).toUTCString(), now), 30_000);
  assert.equal(parseRetryAfter('999999', now), 3_600_000);
  assert.equal(parseRetryAfter('soon', now), null);
  assert.equal(parseRetryAfter('-5', now), null);
  assert.equal(parseRetryAfter(null, now), null);
});

Deno.test(
  'Retry-After: a rate-limited host is not contacted again until the time passes',
  async () => {
    let clock = 1_000_000;
    const f = fakeFetch((c) =>
      c.url.startsWith('https://fcm')
        ? new Response('', { status: 429, headers: { 'retry-after': '60' } })
        : new Response(null, { status: 201 }),
    );
    const send = sender(f.fn, { concurrency: 1, now: () => clock });
    const first = await send([msg(`${FCM}1`), msg(`${FCM}2`), msg(MOZ)]);
    assert.deepEqual(
      first.map((o) => o.status),
      ['error', 'error', 'ok'],
    );
    assert.equal(
      f.calls.filter((c) => c.url.startsWith('https://fcm')).length,
      1,
      'second FCM message skipped',
    );
    assert.match((first[1] as { error: string }).error, /retry after 60s/);

    // نفس الـ isolate، قبل انتهاء المهلة: لا اتصال بـ FCM
    clock += 30_000;
    await send([msg(`${FCM}3`)]);
    assert.equal(f.calls.filter((c) => c.url.startsWith('https://fcm')).length, 1);

    // بعد المهلة: يُعاد الاتصال
    clock += 31_000;
    await send([msg(`${FCM}4`)]);
    assert.equal(f.calls.filter((c) => c.url.startsWith('https://fcm')).length, 2);
  },
);

Deno.test('Retry-After on 503 is honoured too', async () => {
  let n = 0;
  const f = fakeFetch(() => {
    n++;
    return new Response('', { status: 503, headers: { 'retry-after': '10' } });
  });
  const out = await sender(f.fn, { concurrency: 1, now: () => 5 })([
    msg(`${FCM}1`),
    msg(`${FCM}2`),
  ]);
  assert.equal(n, 1);
  assert.deepEqual(
    out.map((o) => o.status),
    ['error', 'error'],
  );
});

// ---------------------------------------------------------------- concurrency
Deno.test('concurrency: at most 10 requests in flight, results keep message order', async () => {
  let inFlight = 0;
  let peak = 0;
  const f = fakeFetch(async (c) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return new Response('', { status: c.url.endsWith('dead') ? 410 : 201 });
  });
  const messages = Array.from({ length: 25 }, (_, i) => msg(`${FCM}${i}${i === 7 ? 'dead' : ''}`));
  const out = await sender(f.fn)(messages);
  assert.equal(f.calls.length, 25);
  assert.equal(peak, 10);
  assert.equal(out.length, 25);
  out.forEach((o, i) => assert.equal(o.status, i === 7 ? 'dead' : 'ok', `index ${i}`));
});

// ---------------------------------------------------------------- logs
Deno.test('logs: host + short hash only, never the endpoint path or the private key', async () => {
  const lines: string[] = [];
  const statuses = [410, 403, 500];
  const f = fakeFetch((_c, i) => new Response('', { status: statuses[i]! }));
  await sender(f.fn, {
    concurrency: 1,
    log: (m, extra) => lines.push(`${m} ${JSON.stringify(extra)}`),
  })([msg(FCM), msg(APPLE), msg(MOZ)]);
  assert.equal(lines.length, 3);
  const all = lines.join('\n');
  assert.ok(!all.includes('SECRET'), all);
  assert.ok(!all.includes(VAPID.privateKey), all);
  assert.match(all, /fcm\.googleapis\.com#[0-9a-f]{8}/);
  assert.match(all, /web\.push\.apple\.com#[0-9a-f]{8}/);
});

Deno.test(
  'error strings (last_error) never carry the endpoint, even from network errors',
  async () => {
    const f = fakeFetch(() =>
      Promise.reject(new TypeError(`error sending request for url (${FCM})`)),
    );
    const out = await sender(f.fn)([msg(FCM), msg('https://evil.example.com/SECRET')]);
    for (const o of out) assert.ok(!JSON.stringify(o).includes('SECRET'), JSON.stringify(o));
  },
);

Deno.test('endpointLabel: host#sha256-prefix, stable, path-free', async () => {
  const a = await endpointLabel(FCM);
  assert.match(a, /^fcm\.googleapis\.com#[0-9a-f]{8}$/);
  assert.equal(await endpointLabel(FCM), a);
  assert.notEqual(await endpointLabel(`${FCM}x`), a);
  assert.match(await endpointLabel('not a url'), /^invalid#[0-9a-f]{8}$/);
});

// ---------------------------------------------------------------- VAPID config
Deno.test('invalid VAPID keys: every message is a permanent failure, nothing is sent', async () => {
  const other = await vapid();
  const f = fakeFetch();
  const out = await createWebPushSender({ ...VAPID, privateKey: other.privateKey, fetch: f.fn })([
    msg(FCM),
    msg(MOZ),
  ]);
  assert.equal(f.calls.length, 0);
  for (const o of out) {
    assert.equal(o.status, 'failed');
    assert.match((o as { error: string }).error, /invalid VAPID/);
    assert.ok(!JSON.stringify(o).includes(other.privateKey));
  }
});

Deno.test('env: missing or empty VAPID secret → no sender, no throw', () => {
  const full: Record<string, string> = {
    VAPID_PUBLIC_KEY: VAPID.publicKey,
    VAPID_PRIVATE_KEY: VAPID.privateKey,
    VAPID_SUBJECT: VAPID.subject,
  };
  assert.equal(typeof webPushSenderFromEnv((n) => full[n]), 'function');
  for (const drop of Object.keys(full)) {
    const env = Object.fromEntries(Object.entries(full).filter(([k]) => k !== drop));
    assert.equal(
      webPushSenderFromEnv((n) => env[n]),
      null,
      `without ${drop}`,
    );
    assert.equal(
      webPushSenderFromEnv((n) => (n === drop ? '  ' : full[n])),
      null,
      `empty ${drop}`,
    );
  }
  assert.equal(
    webPushSenderFromEnv(() => undefined),
    null,
  );
});

Deno.test('env: malformed keys do not throw at startup; sends fail permanently', async () => {
  const f = fakeFetch();
  const send = webPushSenderFromEnv(
    (n) =>
      ({
        VAPID_PUBLIC_KEY: 'garbage',
        VAPID_PRIVATE_KEY: 'garbage',
        VAPID_SUBJECT: 'mailto:x@example.com',
      })[n],
    { fetch: f.fn },
  );
  assert.ok(send);
  const [o] = await send([msg(FCM)]);
  assert.equal(o!.status, 'failed');
  assert.equal(f.calls.length, 0);
});

Deno.test('VAPID JWT is reused per audience within one sender', async () => {
  const f = fakeFetch();
  const send = sender(f.fn);
  await send([msg(`${FCM}1`), msg(`${FCM}2`), msg(MOZ)]);
  // الطلبات متزامنة فترتيب calls غير مضمون: البحث بالعنوان
  const auth = (url: string) => f.calls.find((c) => c.url === url)!.headers.get('authorization');
  assert.equal(auth(`${FCM}1`), auth(`${FCM}2`));
  assert.notEqual(auth(`${FCM}1`), auth(MOZ));
});
