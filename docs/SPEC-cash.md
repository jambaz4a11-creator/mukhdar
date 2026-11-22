# SPEC-cash: تسليم الكاش من السائق للمتجر (تسليم الكاش)

> **الحالة: معتمدة (قرار المالك 2026-11-22).** Q1 محسومة كإعداد للأدمن (§3.1 K19، §11)؛ Q2–Q5 وافتراضات §12 معتمدة كما كُتبت. المهام T40–T42 وR4 (§10).
> **مرتبطة بـ:** SPEC-driver §2.9 (سجل اليوم)، SPEC-admin §2.11 (صفحة جديدة) و§2.5 (التقارير)، SPEC-backend §4 و§5، DRIVER-API (تُحدَّث بـ T40).
> **مصدر الحقيقة عند التنفيذ:** الـ migration. هذا الملف يشرح **ماذا** و**لماذا**.

---

## 1) الهدف

**المشكلة:** تطبيق السائق يعرض "الكاش اللي بيدك" (مجموع طلبات اليوم المسلّمة)، لكن لا شيء يسجّل أن السائق سلّم الكاش للمتجر. الرقم يتصفّر منتصف الليل حتى لو ما سلّم شيئاً، ولا أثر لأي نقص.

**الحل:** دفتر تسليمات بقاعدة البيانات. كل طلب مسلّم (`delivered`) يبقى "بذمة السائق" حتى يُربط بتسليم. التسليم **كامل دائماً**: عملية واحدة تغلق كل رصيد السائق، والمسجِّل يكتب المبلغ الذي استلمه فعلاً، والفرق يُسجَّل نقصاً أو زيادة بملاحظة إلزامية.

### المستخدمون
- **من يفتح اللوحة (أدمن أو موظف بجلسة aal2):** يرى رصيد كل سائق ويسجّل التسليم.
- **السائق:** يرى رصيده منذ آخر تسليم، وسجل تسليماته، ويستلم إشعاراً بعد كل تسليم.
- **الأدمن:** التقارير (الكاش عند السواق الآن، والنقص والزيادة لكل سائق ولكل مدة) والتصحيح.

### قصص المستخدم ومعايير القبول

| # | القصة | القبول |
|---|---|---|
| C1 | كموظف أو أدمن أشوف كم بيد كل سائق | صفحة "تسليم الكاش": لكل سائق الرصيد وعدد الطلبات وأقدم توصيل غير مسلَّم وآخر تسليم. الأرقام من دالة بقاعدة البيانات |
| C2 | كموظف أو أدمن أسجّل استلام الكاش | نافذة تعرض المبلغ المطلوب (N طلب)؛ أكتب المستلم فعلاً؛ مساوٍ ← يُحفظ؛ أقل ← "نقص X" والملاحظة إلزامية؛ أكثر ← "زيادة X" والملاحظة إلزامية. بعد الحفظ رصيد السائق = 0 |
| C3 | كمسجِّل، إذا وصل توصيل جديد وأنا أعدّ الفلوس ما ينحسب غلط | الدالة ترفض إن تغيّر المبلغ أو العدد عمّا عُرض (`CASH_BALANCE_CHANGED` بالمبلغ الجديد)؛ النافذة تتحدّث وتطلب العدّ من جديد. ما يُسجَّل نقصاً بسبب توصيل لم يُعرض |
| C4 | اثنان يسجّلان لنفس السائق بنفس اللحظة | واحد فقط ينجح؛ الثاني `CASH_BALANCE_CHANGED` (الرصيد صار 0). ضغطتان من نفس النافذة = تسليم واحد (مفتاح منع التكرار) |
| C5 | كسائق أعرف الكاش اللي بيدي | "الكاش اللي بيدك" = مجموع طلباتي المسلّمة **منذ آخر تسليم** (لا منذ منتصف الليل)، مع العدد وتاريخ آخر تسليم، من دالة بقاعدة البيانات |
| C6 | كسائق أشوف سجل تسليماتي | قائمة: الوقت، المستلم، المطلوب، شارة نقص/زيادة بمبلغها، الملاحظة، اسم من استلم |
| C7 | كسائق أعرف فوراً إن المتجر سجّل استلامي | إشعار "استلمنا منك X د.ع" (و" · نقص Y د.ع" أو " · زيادة Y د.ع" إن وُجد فرق) يفتح شاشة الكاش |
| C8 | كأدمن أشوف التقارير | بالتقارير: الكاش عند السواق الآن (مجموع وعدد السواق)، ولكل سائق بالمدى: عدد التسليمات، المطلوب، المستلم، النقص، الزيادة. الموظف لا يصل (`NOT_ALLOWED`) |
| C9 | كأدمن أصحّح مبلغاً كُتب غلط | "تصحيح" (أدمن فقط) يغيّر المبلغ المستلم والملاحظة، يُدقَّق بـ `admin_audit` (القديم ← الجديد)، ويُبلَّغ السائق. الطلبات المربوطة لا تتغير |
| C10 | كل تسليم وتصحيح مسجّل | سطر `admin_audit` (`action = 'cash_handover'`) من الدالة نفسها |

### خارج النطاق (النسخة الأولى)
- دفع أجور السواق أو تسويتها (§11 Q1).
- تسليم جزئي، أو اختيار طلبات بعينها للتسليم (القرار: كامل دائماً).
- إلغاء تسليم وإرجاع طلباته للرصيد (التصحيح يغيّر المبلغ فقط).
- أي تأثير على المبيعات أو صافي الربح (§11 Q2).
- تسجيل السائق للتسليم بنفسه، أو توقيع/تأكيد منه داخل التطبيق.

---

## 2) المفاهيم والتعريفات

| المصطلح | التعريف (يُحسب بقاعدة البيانات فقط) |
|---|---|
| **طلب بذمة السائق** | `orders.status = 'delivered'` و`driver_id = <السائق>` و`cash_handover_id is null` |
| **إعداد الأجرة** (`app_settings.cash_handover_includes_delivery_fee`) | قرار المالك Q1: إعداد للأدمن (K19). `true` (الافتراضي) = "أجرة التوصيل للمحل": السائق يسلّم **المجموع كاملاً** (`total_iqd`). `false` = "أجرة التوصيل تبقى عند السائق": يسلّم **مبلغ البضاعة فقط** (`subtotal_iqd`) |
| **مبلغ الطلب المطلوب** | `subtotal_iqd + (delivery_fee_iqd إن كان الإعداد true)`؛ للطلبات بذمته يُحسب **بالإعداد الحالي** |
| **الرصيد** (`outstanding_iqd`) | Σ مبلغ الطلب المطلوب للطلبات بذمته، بالإعداد الحالي |
| **التسليم** | صف بـ `cash_handovers` يربط **كل** الطلبات بذمة السائق لحظة التسجيل. يحفظ `goods_iqd` (Σ `subtotal_iqd`) و`fees_iqd` (Σ `delivery_fee_iqd`) و`includes_delivery_fee` (قيمة الإعداد **لحظة التسجيل**) و`expected_iqd` = `goods_iqd + (fees_iqd إن كان true)`، و`received_iqd` = ما كتبه المسجِّل. تغيير الإعداد لاحقاً **لا يعيد حساب** أي تسليم مسجّل؛ يؤثر فقط على الرصيد الحالي والتسليمات القادمة |
| **الفرق** (`difference_iqd`) | `received_iqd − expected_iqd`. سالب = **نقص**، موجب = **زيادة**، صفر = مطابق |
| **الكاش عند السواق الآن** | Σ الرصيد لكل السواق |
| **اليوم/المدة بالتقارير** | بتوقيت بغداد حسب `recorded_at` للتسليم (نفس نمط T20) |

**الثابت (invariant) الذي تحرسه الاختبارات:** كل طلب مسلّم ينتمي لتسليم واحد بالضبط أو للرصيد. لكل تسليم: `goods_iqd` = Σ `subtotal_iqd` لطلباته، `fees_iqd` = Σ `delivery_fee_iqd`، `order_count` = عددها، و`expected_iqd = goods_iqd + (fees_iqd إن كان includes_delivery_fee)` (قيد CHECK). فلكل سائق: Σ `subtotal_iqd` لكل طلباته المسلّمة = Σ `goods_iqd` لتسليماته + Σ `subtotal_iqd` للطلبات بذمته (ومثله للأجرة)، بغض النظر عن تغييرات الإعداد.

---

## 3) تغييرات قاعدة البيانات (migration واحدة جديدة، مثلاً `20261212000001_cash_handover.sql`)

### 3.1 القائمة الكاملة

| # | التغيير | التفاصيل |
|---|---|---|
| K1 | جدول `public.cash_handovers` | `id uuid pk default gen_random_uuid()`؛ `driver_id uuid null → profiles on delete set null` (حذف حساب سائق برصيد ممنوع، K9؛ بعد الحذف يُعرض "سائق محذوف")؛ `kind text not null default 'handover'` (`handover` \| `opening`، K8)؛ `order_count int not null check (> 0)`؛ `goods_iqd bigint not null check (>= 0)` (Σ `subtotal_iqd`)؛ `fees_iqd bigint not null check (>= 0)` (Σ `delivery_fee_iqd`)؛ `includes_delivery_fee boolean not null` (الإعداد K19 لحظة التسجيل)؛ `expected_iqd bigint not null check (>= 0)` مع قيد `expected_iqd = goods_iqd + case when includes_delivery_fee then fees_iqd else 0 end`؛ `received_iqd bigint not null check (>= 0 and % 250 = 0)`؛ `difference_iqd bigint generated always as (received_iqd - expected_iqd) stored`؛ `note text null` (≤ 300 بعد `clean_user_text`)؛ قيد `difference_iqd = 0 or note is not null` (الملاحظة إلزامية مع أي فرق)؛ `first_delivered_at`/`last_delivered_at timestamptz not null` (المدة المغطاة)؛ `recorded_by uuid null → profiles on delete set null`؛ `recorded_by_role text null` (`admin`/`staff`؛ null لـ `opening`)؛ `recorded_at timestamptz not null default now()`؛ `idempotency_key uuid not null unique`؛ التصحيح: `original_received_iqd bigint null`، `corrected_at`، `corrected_by → profiles on delete set null`. فهارس: `(driver_id, recorded_at desc)`، `(recorded_at)` |
| K2 | عمود `orders.cash_handover_id` | `uuid null → cash_handovers(id) on delete restrict`؛ قيد `orders_cash_handover_delivered_check`: `cash_handover_id is null or status = 'delivered'`؛ فهرس جزئي `orders (driver_id) where status = 'delivered' and cash_handover_id is null` (الرصيد بلا مسح للجدول). لا صلاحية update عليه لأي دور (كتابة الطلبات عبر الدوال فقط، كما هي) |
| K3 | RLS والصلاحيات | `cash_handovers`: RLS مفعّل؛ `revoke all` من `anon`/`authenticated`؛ **لا قراءة مباشرة لأي دور** (حتى الأدمن): كل القراءة عبر الدوال K4–K7 (تطبّق قاعدة الموظف 7 أيام والسائق صفوفه فقط بمكان واحد). `service_role`: لا شيء |
| K4 | `public.cash_outstanding() → setof (driver_id, full_name, phone, is_active, outstanding_iqd, order_count, oldest_delivered_at, last_handover_at, last_received_iqd, last_difference_iqd, includes_delivery_fee)` (الأخير = الإعداد الحالي، لتعرض النافذة "شامل أجرة التوصيل" أو "بدون أجرة التوصيل") | أدمن أو موظف aal2 (وإلا `NOT_ALLOWED`). كل حساب دوره `driver`، **وأي** حساب آخر له رصيد > 0 (سائق خُفّض دوره أو عُطّل ما زال بذمته كاش). مرتب بالرصيد تنازلياً ثم الاسم. حساب برصيد 0 وغير فعّال لا يظهر |
| K5 | `public.cash_outstanding_orders(p_driver_id uuid) → setof (order_id, order_number, delivered_at, total_iqd, delivery_fee_iqd, subsection, building)` | أدمن أو موظف aal2. طلبات السائق بذمته، الأحدث أولاً، حد 500 (أكثر = خطأ تشغيلي يُرى بالعدد بـ K4). البلوك والبناية فقط من لقطة العنوان (لا اسم ولا هاتف زبون، فلا تتجاوز قاعدة الموظف 7 أيام بالطلبات) |
| K6 | `public.record_cash_handover(p_driver_id uuid, p_expected_iqd bigint, p_order_count int, p_received_iqd bigint, p_note text, p_idempotency_key uuid) → jsonb` | §3.2 |
| K7 | `public.cash_handover_history(p_driver_id uuid default null, p_from date default null, p_to date default null, p_limit int default 50, p_before_at timestamptz default null, p_before_id uuid default null) → setof (...)` | أدمن aal2: كل شيء؛ موظف aal2: **آخر 7 أيام بتوقيت بغداد فقط** (نفس قاعدة الطلبات والتقييمات، T23 M6/F M1)؛ غيرهم `NOT_ALLOWED`. keyset على (`recorded_at`, `id`) تنازلياً، `p_limit` 1..200. الأعمدة: كل أعمدة K1 + `driver_name` + `recorded_by_name` + `corrected_by_name` (المحذوف ← null، الواجهة تعرض "محذوف"). `kind = 'opening'` لا يُرجَع |
| K8 | الرصيد الافتتاحي (بنفس الـ migration) | لكل سائق له طلبات مسلّمة **قبل** الـ migration: صف `kind = 'opening'`، `received = expected`، `recorded_by = null`، مفتاح عشوائي، والطلبات تُربط به. بلا إشعار ولا تدقيق. **السبب:** بلا ذلك يبدأ كل سائق برصيد كل تاريخه. على dev = بيانات تجريبية؛ الإنتاج يبدأ فارغاً فلا أثر. التقارير وسجل السائق تستثني `opening` |
| K9 | `begin_account_deletion` | سائق (أو أي حساب) له رصيد > 0 ← `CASH_OUTSTANDING` (409، `detail` = المبلغ)، بنفس قفل الحساب الموجود. تطبيق السائق: "عندك كاش ما سلّمته للمحل (X د.ع). سلّمه أولاً". بعد التسليم يُحذف عادياً و`driver_id` بالتسليمات يصير null |
| K10 | `public.driver_cash_summary() → table(outstanding_iqd, order_count, oldest_delivered_at, last_handover_at, last_received_iqd, last_difference_iqd, includes_delivery_fee)` | سائق فعّال فقط (نفس فحص `available_orders`؛ وإلا `NOT_ALLOWED`). صف واحد دائماً (أصفار ونُل بلا بيانات) |
| K11 | `public.my_cash_handovers(p_limit int default 20, p_before_at timestamptz default null, p_before_id uuid default null) → setof (id, recorded_at, order_count, expected_iqd, received_iqd, difference_iqd, includes_delivery_fee, note, recorded_by_name, corrected_at)` | سائق فعّال فقط، صفوفه فقط، بلا `opening`، keyset، `p_limit` 1..100. `recorded_by_name` = الاسم الأول فقط (لا هاتف الموظف) |
| K12 | `public.correct_cash_handover(p_id uuid, p_received_iqd bigint, p_note text) → jsonb` | **أدمن aal2 فقط**. قفل الصف؛ `kind = 'handover'` فقط (وإلا `HANDOVER_NOT_FOUND`)؛ نفس فحص المبلغ (`CASH_AMOUNT_INVALID`)؛ الملاحظة **إلزامية دائماً** هنا (`NOTE_REQUIRED`)؛ نفس المبلغ ← لا شيء. أول تصحيح يحفظ `original_received_iqd`. تدقيق `admin_audit` (`op = 'correct'`، before/after المبلغ والفرق والملاحظة)؛ إشعار للسائق "تعدّل تسليم الكاش: X د.ع" (`data.type = 'cash_handover'`) |
| K13 | `public.report_cash(p_from date, p_to date) → jsonb` | **أدمن aal2 فقط** (الموظف `NOT_ALLOWED`، كبقية التقارير T20). نفس تحقق المدى (`INVALID_DATE_RANGE`، 1..366 يوماً). `{held_now_iqd, held_now_drivers, totals: {handover_count, expected_iqd, received_iqd, shortage_iqd, overage_iqd, net_difference_iqd}, drivers: [{driver_id, full_name, handover_count, expected_iqd, received_iqd, shortage_iqd, overage_iqd, net_difference_iqd, held_now_iqd}]}`. `shortage_iqd` = Σ |الفرق| للفروق السالبة، `overage_iqd` = Σ الموجبة (منفصلين، لا يلغي أحدهما الآخر). بيوم `recorded_at` بغداد. السائق بلا تسليم بالمدى ورصيده > 0 يظهر بـ `held_now_iqd` فقط |
| K14 | قيد `admin_audit_action_check` | يضاف `'cash_handover'` (drop + add بنفس نمط `20261208000001`). `target_id` = التسليم. `op` = `record` \| `correct` |
| K15 | الأخطاء الجديدة (`packages/shared/src/errors.ts` + SPEC-backend §5) | `NO_CASH_OUTSTANDING`، `CASH_BALANCE_CHANGED`، `CASH_AMOUNT_INVALID`، `NOTE_REQUIRED`، `HANDOVER_NOT_FOUND`، `CASH_OUTSTANDING`. اختبار Jest الحالي يفشل إن نقص رمز |
| K16 | الصلاحيات والحراس | `grant execute` صريح: K4/K5/K6/K7 لـ `authenticated` (الدالة تفحص الدور)، K10/K11 لـ `authenticated`، K12/K13 لـ `authenticated`. تُضاف الدوال لقوائم `01_schema.sql` (دوال SECURITY DEFINER المكشوفة)، `27_access_matrix.sql`، حارس aal (`28_mfa_aal.sql`)، وحارس دوال definer. كلها `search_path = ''` |
| K17 | تصنيف المبالغ | `21_staff_money.sql`: كل عمود `*_iqd` جديد (`cash_handovers.*`) يُصنَّف "مبالغ بيع، للموظف عبر الدوال فقط" (لا قراءة مباشرة لأي دور)، و`report_cash` "أدمن فقط". عمود غير مصنّف يُفشل الاختبار كالعادة |
| K18 | الأنواع | `database.types.ts` يُولَّد من جديد |
| K19 | إعداد الأجرة (قرار المالك Q1) | `app_settings.cash_handover_includes_delivery_fee boolean not null default true`. يُغيَّر **عبر `update_app_settings` فقط** (أدمن aal2، مفتاح جديد بقائمة المفاتيح، `boolean` وإلا `INVALID_SETTINGS`)، ويُدقَّق تلقائياً (`admin_audit`، `action = 'settings'`، القديم ← الجديد). القراءة كبقية الإعدادات (`settings_read` العامة؛ ليس مبلغاً). يُصنَّف بـ `21_staff_money.sql` (الاسم يطابق نمط `fee`). K4/K6/K10 تقرأه؛ التسليم يحفظ قيمته (K1). **التغيير لا يعيد حساب التسليمات المسجّلة** |

`update_app_settings` تتغير لمفتاح K19 فقط (`create or replace`، نفس التوقيع). **لا تغيير** بـ `set_order_status` و`accept_order` و`assign_driver` و`available_orders` و`push-dispatch` و`claim_push_notifications` (الإشعار بجمهور `user` الموجود). لا Edge Function جديدة.

### 3.2 `record_cash_handover`: الخطوات (معاملة واحدة)

1. **الدور:** أدمن أو موظف بجلسة aal2 (`private.current_user_role()`؛ الرمز المؤقت والمعطّل يرجعان null) ← وإلا `NOT_ALLOWED`.
2. **المدخلات:** `p_driver_id` و`p_idempotency_key` غير null (`INVALID_REQUEST`، `detail` = الحقل)؛ `p_expected_iqd >= 0`، `p_order_count > 0` (`INVALID_REQUEST`)؛ `p_received_iqd` عدد ≥ 0 ومضاعف 250 و≤ `p_expected_iqd + 10,000,000` (حد عقلاني ضد خطأ كتابة صفر زائد) ← وإلا `CASH_AMOUNT_INVALID`؛ الملاحظة تُنظَّف بـ `clean_user_text` و≤ 300 (`INVALID_REQUEST`، `detail = 'note'`).
3. **منع التكرار (سريع):** مفتاح موجود ← إن كان لنفس السائق يرجع نفس النتيجة مع `replayed: true`، وإلا `INVALID_REQUEST` (`detail = 'idempotency_key'`).
4. **قفل السائق:** `pg_advisory_xact_lock(hashtextextended('cash_handover:' || p_driver_id, 0))`؛ ثم إعادة فحص المفتاح (ضغطتان متوازيتان).
5. **قفل الطلبات:** `select ... from orders where driver_id = p_driver_id and status = 'delivered' and cash_handover_id is null order by id for update`. صفر صفوف ← `NO_CASH_OUTSTANDING`.
6. **الإعداد والمقارنة المتفائلة:** يُقرأ `cash_handover_includes_delivery_fee` مرة واحدة، والمجموع = Σ `subtotal_iqd` + (Σ `delivery_fee_iqd` إن كان true). المجموع ≠ `p_expected_iqd` أو العدد ≠ `p_order_count` ← `CASH_BALANCE_CHANGED` (`detail` = `{"expected_iqd": N, "order_count": M}` نصاً). المسجِّل كتب مبلغاً مقابل رقم معروض؛ أي تغيير بعد العرض يعني أن العدّ يجب أن يُعاد.
7. **الملاحظة:** `received ≠ expected` بلا ملاحظة ← `NOTE_REQUIRED`.
8. **الإدراج والربط:** صف `cash_handovers` (`goods_iqd`، `fees_iqd`، `includes_delivery_fee` = القيمة المقروءة، `recorded_by = auth.uid()`، `recorded_by_role`)، و`update orders set cash_handover_id = <id>` لنفس الصفوف المقفولة.
9. **التدقيق:** `admin_audit` (`action = 'cash_handover'`، `target_id` = التسليم، `after = {op: 'record', driver_id, order_count, expected_iqd, received_iqd, difference_iqd, note}`).
10. **الإشعار:** `_notify('user', p_driver_id, 'تسليم الكاش', 'استلمنا منك ' || <المبلغ بفواصل الآلاف> || ' د.ع' [|| ' · نقص Y د.ع' | ' · زيادة Y د.ع'], {type: 'cash_handover', handover_id})`. حساب `must_change_pin` لا يستلم (سلوك `claim_push_notifications` الموجود).
11. **يرجع:** `{handover_id, driver_id, order_count, expected_iqd, received_iqd, difference_iqd, recorded_at, replayed: false}`.

### 3.3 لماذا هذا آمن من السباقات

| السيناريو | ماذا يحدث |
|---|---|
| توصيل يكتمل **أثناء** التسليم | `set_order_status(delivered)` يقفل صف الطلب ويغيّره. جملة الخطوة 5 (`READ COMMITTED`) ترى فقط الطلبات المسلّمة **الملتزمة** لحظة بدئها؛ الطلب الذي ما زال `out_for_delivery` بلقطتها لا يطابق ولا يُقفل، فيبقى بالرصيد للتسليم القادم. لا يُفقد ولا يُحسب مرتين |
| الأدمن يغيّر إعداد الأجرة **بين** عرض النافذة والضغط | المجموع بالإعداد الجديد يختلف (إن وُجدت أجرة) ← `CASH_BALANCE_CHANGED` بالمبلغ الجديد. التسليم يحفظ الإعداد الذي حُسب به فعلاً |
| توصيل يكتمل **بين** عرض النافذة والضغط | العدد أو المجموع يختلف ← `CASH_BALANCE_CHANGED`؛ النافذة تعرض المبلغ الجديد وتمسح المبلغ المكتوب. لا نقص وهمي |
| مسجِّلان لنفس السائق معاً | القفل الاستشاري يسلسلهما؛ الثاني يجد الرصيد 0 ← `NO_CASH_OUTSTANDING`، أو رصيداً مختلفاً ← `CASH_BALANCE_CHANGED`. تسليم واحد فقط |
| ضغطتان من نفس النافذة / إعادة بعد انقطاع | نفس `p_idempotency_key` ← نفس النتيجة `replayed: true` |
| مسجِّلان لسائقين مختلفين | أقفال مختلفة؛ لا انتظار |
| حذف حساب السائق أثناء التسليم | `begin_account_deletion` يرفض برصيد > 0 (K9)؛ بعد التسليم يُسمح |
| قيد قاعدة البيانات | `cash_handover_id` لا يُضبط إلا لطلب `delivered` (K2)، والحالة `delivered` نهائية بمخطط التحويلات، فلا طلب مربوط يتغير بعدها |
| deadlock نادر (حذف حساب زبون يعدّل طلباته المسلّمة بنفس اللحظة) | Postgres يكتشفه ويُفشل معاملة واحدة؛ اللوحة تعرض "صار خلل، حاول مرة ثانية" وتعيد بنفس المفتاح. الطلبات تُقفل بترتيب `id` لتقليله |

---

## 4) لوحة الأدمن: "تسليم الكاش" (`/cash`، أدمن وموظف)

> يُضاف لـ SPEC-admin كـ §2.11 بمهمة T41 (هذا القسم هو المواصفة).

- **الوصول:** `apps/admin/src/lib/access.ts`: الأدمن والموظف. بالقائمة الجانبية بعد "الطلبات" للدورين. الحماية الحقيقية بالدوال (aal2).
- **الرأس:** "الكاش عند السواق الآن: X د.ع (N سائق)" (من مجموع K4؛ للموظف أيضاً: مبالغ بيع، قرار المالك).
- **تبويب "الأرصدة"** (K4): الصف = اسم السائق (و"غير مفعّل" إن وُجد)، الرقم (اتصال)، **الرصيد** بخط كبير، عدد الطلبات، "أقدم توصيل من N يوم/ساعة" (`formatElapsedAr`)، آخر تسليم (الوقت، المبلغ، شارة نقص/زيادة)، وزر **"استلام الكاش"** (معطّل برصيد 0).
- **نافذة "استلام الكاش من <الاسم>":**
  - "المطلوب: **X د.ع** عن N طلب" وتحته "شامل أجرة التوصيل" أو "بدون أجرة التوصيل (تبقى عند السائق)" حسب `includes_delivery_fee` من K4 + قائمة قابلة للطي من K5 (`#رقم · بلوك · بناية · الوقت · المبلغ`).
  - حقل **"المبلغ اللي استلمته"** فارغ (لا يُملأ تلقائياً حتى يُعَدّ فعلاً)، أرقام عربية أو لاتينية، تحقق مضاعف 250. زر صغير "نفس المبلغ" يملأه بالمطلوب (اختصار للحالة الأكثر شيوعاً؛ المسجِّل يضغطه بقصد).
  - فرق حي: أخضر "مطابق"، أحمر "**نقص** Y د.ع"، برتقالي "**زيادة** Y د.ع"؛ مع أي فرق يظهر حقل **ملاحظة إلزامي** (≤ 300).
  - "تأكيد الاستلام" ← `record_cash_handover` بمفتاح يُولَّد عند فتح النافذة ويُعاد مع كل إعادة محاولة لنفس المبلغ (مفتاح جديد إن تغيّر المبلغ أو النافذة أُعيد تحميلها بعد `CASH_BALANCE_CHANGED`).
  - النجاح: رسالة "تم: استلمت X د.ع من <الاسم>" وتحديث القائمة.
  - الأخطاء: `CASH_BALANCE_CHANGED` ← "تغيّر المبلغ (وصل توصيل جديد). المطلوب الآن X د.ع. عدّ من جديد" + تحديث القائمة والمطلوب ومسح الحقل؛ `NO_CASH_OUTSTANDING` ← "انسجل الاستلام قبل شوية" + تحديث وإغلاق؛ `NOTE_REQUIRED`/`CASH_AMOUNT_INVALID` ← رسالة الحقل؛ `NOT_ALLOWED` ← مسار الجلسة الموجود.
- **تبويب "السجل"** (K7): فلترة بالسائق والمدى؛ الصف = الوقت، السائق، من استلم، عدد الطلبات، المطلوب، المستلم، الفرق (شارة)، الملاحظة، و"مُصحَّح" إن وُجد (مع المبلغ الأصلي للأدمن). الموظف: ملاحظة "يظهر لك سجل آخر 7 أيام فقط. الأقدم عند المدير." صفحات 50 (keyset).
- **"تصحيح"** (أدمن فقط، بالسجل): نافذة بالمبلغ الجديد وملاحظة إلزامية ← `correct_cash_handover`.
- **التحديث:** عند تركيز النافذة، كل 30 ثانية والصفحة ظاهرة، وبعد أي عملية. لا Realtime (الرصيد يتغير بتوصيل لا بحدث على جدول تشترك به اللوحة؛ الاستطلاع أبسط وكافٍ).
- **الإعدادات (`/settings`، أدمن فقط، K19؛ SPEC-admin §2.10):** قسم واضح "أجرة التوصيل وتسليم الكاش" بخيارين (radio):
  - **"أجرة التوصيل للمحل"** (الافتراضي): "السائق يسلّم المجموع كاملاً (البضاعة + أجرة التوصيل)، والمحل يدفع للسائق أجوره بطريقته."
  - **"أجرة التوصيل تبقى عند السائق"**: "السائق يسلّم مبلغ البضاعة فقط ويحتفظ بأجرة كل توصيل."
  - تنبيه ثابت تحته: "التغيير يسري على الكاش اللي بيد السواق الآن والتسليمات الجاية فقط. التسليمات المسجّلة قبل التغيير ما تتغير." الحفظ عبر `update_app_settings` (مُدقَّق كبقية الإعدادات).
- **التقارير (SPEC-admin §2.5، أدمن فقط):** قسم جديد "الكاش والسواق" من `report_cash` لنفس مدى الصفحة: بطاقة "الكاش عند السواق الآن"، بطاقتا "النقص" و"الزيادة" بالمدى، وجدول لكل سائق (التسليمات، المطلوب، المستلم، النقص، الزيادة، بيده الآن)، وتصدير CSV للجدول.

---

## 5) تطبيق السائق (`apps/driver`، الأصلي والـ PWA)

> يحل محل SPEC-driver §2.9 (قصة U8) بمهمة T42.

- **شاشة `(tabs)/today.tsx`** (يبقى التبويب، الاسم "سجل اليوم" بلا تغيير بالنسخة الأولى):
  - **"الكاش اللي بيدك"** (أو **"المطلوب تسليمه للمحل"** إن كان `includes_delivery_fee = false`) = `outstanding_iqd` من `driver_cash_summary()` (لا مجموع بالتطبيق)، وتحته "عن N طلب · من آخر تسليم <التاريخ والوقت>" أو "ما سلّمت كاش بعد"، ومع `false` سطر "أجرة التوصيل إلك، ما تنحسب".
  - **"توصيلات اليوم"** = العدد كما هو (`baghdadDayRange`، قراءة RLS الموجودة).
  - القائمة: **الطلبات اللي فلوسها بيدك** (`orders` بـ `driver_id = me`، `status = 'delivered'`، `cash_handover_id is null`، الأحدث أولاً، حد 200؛ قراءة RLS الموجودة للسائق المعيَّن). عرض فقط؛ المجموع من الدالة.
  - الملاحظة تتغير من "الأرقام تتصفّر كل يوم الساعة 12 بالليل" إلى "الكاش يتصفّر لما تسلّمه للمحل".
  - رابط **"سجل التسليمات"** ← شاشة جديدة.
- **شاشة جديدة `cash/history.tsx` "سجل التسليمات"** (`my_cash_handovers`، صفحات 20 بالتمرير): الوقت (بغداد)، "استلم المحل X د.ع"، "المطلوب Y" إن اختلف، شارة **نقص**/**زيادة** بمبلغها، الملاحظة (نص صرف)، "استلمها <الاسم>"، و"تعدّل" إن صُحِّح. فارغة: "ما عندك تسليمات بعد".
- **التحديث:** عند فتح الشاشة، عند الرجوع للتطبيق، سحب للتحديث، وعند وصول إشعار `cash_handover` (والتطبيق مفتوح). لا Realtime.
- **الإشعار:** `data.type = 'cash_handover'` ← `routeForNotification` يرجع `/(tabs)/today` (مع تحديث). نفس التعديل بـ `public/sw.js` (Web Push)، و`sw-parity.test.ts` يفرض التطابق.
- **حذف الحساب:** `CASH_OUTSTANDING` ← "عندك كاش ما سلّمته للمحل (X د.ع). سلّمه أولاً" (`errors.ts`).
- **لا تغيير** بباقي الشاشات ولا بالتوصيل.

---

## 6) الأوامر

```
pnpm db:test                                    # pgTAP محلياً (CI)، ومنه 39_cash_handover.sql
pnpm db:test:remote                             # على mukhdar-dev بعد الدفع
pnpm sb db push --dry-run && pnpm sb db push    # dev فقط وبموافقة المالك؛ ثم:
pnpm sb migration list --remote                 # محلي = بعيد
node scripts/db-concurrency.mjs                 # سيناريوهات التسليم المتزامن الجديدة (CI)
pnpm --filter @mukhdar/admin test && pnpm --filter @mukhdar/admin test:e2e
pnpm --filter @mukhdar/driver test && pnpm --filter @mukhdar/driver test:e2e
pnpm lint && pnpm typecheck && pnpm test        # كل الـ repo
```

## 7) هيكل الملفات المتوقع

```
supabase/migrations/20261212000001_cash_handover.sql
supabase/tests/39_cash_handover.sql            (+ تحديث 01_schema، 12_delete_account، 21_staff_money، 27_access_matrix، 28_mfa_aal، 32_real_role_writes)
scripts/db-concurrency.mjs                     (سيناريوهات جديدة)
packages/shared/src/errors.ts                  (K15)
packages/shared/src/database.types.ts          (K18)
apps/admin/src/app/(panel)/cash/               page + HandoverDialog + HistoryTab + CorrectDialog
apps/admin/src/features/cash/                  منطق صرف (الفرق، التحقق، تحويل الأخطاء) + اختبارات
apps/admin/src/app/(panel)/reports/            قسم "الكاش والسواق"
apps/admin/e2e/cash.spec.ts
apps/driver/src/app/(tabs)/today.tsx           تعديل
apps/driver/src/app/cash/history.tsx           جديد
apps/driver/src/features/cash/                 summary، history
apps/driver/src/features/notifications/routing.ts + public/sw.js
```

## 8) أسلوب الكود

كبقية المشروع: المجاميع والفروق **بقاعدة البيانات**؛ الواجهة تعرض فقط، ومنطقها دوال صرفة بـ `features/*` باختبارات؛ المبالغ بـ `formatIqd`؛ النصوص العربية بملفات i18n؛ الأخطاء عبر `errors.ts`. الفرق الحي بالنافذة للعرض فقط (القاعدة تعيد حسابه):

```ts
// apps/admin/src/features/cash/difference.ts
export type CashDiff = { kind: 'match' | 'shortage' | 'overage'; amount: number };

export function cashDifference(expected: number, received: number): CashDiff {
  const d = received - expected;
  if (d === 0) return { kind: 'match', amount: 0 };
  return d < 0 ? { kind: 'shortage', amount: -d } : { kind: 'overage', amount: d };
}
```

---

## 9) الاختبارات

### 9.1 pgTAP **بالدور الحقيقي** (`supabase/tests/39_cash_handover.sql`)
كل كتابة بـ `tests.as_user` (موظف وأدمن بـ aal2) أو `tests.as_user_aal1`؛ دور postgres للتجهيز فقط.

| المجال | الحالات |
|---|---|
| الصلاحيات | K4/K5/K6/K7: أدمن aal2 وموظف aal2 ✓؛ أدمن/موظف aal1، أدمن برمز مؤقت، سائق، زبون، `anon` ✗ (`NOT_ALLOWED` أو لا صلاحية). K12/K13: أدمن aal2 فقط (الموظف ✗). K10/K11: سائق فعّال ✓؛ سائق معطّل أو برمز مؤقت، زبون، موظف ✗. `cash_handovers` بلا قراءة مباشرة لأي دور (حتى الأدمن) |
| الحساب | الرصيد = Σ `total_iqd` للمسلّمة غير المربوطة فقط (لا `out_for_delivery` ولا `cancelled` ولا طلبات سائق آخر)؛ `goods_iqd` و`fees_iqd` صحيحان؛ `first/last_delivered_at` صحيحة |
| إعداد الأجرة (K19) | `update_app_settings` يقبل `true/false` فقط (`INVALID_SETTINGS` لغير ذلك)، أدمن فقط، ومُدقَّق؛ مع `false` الرصيد = Σ `subtotal_iqd` بـ K4/K10، والتسليم يحفظ `includes_delivery_fee = false` و`expected = goods`؛ تسليم قديم بـ `true` لا يتغير بعد تغيير الإعداد؛ تغيير الإعداد بعد العرض ← `CASH_BALANCE_CHANGED`؛ القيد يرفض `expected` لا يطابق |
| التسليم المطابق | كموظف aal2: الطلبات تُربط، الرصيد 0، `difference = 0`، `note` null مقبول، سطر `admin_audit` بالقيم، صف إشعار `user` للسائق بنص "استلمنا منك X د.ع" و`data.type = 'cash_handover'` |
| النقص والزيادة | كأدمن aal2: أقل بلا ملاحظة ← `NOTE_REQUIRED`؛ بملاحظة ← `difference < 0`، نص الإشعار فيه "نقص"، والرصيد 0؛ أكثر ← "زيادة" |
| التحقق | مبلغ سالب، غير مضاعف 250، أو فوق الحد ← `CASH_AMOUNT_INVALID`؛ ملاحظة > 300 ← `INVALID_REQUEST`؛ رصيد 0 ← `NO_CASH_OUTSTANDING`؛ expected/count لا يطابقان ← `CASH_BALANCE_CHANGED` و`detail` يحمل القيم الحالية |
| منع التكرار | نفس المفتاح ← نفس `handover_id` و`replayed = true` وإشعار واحد وتدقيق واحد؛ نفس المفتاح لسائق آخر ← `INVALID_REQUEST` |
| بعد التسليم | توصيل جديد يظهر وحده بالرصيد؛ تسليم ثانٍ يربطه وحده؛ **الثابت** (§2) صحيح بعد كل خطوة |
| القيود | `update orders set cash_handover_id` مباشرة مرفوض لكل دور؛ قيد K2 يرفض ربط طلب غير مسلّم حتى لـ postgres؛ حذف تسليم له طلبات مرفوض (`restrict`) |
| التصحيح | أدمن: المبلغ والفرق يتغيران، `original_received_iqd` يُحفظ مرة واحدة، تدقيق before/after، إشعار؛ بلا ملاحظة ← `NOTE_REQUIRED`؛ `opening` أو غير موجود ← `HANDOVER_NOT_FOUND`؛ موظف ✗ |
| السجل | موظف: لا يرى تسليماً أقدم من 7 أيام بغداد؛ أدمن يرى الكل؛ keyset بلا تكرار ولا فجوات؛ `opening` مستثنى |
| السائق | `driver_cash_summary` صف واحد بأصفار بلا بيانات، وبعد التسليم آخر تسليم صحيح؛ `my_cash_handovers` صفوفه فقط |
| K4 | سائق معطّل أو خُفّض دوره وبذمته كاش يظهر؛ سائق غير فعّال برصيد 0 لا يظهر |
| التقرير | `report_cash`: النقص والزيادة منفصلان، بيوم `recorded_at` بغداد (تسليم 23:30 و00:30 بيومين)، `held_now` صحيح، `INVALID_DATE_RANGE`، و`opening` مستثنى |
| الافتتاحي | بعد الـ migration لا سائق برصيد من طلبات قديمة (فحص على بيانات التجهيز) |
| الحذف | `begin_account_deletion` لسائق برصيد ← `CASH_OUTSTANDING`؛ بعد التسليم ينجح (`12_delete_account.sql`) |
| الحراس | `32_real_role_writes.sql` (الكتابة بالدور الحقيقي)، `21_staff_money.sql` (تصنيف الأعمدة)، `27_access_matrix.sql`، `28_mfa_aal.sql`، `01_schema.sql` (قوائم الدوال والصلاحيات) |

### 9.2 التزامن (`scripts/db-concurrency.mjs`، CI)
1. **مسجِّلان معاً** لنفس السائق بنفس expected ومفتاحين مختلفين (10 تكرارات): تسليم واحد بالضبط، والثاني `NO_CASH_OUTSTANDING`/`CASH_BALANCE_CHANGED`.
2. **توصيلات أثناء التسليم:** 5 طلبات `out_for_delivery` تُسلَّم بالتوازي مع تسليمات متكررة: في النهاية الثابت (§2) صحيح، ولا طلب مربوط مرتين أو مفقود.
3. **نفس المفتاح بالتوازي** (ضغطتان): صف تسليم واحد.

### 9.3 الواجهات
| المستوى | ماذا | أين |
|---|---|---|
| وحدة (اللوحة) | `cashDifference`؛ تحقق المبلغ (مضاعف 250، أرقام عربية)؛ تحويل `CASH_BALANCE_CHANGED` (قراءة `detail`)؛ قاعدة إعادة استخدام المفتاح | `apps/admin/src/features/cash/*.test.ts` |
| Playwright (اللوحة) | موظف: يرى الأرصدة، يسجّل تسليماً مطابقاً ← الرصيد 0؛ نقص بلا ملاحظة ← الزر معطّل؛ بملاحظة ← يظهر بالسجل بشارة "نقص"؛ لا يرى "تصحيح" ولا قسم التقارير. أدمن: تصحيح، وقسم "الكاش والسواق" بالتقارير. زبون ← "غير مصرح" | `apps/admin/e2e/cash.spec.ts` |
| Jest/RNTL (السائق) | البطاقة من الدالة لا من مجموع القائمة؛ "ما سلّمت كاش بعد"؛ سجل التسليمات بالشارات والتصحيح؛ توجيه `cash_handover`؛ رسالة `CASH_OUTSTANDING` بالحذف؛ `sw-parity` | `apps/driver/src/__tests__` |
| Playwright (السائق PWA) | لا تغيير بالسيناريوهات الحالية؛ تُضاف الشاشة الجديدة لفحص RTL/CSP إن لزم | `apps/driver/e2e` |
| يدوي (dev، بجهاز سائق) | توصيل ← اللوحة تعرض الرصيد ← تسليم بنقص ← إشعار "استلمنا منك … · نقص …" على الجهاز ← السجل بالتطبيق | تقرير بـ `docs/reviews/` ضمن T39/T33 أو R4 |

---

## 10) المهام المقترحة

| # | المهمة | تعتمد على | النموذج | على dev | لماذا هذا النموذج |
|---|---|---|---|---|---|
| T40 | **DB:** K1–K18 + `39_cash_handover.sql` + الحراس + سيناريوهات التزامن + `errors.ts` + الأنواع + تحديث SPEC-backend §4/§5 وDRIVER-API (دالتا السائق والإشعار) | — | **Opus** | migration (`db push` بعد dry-run، بموافقتك) | أقفال، تزامن، RLS، ثابت محاسبي: الخطأ هنا يكلّف فلوساً |
| T41 | **اللوحة:** صفحة `/cash` (الأرصدة، النافذة، السجل، التصحيح) + قسم التقارير + إعداد الأجرة بـ `/settings` (K19) + `access.ts` + Playwright + SPEC-admin §2.11 و§2.5 و§2.10 | T40 | Sonnet | - (Pages ينشر بعد الدمج) | واجهة فوق دوال جاهزة، بنمط صفحات موجودة (طلبات السواق، التقارير) |
| T42 | **السائق:** بطاقة الكاش من الدالة، قائمة الطلبات بذمته، `cash/history`، توجيه الإشعار وsw.js، رسالة الحذف + اختبارات + SPEC-driver §2.9 | T40 | Sonnet | - (PWA تُنشر بعد الدمج؛ APK مع T33) | تعديلات شاشات بنمط T32 |
| R4 | **مراجعة** (`/review`) لـ T40–T42: السباقات، تصنيف المبالغ، الأدوار، الثابت، الإشعار؛ ثم فحص يدوي على dev | T40–T42 | **Opus** | - | مراجعة أمان ومال |

T41 وT42 مستقلتان (أي ترتيب). كل مهمة: فرع ← PR ← CI أخضر ← دمج (CLAUDE.md 11).

---

## 11) القرارات (قرار المالك 2026-11-22)

| # | السؤال | القرار |
|---|---|---|
| **Q1** | السائق يسلّم **المجموع كاملاً** (مع أجرة التوصيل)، أم **يحتفظ بالأجرة** ويسلّم مبلغ البضاعة (`subtotal`) فقط؟ | **المالك لم يحسم بعد ← إعداد للأدمن** (K19): "أجرة التوصيل للمحل" (**الافتراضي**: المجموع كاملاً `total_iqd`) أو "أجرة التوصيل تبقى عند السائق" (`subtotal_iqd` فقط). يُغيَّر من `/settings` عبر `update_app_settings` (مُدقَّق) مع شرح عربي. **كل تسليم يحفظ مبلغه المطلوب وقيمة الإعداد لحظتها**؛ التغيير يؤثر على الرصيد الحالي والتسليمات القادمة فقط، ولا يعيد حساب القديم |
| Q2 | هل النقص يُنقص **صافي الربح**؟ | **لا (معتمد):** تعريف صافي الربح ثابت (CLAUDE.md)؛ النقص والزيادة يُعرضان منفصلين بالتقارير |
| Q3 | تصحيح مبلغ كُتب غلط | **معتمد:** أدمن فقط، المبلغ والملاحظة فقط، مدقَّق ومبلَّغ للسائق (C9). لا إلغاء ولا إرجاع طلبات للرصيد |
| Q4 | الموظف وسجل التسليمات | **معتمد:** آخر 7 أيام، بالمبالغ والفروق (كقاعدة الطلبات والتقييمات)؛ التقارير للأدمن وحده |
| Q5 | سائق خُفّض دوره أو عُطّل وبذمته كاش | **معتمد:** يُسمح بالتعطيل والتخفيض (يبقى ظاهراً بالأرصدة حتى يُسلَّم)؛ **حذف الحساب فقط يُمنع** (K9) |

## 12) افتراضات أخرى (معتمدة كما كُتبت، 2026-11-22)
1. **المبلغ المستلم مضاعف 250** (أصغر فئة نقدية متداولة؛ كل مجاميع الطلبات مضاعفات 250)، وحد عقلاني `expected + 10,000,000`.
2. **حقل المبلغ لا يُملأ تلقائياً** (حتى يُعَدّ فعلاً)، مع زر "نفس المبلغ" صريح.
3. **نص الإشعار** يضيف الفرق إن وُجد (" · نقص Y د.ع")؛ المالك طلب "استلمنا منك X د.ع" والإضافة للشفافية مع السائق. المبالغ بفواصل الآلاف (`to_char(n, 'FM999,999,999,990')`)، بخلاف إشعار الطلب الجديد الحالي (بلا فواصل).
4. **السائق يرى الملاحظة** واسم المستلم (الاسم الأول) بسجله؛ الملاحظة تخصه.
5. **الرصيد الافتتاحي** (K8) يغلق تاريخ dev بلا إشعار ولا تدقيق؛ الإنتاج يبدأ فارغاً.
6. **لا Realtime** للرصيد باللوحة ولا بالتطبيق: استطلاع 30 ثانية + تركيز + بعد العملية + الإشعار.
7. **اسم التبويب** "سجل اليوم" لا يتغير بالنسخة الأولى (تعديل محتوى فقط).
8. **الكاش عند السواق** يظهر للموظف برأس صفحة `/cash` (مجموع مبالغ بيع، قرار المالك)، لكن بالتقارير للأدمن فقط.
9. **حد 500 طلب** بنافذة التسليم (K5)؛ رصيد أكبر يُسجَّل عادياً (الدالة لا تحدّ)، والقائمة تعرض أول 500 مع العدد الكلي.
10. **إعداد الأجرة يُقرأ للجميع** (K19) كبقية `app_settings` (`settings_read` العامة): قيمة سياسة لا مبلغ، والسائق يحتاجها ليفهم رقمه. التغيير للأدمن فقط.
11. **`expected_iqd >= 0`** (لا `> 0`): مع "الأجرة تبقى عند السائق" يكون المطلوب `subtotal` وحده، والقيد على `subtotal_iqd` بالطلبات `>= 0`. عملياً كل طلب له بنود بأسعار موجبة.

## 13) الحدود
- **دائماً:** المجاميع بقاعدة البيانات؛ اختبار كل كتابة بدورها الحقيقي (aal2)؛ migration جديدة و`pnpm sb db push` على dev فقط بعد dry-run؛ فرع ← PR ← CI أخضر ← دمج؛ تحديث الـ SPEC بنفس الـ PR عند أي قرار يتغير.
- **اسأل أولاً:** تطبيق الـ migration على dev؛ أي تغيير بتعريف المبيعات أو صافي الربح (Q2)؛ أي تغيير بدوال السائق أو `set_order_status`.
- **ممنوع:** حساب الرصيد أو الفرق بالتطبيق كمصدر للحقيقة؛ قراءة مباشرة لـ `cash_handovers`؛ تعديل migration قديمة؛ `apply_migration`/`execute_sql` عبر MCP؛ `service_role` باللوحة أو التطبيق؛ تعطيل RLS؛ كشف الكلفة أو الربح للموظف.

## 14) معايير النجاح
1. CI أخضر، ومنه `39_cash_handover.sql` وسيناريوهات التزامن والحراس الثلاثة.
2. `pnpm sb migration list --remote` مطابق بعد T40، و`db:test:remote` يمر.
3. على dev: سائق يوصّل طلبين ← "الكاش اللي بيدك" بالتطبيق = مجموعهما ← الموظف يسجّل استلاماً ناقصاً بملاحظة ← الرصيد 0 بالتطبيق واللوحة ← الإشعار يصل بالمبلغ والنقص ← السجل بالتطبيق يعرض التسليم ← تقرير الأدمن يعرض النقص للسائق واليوم.
4. توصيل ثالث أثناء فتح نافذة التسليم ← `CASH_BALANCE_CHANGED` ولا نقص وهمي.
