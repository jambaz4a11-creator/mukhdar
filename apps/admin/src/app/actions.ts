'use server';
import { redirect } from 'next/navigation';
import { LOGIN_PATH } from '@/lib/access';
import { createClient } from '@/lib/supabase/server';

/** خروج من هذا الجهاز فقط (كتطبيق الزبون). */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect(LOGIN_PATH);
}
