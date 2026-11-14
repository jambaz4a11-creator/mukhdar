// إنشاء Supabase client مشترك. التخزين يُمرَّر كمعامل:
//   الموبايل: AsyncStorage (من التطبيق)، الويب: تخزين cookies (من التطبيق).
// الحزمة لا تعتمد على React Native ولا Next.
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import type { Database } from './database.types';

export type MukhdarClient = SupabaseClient<Database>;
export type { Session } from '@supabase/supabase-js';
export type AuthStorage = NonNullable<
  NonNullable<SupabaseClientOptions<'public'>['auth']>['storage']
>;

export interface CreateClientOptions {
  url: string;
  /** مفتاح anon / publishable فقط. مفتاح service_role مرفوض. */
  anonKey: string;
  /** أين تُحفظ الجلسة. بدونه: لا حفظ للجلسة (مناسب للاختبارات والخادم). */
  storage?: AuthStorage;
  /** للويب فقط (روابط الدخول). الموبايل: false. */
  detectSessionInUrl?: boolean;
}

function decodeBase64Url(segment: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = segment.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) return '';
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/** true إن كان المفتاح مفتاح خادم (service_role بصيغة JWT القديمة، أو sb_secret_ الجديدة). */
export function isServerKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(decodeBase64Url(payload)) as { role?: unknown };
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

export function createSupabaseClient(options: CreateClientOptions): MukhdarClient {
  if (!options.url || !options.anonKey) throw new Error('Supabase url and anon key are required');
  if (isServerKey(options.anonKey)) {
    throw new Error(
      'Refusing a service_role/secret key in an app client; use the anon (publishable) key',
    );
  }
  return createClient<Database>(options.url, options.anonKey, {
    auth: {
      storage: options.storage,
      persistSession: options.storage !== undefined,
      autoRefreshToken: options.storage !== undefined,
      detectSessionInUrl: options.detectSessionInUrl ?? false,
    },
  });
}
