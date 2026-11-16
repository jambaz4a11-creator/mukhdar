// مشترك بين admin-reset-pin وadmin-create-user (T19، SPEC-admin §2.6): الرد JSON، قراءة الجسم،
// والتحقق أن المستدعي أدمن نشط. بلا اعتماديات خارجية (يُختبر مباشرة بـ deno test).
// لا يُسجَّل جسم الطلب أبداً (فيه الـ PIN).

export interface ProfileRow {
  role: 'customer' | 'driver' | 'staff' | 'admin';
  is_active: boolean;
  phone: string | null;
}

export interface AdminAuthDeps {
  /** auth.getUser(jwt): معرّف المستخدم، أو null لرمز غير صالح أو منتهٍ. */
  getUserId(jwt: string): Promise<string | null>;
  /** profiles بمفتاح الخدمة: الدور والتفعيل والهاتف، أو null إن لم يوجد. */
  getProfile(userId: string): Promise<ProfileRow | null>;
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const fail = (status: number, code: string, detail?: string) =>
  json(status, detail ? { error: code, detail } : { error: code });

export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  return m?.[1] ?? null;
}

const MAX_BODY_BYTES = 2048;

export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body: unknown = JSON.parse(text);
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** المستدعي أدمن نشط: يرجع معرّفه، أو Response جاهزة (401 NOT_AUTHENTICATED / 403 NOT_ALLOWED). */
export async function requireAdmin(req: Request, deps: AdminAuthDeps): Promise<string | Response> {
  const jwt = bearer(req);
  if (!jwt) return fail(401, 'NOT_AUTHENTICATED');
  let userId: string | null;
  try {
    userId = await deps.getUserId(jwt);
  } catch {
    userId = null;
  }
  if (!userId) return fail(401, 'NOT_AUTHENTICATED');
  let profile: ProfileRow | null;
  try {
    profile = await deps.getProfile(userId);
  } catch {
    return fail(500, 'INTERNAL');
  }
  if (!profile || profile.role !== 'admin' || !profile.is_active) return fail(403, 'NOT_ALLOWED');
  return userId;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
