'use client';
// Supabase للمتصفح (الدخول والخروج). الجلسة بـ cookies يقرأها الخادم والـ proxy.
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@mukhdar/shared';

export function createClient() {
  // NEXT_PUBLIC_* تُستبدل وقت البناء، لذا تُقرأ هنا حرفياً.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Supabase env is missing');
  return createBrowserClient<Database>(url, key);
}
