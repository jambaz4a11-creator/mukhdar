// تنظيف احتياطي: أي حساب e2e بقي (اختبار انقطع قبل "حذف الحساب") يُحذف عبر Auth Admin API
// (الطلبات تبقى مجهّلة كما بحذف الحساب العادي). يطبع رمز HTTP لكل حذف ليُفحص يدوياً إن فشل.
import { E2E_PHONE_PREFIX, SERVICE_KEY, SUPABASE_URL, assertDev } from './env';

export default async function globalTeardown(): Promise<void> {
  if (!SERVICE_KEY || !SUPABASE_URL) {
    console.warn('[e2e teardown] SUPABASE_SERVICE_ROLE_KEY missing: leftover check skipped');
    return;
  }
  assertDev();
  const headers = { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` };
  const leftovers: { id: string; phone: string }[] = [];
  for (let page = 1; page < 50; page++) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=500`, {
      headers,
    });
    if (!res.ok) throw new Error(`[e2e teardown] list users: HTTP ${res.status}`);
    const { users } = (await res.json()) as { users: { id: string; phone: string | null }[] };
    for (const u of users)
      if (u.phone?.startsWith(E2E_PHONE_PREFIX)) leftovers.push({ id: u.id, phone: u.phone });
    if (users.length < 500) break;
  }
  for (const u of leftovers) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${u.id}`, {
      method: 'DELETE',
      headers,
    });
    console.warn(`[e2e teardown] leftover ${u.phone.slice(0, 7)}…: delete HTTP ${res.status}`);
  }
  if (leftovers.length === 0) console.log('[e2e teardown] no leftover e2e accounts');
}
