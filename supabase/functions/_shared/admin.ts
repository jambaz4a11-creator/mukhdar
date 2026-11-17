// مشترك بين admin-reset-pin وadmin-create-user (T19، SPEC-admin §2.6): الرد JSON، قراءة الجسم،
// والتحقق أن المستدعي أدمن نشط بجلسة aal2 (T23 C1). بلا اعتماديات خارجية (يُختبر مباشرة بـ deno test).
// لا يُسجَّل جسم الطلب أبداً (فيه الـ PIN).

export interface ProfileRow {
  role: 'customer' | 'driver' | 'staff' | 'admin';
  is_active: boolean;
  phone: string | null;
  /** رمز مؤقت لم يُغيَّر بعد (مراجعة T16-T19 H1): مستدعٍ كهذا يرفضه requireAdmin. */
  must_change_pin?: boolean;
}

export interface AdminAuthDeps {
  /**
   * auth.getUser(jwt) يتحقق من الرمز عند Auth: المعرّف ومستوى الجلسة (claim "aal" من نفس الرمز بعد التحقق)،
   * أو null لرمز غير صالح أو منتهٍ.
   */
  getUser(jwt: string): Promise<{ id: string; aal: string | null } | null>;
  /** profiles بمفتاح الخدمة: الدور والتفعيل والهاتف، أو null إن لم يوجد. */
  getProfile(userId: string): Promise<ProfileRow | null>;
  /**
   * يسجّل نشاط جلسة اللوحة (rpc touch_panel_session بجلسة المستدعي، T23 M7): true = حيّة، false = انتهت بخمول
   * أكثر من 12 ساعة (وحذفها الخادم). الأدمن يستدعي الدالتين من جلسته، فكل طلب نشاط، ولا تُحيا جلسة منتهية.
   */
  touchSession(jwt: string): Promise<boolean>;
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

/**
 * claim "aal" من حمولة JWT (بلا تحقق من التوقيع: يُستدعى فقط بعد أن تحقق auth.getUser من نفس الرمز).
 * 'aal1' (الـ PIN وحده) أو 'aal2' (+ رمز تطبيق المصادقة)، أو null لرمز غير مقروء.
 */
export function jwtAal(jwt: string): string | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload: unknown = JSON.parse(atob(b64));
    const aal = (payload as { aal?: unknown } | null)?.aal;
    return typeof aal === 'string' ? aal : null;
  } catch {
    return null;
  }
}

/**
 * المستدعي أدمن نشط، بجلسة aal2 (المصادقة الثنائية، T23 C1)، وليس برمز مؤقت: يرجع معرّفه، أو Response جاهزة
 * (401 NOT_AUTHENTICATED / 403 NOT_ALLOWED / 403 MFA_REQUIRED / 403 PIN_CHANGE_REQUIRED).
 * نفس قاعدة current_user_role() بقاعدة البيانات: أدمن بالـ PIN وحده أو برمز مؤقت لا يعمل حتى لو استدعى
 * الدالة مباشرة بلا اللوحة.
 */
export async function requireAdmin(req: Request, deps: AdminAuthDeps): Promise<string | Response> {
  const jwt = bearer(req);
  if (!jwt) return fail(401, 'NOT_AUTHENTICATED');
  let user: { id: string; aal: string | null } | null;
  try {
    user = await deps.getUser(jwt);
  } catch {
    user = null;
  }
  if (!user) return fail(401, 'NOT_AUTHENTICATED');
  const userId = user.id;
  let profile: ProfileRow | null;
  try {
    profile = await deps.getProfile(userId);
  } catch {
    return fail(500, 'INTERNAL');
  }
  if (!profile || profile.role !== 'admin' || !profile.is_active) return fail(403, 'NOT_ALLOWED');
  if (user.aal !== 'aal2') return fail(403, 'MFA_REQUIRED');
  if (profile.must_change_pin) return fail(403, 'PIN_CHANGE_REQUIRED');
  // خمول اللوحة 12 ساعة (M7): الخادم يفرضه بـ current_user_role()، والدالتان تستعملان service_role فتفحصانه هنا
  let alive: boolean;
  try {
    alive = await deps.touchSession(jwt);
  } catch {
    return fail(500, 'INTERNAL');
  }
  if (!alive) return fail(401, 'SESSION_EXPIRED');
  return userId;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * نص الخطأ للسجل بعد إزالة الأسرار (الرمز الخام والمُطبَّع): رسائل Auth وPostgREST لا تحمل كلمة السر
 * اليوم، لكن السطر غير مفلتر، فلا نعتمد على ذلك (مراجعة T16-T19 L4/T6).
 */
export function errTextWithout(e: unknown, ...secrets: string[]): string {
  let text = errText(e);
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('***');
  }
  return text;
}
