// Supabase مزيف للاختبارات: كل استدعاء from(table) يسجّل سلسلة العمليات (select, eq, range...)،
// والنتيجة من دالة resolve حسب الجدول والعمليات. لا شبكة.
import type { Product } from '../features/catalog/api';

export type Op = [name: string, args: unknown[]];
export interface Call {
  table: string;
  ops: Op[];
}
export type Result = { data: unknown; error: unknown };

export function opArgs(call: Call, name: string): unknown[] | undefined {
  return call.ops.find(([n]) => n === name)?.[1];
}

export function createFakeSupabase(resolve: (call: Call) => Result) {
  const calls: Call[] = [];
  const client = {
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
    /** rpc(fn, args): يُسجَّل كـ table = "rpc:fn" وعملية ['rpc', [args]]، والنتيجة من resolve. */
    rpc(fn: string, args?: unknown) {
      const call: Call = { table: `rpc:${fn}`, ops: [['rpc', [args]]] };
      calls.push(call);
      return Promise.resolve().then(() => resolve(call));
    },
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  };
  return { client, calls };
}

export function makeProduct(overrides: Partial<Product> & { id: string }): Product {
  return {
    category_id: 1,
    name: `منتج ${overrides.id}`,
    description: null,
    unit: 'نص كيلو',
    price_iqd: 750,
    image_path: null,
    in_stock: true,
    sort_order: 0,
    ...overrides,
  };
}
