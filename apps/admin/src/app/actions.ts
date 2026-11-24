'use server';
import { redirect } from 'next/navigation';
import { LOGIN_PATH } from '@/lib/access';
import { createClient } from '@/lib/supabase/server';

/**
 * خروج صريح من هذا الجهاز فقط (كتطبيق الزبون). قبل الخروج: حذف اشتراكات إشعارات هذه الجلسة من الخادم
 * (SPEC-admin-push §4، T44 متابعة): الإشعارات لم تعد تتوقف بانتهاء الجلسة، فالخروج الصريح هو ما يوقفها. هذا إضافة
 * لحذف العميل بالـ endpoint (Sidebar)، ويعمل حتى لو فشل ذاك. خروج الخمول لا يمر من هنا (الإشعارات تستمر).
 */
export async function signOut() {
  const supabase = await createClient();
  try {
    await supabase.rpc('forget_session_push');
  } catch {
    // الخروج لا يتعطل بسبب الإشعارات
  }
  await supabase.auth.signOut({ scope: 'local' });
  redirect(LOGIN_PATH);
}
