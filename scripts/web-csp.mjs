// CSP بلا 'unsafe-inline' للسكربت (T37، SPEC-webpush §6.4) لتطبيقَي الويب (الزبون والسائق).
// public/_headers يحوي العلامة بعد script-src 'self'؛ postexport-web.mjs يستبدلها بهاشات كل <script> داخلي
// بـ dist/index.html النهائي (اليوم: لا شيء، فتبقى 'self' وحدها). أي شكل غير متوقع ← خطأ يوقف البناء.
import { createHash } from 'node:crypto';

export const SCRIPT_HASHES_PLACEHOLDER = '__SCRIPT_HASHES__';

/** هاش 'sha256-…' لكل <script> داخلي قابل للتنفيذ (بلا src، وليس كتلة بيانات JSON)، بنفس البايتات. */
export function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (
      type &&
      type !== 'module' &&
      type !== 'text/javascript' &&
      type !== 'application/javascript'
    ) {
      continue; // application/json وما شابه: بيانات لا تُنفَّذ
    }
    out.push(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return out;
}

/** يرجع _headers بعد استبدال العلامة. يرفض unsafe-inline/unsafe-eval بـ script-src ومعالجات الأحداث الداخلية. */
export function applyScriptHashes(headers, html) {
  if (!headers.includes(SCRIPT_HASHES_PLACEHOLDER)) {
    throw new Error(`web-csp: ${SCRIPT_HASHES_PLACEHOLDER} placeholder not found in _headers`);
  }
  for (const m of headers.matchAll(/script-src\b([^;\n]*)/g)) {
    if (/'unsafe-(inline|eval)'/.test(m[1])) {
      throw new Error("web-csp: 'unsafe-inline'/'unsafe-eval' is not allowed in script-src");
    }
  }
  if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(html)) {
    throw new Error('web-csp: inline event handler attribute in index.html (blocked by the CSP)');
  }
  const hashes = inlineScriptHashes(html);
  return headers.replaceAll(SCRIPT_HASHES_PLACEHOLDER, hashes.length ? ` ${hashes.join(' ')}` : '');
}
