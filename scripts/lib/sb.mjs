// حارس أوامر Supabase CLI (H1، مراجعة C): يمنع الخلط بين التطوير والإنتاج.
//
// ملاحظة: كلمة "production" التي يطبعها الـ CLI v3 معناها "الفرع الافتراضي" لأي مشروع، وليست البيئة.
// لذلك لا نعتمد عليها: نصنّف المشروع المربوط (supabase/.temp/linked-project.json) بقائمتين صريحتين.
import fs from 'node:fs';
import path from 'node:path';
import { root } from './db.mjs';
import {
  DEV_NAME,
  DEV_PROJECT_REFS,
  PROD_NAME,
  PROD_PROJECT_REFS,
  classifyRef,
  isValidRef,
  refFromPoolerUrl,
} from './projects.mjs';

// القائمتان وتصنيف المشروع من projects.mjs (T23 H3: مصدر واحد مع db.mjs)
export { DEV_NAME, DEV_PROJECT_REFS, PROD_NAME, PROD_PROJECT_REFS, classifyRef, isValidRef };

// أوامر لا تحتاج مشروعاً مربوطاً ولا تغيّر شيئاً بالسحابة.
const NO_PROJECT = new Set(['login', 'logout', 'help', 'completion', 'init']);
const READ_ONLY = [
  ['projects', 'list'],
  ['branches', 'list'],
  ['migration', 'list'],
  ['functions', 'list'],
  ['db', 'advisors'],
  ['gen', 'types'],
  ['secrets', 'list'],
];

/** الأوامر الفرعية الموضعية (بدون الخيارات). */
export function positionals(args) {
  const out = [];
  for (const a of args) {
    if (a === '--') break;
    if (a.startsWith('-')) continue;
    out.push(a);
  }
  return out;
}

// أوامر الـ CLI التي تدعم --dry-run فعلاً (T23 L5): `db push` و`migration ...`. لغيرها العلم لا يمنع التنفيذ،
// فلا نعامله كقراءة فقط (مثلاً `functions deploy x --dry-run` على الإنتاج ينشر فعلاً إن تجاهله الـ CLI).
const DRY_RUN_COMMANDS = [['db', 'push'], ['migration']];

function supportsDryRun(pos) {
  return DRY_RUN_COMMANDS.some((c) => c.every((word, i) => pos[i] === word));
}

export function isReadOnly(args) {
  if (args.includes('--dry-run') && supportsDryRun(positionals(args))) return true;
  if (args.some((a) => a === '--version' || a === '-v' || a === '--help' || a === '-h'))
    return true;
  const pos = positionals(args);
  return READ_ONLY.some(([a, b]) => pos[0] === a && pos[1] === b);
}

/** كل ref صريح بالوسائط: --project-ref X، --project-ref=X، --remote=X، --remote X. */
export function explicitRefs(args) {
  const refs = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const m = a.match(/^--(?:project-ref|remote)=(.+)$/);
    if (m) refs.push(m[1]);
    else if (
      (a === '--project-ref' || a === '--remote') &&
      args[i + 1] &&
      !args[i + 1].startsWith('-')
    ) {
      refs.push(args[i + 1]);
    }
  }
  return refs;
}

/** كل رابط قاعدة بيانات صريح بالوسائط: --db-url X أو --db-url=X (T23 L5). */
export function dbUrls(args) {
  const urls = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    const m = a.match(/^--db-url=(.*)$/);
    if (m) urls.push(m[1]);
    else if (a === '--db-url') urls.push(args[i + 1] ?? '');
  }
  return urls;
}

export function readLinked(rootDir = root) {
  const p = path.join(rootDir, 'supabase', '.temp', 'linked-project.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ref: j.ref, name: j.name };
  } catch {
    return undefined;
  }
}

export const bannerFor = (kind, ref, name) =>
  kind === 'prod' ? `TARGET: *** PRODUCTION *** ${name} (${ref})` : `TARGET: DEV ${name} (${ref})`;

/**
 * قرار الحارس، دالة نقية.
 * يرجع { action: 'refuse', reason } أو { action: 'run', banner, args, confirmRef?, kind }.
 */
export function plan(args, { linked, env = process.env } = {}) {
  const pos = positionals(args);
  const first = pos[0];
  const refs = explicitRefs(args);

  // الهدف: ref الربط، أو الـ ref الصريح لأمر link.
  const ref = first === 'link' ? refs[0] : linked?.ref;

  if (!ref) {
    if (!first || NO_PROJECT.has(first) || (first === 'projects' && isReadOnly(args))) {
      return { action: 'run', kind: 'none', args, banner: 'TARGET: none (no project needed)' };
    }
    return {
      action: 'refuse',
      reason:
        first === 'link'
          ? 'link needs --project-ref <ref>.'
          : 'No linked project (supabase/.temp/linked-project.json). Link first: pnpm sb link --project-ref <ref>.',
    };
  }

  const kind = classifyRef(ref);
  if (kind === 'unknown') {
    return {
      action: 'refuse',
      reason: `Project ${ref} is not in DEV_PROJECT_REFS or PROD_PROJECT_REFS (scripts/lib/projects.mjs).`,
    };
  }
  if (kind === 'placeholder') {
    return {
      action: 'refuse',
      reason:
        `PROD_PROJECT_REFS still holds a placeholder (${ref}). The production project (${PROD_NAME}) ` +
        'is not registered: put its real ref in scripts/lib/projects.mjs first.',
    };
  }

  // أي ref صريح بالوسائط لازم يطابق الهدف المصنَّف (لا نشر لمشروع غير المربوط).
  for (const r of refs) {
    if (r !== ref) {
      return {
        action: 'refuse',
        reason: `Explicit project ${r} differs from the target ${ref}. Refusing to mix projects.`,
      };
    }
  }

  // --db-url يتجاوز المشروع المربوط كلياً (يتصل بأي قاعدة): يُقبل فقط إن كان رابطه لنفس المشروع المصنَّف (ref من
  // مستخدم الـ pooler "postgres.<ref>" أو مضيف db.<ref>.supabase.co)؛ ما لا نستطيع التحقق منه (محلي، مخصص) يُرفض.
  for (const u of dbUrls(args)) {
    const r = refFromPoolerUrl(u);
    if (r !== ref) {
      return {
        action: 'refuse',
        reason:
          r === null
            ? `--db-url could not be tied to the target project ${ref} (expected the pooler user postgres.${ref} ` +
              `or host db.${ref}.supabase.co). Refusing a database URL the guard cannot verify.`
            : `--db-url points at project ${r}, not the target ${ref}. Refusing to mix projects.`,
      };
    }
  }

  const name =
    kind === 'prod' ? PROD_NAME : first === 'link' ? DEV_NAME : (linked?.name ?? DEV_NAME);
  const banner = bannerFor(kind, ref, name);

  if (kind === 'dev') return { action: 'run', kind, args, banner };

  // إنتاج
  if (isReadOnly(args)) return { action: 'run', kind, args, banner };
  if (env.MUKHDAR_TARGET !== 'prod') {
    return {
      action: 'refuse',
      kind,
      banner,
      reason: 'Production target: set MUKHDAR_TARGET=prod to run a non-read-only command on it.',
    };
  }
  return {
    action: 'run',
    kind,
    banner,
    confirmRef: ref,
    // لا --yes على الإنتاج: يبقى سؤال الـ CLI نفسه.
    args: args.filter((a) => a !== '--yes' && a !== '-y'),
  };
}
