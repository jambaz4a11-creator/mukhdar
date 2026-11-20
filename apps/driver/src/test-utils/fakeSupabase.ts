// Supabase مزيف للاختبارات: from(table) يسجّل سلسلة العمليات (select, eq...)، rpc يُسجَّل كـ "rpc:fn"،
// functions.invoke يُسجَّل كـ "fn:name". النتيجة من resolve. auth يُمرَّر من الاختبار. لا شبكة.
export type Op = [name: string, args: unknown[]];
export interface Call {
  table: string;
  ops: Op[];
}
export type Result = { data: unknown; error: unknown };

export function opArgs(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([n]) => n === name)?.[1];
}

export function createFakeSupabase(resolve: (call: Call) => Result, auth: object = {}) {
  const calls: Call[] = [];
  const client = {
    auth,
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              return (onOk: (r: Result) => unknown, onErr: (e: unknown) => unknown) =>
                Promise.resolve()
                  .then(() => resolve(call))
                  .then(onOk, onErr);
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
    rpc(fn: string, args?: unknown) {
      const call: Call = { table: `rpc:${fn}`, ops: [['rpc', [args]]] };
      calls.push(call);
      return Promise.resolve().then(() => resolve(call));
    },
    functions: {
      invoke(name: string, options?: { body?: unknown }) {
        const call: Call = { table: `fn:${name}`, ops: [['invoke', [options?.body]]] };
        calls.push(call);
        return Promise.resolve().then(() => resolve(call));
      },
    },
  };
  return { client, calls };
}

/** خطأ FunctionsHttpError كما يرجعه supabase-js: الجسم {"error": CODE} بـ context. */
export function functionError(status: number, body: object) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status }),
  };
}

/**
 * Realtime مزيف يطابق سلوك @supabase/realtime-js الحقيقي (R2 C1): `channel(topic)` يرجع القناة نفسها إن كان الاسم مسجّلاً،
 * و`.on()` بعد `subscribe()` يرمي، و`removeChannel` يلغي تسجيل الاسم. هكذا لا يختبئ خطأ "اسم مشترك" خلف الاختبارات.
 */
export interface FakeChannel {
  topic: string;
  subscribed: boolean;
  removed: boolean;
  handlers: { filter: object; cb: () => void }[];
  on(type: string, filter: object, cb: () => void): FakeChannel;
  subscribe(): FakeChannel;
}

export function withRealtime(fake: { client: object }) {
  const registry = new Map<string, FakeChannel>();
  const created: FakeChannel[] = [];
  Object.assign(fake.client, {
    channel(topic: string) {
      const existing = registry.get(topic);
      if (existing) return existing;
      const ch: FakeChannel = {
        topic,
        subscribed: false,
        removed: false,
        handlers: [],
        on(_type, filter, cb) {
          if (ch.subscribed) {
            throw new Error(
              `cannot add \`postgres_changes\` callbacks for realtime:${topic} after \`subscribe()\`.`,
            );
          }
          ch.handlers.push({ filter, cb });
          return ch;
        },
        subscribe() {
          ch.subscribed = true;
          return ch;
        },
      };
      registry.set(topic, ch);
      created.push(ch);
      return ch;
    },
    removeChannel(ch: FakeChannel) {
      ch.removed = true;
      ch.subscribed = false;
      registry.delete(ch.topic);
      return Promise.resolve('ok');
    },
    removeAllChannels() {
      for (const ch of registry.values()) ch.removed = true;
      registry.clear();
      return Promise.resolve([]);
    },
  });
  return {
    channels: created,
    /** القنوات الحيّة (غير الملغاة) */
    live: () => created.filter((c) => !c.removed),
    /** كل دوال الاستدعاء من القنوات الحيّة */
    fire: () => created.filter((c) => !c.removed).forEach((c) => c.handlers.forEach((h) => h.cb())),
  };
}
