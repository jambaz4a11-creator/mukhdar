// اتصال قاعدة البيانات المشترك لسكربتات التطوير (db-test، seed-demo، seed-reset).
//
// الأهداف:
//   local  -> Supabase المحلي (supabase start) أو DB_URL إن كان يشير لجهاز محلي
//   remote -> المشروع السحابي المربوط (supabase/.temp)، بكلمة السر من .env.local
//             وتحقق TLS كامل بشهادة Supabase Root 2021 CA
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const root = path.resolve(import.meta.dirname, '..', '..');
export const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// المشاريع التي يُسمح لسكربتات البيانات التجريبية بالكتابة عليها. لا تضف مشروع الإنتاج أبداً.
export const DEV_PROJECT_REFS = ['ghcohlrzvehtcettaaiu']; // mukhdar-dev

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', 'host.docker.internal']);

function readEnvLocal(name) {
  if (process.env[name]) return process.env[name];
  const envFile = path.join(root, '.env.local');
  if (!fs.existsSync(envFile)) return undefined;
  const m = fs.readFileSync(envFile, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

function readTemp(file) {
  const p = path.join(root, 'supabase', '.temp', file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : undefined;
}

/** يحدد الهدف من الوسائط: --remote للسحابة المربوطة، وإلا المحلي. */
export function resolveTarget(args = process.argv.slice(2), env = process.env) {
  if (args.includes('--remote')) {
    return {
      kind: 'remote',
      projectRef: readTemp('project-ref'),
      poolerUrl: readTemp('pooler-url'),
    };
  }
  return { kind: 'local', url: env.DB_URL ?? LOCAL_URL };
}

/**
 * يرفض الكتابة على أي شيء غير التطوير. يُستدعى قبل أي سكربت يغيّر البيانات.
 * يرمي خطأ بالسبب؛ لا يرجع شيئاً عند السماح.
 */
export function assertSafeTarget(target, env = process.env) {
  const envName = (env.MUKHDAR_ENV ?? '').toLowerCase();
  if (envName === 'production' || envName === 'prod') {
    throw new Error('Refusing: MUKHDAR_ENV is production. Demo data is for development only.');
  }
  if (target.kind === 'remote') {
    if (!target.projectRef) throw new Error('Refusing: no linked project (run `supabase link`).');
    if (!DEV_PROJECT_REFS.includes(target.projectRef)) {
      throw new Error(
        `Refusing: linked project ${target.projectRef} is not a known development project ` +
          `(allowed: ${DEV_PROJECT_REFS.join(', ')}).`,
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

export function describe(target) {
  return target.kind === 'remote'
    ? `remote project ${target.projectRef}`
    : `local ${new URL(target.url).host}`;
}

export { readEnvLocal };
