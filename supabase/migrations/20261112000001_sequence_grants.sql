-- N2 (تكملة): لا صلاحيات على sequences بـ public لـ anon و authenticated، الحالية والمستقبلية.
-- المشروع السحابي لا يمنح anon هذه الصلاحيات افتراضياً، لكن Supabase المحلي (CI) يمنحها،
-- فاختبار 01_schema.sql فشل محلياً فقط. أعمدة identity لا تحتاج صلاحية على الـ sequence.
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
