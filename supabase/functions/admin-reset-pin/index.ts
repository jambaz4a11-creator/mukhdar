// Edge Function: admin-reset-pin (T19، SPEC-admin §2.6، ADR 0001)
// لوحة الأدمن: supabase.functions.invoke('admin-reset-pin', { body: { user_id, new_pin } })
// verify_jwt = true (البوابة) + auth.getUser + profiles.role = 'admin' ونشط + جلسة aal2 (المعالج، T23 C1).
// CORS: الأصول من سر ALLOWED_ORIGINS فقط (T23 H1)؛ الـ preflight يُرد عليه هنا.
import { createResetPinServer } from './handler.ts';
import { adminAuthDeps, allowedOrigins, log, rateHit, serviceClient } from '../_shared/supabase.ts';

const admin = serviceClient();

// ما يُخدم هنا هو نفسه ما تختبره cors_test.ts (المعالج ملفوفاً بـ CORS)
Deno.serve(
  createResetPinServer(
    {
      ...adminAuthDeps(admin),
      rateHit: (adminId) => rateHit(admin, 'pin_reset', adminId),
      async updatePassword(userId, pin) {
        const { error } = await admin.auth.admin.updateUserById(userId, { password: pin });
        if (error) throw new Error(`${error.code ?? 'auth_error'}: ${error.message}`);
      },
      async revokeSessions(userId) {
        const { error } = await admin.rpc('revoke_user_sessions', { p_user_id: userId });
        if (error) throw new Error(error.message);
      },
      async recordReset(userId, adminId) {
        const { error } = await admin.rpc('record_pin_reset', {
          p_user_id: userId,
          p_reset_by: adminId,
        });
        if (error) throw new Error(error.message);
      },
      log,
    },
    allowedOrigins(),
  ),
);
