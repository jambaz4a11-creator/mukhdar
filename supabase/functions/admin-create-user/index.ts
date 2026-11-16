// Edge Function: admin-create-user (T19، SPEC-admin §2.6)
// لوحة الأدمن: supabase.functions.invoke('admin-create-user', { body: { phone, full_name, role, pin } })
// verify_jwt = true (البوابة) + auth.getUser + profiles.role = 'admin' ونشط (المعالج).
import { createAdminCreateUserHandler } from './handler.ts';
import { actionsLastHour, adminAuthDeps, log, serviceClient } from '../_shared/supabase.ts';

const admin = serviceClient();
const EXISTS_CODES = new Set(['phone_exists', 'user_already_exists']);

Deno.serve(
  createAdminCreateUserHandler({
    ...adminAuthDeps(admin),
    creationsLastHour: (adminId) => actionsLastHour(admin, 'user_creation', adminId),
    async createUser(phone, pin) {
      const { data, error } = await admin.auth.admin.createUser({
        phone,
        password: pin,
        phone_confirm: true,
      });
      if (!error && data.user) return { id: data.user.id };
      if (
        error &&
        (EXISTS_CODES.has(error.code ?? '') ||
          /already (been )?registered|already exists/i.test(error.message))
      ) {
        return 'exists';
      }
      throw new Error(`${error?.code ?? 'auth_error'}: ${error?.message ?? 'no user'}`);
    },
    async finish(userId, adminId, role, fullName) {
      const { error } = await admin.rpc('finish_user_creation', {
        p_user_id: userId,
        p_created_by: adminId,
        p_role: role,
        p_full_name: fullName,
      });
      if (error) throw new Error(error.message);
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
    log,
  }),
);
