// مساعدات سكربت الطوارئ scripts/admin-break-glass.mjs (قابلة للاختبار بلا شبكة: breakGlass.test.mjs).
import crypto from 'node:crypto';

export const DEV_PROJECT_REF = 'ghcohlrzvehtcettaaiu'; // mukhdar-dev

/** 07XXXXXXXXX | +9647XXXXXXXXX | 9647XXXXXXXXX (أرقام عربية-هندية مقبولة) ← 9647XXXXXXXXX (كما بـ profiles). */
export function storedPhone(input) {
  const latin = String(input ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s\-()]/g, '');
  if (/^07\d{9}$/.test(latin)) return `964${latin.slice(1)}`;
  if (/^\+?9647\d{9}$/.test(latin)) return latin.replace(/^\+/, '');
  return null;
}

/** 6 أرقام عشوائية بلا تكرار ولا تسلسل ولا جزء من رقم الحساب (كقواعد validatePin الأساسية). */
export function randomPin(phone, random = (n) => crypto.randomInt(0, n)) {
  for (;;) {
    const pin = Array.from({ length: 6 }, () => random(10)).join('');
    const d = [...pin].map(Number);
    const repeats = [1, 2, 3].some((p) => d.every((x, i) => x === d[i % p]));
    const run = [1, -1].some((s) => d.every((x, i) => i === 0 || x - d[i - 1] === s));
    const fromPhone = phone && (phone.startsWith(pin) || phone.endsWith(pin));
    if (!repeats && !run && !fromPhone) return pin;
  }
}

export function projectRef(url) {
  try {
    const host = new URL(url).hostname;
    const m = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * هل يُسمح بالتشغيل؟ يرجع null إن سُمح، أو نص سبب الرفض (مراجعة جلسة C، M4).
 * الرمز يُطبع على الشاشة فقط ويُؤكَّد بالكتابة، فلا يُقبل stdin أو stdout مُحوَّل (أنبوب أو ملف أو tee أو CI):
 * سطر الرمز يبقى بالسجل والتأكيد يمكن تمريره بـ echo y |.
 *  - CI مضبوط ← رفض دائماً.
 *  - stdin وstdout كلاهما طرفية حقيقية ← مسموح.
 *  - غير ذلك ← مسموح فقط للاختبار: MUKHDAR_BREAK_GLASS_TEST=1 **ومعه** مشروع التطوير المعروف.
 */
export function interactiveGuard({ stdinTTY, stdoutTTY, env, ref }) {
  if (env.CI) return 'CI is set: break-glass must be run by a person on their own machine.';
  if (stdinTTY && stdoutTTY) return null;
  if (env.MUKHDAR_BREAK_GLASS_TEST === '1' && ref === DEV_PROJECT_REF) return null;
  return (
    'stdin and stdout must both be a real terminal (not piped, redirected, tee-ed or recorded), ' +
    'so the PIN is never captured in a log and the confirmation cannot be scripted. Nothing changed.'
  );
}
