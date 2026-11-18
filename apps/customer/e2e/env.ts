// قراءة القيم اللازمة للاختبار من ملفات البيئة المحلية (مُتجاهلة بـ git). لا تطبع أي مفتاح.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readVar(file: string, name: string): string | undefined {
  try {
    const text = readFileSync(file, 'utf8');
    return new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const appDir = join(__dirname, '..');
const repo = join(appDir, '..', '..');

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? readVar(join(appDir, '.env'), 'EXPO_PUBLIC_SUPABASE_URL');
export const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  readVar(join(repo, '.env.local'), 'SUPABASE_SERVICE_ROLE_KEY');

/** بادئة حسابات e2e المؤقتة (ليست لأي شركة؛ 7006 لـ it:signup، 7008 لهذا الاختبار). */
export const E2E_PHONE_PREFIX = '9647008';

/** الاختبار يكتب على mukhdar-dev فقط. */
export function assertDev(): void {
  if (!SUPABASE_URL?.startsWith('https://ghcohlrzvehtcettaaiu.')) {
    throw new Error(
      `Refusing: customer e2e writes to mukhdar-dev only (got ${SUPABASE_URL ?? 'no URL'})`,
    );
  }
}
