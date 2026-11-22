# 40: قاعدة بيانات تسليم الكاش ✅

> **منجزة 2026-11-22 (PR #37، CI أخضر).** migration `20261212000001` على mukhdar-dev بـ `pnpm sb db push --remote` بعد dry-run؛ `migration list` مطابق 43 = 43؛ `db:test:remote` 39/39 (1739 تأكيداً، منها `39_cash_handover` 130). التزامن (CI): 5a–5d كلها تمر. `database.types.ts` من dev. **مؤجَّل لـ T42:** إعادة نشر `delete-account` (`CASH_OUTSTANDING` ← 409؛ قبلها 500 والحذف ممنوع على أي حال). فحص K9 بـ `39_cash_handover` و`12_delete_account`.

**الهدف:** SPEC-cash §2، §3 (K1–K19)، §9.1–§9.2. دفتر تسليمات بقاعدة البيانات: كل طلب مسلّم يبقى بذمة السائق حتى يُربط بتسليم كامل يسجّله أدمن أو موظف (aal2)، مع الفرق (نقص/زيادة) والتصحيح والتقرير ودالتي السائق، وإعداد الأجرة (Q1) بـ `app_settings`.
**يعتمد على:** قرار Q1 (محسوم 2026-11-22: إعداد للأدمن، SPEC-cash §11).
**النموذج المقترح:** **Opus** (أقفال، تزامن، RLS، ثابت محاسبي: الخطأ هنا يكلّف فلوساً).
**على dev (بموافقتك):** **migration واحدة** بـ `pnpm sb db push --remote` بعد `--dry-run` (لا MCP)، ثم `pnpm sb migration list --remote` (محلي = بعيد، 43 = 43) و`pnpm db:test:remote`. لا Edge Function ولا أسرار ولا Cloudflare. لا شيء على الإنتاج.
**الحجم:** L.

## الخطوات (TDD)
1. **الاختبارات أولاً:** `supabase/tests/39_cash_handover.sql` (كل حالات SPEC-cash §9.1، كل كتابة بـ `tests.as_user`/`tests.as_user_aal1` بالدور الحقيقي؛ postgres للتجهيز فقط) وتحديث الحراس: `01_schema` (قائمة دوال definer لـ authenticated، الجدول)، `12_delete_account` (`CASH_OUTSTANDING`)، `21_staff_money` (تصنيف `cash_handovers.*_iqd` و`app_settings.cash_handover_includes_delivery_fee`، دوال jsonb/TABLE)، `27_access_matrix` (`report_cash` أدمن فقط)، `28_mfa_aal` (دوال الأدمن/الموظف بالمصفوفة، دالتا السائق مستثناتان)، `32_real_role_writes` (تسليم كموظف aal2 وتصحيح كأدمن). تُشغَّل ← تفشل.
2. **migration** `supabase/migrations/20261212000001_cash_handover.sql`: K1 الجدول وقيوده (منها قيد `expected = goods + fees?`)، K2 `orders.cash_handover_id` وقيده وفهرسه، K3 RLS بلا صلاحيات، K4–K7 وK10–K13 الدوال (`security definer`، `search_path = ''`)، K8 الرصيد الافتتاحي، K9 `begin_account_deletion`، K14 قيد `admin_audit`، K16 المنح الصريحة، K19 العمود و`update_app_settings` (المفتاح الجديد، مُدقَّق).
3. **التحقق بلا Docker:** `pnpm db:test:remote --prelude=supabase/migrations/20261212000001_cash_handover.sql` (يُطبَّق داخل معاملة كل ملف ويُلغى) حتى تمر كل الملفات.
4. **التزامن** `scripts/db-concurrency.mjs` (CI، محلي فقط): (5a) مسجِّلان معاً لنفس السائق بمفتاحين، 10 تكرارات ← تسليم واحد بالضبط؛ (5b) 5 توصيلات بالتوازي مع تسليمات متكررة ← الثابت صحيح، لا طلب مربوط مرتين ولا مفقود؛ (5c) نفس المفتاح بالتوازي ← صف واحد؛ (5d) تغيير إعداد الأجرة أثناء التسليم ← نجاح بقيمة محفوظة متسقة أو `CASH_BALANCE_CHANGED`. التنظيف يحذف التسليمات.
5. `packages/shared/src/errors.ts` (K15: `NO_CASH_OUTSTANDING`، `CASH_BALANCE_CHANGED`، `CASH_AMOUNT_INVALID`، `NOTE_REQUIRED`، `HANDOVER_NOT_FOUND`، `CASH_OUTSTANDING`) + اختبارها؛ `database.types.ts` (K18).
6. `scripts/seed-reset.mjs`: حذف تسليمات سواق العرض التي لم يبقَ لها طلب.
7. الوثائق: SPEC-backend §4/§5، DRIVER-API (دالتا السائق، الإشعار `cash_handover`، `CASH_OUTSTANDING`)، RUNBOOK §17 (البند 43)، SPEC-cash (إن تغيّر شيء).
8. CI أخضر ← (بموافقتك) dry-run ← `db push` على dev ← `migration list` ← `db:test:remote`.

## القبول
- كل بنود SPEC-cash §9.1 مغطاة بـ pgTAP بالدور الحقيقي وتمر محلياً (CI) وعلى dev.
- سيناريوهات التزامن §9.2 + تغيير الإعداد تمر بـ CI بلا deadlock.
- لا قراءة مباشرة لـ `cash_handovers` لأي دور؛ الموظف لا يصل لـ `report_cash` ولا `correct_cash_handover` ولا لتسليم أقدم من 7 أيام.
- تغيير إعداد الأجرة لا يغيّر أي تسليم مسجّل، ويُدقَّق.
- `migration list` مطابق (43 = 43)، والحراس الثلاثة (`21`، `27`، `28`) و`01_schema` تمر.

## الاختبارات
- pgTAP: `39_cash_handover.sql` + الحراس أعلاه (`pnpm db:test`، و`db:test:remote --prelude` قبل الدفع).
- `pnpm db:concurrency` (CI).
- Jest: `packages/shared` (رموز الأخطاء)، `--maxWorkers=2`، حزمة حزمة.
- `pnpm typecheck` بعد توليد الأنواع.
