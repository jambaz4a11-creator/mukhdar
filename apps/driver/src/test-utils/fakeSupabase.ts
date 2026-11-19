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
