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
