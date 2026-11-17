// اتصال قاعدة البيانات المشترك لسكربتات التطوير (db-test، seed-demo، seed-reset).
//
// الأهداف:
//   local  -> Supabase المحلي (supabase start) أو DB_URL إن كان يشير لجهاز محلي
//   remote -> المشروع السحابي المربوط (supabase/.temp)، بكلمة السر من .env.local
//             وتحقق TLS كامل بشهادة Supabase Root 2021 CA
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { DEV_PROJECT_REFS, PROD_PROJECT_REFS, classifyRef, refFromPoolerUrl } from './projects.mjs';

export const root = path.resolve(import.meta.dirname, '..', '..');
export const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// المشاريع المعروفة بـ projects.mjs (T23 H3: مصدر واحد). لا تضف مشروع الإنتاج لقائمة التطوير أبداً.
export { DEV_PROJECT_REFS, PROD_PROJECT_REFS };

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'host.docker.internal']);

function readEnvLocal(name) {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(root, '.env.local');
  if (!fs.existsSync(envFile)) return undefined;
  const m = fs.readFileSync(envFile, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

// مجلد ربط Supabase CLI. MUKHDAR_SUPABASE_TEMP لاختبارات السكربتات فقط (مشروع مربوط مزيف)؛ الحارس يصنّف
// ما يُقرأ منه بنفس القواعد، فلا يفتح شيئاً.
export function tempDir(env = process.env) {
  return env.MUKHDAR_SUPABASE_TEMP || path.join(root, 'supabase', '.temp');
}

function readTemp(file, env = process.env) {
  const p = path.join(tempDir(env), file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : undefined;
}

/** يحدد الهدف من الوسائط: --remote للسحابة المربوطة، وإلا المحلي. */
export function resolveTarget(args = process.argv.slice(2), env = process.env) {
  if (args.includes('--remote')) {
    return {
      kind: 'remote',
      projectRef: readTemp('project-ref', env),
      poolerUrl: readTemp('pooler-url', env),
    };
  }
  return { kind: 'local', url: env.DB_URL ?? LOCAL_URL };
}

/**
 * يرفض الكتابة على أي شيء غير التطوير. يُستدعى قبل أي سكربت يغيّر البيانات (seed:demo، seed:reset، it:*...).
 * يرمي خطأ بالسبب؛ لا يرجع شيئاً عند السماح.
 * T23 H3: مشروع بقائمة الإنتاج يُرفض **دائماً** حتى لو أُضيف خطأً لقائمة التطوير، ورابط الـ pooler لازم
 * يشير لنفس المشروع المربوط (لا ref تطوير مع اتصال فعلي بالإنتاج).
 */
export function assertSafeTarget(
  target,
  env = process.env,
  lists = { dev: DEV_PROJECT_REFS, prod: PROD_PROJECT_REFS },
) {
  const envName = (env.MUKHDAR_ENV ?? '').toLowerCase();
  if (envName === 'production' || envName === 'prod') {
    throw new Error('Refusing: MUKHDAR_ENV is production. Demo data is for development only.');
  }
  if (target.kind === 'remote') {
    if (!target.projectRef) throw new Error('Refusing: no linked project (run `supabase link`).');
    const poolerRef = refFromPoolerUrl(target.poolerUrl);
    for (const ref of [target.projectRef, poolerRef]) {
      if (ref && lists.prod.includes(ref)) {
        throw new Error(
          `Refusing: ${ref} is the PRODUCTION project. Demo/test data scripts never run on production, ` +
            'whatever the allowlists say.',
        );
      }
    }
    if (classifyRef(target.projectRef, lists.dev, lists.prod) !== 'dev') {
      throw new Error(
        `Refusing: linked project ${target.projectRef} is not a known development project ` +
          `(allowed: ${lists.dev.join(', ')}).`,
      );
    }
    if (target.poolerUrl && poolerRef !== target.projectRef) {
      throw new Error(
        `Refusing: the pooler URL points to ${poolerRef ?? 'an unknown project'}, not the linked ` +
          `project ${target.projectRef}. Re-run \`supabase link\`.`,
      );
    }
    return;
  }
  const host = new URL(target.url).hostname.replace(/^\[|\]$/g, '');
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing: DB_URL host ${host} is not local. Use --remote for the dev project.`,
    );
  }
}

/** إعدادات pg.Client للهدف. */
export function connectionConfig(target) {
  if (target.kind === 'local') return { connectionString: target.url };
  if (!target.poolerUrl) throw new Error('Not linked: run `supabase link` first');
  const password = readEnvLocal('SUPABASE_DB_PASSWORD');
  if (!password) throw new Error('SUPABASE_DB_PASSWORD is not set (env or .env.local)');
  const url = new URL(target.poolerUrl);
  url.password = password;
  url.searchParams.delete('sslmode');
  // شهادة الـ pooler موقّعة من "Supabase Root 2021 CA" (غير موجودة بمخزن Node). تحقق كامل بها.
  const caFile =
    process.env.SUPABASE_CA_CERT ?? path.join(root, 'supabase', 'certs', 'prod-ca-2021.crt');
  if (!fs.existsSync(caFile)) {
    throw new Error(`Supabase CA certificate not found at ${caFile} (see docs/RUNBOOK.md).`);
  }
  return {
    connectionString: url.toString(),
    ssl: { ca: fs.readFileSync(caFile, 'utf8'), servername: url.hostname },
  };
}

export async function connect(target) {
  const client = new pg.Client(connectionConfig(target));
  await client.connect();
  return client;
}

/**
 * T23 F L3: حارس ثانٍ مستقل عن قوائم المراجع: قاعدة البيانات نفسها لازم تقول إنها تطوير
 * (`private.deployment.env = 'dev'`). الصف يُضاف محلياً بـ seed.sql ومرة واحدة يدوياً على mukhdar-dev، ولا يُضاف
 * على الإنتاج أبداً (RUNBOOK §17.2)، فخطأ بـ projects.mjs وحده لا يكفي لتشغيل سكربت بيانات تجريبية على الإنتاج.
 */
export async function assertDevDatabase(client) {
  let env;
  try {
    const { rows } = await client.query('select env from private.deployment');
    env = rows[0]?.env ?? null;
  } catch {
    env = null; // الجدول غير موجود (migration 20261202000001 لم تُطبَّق) = غير مُعلَّم
  }
  if (env !== 'dev') {
    throw new Error(
      `Refusing: this database is not marked as development (private.deployment.env = ${env ?? 'none'}). ` +
        'Demo/test data scripts run only where the dev marker exists (RUNBOOK §17.2).',
    );
  }
}

/** connect + assertDevDatabase: لكل سكربت يكتب بيانات تجريبية أو اختبارية (seed:*، it:*). */
export async function connectDev(target) {
  const client = await connect(target);
  try {
    await assertDevDatabase(client);
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
  return client;
}

export function describe(target) {
  return target.kind === 'remote'
    ? `remote project ${target.projectRef}`
    : `local ${new URL(target.url).host}`;
}

export { readEnvLocal };
