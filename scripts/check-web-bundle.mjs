// يفحص مجلد تصدير الويب (dist) من الأسرار قبل النشر (T37، SPEC-webpush §5.1). يفشل بلا طباعة السر نفسه.
//   node scripts/check-web-bundle.mjs <dist>
// يُشغَّل بنهاية export:web للتطبيقين (محلياً وبـ CI وبناء Cloudflare Pages).
// النصوص التي يرفض بها الكود المفاتيح ("sb_secret_"، "service_role") ليست أسراراً: نبحث عن أشكال المفاتيح الفعلية.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TEXT = new Set(['.js', '.mjs', '.html', '.json', '.css', '.map', '.txt', '.webmanifest', '']);
/** متغيرات بيئة سرية: إن كانت مضبوطة وقت البناء فقيمتها ممنوعة بالـ bundle. */
const SECRET_ENV = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY',
  'VAPID_PRIVATE_KEY',
  'DB_PASSWORD',
  'SUPABASE_DB_PASSWORD',
];

function jwtRole(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof claims?.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

/** يرجع وصفاً لكل سر موجود بالنص (بلا قيمته). */
export function findSecrets(text, env = process.env) {
  const found = [];
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) found.push('sb_secret_ key');
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
    if (jwtRole(m[0]) === 'service_role') {
      found.push('service_role JWT');
      break;
    }
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) found.push('PEM private key');
  if (/\bVAPID_PRIVATE_KEY\b/.test(text)) found.push('reference to VAPID_PRIVATE_KEY');
  for (const name of SECRET_ENV) {
    const value = (env[name] ?? '').trim();
    if (value.length >= 16 && text.includes(value)) found.push(`value of $${name}`);
  }
  return found;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** كل الملفات النصية تحت dir: "ملف: وصف" لكل سر. */
export function scanDir(dir, env = process.env) {
  const out = [];
  for (const file of walk(dir)) {
    if (!TEXT.has(extname(file).toLowerCase())) continue;
    for (const what of findSecrets(readFileSync(file, 'utf8'), env)) {
      out.push(`${relative(dir, file)}: ${what}`);
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    process.stderr.write('usage: node scripts/check-web-bundle.mjs <dist>\n');
    process.exit(2);
  }
  const findings = scanDir(resolve(dir));
  if (findings.length > 0) {
    process.stderr.write(`check-web-bundle: SECRET FOUND in ${dir}\n  ${findings.join('\n  ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`check-web-bundle: ${dir} has no secrets\n`);
}
