// بيانات دخول العرض لاختبارات e2e (تجهيز الـ repo ليصير عاماً، 2026-11-22): البيئة أولاً، ثم .env.local بجذر
// المستودع (مُتجاهل بـ git؛ نفس ملف seed:demo وdemo:rotate، RUNBOOK §6). بلا قيمة ← undefined، والمستدعي يقرر
// (الافتراضي العام صالح للمكدس المحلي/CI فقط، لا على mukhdar-dev).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_ENV = join(__dirname, '..', '..', '..', '.env.local');

export function demoEnv(...names: string[]): string | undefined {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  let text: string;
  try {
    text = readFileSync(ROOT_ENV, 'utf8');
  } catch {
    return undefined;
  }
  for (const name of names) {
    const v = new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1]?.trim();
    if (v) return v;
  }
  return undefined;
}
