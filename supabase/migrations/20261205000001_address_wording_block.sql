-- نص الإشعارات: "وحدة A3 - عمارة 12" ← "بلوك A3 - بناية 12" (قرار المالك 2026-11-18: بلوك/بناية/الطابق/شقة بكل مكان).
-- النص مكتوب بدوال قاعدة البيانات (place_order، set_order_status). بدل نسخ مئات الأسطر، نعيد تعريف كل دالة
-- تحتوي الصيغة القديمة بتبديل النصين الحرفيين فقط (يحفظ الصلاحيات وSECURITY DEFINER وsearch_path).
-- لا تغيير بالجداول ولا بالمخزّن بلقطات الطلبات (القيم "A3"، "12" نفسها). يفشل بوضوح إن لم تتغير أي دالة.
do $$
declare
  r record;
  v_def text;
  v_new text;
  v_changed integer := 0;
begin
  for r in
    select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and p.prosrc like '%''وحدة '' ||%'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(replace(v_def, '''وحدة '' ||', '''بلوك '' ||'), '|| '' - عمارة '' ||', '|| '' - بناية '' ||');
    if v_new <> v_def then
      execute v_new;
      v_changed := v_changed + 1;
    end if;
  end loop;
  if v_changed = 0 then
    raise exception 'address wording: no function contained the old push text';
  end if;
end $$;
