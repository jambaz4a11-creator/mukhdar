// معالج HTTP (بدون اعتماديات خارجية، يُختبر مباشرة).
// المصادقة: ترويسة x-dispatch-secret تُقارن داخل القاعدة بالسر المحفوظ بـ Vault.
import type { DispatchSummary } from './dispatch.ts';

export interface HandlerDeps {
  authorize(secret: string): Promise<boolean>;
  run(): Promise<DispatchSummary>;
  log?: (msg: string, extra?: unknown) => void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    const secret = req.headers.get('x-dispatch-secret') ?? '';
    if (!secret) return json(401, { error: 'unauthorized' });
    try {
      if (!(await deps.authorize(secret))) return json(401, { error: 'unauthorized' });
      const summary = await deps.run();
      deps.log?.('push-dispatch done', summary);
      return json(200, summary);
    } catch (e) {
      deps.log?.('push-dispatch failed', e instanceof Error ? e.message : String(e));
      return json(500, { error: 'dispatch failed' });
    }
  };
}
