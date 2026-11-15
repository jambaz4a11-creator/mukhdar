// Supabase لمكوّنات الخادم وأفعال الخادم: الجلسة من cookies (بمفتاح عام وجلسة المستخدم؛ RLS يحكم).
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@mukhdar/shared';
import { cookies } from 'next/headers';
import { readPublicEnv } from '../env';

export async function createClient() {
  const { url, key } = readPublicEnv();
  const store = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // من Server Component لا يمكن الكتابة؛ الـ proxy يجدد الجلسة.
        }
      },
    },
  });
}
