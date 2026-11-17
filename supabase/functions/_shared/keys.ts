// مفاتيح Supabase داخل الـ Edge Functions (T23 F H2). بلا استيراد npm (push-dispatch وdelete-account بلا import map).
//
// Supabase تحقن نوعين:
//   الجديد:  SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS = JSON باسم المفتاح، مثل {"default": "sb_secret_..."}
//   القديم: SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY (JWT؛ يعمل حتى نهاية 2026 أو حتى يُطفأ من اللوحة)
// نفضّل الجديد (المفتاح المسمّى 'default'، أو SUPABASE_KEY_NAME إن ضُبط) ونرجع للقديم، فإطفاء المفاتيح القديمة
// بالإنتاج لا يكسر الدوال. لا مفتاح أبداً بالسجل أو بالخطأ.
export interface EnvReader {
  get(name: string): string | undefined;
}

const nonEmpty = (v: string | undefined | null): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/** مفتاح باسمه من متغير JSON (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS)؛ null إن غاب أو تعذّرت قراءته. */
export function namedKey(json: string | undefined, name: string): string | null {
  const raw = nonEmpty(json);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>)[name];
    return typeof value === 'string' ? nonEmpty(value) : null;
  } catch {
    return null;
  }
}

const keyName = (env: EnvReader) => nonEmpty(env.get('SUPABASE_KEY_NAME')) ?? 'default';

/** مفتاح الخدمة (يتجاوز RLS): الجديد sb_secret_ أولاً، ثم service_role القديم. يرمي إن لم يوجد أي منهما. */
export function secretKey(env: EnvReader = Deno.env): string {
  const key =
    namedKey(env.get('SUPABASE_SECRET_KEYS'), keyName(env)) ??
    nonEmpty(env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (!key)
    throw new Error('No Supabase secret key (SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY)');
  return key;
}

/** المفتاح المنشور (RLS بجلسة المستخدم): الجديد sb_publishable_ أولاً، ثم anon القديم. */
export function publishableKey(env: EnvReader = Deno.env): string {
  const key =
    namedKey(env.get('SUPABASE_PUBLISHABLE_KEYS'), keyName(env)) ??
    nonEmpty(env.get('SUPABASE_ANON_KEY'));
  if (!key) {
    throw new Error('No Supabase publishable key (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_ANON_KEY)');
  }
  return key;
}

export function supabaseUrl(env: EnvReader = Deno.env): string {
  const url = nonEmpty(env.get('SUPABASE_URL'));
  if (!url) throw new Error('SUPABASE_URL missing');
  return url;
}

/** نوع المفتاح المستعمل فعلاً (للسجل فقط، بلا قيمته). */
export function keyKind(key: string): 'new' | 'legacy' {
  return key.startsWith('sb_') ? 'new' : 'legacy';
}
