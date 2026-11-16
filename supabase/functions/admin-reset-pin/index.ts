// Edge Function: admin-reset-pin (T19، SPEC-admin §2.6، ADR 0001)
// لوحة الأدمن: supabase.functions.invoke('admin-reset-pin', { body: { user_id, new_pin } })
// verify_jwt = true (البوابة) + auth.getUser + profiles.role = 'admin' ونشط (المعالج).
import { createResetPinHandler } from './handler.ts';
import { actionsLastHour, adminAuthDeps, log, serviceClient } from '../_shared/supabase.ts';

const admin = serviceClient();

Deno.serve(
  createResetPinHandler({
    ...adminAuthDeps(admin),
    resetsLastHour: (adminId) => actionsLastHour(admin, 'pin_reset', adminId),
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
  }),
);
