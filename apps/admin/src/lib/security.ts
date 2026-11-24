// ترويسات الأمان ومحتوى CSP للوحة (T23 M3) وخيارات الـ cookies (M7). مصدر واحد يستعمله next.config.ts والـ proxy
// وتختبره vitest وPlaywright (e2e/security.spec.ts). بلا اعتماديات: يعمل بوقت Edge وNode.

/** ترويسات ثابتة لكل المسارات (next.config.ts). CSP نفسه بالـ proxy لأنه يحمل nonce لكل طلب. */
export const STATIC_SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  // لا إطارات إطلاقاً (clickjacking). frame-ancestors بالـ CSP هو الأساس، وهذه للمتصفحات القديمة.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // لا Referer لأي موقع آخر (يمنع تسرب /orders?order=<uuid> إلى wa.me وغيره). ليس no-referrer: كروم يرسل
  // Origin: null مع POST بنفس الأصل فيرفض Next كل Server Action (تسجيل الخروج). same-origin يرسل Origin صحيحاً.
  { key: 'Referrer-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  // Vercel يرسل HSTS على نطاقاته؛ للنطاق المخصص نرسله بأنفسنا (المتصفح يتجاهله على http)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

function origins(supabaseUrl: string | undefined): { http: string[]; ws: string[] } {
  if (!supabaseUrl) return { http: [], ws: [] };
  const u = new URL(supabaseUrl);
  return { http: [u.origin], ws: [`${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`] };
}

export interface CspOptions {
  nonce: string;
  /** NEXT_PUBLIC_SUPABASE_URL: الاتصال (REST/Auth/Functions/Realtime) والصور من Storage. */
  supabaseUrl: string | undefined;
  /** next dev يحتاج eval لإعادة التحميل السريع؛ الإنتاج لا. */
  dev?: boolean;
}

/**
 * Content-Security-Policy بـ nonce لكل طلب: السكربتات من نفس الأصل أو بالـ nonce فقط (لا unsafe-inline).
 * الأنماط 'unsafe-inline' (Next/Tailwind يحقنان style)، وهي أقل خطراً من السكربت.
 */
export function buildCsp({ nonce, supabaseUrl, dev = false }: CspOptions): string {
  const { http, ws } = origins(supabaseUrl);
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    [
      'script-src',
      ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'blob:', 'data:', ...http]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", ...http, ...ws]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['manifest-src', ["'self'"]],
    // T44: service worker الإشعارات (/sw.js). مع 'strict-dynamic' يُتجاهل 'self' بـ script-src الذي كان الاحتياط
    ['worker-src', ["'self'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** nonce عشوائي بـ 128 بتاً (base64) لكل طلب. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * خيارات cookies الجلسة (M7): Secure بالإنتاج (HTTPS)، SameSite=Lax، وعمر 7 أيام بدل 400. الأمان الفعلي
 * من خمول 12 ساعة بقاعدة البيانات (touch_panel_session)؛ هذا يحدّ بقاء cookie على جهاز منسي.
 * التطوير والاختبارات على http محلي: بلا Secure (وإلا لا يحفظ المتصفح الـ cookie على غير localhost).
 */
export const SESSION_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7;

export function sessionCookieOptions(
  production: boolean = process.env.NODE_ENV === 'production',
  insecureLocal: boolean = process.env.PANEL_INSECURE_COOKIES === '1',
) {
  return {
    path: '/',
    sameSite: 'lax' as const,
    secure: production && !insecureLocal,
    maxAge: SESSION_COOKIE_MAX_AGE_S,
  };
}

/** cookie قصير العمر يخفف عدد استدعاءات touch_panel_session من الـ proxy (الخادم يفرض الحد بنفسه). */
export const TOUCH_COOKIE = 'mk_touch';
export const TOUCH_THROTTLE_S = 120;
