// pnpm test:functions  (deno test, بدون شبكة: fetch و store مزيفان)
import assert from 'node:assert/strict';
import {
  dispatchAll,
  dispatchOnce,
  MAX_ATTEMPTS,
  type OutboxRow,
  type Recipient,
  type RowResult,
  type Store,
} from './dispatch.ts';
import { createExpoSender, EXPO_PUSH_URL } from './expo.ts';
import { createHandler } from './handler.ts';

// ---------------------------------------------------------------- helpers
const expo = (n: number | string): Recipient => ({
  token: `ExponentPushToken[${n}]`,
  provider: 'expo',
  platform: 'android',
});
const fcm = (n: number | string): Recipient => ({
  token: `fcm-${n}`,
  provider: 'fcm',
  platform: 'android',
});

function row(id: number, recipients: Recipient[], attempts = 0): OutboxRow {
  return {
    id,
    title: `t${id}`,
    body: `b${id}`,
    data: { order_id: `o${id}` },
    attempts,
    recipients,
  };
}

class FakeStore implements Store {
  claims: number[] = [];
  finished: { results: RowResult[]; dead: string[] }[] = [];
  constructor(private batches: OutboxRow[][]) {}
  claim(limit: number) {
    this.claims.push(limit);
    return Promise.resolve(this.batches.shift() ?? []);
  }
  finish(results: RowResult[], dead: string[]) {
    this.finished.push({ results, dead });
    return Promise.resolve();
  }
  result(id: number): RowResult {
    const r = this.finished.flatMap((f) => f.results).find((x) => x.id === id);
    assert.ok(r, `no result for row ${id}`);
    return r;
  }
}

interface Call {
  url: string;
  headers: Headers;
  body: { to: string; title: string; body: string; channelId: string; priority: string }[];
}

/** fetch مزيف: يسجل الطلبات ويرد حسب الدالة المعطاة (افتراضياً: ok لكل رسالة). */
function fakeFetch(respond?: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    };
    calls.push(call);
    if (respond) return await respond(call, calls.length - 1);
    return Response.json({
      data: call.body.map(() => ({ status: 'ok', id: crypto.randomUUID() })),
    });
  }) as typeof fetch;
  return { fn, calls };
}

const tickets = (call: Call, pick: (to: string) => object) =>
  Response.json({ data: call.body.map((m) => pick(m.to)) });

// ---------------------------------------------------------------- expo sender
Deno.test(
  'expo: batches of at most 100 (250 → 100/100/50), android channel + high priority',
  async () => {
    const { fn, calls } = fakeFetch();
    const send = createExpoSender({ fetch: fn });
    const msgs = Array.from({ length: 250 }, (_, i) => ({
      to: expo(i).token,
      title: 't',
      body: 'b',
      data: {},
    }));
    const out = await send(msgs);
    assert.deepEqual(
      calls.map((c) => c.body.length),
      [100, 100, 50],
    );
    assert.equal(out.length, 250);
    assert.ok(out.every((o) => o.status === 'ok'));
    assert.equal(calls[0]!.url, EXPO_PUSH_URL);
    assert.equal(calls[0]!.body[0]!.channelId, 'orders');
    assert.equal(calls[0]!.body[0]!.priority, 'high');
    assert.equal(calls[2]!.body[49]!.to, expo(249).token);
  },
);

Deno.test('expo: Authorization header only when EXPO_ACCESS_TOKEN is set', async () => {
  const a = fakeFetch();
  await createExpoSender({ fetch: a.fn })([{ to: expo(1).token, title: 't', body: 'b', data: {} }]);
  assert.equal(a.calls[0]!.headers.get('authorization'), null);

  const b = fakeFetch();
  await createExpoSender({ fetch: b.fn, accessToken: 'tok' })([
    { to: expo(1).token, title: 't', body: 'b', data: {} },
  ]);
  assert.equal(b.calls[0]!.headers.get('authorization'), 'Bearer tok');
});

Deno.test(
  'expo: ticket errors map to dead / error; HTTP and network errors fail the chunk',
  async () => {
    const { fn } = fakeFetch((call) =>
      tickets(call, (to) =>
        to.includes('[dead]')
          ? { status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }
          : to.includes('[big]')
            ? { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } }
            : { status: 'ok' },
      ),
    );
    const out = await createExpoSender({ fetch: fn })(
      ['ok', 'dead', 'big'].map((n) => ({ to: expo(n).token, title: 't', body: 'b', data: {} })),
    );
    assert.deepEqual(out, [
      { status: 'ok' },
      { status: 'dead', error: 'DeviceNotRegistered' },
      { status: 'error', error: 'expo: MessageTooBig' },
    ]);

    const http = fakeFetch(() => new Response('boom', { status: 500 }));
    const out2 = await createExpoSender({ fetch: http.fn })([
      { to: expo(1).token, title: 't', body: 'b', data: {} },
    ]);
    assert.equal(out2[0]!.status, 'error');
    assert.match((out2[0] as { error: string }).error, /HTTP 500/);

    const net = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    const out3 = await createExpoSender({ fetch: net.fn })([
      { to: expo(1).token, title: 't', body: 'b', data: {} },
    ]);
    assert.deepEqual(out3, [{ status: 'error', error: 'expo: fetch failed' }]);
  },
);

// ---------------------------------------------------------------- dispatch
Deno.test(
  'dispatch: every recipient of every row gets the row title/body/data; success marks sent',
  async () => {
    const { fn, calls } = fakeFetch();
    const store = new FakeStore([[row(1, [expo('a'), expo('b')]), row(2, [expo('c')])]]);
    const s = await dispatchOnce(store, { expo: createExpoSender({ fetch: fn }) });
    assert.deepEqual(s, { claimed: 2, sent: 2, failed: 0, deadTokens: 0 });
    assert.equal(calls.length, 1, 'rows share one Expo batch');
    assert.deepEqual(
      calls[0]!.body.map((m) => [m.to, m.title, m.body]),
      [
        [expo('a').token, 't1', 'b1'],
        [expo('b').token, 't1', 'b1'],
        [expo('c').token, 't2', 'b2'],
      ],
    );
    assert.deepEqual(store.result(1), { id: 1, ok: true, error: null, final: false });
    assert.deepEqual(store.finished[0]!.dead, []);
  },
);

Deno.test('dispatch: 250 drivers in one row → 3 Expo requests, row sent once', async () => {
  const { fn, calls } = fakeFetch();
  const store = new FakeStore([
    [
      row(
        1,
        Array.from({ length: 250 }, (_, i) => expo(i)),
      ),
    ],
  ]);
  await dispatchOnce(store, { expo: createExpoSender({ fetch: fn }) });
  assert.equal(calls.length, 3);
  assert.equal(store.result(1).ok, true);
});

Deno.test('dispatch: DeviceNotRegistered tokens are returned for deletion', async () => {
  const { fn } = fakeFetch((call) =>
    tickets(call, (to) =>
      to.includes('dead')
        ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok' },
    ),
  );
  const store = new FakeStore([[row(1, [expo('dead1'), expo('ok')]), row(2, [expo('dead2')])]]);
  const s = await dispatchOnce(store, { expo: createExpoSender({ fetch: fn }) });
  assert.deepEqual(
    store.finished[0]!.dead.sort(),
    [expo('dead1').token, expo('dead2').token].sort(),
  );
  assert.equal(s.deadTokens, 2);
  // صف 1: وصل لرمز آخر ← مرسل مع ملاحظة
  assert.equal(store.result(1).ok, true);
  assert.match(store.result(1).error!, /DeviceNotRegistered/);
  // صف 2: كل رموزه ميتة ← فشل نهائي (لا فائدة من الإعادة)
  assert.equal(store.result(2).ok, false);
  assert.equal(store.result(2).final, true);
});

Deno.test('dispatch: Expo outage → retry (attempts+1), final on the last attempt', async () => {
  const { fn } = fakeFetch(() => new Response('down', { status: 503 }));
  const store = new FakeStore([[row(1, [expo(1)], 0), row(2, [expo(2)], MAX_ATTEMPTS - 1)]]);
  const s = await dispatchOnce(store, { expo: createExpoSender({ fetch: fn }) });
  assert.deepEqual(s, { claimed: 2, sent: 0, failed: 2, deadTokens: 0 });
  assert.equal(store.result(1).ok, false);
  assert.equal(store.result(1).final, false);
  assert.match(store.result(1).error!, /HTTP 503/);
  assert.equal(store.result(2).final, true);
});

Deno.test('dispatch: a sender that throws fails its messages without crashing', async () => {
  const store = new FakeStore([[row(1, [expo(1)])]]);
  await dispatchOnce(store, { expo: () => Promise.reject(new Error('kaput')) });
  assert.equal(store.result(1).ok, false);
  assert.match(store.result(1).error!, /expo: kaput/);
});

Deno.test(
  'dispatch: fcm tokens are skipped with a clear last_error (provider not implemented)',
  async () => {
    const { fn, calls } = fakeFetch();
    const store = new FakeStore([[row(1, [fcm(1), fcm(2)]), row(2, [expo(1), fcm(3)])]]);
    await dispatchOnce(store, { expo: createExpoSender({ fetch: fn }) });
    assert.deepEqual(
      calls.flatMap((c) => c.body.map((m) => m.to)),
      [expo(1).token],
      'fcm tokens never go to Expo',
    );
    assert.deepEqual(store.result(1), {
      id: 1,
      ok: false,
      error: 'fcm: 2 token(s) skipped (provider not implemented)',
      final: true,
    });
    assert.deepEqual(store.result(2), {
      id: 2,
      ok: true,
      error: 'fcm: 1 token(s) skipped (provider not implemented)',
      final: false,
    });
  },
);

Deno.test('dispatch: row without recipients is closed (no one to send to)', async () => {
  const { fn, calls } = fakeFetch();
  const store = new FakeStore([[row(1, [])]]);
  await dispatchOnce(store, { expo: createExpoSender({ fetch: fn }) });
  assert.equal(calls.length, 0);
  assert.deepEqual(store.result(1), { id: 1, ok: true, error: 'no recipients', final: false });
});

Deno.test('dispatch: empty outbox → no finish call', async () => {
  const store = new FakeStore([]);
  const s = await dispatchOnce(store, {});
  assert.equal(s.claimed, 0);
  assert.equal(store.finished.length, 0);
});

Deno.test('dispatchAll: keeps claiming while batches are full, bounded by maxRounds', async () => {
  const { fn } = fakeFetch();
  const full = (base: number) => [row(base, [expo(base)]), row(base + 1, [expo(base + 1)])];
  const store = new FakeStore([full(1), full(3), [row(5, [expo(5)])], full(6)]);
  const s = await dispatchAll(store, { expo: createExpoSender({ fetch: fn }) }, { limit: 2 });
  assert.equal(s.claimed, 5, 'stops after the partial batch');
  assert.equal(store.claims.length, 3);

  const loop = new FakeStore(Array.from({ length: 10 }, (_, i) => full(i * 10)));
  await dispatchAll(loop, { expo: createExpoSender({ fetch: fn }) }, { limit: 2, maxRounds: 4 });
  assert.equal(loop.claims.length, 4);
});

// ---------------------------------------------------------------- handler
Deno.test('handler: POST only, secret required and verified', async () => {
  let runs = 0;
  const h = createHandler({
    authorize: (s) => Promise.resolve(s === 'right'),
    run: () => {
      runs++;
      return Promise.resolve({ claimed: 1, sent: 1, failed: 0, deadTokens: 0 });
    },
  });
  const req = (method: string, secret?: string) =>
    new Request('http://x/push-dispatch', {
      method,
      headers: secret ? { 'x-dispatch-secret': secret } : {},
    });

  assert.equal((await h(req('GET', 'right'))).status, 405);
  assert.equal((await h(req('POST'))).status, 401);
  assert.equal((await h(req('POST', 'wrong'))).status, 401);
  assert.equal(runs, 0);
  const ok = await h(req('POST', 'right'));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { claimed: 1, sent: 1, failed: 0, deadTokens: 0 });
  assert.equal(runs, 1);
});

Deno.test('handler: internal failure → 500 without leaking details', async () => {
  const h = createHandler({
    authorize: () => Promise.resolve(true),
    run: () => Promise.reject(new Error('claim: secret db detail')),
  });
  const res = await h(
    new Request('http://x', { method: 'POST', headers: { 'x-dispatch-secret': 's' } }),
  );
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'dispatch failed' });
});
