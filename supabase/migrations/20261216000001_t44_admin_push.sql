-- T44 (SPEC-admin-push §1): إشعارات اللوحة (أدمن + موظف) بلا بيانات زبون.
--   (1) place_order: نص "طلب جديد" للوحة كان "بلوك A3 - بناية 12 · المجموع X د.ع" ← "المجموع X د.ع" (لا عنوان بنص
--       الإشعار؛ قاعدة R3 M1 وطلب المالك). العنوان واسم الزبون داخل اللوحة فقط.
--   (2) set_order_status: الزبون ألغى طلبه ← إشعار 'admins' "الزبون ألغى الطلب #N" {order_id, type: customer_cancelled}.
--       بلا سبب الإلغاء (نص حر يكتبه الزبون) ولا عنوان. إلغاء الأدمن/الموظف/السائق لا يُبلّغ اللوحة (من ألغى يعرف).
-- نفس أسلوب R3 M1: تبديل حرفي داخل تعريف الدالة الحي (يحفظ الصلاحيات وSECURITY DEFINER وsearch_path)، ويفشل إن لم
-- يجد الموضع مرة واحدة بالضبط. لا تغيير بالجداول ولا بالبيانات.
do $$
declare
  v_oid  oid := 'public.place_order(uuid, jsonb, uuid, text)'::regprocedure;
  v_def  text := pg_get_functiondef(v_oid);
  -- بين السطرين مسافات وسطر جديد: \s* يتسامح معها
  v_pat  text := '''بلوك '' \|\| \(v_address ->> ''subsection''\) \|\| '' - بناية '' \|\| \(v_address ->> ''building''\)\s*\|\| '' · المجموع '' \|\| v_order\.total_iqd \|\| '' د\.ع''';
  v_new  text := '''المجموع '' || v_order.total_iqd || '' د.ع''';
  v_hits integer;
begin
  select count(*) into v_hits from regexp_matches(v_def, v_pat, 'g');
  if v_hits <> 1 then
    raise exception 'T44: expected exactly one new-order push body with the address in place_order, found %', v_hits;
  end if;
  execute regexp_replace(v_def, v_pat, v_new);
end $$;

do $$
declare
  v_oid  oid := 'public.set_order_status(uuid, public.order_status, text, boolean)'::regprocedure;
  v_def  text := pg_get_functiondef(v_oid);
  v_old  text := 'where v_order.driver_id is not null and v_order.driver_id <> v_uid;';
  v_add  text := E'\n'
    || '    -- T44: الزبون ألغى طلبه ← اللوحة (أدمن + موظف). بلا سبب الإلغاء (نص حر) ولا عنوان.' || E'\n'
    || '    perform public._notify(''admins'', null, ''الزبون ألغى الطلب #'' || v_order.order_number,' || E'\n'
    || '                           ''افتح الطلب باللوحة'',' || E'\n'
    || '                           jsonb_build_object(''order_id'', p_order_id, ''type'', ''customer_cancelled''))' || E'\n'
    || '      where v_role = ''customer'';';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'T44: expected exactly one driver-cancel notify anchor in set_order_status';
  end if;
  if position('customer_cancelled' in v_def) > 0 then
    raise exception 'T44: set_order_status already notifies the panel of customer cancellations';
  end if;
  execute replace(v_def, v_old, v_old || v_add);
end $$;
