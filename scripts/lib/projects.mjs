// مصدر واحد لمشاريع Supabase المعروفة (T23 H3). كل الحرّاس (db.mjs لسكربتات البيانات، sb.mjs لأوامر CLI،
// load/lib.mjs لاختبار الحمل) يقرأون من هنا.
//
// القاعدة: ref الإنتاج **لا يُضاف أبداً** لـ DEV_PROJECT_REFS. القائمتان منفصلتان، وأي تداخل يوقف كل
// السكربتات عند التحميل (assertDisjoint). seed:demo وseed:reset يرفضان أي مشروع بقائمة الإنتاج حتى لو أُضيف
// خطأً لقائمة التطوير؛ اختبار الحمل على الإنتاج له مسار صريح منفصل (--target=prod + تأكيد مكتوب).

export const DEV_NAME = 'mukhdar-dev';
export const PROD_NAME = 'mukhdar-prod';

/** المشاريع التي يُسمح لسكربتات البيانات التجريبية بالكتابة عليها. */
export const DEV_PROJECT_REFS = ['ghcohlrzvehtcettaaiu']; // mukhdar-dev

// ref مشروع الإنتاج (mukhdar-prod). مكانه محجوز: القيمة الحالية ليست ref صالحاً، فالحارس يرفض كل شيء
// على الإنتاج إلى أن تُستبدل بالـ ref الحقيقي (20 حرفاً صغيراً) بنفس الـ commit الذي يُنشئ المشروع.
export const PROD_PROJECT_REFS = ['REPLACE_WITH_MUKHDAR_PROD_REF'];

const REF_RE = /^[a-z]{20}$/;
export const isValidRef = (ref) => typeof ref === 'string' && REF_RE.test(ref);

/** يرمي إن ظهر ref بالقائمتين (مثلاً أُضيف ref الإنتاج لقائمة التطوير). */
export function assertDisjoint(dev = DEV_PROJECT_REFS, prod = PROD_PROJECT_REFS) {
  const both = dev.filter((r) => prod.includes(r));
  if (both.length) {
    throw new Error(
      `Refusing: ${both.join(', ')} is listed as BOTH a dev and a production project ` +
        '(scripts/lib/projects.mjs). Never add the production ref to DEV_PROJECT_REFS.',
    );
  }
}

assertDisjoint();

/** 'dev' | 'prod' | 'placeholder' | 'unknown' */
export function classifyRef(ref, dev = DEV_PROJECT_REFS, prod = PROD_PROJECT_REFS) {
  if (!ref) return 'unknown';
  // الإنتاج أولاً: ref بالقائمتين يُعامل إنتاجاً (assertDisjoint يمنعه أصلاً)
  if (prod.includes(ref)) return isValidRef(ref) ? 'prod' : 'placeholder';
  if (dev.includes(ref)) return 'dev';
  return 'unknown';
}

/**
 * ref المشروع من رابط الـ pooler (المستخدم "postgres.<ref>")، أو من مضيف مباشر db.<ref>.supabase.co.
 * null إن لم يُعرف.
 */
export function refFromPoolerUrl(poolerUrl) {
  if (!poolerUrl) return null;
  try {
    const u = new URL(poolerUrl);
    const user = decodeURIComponent(u.username);
    const m = /^postgres\.([a-z0-9]+)$/.exec(user);
    if (m) return m[1];
    const h = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(u.hostname);
    return h ? h[1] : null;
  } catch {
    return null;
  }
}
