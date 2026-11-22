-- R3 M1 (مراجعة PWA وWeb Push، 2026-11-22): إشعار "تم إلغاء الطلب" للسائق المعيَّن كان نصه سبب الإلغاء الحر
-- (coalesce(v_reason, 'بلوك X - بناية Y'))، والسبب يكتبه الأدمن/الموظف وقد يحوي هاتف الزبون أو طابقه أو شقته فيظهر على
-- شاشة القفل (Expo بنص صريح لدى FCM/APNs، وWeb Push). القاعدة (SPEC-backend، SPEC-webpush §5.5): إشعار السائق = البلوك
-- والبناية فقط. السبب يبقى بالطلب (cancel_reason) وبسجل الحالات كما هو.
-- تبديل حرفي لموضع واحد بـ set_order_status (يحفظ الصلاحيات وSECURITY DEFINER وsearch_path)، ويفشل إن لم يجده.
do $$
declare
  v_oid oid := 'public.set_order_status(uuid, public.order_status, text, boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_oid);
  v_old text := 'coalesce(v_reason, ''بلوك '' || (v_order.address_snapshot ->> ''subsection'') || '' - بناية '' || (v_order.address_snapshot ->> ''building''))';
  v_new text := '''بلوك '' || (v_order.address_snapshot ->> ''subsection'') || '' - بناية '' || (v_order.address_snapshot ->> ''building'')';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'R3 M1: expected exactly one driver cancel body with the free-text reason in set_order_status';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
