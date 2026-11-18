-- =====================================================================
-- إصلاح: الاسم والعنوان يفشلان للزبون الحقيقي (بلاغ iOS Safari، 2026-11-18)
--
-- السبب: trigger التنظيف (20261201000001، T23 E2 L3) كان SECURITY INVOKER، فيعمل بدور المستدعي
-- (authenticated) ويستدعي private.clean_user_text التي سُحب EXECUTE منها لكل الأدوار ← 42501
-- "permission denied for function clean_user_text" عند حفظ الاسم بعد التسجيل وعند إضافة/تعديل عنوان.
-- اختبارات pgTAP لم تكشفه لأنها كانت تكتب الاسم والعنوان بدور postgres (المالك) لا بدور الزبون.
--
-- الإصلاح: الدالتان SECURITY DEFINER بـ search_path = '' (كل الأسماء مؤهلة بالمخطط)، وEXECUTE يبقى
-- مسحوباً من كل الأدوار (Postgres لا يفحص EXECUTE لدالة trigger عند تشغيلها؛ يفحص ما بداخلها فقط).
--
-- تدقيق نفس الصنف من الأخطاء بكل القاعدة (mukhdar-dev، 2026-11-18؛ التفاصيل بـ SPEC-backend §12.8):
--   1. triggers على جداول public/private/auth بدالة SECURITY INVOKER:
--      - private.tg_clean_profile_name   ← تستدعي private.clean_user_text  (مكسورة: أُصلحت هنا)
--      - private.tg_clean_address_text   ← تستدعي private.clean_user_text  (مكسورة: أُصلحت هنا)
--      - public.set_updated_at, private.tg_profiles_pin_reset_at  ← now() فقط (سليمتان)
--      - private.tg_require_valid_phone (auth.users) ← regex فقط (سليمة)
--      باقي دوال الـ triggers SECURITY DEFINER أصلاً.
--   2. سياسات RLS: تعتمد على private.is_admin/is_staff_or_admin/current_user_role (definer) وpublic.baghdad_today
--      وauth.uid؛ كلها قابلة للتنفيذ من anon وauthenticated مع USAGE على private (سليمة).
--   3. القيم الافتراضية: gen_random_uuid() وnow() وعمود محسوب (سليمة).
--   4. دوال SECURITY INVOKER قابلة للاستدعاء: round_iqd، baghdad_today، public.is_admin/is_staff_or_admin/
--      current_user_role (تغلّف دوال private المسموحة)، panel_session_alive، set_default_address (تحدّث
--      is_default فقط فلا يعمل trigger التنظيف)، finish_push_notifications (service_role فقط) (سليمة).
--   اختبار 32_real_role_writes.sql يثبت البنود 1-3 آلياً لكل جدول مستقبلاً.
-- =====================================================================

alter function private.tg_clean_profile_name() security definer;
alter function private.tg_clean_profile_name() set search_path = '';
revoke all on function private.tg_clean_profile_name() from public, anon, authenticated, service_role;

alter function private.tg_clean_address_text() security definer;
alter function private.tg_clean_address_text() set search_path = '';
revoke all on function private.tg_clean_address_text() from public, anon, authenticated, service_role;
