// معالج HTTP لحذف الحساب (بدون اعتماديات خارجية، يُختبر مباشرة).
// الرد دائماً JSON: نجاح {deleted: true}، أو {error: CODE} حيث CODE من رموز SPEC-backend §5
// (التطبيق يترجمه بـ parseBackendError)، عدا الخطأ الداخلي (500) فرسالته عامة.

export interface DeleteAccountDeps {
  /** يتحقق من JWT المستخدم عبر Auth (لا يكفي فك الترميز) ويرجع معرّفه، أو null. */
  getUserId(jwt: string): Promise<string | null>;
  /** begin_account_deletion: يرجع is_active السابق، أو يرمي Error برسالة الرمز. */
  begin(userId: string): Promise<boolean>;
  deleteUser(userId: string): Promise<void>;
  abort(userId: string, wasActive: boolean): Promise<void>;
  log?: (msg: string, extra?: unknown) => void;
}

const STATUS_BY_CODE: Record<string, number> = {
  ACTIVE_ORDER: 409,
  ADMIN_ACCOUNT: 403,
  USER_NOT_FOUND: 404,
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  return m?.[1] ?? null;
}

export function createDeleteAccountHandler(
  deps: DeleteAccountDeps,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

    const jwt = bearer(req);
    if (!jwt) return json(401, { error: 'NOT_AUTHENTICATED' });

    let userId: string | null;
    try {
      userId = await deps.getUserId(jwt);
    } catch {
      userId = null;
    }
    if (!userId) return json(401, { error: 'NOT_AUTHENTICATED' });

    let wasActive: boolean;
    try {
      wasActive = await deps.begin(userId);
    } catch (e) {
      const code = e instanceof Error ? e.message.trim() : '';
      const status = STATUS_BY_CODE[code];
      if (status) return json(status, { error: code });
      deps.log?.('delete-account begin failed', code);
      return json(500, { error: 'delete failed' });
    }

    try {
      await deps.deleteUser(userId);
    } catch (e) {
      deps.log?.('delete-account deleteUser failed', e instanceof Error ? e.message : String(e));
      await deps
        .abort(userId, wasActive)
        .catch((err) =>
          deps.log?.(
            'delete-account abort failed',
            err instanceof Error ? err.message : String(err),
          ),
        );
      return json(500, { error: 'delete failed' });
    }

    deps.log?.('delete-account done', { userId });
    return json(200, { deleted: true });
  };
}
