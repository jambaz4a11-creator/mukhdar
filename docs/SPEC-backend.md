# SPEC-backend: المخضر (Supabase)

> المرجع التنفيذي: كل ملفات `supabase/migrations/` بالترتيب (الأساس `20261110000001_init.sql`، ثم storage، ثم إصلاحات Advisor، ثم إصلاحات مراجعة T01–T05). هذا الملف يشرح **لماذا** و**ماذا**؛ الـ SQL هو المصدر الوحيد للحقيقة عند التعارض.
> الحالة: مطبّق على `mukhdar-dev` (Supabase، Postgres 17)، ومغطى باختبارات pgTAP بـ `supabase/tests/` (تعمل على السحابة وفي CI على Supabase محلي). عقد تطبيق السائق الخارجي: `docs/DRIVER-API.md`.

## 1) الهدف والنطاق
- خلفية واحدة لثلاث واجهات: تطبيق الزبون، لوحة الأدمن (ويب)، وتطبيق السائق (**خارجي**، يبنيه مطوّر منفصل ويتصل عبر `docs/DRIVER-API.md`).
- مدينة واحدة (بسماية) بالمرحلة الأولى، مع حقول `city_id` و`vendor_id` (nullable) للتوسع.
- لا خادم خاص: كل المنطق الحساس داخل Postgres (دوال `security definer`) وكل القراءة عبر RLS.

## 2) القواعد الثابتة
| القاعدة | التطبيق بقاعدة البيانات |
|---|---|
| المبالغ أعداد صحيحة بالدينار | كل الأعمدة `bigint` بلاحقة `_iqd` |
| تقريب لأقرب 250 | `round_iqd()`؛ وسعر المنتج وأجرة التوصيل **يجب** أن تكون مضاعفات 250 (قيد CHECK) |
| أجرة توصيل قابلة للتعديل | `app_settings.delivery_fee_iqd` (افتراضي 1000)، وتُنسخ للطلب لحظة إنشائه |
| أسعار ثابتة، بدون وزن | `qty` عدد صحيح 1..99 لكل بند، بوحدة البيع `products.unit`: الخضار والفواكه `نص كيلو` (السعر لكل نص كيلو، و`qty = 3` = كيلو ونص)، الأعشاب `باقة`، وما يُباع بالقطعة `حبة`/`علبة`/`قنينة`/`سلة`. سعر ثابت لكل وحدة، لا وزن فعلي ولا كسور. المخزون بنفس الوحدة |
| سعر الشراء والمخزون للأدمن فقط | `product_costs`، `stock`، `inventory_movements`، `order_item_costs`، `daily_stats` محمية بـ RLS. الزبون يرى `products.in_stock` فقط |
| الدفع كاش عند التسليم | لا جداول دفع. `total_iqd` هو ما يستلمه السائق |
| إشعار السائق تلقائي | `place_order` يبلّغ الأدمن والموظفين فقط؛ عند `ready` يكتب `set_order_status` إشعاراً لكل السائقين النشطين (طلب متاح) وللزبون |
| تقييم بعد التسليم | `rate_order()` يقبل فقط طلباً `delivered` لنفس الزبون، مرة واحدة |
| المبيعات وصافي الربح (قرار 2026-11-15، يُبنى بـ T18/T20) | المبيعات = `subtotal` للطلبات المسلّمة (بدون الأجرة، للسواق) بتاريخ `delivered_at`. صافي الربح = الربح الإجمالي − كلفة الهدر − كلفة تسويات الجرد السالبة، بكلفة الوحدة المحفوظة على كل حركة (§12) |
| كتابة المال عبر دوال | المنتجات والأسعار وسعر الشراء والإعدادات تُكتب بدوال فقط (§12، T18/T19)؛ لا insert/update مباشر من المتصفح |

## 3) الأدوار
`customer` (افتراضي عند التسجيل) · `driver` · `staff` · `admin`.
- الدور يُخزَّن في `profiles.role` ولا يتغير إلا عبر `set_user_role()` (أدمن فقط).
- العمود محمي بصلاحيات على مستوى العمود: المستخدم يعدّل `full_name` فقط.
- الأدمن لا يقدر يخفّض دوره أو يعطّل نفسه (`CANNOT_DEMOTE_SELF`)، ولا يُزال آخر أدمن نشط (`LAST_ADMIN`).
- حساب معطّل (`is_active = false`) يُعامل كأنه بلا دور.
- **رمز مؤقت (`profiles.must_change_pin`، migration `20261123000001`):** يُضبط بعد `admin-create-user` و`admin-reset-pin` (داخل `finish_user_creation` و`record_pin_reset`)، ويُمسح تلقائياً حين تتغير كلمة السر فعلاً (trigger `on_auth_user_password_changed` على `auth.users.encrypted_password`؛ استدعاء من التطبيق لا يمسحه). أثناءه `current_user_role()` = null: كل دالة وسياسة مبنية على الدور ترفض كأن الحساب بلا دور، و`place_order` ترفض `PIN_CHANGE_REQUIRED`. يبقى: قراءة الملف الشخصي (لمعرفة العلامة)، صفوف الزبون نفسه، تغيير الرمز (GoTrue `updateUser`)، وحذف الحساب. **افتراض:** تغيير الرمز لنفس الرمز المؤقت يمسح العلامة أيضاً (الـ hash يتغير مع كل ملح)؛ التطبيقات ترفض الجديد = الحالي.

## 4) نموذج البيانات (ملخص)
| الجدول | الغرض | من يقرأ | من يكتب |
|---|---|---|---|
| `profiles` | دور، هاتف، اسم، `must_change_pin` (§3) | صاحبه + أدمن | trigger عند التسجيل؛ الاسم من صاحبه؛ الدور والتفعيل `set_user_role` |
| `app_settings` | الأجرة، الحد الأدنى، فتح/غلق المتجر، حد الطلبات المفتوحة للزبون (`max_active_orders`) | الجميع | أدمن عبر `update_app_settings` فقط (T19؛ لا update مباشر) |
| `sectors` / `subsections` / `buildings` | العنوان الهرمي: قطاع ← وحدة ← عمارة (قطاعان A وB، 17 وحدة، 1700 عمارة؛ رقم العمارة فريد داخل الوحدة فقط) | الجميع (النشط) | أدمن (RLS؛ العمارات بالجملة `add_buildings`، T19) |
| `addresses` | عناوين الزبون (عمارة + شقة نصاً)، عنوان افتراضي واحد | صاحبها + أدمن | صاحبها (أعمدة محددة) |
| `categories` / `products` | الكتالوج | الجميع (النشط)، موظف/أدمن الكل | الأقسام: أدمن (RLS)؛ المنتجات: أدمن عبر الدوال فقط (T18) |
| `product_costs` | سعر الشراء (= آخر سعر مشتريات) | أدمن | دوال فقط (`adjust_stock*`، `admin_save_product`) |
| `stock` | الرصيد الحالي، وحد النقص `low_stock_threshold` (T18) | موظف + أدمن | دوال فقط |
| `inventory_movements` | دفتر حركات المخزون، مع كلفة الوحدة `unit_cost_iqd` لكل حركة (T18) | أدمن | دوال فقط |
| `orders` | الطلب + نسخة العنوان + اسم/هاتف الزبون | الزبون صاحبه، السائق المعيَّن (حسابه نشط ودوره `driver`)، موظف/أدمن | دوال فقط |
| `order_items` | بنود بنسخة الاسم والسعر | من يرى الطلب | `place_order` |
| `order_item_costs` | تكلفة البند لحظة الطلب | أدمن | `place_order` |
| `order_status_history` | سجل التحويلات | من يرى الطلب | دوال |
| `ratings` | تقييم 1..5 + تعليق | الزبون + موظف/أدمن | `rate_order` |
| `push_tokens` | رموز الإشعارات، ولكل رمز مزوّد `provider`: `expo` (افتراضي، مُنفَّذ) أو `fcm` (محجوز، يُتخطى عند الإرسال). انظر DRIVER-API §6 | صاحبها (قراءة وحذف) | `register_push_token` فقط (لا insert/update مباشر) |
| `notification_outbox` | إشعارات بانتظار الإرسال (`claimed_at` = حجز عامل الإرسال، 5 دقائق) | service_role فقط | دوال |
| `daily_stats` | تقارير يومية (توقيت بغداد)؛ تُضاف كلفة الهدر وخسارة التسويات (T18) | أدمن | دوال |
| `pin_resets` (T19) | تدقيق إعادة ضبط الـ PIN (بلا الرمز)؛ `kind` = `admin` (`admin-reset-pin`، `reset_by` = الأدمن) أو `break_glass` (سكربت الطوارئ المحلي، `reset_by` فارغ؛ جلسة B) | أدمن | `record_pin_reset` |
| `admin_function_hits` (جلسة B) | محاولات `admin-create-user`/`admin-reset-pin` (ناجحة أو فاشلة) لحد 20/ساعة؛ تُحذف بعد يوم | لا أحد (service_role عبر `admin_rate_hit` فقط) | `admin_rate_hit` |
| `user_creations` (T19) | تدقيق إنشاء الحسابات من اللوحة | أدمن | `admin-create-user` (`finish_user_creation`) |
| `admin_audit` (مراجعة T16-T19) | من غيّر ماذا ومتى (القديم ← الجديد): `user_role` (الدور والتفعيل)، `settings` (الحقول المتغيرة فقط)، `order_driver` (نقل طلب من سائق لآخر)، `address` (جلسة C: تغيير اسم/رقم/تفعيل قطاع أو وحدة أو عمارة؛ الجدول والمعرّف داخل before/after، migration `20261125000002`) | أدمن | `set_user_role`، `update_app_settings`، `assign_driver` فقط |
| `cities` / `vendors` | للتوسع لاحقاً | الجميع (النشط) | أدمن |

**لماذا نسخ (snapshots)؟** الطلب يحتفظ بالاسم والسعر والعنوان وهاتف الزبون كما كانت لحظة الطلب. تغيير سعر منتج أو حذف عنوان أو حذف الحساب لا يغيّر الفواتير القديمة ولا التقارير.

## 5) دوال RPC (الواجهة الوحيدة للكتابة الحساسة)
كل الأخطاء ترجع بـ `message` ثابت (رمز إنجليزي) يترجمه التطبيق لرسالة عربية. `detail` يحمل `product_id` عند أخطاء المنتجات.

### `place_order(p_address_id, p_items, p_idempotency_key, p_note?) → jsonb`
- `p_items`: `[{"product_id": uuid, "qty": int}]`. **التطبيق لا يرسل أي سعر.**
- الخطوات بمعاملة واحدة:
  1. يتحقق أن المستخدم زبون نشط (ورمزه غير مؤقت) وله رقم هاتف.
  2. **منع التكرار:** قفل استشاري لكل زبون. لو وُجد طلب بنفس المفتاح يرجعه مع `replayed: true`. التطبيق يولّد المفتاح مرة لكل محاولة "تأكيد الطلب" ويعيد استخدامه عند إعادة المحاولة.
  3. **حد الطلبات المفتوحة:** يرفض إن كان للزبون `max_active_orders` (افتراضي 3) طلبات غير منتهية (`pending`/`preparing`/`ready`/`out_for_delivery`).
  4. المتجر مفتوح؟ العنوان للزبون نفسه؟ والعمارة والوحدة والقطاع مفعّلة؟
  5. يتحقق من صيغة البنود **قبل أي تحويل نوع** (كل بند كائن، `product_id` نص UUID، `qty` عدد صحيح)، ثم يدمج المكرر، ويرفض كمية خارج 1..99 أو أكثر من 50 بنداً.
  6. **يقفل صفوف `stock` بترتيب `product_id`** (يمنع بيع نفس الحبة مرتين ويمنع الـ deadlock).
  7. يتحقق من التفعيل والرصيد، يحسب `subtotal = round_iqd(Σ price × qty)`، يتحقق من الحد الأدنى، ثم `total = subtotal + delivery_fee`.
  8. ينشئ الطلب والبنود وتكاليفها، ينقص المخزون، يسجل الحركات والتاريخ، ويضيف إشعاراً واحداً للأدمن والموظفين (`audience = 'admins'`، النص: الوحدة والعمارة والمجموع). السائقون لا يُبلَّغون هنا.
- يرجع: `{order_id, order_number, total_iqd, status, replayed}`.
- أخطاء: `NOT_AUTHENTICATED`, `NOT_CUSTOMER`, `PIN_CHANGE_REQUIRED` (رمز مؤقت، §3), `PHONE_REQUIRED`, `IDEMPOTENCY_KEY_REQUIRED`, `TOO_MANY_ACTIVE_ORDERS` (`detail` = الحد), `STORE_CLOSED`, `ADDRESS_NOT_FOUND`, `ADDRESS_INACTIVE`, `EMPTY_CART`, `TOO_MANY_ITEMS`, `INVALID_QTY` (يشمل بنداً ليس كائناً أو `qty` ليس عدداً صحيحاً), `PRODUCT_UNAVAILABLE` (يشمل `product_id` مفقوداً أو بصيغة خاطئة؛ `detail` = القيمة المرسلة), `INSUFFICIENT_STOCK`, `BELOW_MIN_ORDER`.

### `set_order_status(p_order_id, p_status, p_reason?, p_return_stock = true) → orders`
مخطط الحالات:
```
pending ──► preparing ──► ready ──► out_for_delivery ──► delivered
   │            │           │              │
   └────────────┴───────────┴──────────────┴──► cancelled
```
| الدور | المسموح |
|---|---|
| admin | أي تحويل صحيح (ومنه الإلغاء من `out_for_delivery`، للأدمن وحده) |
| staff | ← `preparing`، ← `ready`، ← `out_for_delivery` (يتطلب سائقاً معيَّناً)، ← `delivered`؛ والإلغاء من `pending`/`preparing`/`ready`. آخر تحويلين **احتياطيان** (migration `20261120000001`، 2026-11-16) حين يكون تطبيق السائق معطّلاً أو نسي السائق |
| driver (المعيَّن فقط) | `ready` ← `out_for_delivery` (يتطلب أن يكون معيَّناً)، `out_for_delivery` ← `delivered` |
| customer (صاحب الطلب) | الإلغاء وهو `pending` فقط |

آثار جانبية: طوابع الوقت (`preparing_at`، `ready_at`، ...)، سجل التاريخ، إشعار للزبون (قيد التحضير، "طلبك جاهز، بانتظار السائق"، بالطريق، تم التوصيل، الإلغاء). عند `ready`: إن لم يكن للطلب سائق ← إشعار `audience = 'drivers'` لكل السائقين النشطين (`type: new_order`)؛ وإن عُيِّن مسبقاً أثناء التحضير ← إشعار لسائقه فقط (`type: ready`). `p_reason` يُقص لـ 300 حرف. الإلغاء **يرجع المخزون** بحركة `cancel_return`، ويُبلّغ السائق المعيَّن (إن وُجد) بإشعار `type: cancelled`. **الإلغاء بلا إرجاع** (`p_return_stock = false`، قرار المالك 2026-11-16): للأدمن وحده ولطلب `out_for_delivery` وحده (البضاعة طلعت مع السائق؛ غير ذلك `INVALID_REQUEST` بـ `detail = 'p_return_stock'`، وغير الأدمن `NOT_ALLOWED`): الرصيد لا يتغير، وتُكتب حركتان بنفس الكمية لكل منتج: `cancel_return` (+) و`waste` (−) بملاحظة "cancelled after dispatch" وكلفة البنود وقت الطلب (`order_item_costs`)، فيبقى السجل = الرصيد ويدخل الهدر خسائر اليوم وصافي الربح. التسليم يحدّث `daily_stats` (الإيراد، الأجرة، التكلفة من `order_item_costs`، الربح الإجمالي).
أخطاء: `ORDER_NOT_FOUND`, `INVALID_TRANSITION`, `NOT_ALLOWED`, `NO_DRIVER_ASSIGNED`.

### دوال السائق
- `available_orders(p_limit=20)`: الطلبات غير المعيَّنة بحالة `ready` فقط **بدون هاتف الزبون واسمه**، حد أقصى 50. لغير السائق النشط: `NOT_ALLOWED`.
- `accept_order(p_order_id)`: على طلب `ready` غير معيَّن فقط (غير ذلك `ORDER_NOT_AVAILABLE`). أول سائق يقبل يأخذ الطلب؛ الثاني يحصل `ORDER_NOT_AVAILABLE`. بعد القبول يرى السائق الهاتف والعنوان الكامل عبر RLS. **قفل الصف (migration `20261125000001`، جلسة C M1):** صف السائق يُقفل `for share` بشرط `role = 'driver' and is_active and not must_change_pin` (لا قبل القفل فقط): سائق خُفّض أو عُطّل أو أُعيد ضبط رمزه أثناء انتظار القفل يُرفض `NOT_ALLOWED` ولا يأخذ الطلب.
- `assign_driver(p_order_id, p_driver_id)` (موظف/أدمن): تعيين أو تغيير يدوي من `preparing` أو `ready`، أو **نقل طلب `out_for_delivery` لسائق نشط آخر** (قرار المالك 2026-11-16؛ الموظف أيضاً كإجراءات التوصيل الاحتياطية؛ الحالة لا تتغير، ملاحظة التاريخ `driver_reassigned`)، مع إشعار للسائق (`type: assigned`)، وإشعار السائق السابق عند التغيير (`type: unassigned`). كل تغيير من سائق لآخر يُسجَّل بـ `admin_audit` (`order_driver`). ملف السائق يُقفل `for share` (يتسلسل مع تعطيله وتخفيضه). **جلسة C:** سائق `must_change_pin` لا يُسند له (`DRIVER_PIN_PENDING`: لا يقرأ الطلب بـ RLS ولا يستلم إشعاراً)؛ التعيين لنفس السائق الحالي لا يفعل شيئاً (لا سجل ولا إشعار ولا تدقيق). أخطاء: `NOT_ALLOWED`, `DRIVER_NOT_FOUND` (ليس سائقاً نشطاً), `DRIVER_PIN_PENDING` (سائق لم يغيّر رمزه المؤقت), `ORDER_NOT_AVAILABLE` (الطلب ليس `preparing`/`ready`/`out_for_delivery`، أو غير موجود).
- `list_drivers()` (موظف/أدمن): السائقون فقط، بالأعمدة `id, full_name, phone, is_active, must_change_pin` (جلسة C: العلامة لتعطّل اللوحة صف من لم يغيّر رمزه بنافذة التعيين؛ لقائمة التعيين واسم السائق بجدول الطلبات). غيرهم: `NOT_ALLOWED`.

### دوال أخرى
- `set_default_address(p_address_id)` (الزبون، migration `20261118000001`): يجعل عنوانه افتراضياً ويلغي القديم بمعاملة واحدة (قفل استشاري لكل زبون). **security invoker** (تعمل تحت RLS الزبون، فليست من دوال SECURITY DEFINER العشر). أخطاء: `NOT_AUTHENTICATED`, `ADDRESS_NOT_FOUND` (ليس عنوانه أو غير موجود).
- `revoke_user_sessions(p_user_id)` (**service_role فقط**، migration `20261119000001`، مراجعة T09-T15): يحذف كل `auth.sessions` و`auth.refresh_tokens` للمستخدم ويرجع عدد الجلسات. تستدعيه `admin-reset-pin` (T19) بعد ضبط الرمز، لأن تغيير كلمة السر لا يبطل الجلسات (فُحص؛ ADR 0001). الـ access token الصادر قبلها يبقى حتى انتهائه.
- `rate_order(p_order_id, p_stars, p_comment?)`: `INVALID_STARS`, `ORDER_NOT_RATEABLE`, `ALREADY_RATED`.
- `register_push_token(p_token, p_platform, p_provider = 'expo')`: لو الرمز مسجّل لحساب آخر (نفس الجهاز)، ينتقل للحساب الحالي (مع مزوّده). رمز فارغ أو أطول من 255 حرفاً أو بلا منصة/مزوّد، أو رمز `expo` ليس بصيغة `ExponentPushToken[...]`/`ExpoPushToken[...]`: `INVALID_TOKEN`. **جلسة C:** حساب `must_change_pin` يُرفض `PIN_CHANGE_REQUIRED` (يسجّل رمزه بعد تغيير الرمز).
- دوال `push-dispatch` (service_role فقط، T07): `claim_push_notifications(p_limit = 200)` تحجز صفوفاً غير مرسلة (`for update skip locked` + `claimed_at`) وترجع لكل صف مستلميه (رمز + مزوّد)، **بلا أي حساب `must_change_pin`** (مهما كان الجمهور: جهاز ضائع أو رمز مؤقت لم يُغيَّر لا يستلم شيئاً؛ جلسة C H1)؛ `finish_push_notifications(p_results, p_dead_tokens)` تسجل النتيجة وتحذف الرموز الميتة؛ `push_dispatch_authorized(p_secret)` تتحقق من السر المشترك.
- `adjust_stock(p_product_id, p_qty, p_type, p_note?, p_unit_cost_iqd?)` (أدمن، T18 migration `20261121000001`): `purchase` موجب ويتطلب `p_unit_cost_iqd` (موجب، مضاعف 250، لكل وحدة بيع) ويصير سعر الشراء الحالي (`product_costs`)؛ `waste` سالب؛ `adjust` أي إشارة بملاحظة إلزامية. يرفض الرصيد السالب. كل حركة تحفظ كلفة وحدتها (`unit_cost_iqd`: المُدخلة للمشتريات، وإلا سعر الشراء لحظة الحركة أو 0). الهدر والتسوية السالبة تزيد `daily_stats` (بيوم الحركة، بغداد). أخطاء: `NOT_ALLOWED`, `INVALID_MOVEMENT`, `PRODUCT_NOT_FOUND`, `INSUFFICIENT_STOCK` (`detail` = المنتج).
- `adjust_stock_bulk(p_items, p_type, p_note?) → int` (أدمن): `[{product_id, qty, unit_cost_iqd?}]` (حتى 500، بلا تكرار) بمعاملة واحدة وأقفال `stock` بترتيب `product_id`؛ أي بند خاطئ يُفشل الكل. لهدر اليوم والمشتريات بالجملة. نفس أخطاء `adjust_stock`.
- `recompute_daily_stats(p_from, p_to) → int` (أدمن أو service_role): يعيد بناء أيام `daily_stats` من `orders` و`order_item_costs` و`inventory_movements` (مطابق للتحديث التراكمي؛ اختبار pgTAP). أخطاء: `NOT_ALLOWED`, `INVALID_DATE_RANGE` (البداية بعد النهاية أو أكثر من 366 يوماً).
- **التقارير (T20، أدمن فقط، migration `20261126000001`):** كل المجاميع بقاعدة البيانات (اللوحة لا تجمع). الأيام بتوقيت بغداد (`[بداية اليوم، بداية اليوم التالي)` عبر `Asia/Baghdad`)، والمدى 1..366 يوماً شاملاً. الأخطاء: `NOT_ALLOWED` (42501؛ الموظف والسائق والزبون والأدمن برمز مؤقت)، `INVALID_DATE_RANGE` (بداية بعد نهاية، طرف null، أو أكثر من 366 يوماً).
  - `report_summary(p_from, p_to) → jsonb`: من `daily_stats` (الطلبات المسلّمة والملغاة، المبيعات = Σ `subtotal` المسلّمة بيوم `delivered_at` بلا الأجرة، أجور التوصيل للعلم، الكلفة لحظة الطلب، الربح الإجمالي، الهدر، خسارة التسويات السالبة، صافي الربح)، + الواردة (`created_at`) + `avg_order_iqd` (المبيعات ÷ المسلّمة مقرّباً لأقرب دينار، null بلا تسليم) + `rating_count`/`rating_avg` (رقم عشري واحد، بيوم التقييم).
  - `report_daily(p_from, p_to)`: صف لكل يوم بالمدى ولو صفراً (نفس الحقول + `placed_count`)، للرسم وCSV.
  - `report_orders_placed(p_from, p_to)`: الواردة لكل يوم (أي حالة) من فهرس `orders(created_at)`.
  - `report_top_products(p_from, p_to, p_limit = 20)`: بنود الطلبات المسلّمة بيوم التسليم، صف لكل (منتج، وحدة البند وقت الطلب): الكمية بوحدات البيع، المبيعات، الكلفة، الربح؛ مرتّب بالمبيعات ثم الكمية؛ `p_limit` 1..100.
  - `report_drivers(p_from, p_to)`: المسلّمة وأجورها لكل سائق بيوم التسليم.
  - `report_waste(p_from, p_to)`: لكل منتج كمية وكلفة الهدر (ومنه الإلغاء بلا إرجاع) والتسويات السالبة (النقص)، بكلفة الوحدة المحفوظة على الحركة، بيوم الحركة؛ مرتّب بالكلفة الكلية.
- **لا حذف فعلي لمنتج له تاريخ (مراجعة AB، L4(أ)، migration `20261126000001`):** `order_items.product_id` و`inventory_movements.product_id` صارا `on delete restrict` (كانا `set null` و`cascade`): حذف منتج له أي بند أو حركة يُرفض (`23503`) حتى لـ postgres/service_role؛ منتج بلا تاريخ يُحذف مع `stock`/`product_costs`. التعطيل (`is_active`) هو البديل.
- `admin_save_product(p jsonb) → uuid` (أدمن): إنشاء (بلا `id`؛ يتطلب `name`، `category_id`، `unit`، `price_iqd`) أو تعديل (مع `id`؛ الحقول الموجودة فقط تتغير): `name`، `description`، `category_id`، `unit` (القائمة الثابتة، قيد `products_unit_allowed`)، `price_iqd` (مضاعف 250)، `image_path`، `is_active`، `sort_order`، `cost_iqd` (سعر الشراء، تصحيح يدوي؛ null = بلا تغيير)، `low_stock_threshold` (0..10000). أخطاء: `NOT_ALLOWED`, `INVALID_PRODUCT` (`detail` = اسم الحقل)، `PRODUCT_NOT_FOUND`.
- `set_product_price(p_product_id, p_price_iqd)` (أدمن، التعديل السريع): `NOT_ALLOWED`, `INVALID_PRODUCT`, `PRODUCT_NOT_FOUND`. `reorder_products(p_ids uuid[])` (أدمن؛ `sort_order` = الموضع 1، 2، …): `NOT_ALLOWED`, `INVALID_PRODUCT` (فارغة أو مكررة)، `PRODUCT_NOT_FOUND`.
- **إشعار النقص** (trigger على `stock`، كل المسارات: `place_order`، الإلغاء، `adjust_stock*`): نزول الرصيد من ≥ `low_stock_threshold` إلى أقل منه لمنتج نشط ← `_notify('admins_only', …)` مرة واحدة (`data.type = 'low_stock'`، `product_id`؛ النص بالكيلو لنص الكيلو). جمهور `admins_only` = الأدمن وحده (`admins` = الأدمن والموظفون للطلب الجديد).
- `set_user_role(p_user_id, p_role, p_is_active=true)` (أدمن نشط برمز غير مؤقت؛ migration `20261123000001`). نفس القيم ← لا شيء. غير ذلك: التغيير + سطر `admin_audit` (`user_role`، القديم ← الجديد). **التعطيل أو تخفيض الدور** (الرتبة: زبون < سائق < موظف < أدمن) يستدعي `revoke_user_sessions` **ويحذف `push_tokens` المستخدم** (جلسة C H1؛ كل الأجهزة تخرج؛ إعادة التفعيل تتطلب دخولاً جديداً). سائق عنده طلبات `preparing`/`ready`/`out_for_delivery` لا يُعطَّل ولا يُغيَّر دوره (`DRIVER_HAS_ORDERS`، `detail` = أرقام الطلبات "#12، #15")؛ الحل: نقلها (`assign_driver`) أو إكمالها. تغييرات الأدمن متسلسلة (قفل صفوف الأدمن النشطين) فلا يُزال آخر أدمن نشط (`LAST_ADMIN`، خط دفاع: الأدمن لا يزيل نفسه أصلاً). أخطاء: `NOT_ALLOWED`, `INVALID_ROLE` (دور أو تفعيل null), `CANNOT_DEMOTE_SELF`, `USER_NOT_FOUND`, `LAST_ADMIN`, `DRIVER_HAS_ORDERS`.
- `update_app_settings(p jsonb) → app_settings` (أدمن، T19 migration `20261122000001`): الحقول الموجودة فقط تتغير: `delivery_fee_iqd` و`min_order_iqd` (أعداد صحيحة ≥ 0 مضاعفات 250)، `max_active_orders` (1..1000)، `store_open` (boolean)، `closed_message` (≤ 200، الفارغ = null). مفتاح غير معروف أو قيمة خاطئة: `INVALID_SETTINGS` (`detail` = الحقل). غير الأدمن: `NOT_ALLOWED`. **لا update مباشر** على `app_settings` (سُحبت الصلاحية والسياسة). قيد `app_settings_min_order_multiple_250` (migration `20261111000002`) خط الدفاع الأخير. كل حفظ يغيّر شيئاً يكتب سطر `admin_audit` (`settings`) بالحقول المتغيرة فقط (القديم ← الجديد).
- حالة الإشعارات (أدمن، مؤشر صفحة الإعدادات؛ مراجعة T16-T19 M5، migration `20261124000001`): **عالق** `stuck_notifications_count() → int` = غير مرسل، `attempts < 5` (ما زال قابلاً لإعادة المحاولة)، لم يُصرف، أقدم من 5 دقائق (المرسِل متوقف أو بطيء). **فاشل نهائياً** `failed_notifications_count() → int` = غير مرسل، `attempts >= 5`، لم يُصرف (رمز جهاز تالف مثلاً؛ لا يعني توقف المرسِل). `dismiss_failed_notifications() → int` يصرف الفاشلة (`notification_outbox.dismissed_at`، الصفوف تبقى) ويرجع عددها، ويكتب `admin_audit` (`notifications_dismissed`، العدد) إن كان > 0. الثلاث `NOT_ALLOWED` لغير الأدمن.
- `add_buildings(p_subsection_id, p_numbers text[]) → int` (أدمن): عمارات بالجملة لوحدة (أرقام **1..100** نصاً، حتى 500 عنصر، المكرر بالقائمة أو بالجدول يُتجاهل بـ `on conflict do nothing`)، ويرجع عدد المُضاف؛ `sort_order` = الرقم. أخطاء: `NOT_ALLOWED`, `INVALID_BUILDINGS` (قائمة فارغة/طويلة/رقم خارج 1..100، أو وحدة غير موجودة).
- العناوين (جلسة B، M7): قيد `buildings_number_format` (`^([1-9][0-9]?|100)$`) على `buildings.number` بقاعدة البيانات (أي إدخال أو إعادة تسمية خارج 1..100 ← `23514`). صلاحيات الأدمن على `sectors`/`subsections`/`buildings`: `update` للأعمدة `name`/`number` و`sort_order` و`is_active` فقط (لا `id` ولا الأب: نقل وحدة أو عمارة يحرّك العناوين المحفوظة)، ولا `delete` (الإخفاء بديله؛ العناوين تشير إليها). `address_usage(p_kind, p_id) → int` (أدمن؛ `sectors` | `subsections` | `buildings`، وإلا `INVALID_REQUEST`): عدد عناوين الزبائن المحفوظة تحته، تعرضه اللوحة قبل تأكيد إعادة التسمية.
- دوال service_role لـ `admin-reset-pin` و`admin-create-user` (T19): `admin_rate_hit(p_kind, p_admin) → int` (جلسة B، L3: `pin_reset` أو `user_creation`، وإلا `INVALID_REQUEST`) تسجّل **المحاولة** (ناجحة أو فاشلة) بقفل لكل أدمن وترجع عدد محاولات آخر ساعة شاملة هذه، والدالة ترفض 429 إن زاد على 20 (`admin_actions_last_hour` القديمة حُذفت بجلسة C، L2)؛ `record_pin_reset(p_user_id, p_reset_by, p_kind = 'admin')` (يضبط `must_change_pin` ويحذف `push_tokens` المستخدم؛ `kind = 'admin'` يتطلب `reset_by` و`break_glass` للسكربت المحلي يمنعه، وإلا `INVALID_REQUEST`: بالدالة لا بقيد جدول لأن `reset_by` يصير null عند حذف الأدمن)؛ `finish_user_creation(p_user_id, p_created_by, p_role, p_full_name)` (الدور والاسم و`must_change_pin` والتدقيق بمعاملة؛ `INVALID_ROLE` لغير `staff`/`driver`، `USER_NOT_FOUND`). **الدالتان تتحققان أن المستدعي ليس برمز مؤقت:** أدمن `must_change_pin` يُرفض بـ `PIN_CHANGE_REQUIRED` (403) قبل أي حد معدل أو تغيير (جلسة B، كما ترفضه قاعدة البيانات)؛ سجلاتهما بلا الرمز حتى داخل نص أي خطأ (`errTextWithout`).
- حذف الحساب (service_role فقط، تستدعيها Edge Function `delete-account`، T08): `begin_account_deletion(p_user_id) → boolean` (is_active السابق) تأخذ قفل `place_order` لنفس المستخدم، ترفض `ADMIN_ACCOUNT` (أدمن) و`ACTIVE_ORDER` (طلب غير منتهٍ كزبون أو كسائق معيَّن)، وتعطّل الحساب حتى يكتمل `auth.admin.deleteUser`؛ `abort_account_deletion(p_user_id, p_was_active)` ترجع الحالة إن فشل الحذف. `USER_NOT_FOUND` إن لم يوجد ملف شخصي. الدالة ترجع نفس الرموز بـ `{error}` مع HTTP 403/409/404.
- حماية الحسابات (trigger `before insert/update of phone` على `auth.users`، migration `20261116000001`، ADR 0001): `PHONE_INVALID` لحساب بلا هاتف أو برقم ليس `9647XXXXXXXXX` (يصل للتطبيق كخطأ GoTrue عام "Database error"؛ التطبيق يتحقق من الرقم قبل الإرسال).

كل رموز هذا القسم لها رسالة عربية بـ `packages/shared/src/errors.ts`، واختبار Jest يفشل إن نقص رمز أو اختلف هذا القسم عن الرموز التي يرفعها SQL.

## 6) الأمان
1. RLS مفعّل على **كل** جدول. `notification_outbox` بلا سياسات (service_role فقط).
2. الصلاحيات تُسحب بالكامل ثم تُمنح صراحة لكل جدول ولكل دالة (`revoke all` + `grant`)، حتى لا تتسرب صلاحيات Supabase الافتراضية.
3. لا سياسات `insert/update/delete` على الطلبات والمخزون؛ الكتابة فقط من خلال الدوال.
4. الدوال `security definer` مع `set search_path = public, pg_temp`. دوال الأدوار المستخدمة داخل RLS (`current_user_role`، `is_admin`، `is_staff_or_admin`) تعيش بمخطط `private` غير المكشوف بالـ API، والأسماء بـ `public` أغلفة security invoker. كل الدوال لها `search_path` ثابت.
5. مفتاح `service_role` يُستخدم **فقط** داخل Edge Functions، ولا يوضع أبداً بتطبيق موبايل أو بكود الويب في المتصفح.
6. `anon` يقرأ الكتالوج والعناوين والإعدادات فقط (التصفح قبل الدخول).
7. السياسات تستخدم `(select auth.uid())` و`(select private.is_admin())` (تُحسب مرة لكل استعلام)، ولا توجد سياستان permissive لنفس الدور والعملية. الهدف: Advisor بلا تحذيرات عدا دوال RPC العشر المقصودة.
8. الدوال الجديدة **لا تُنفَّذ افتراضياً** من `PUBLIC` (`alter default privileges for role postgres` عامة، لا بالمخطط)، فكل دالة RPC جديدة تحتاج `grant execute` صريحاً.
9. `service_role` (لـ Edge Functions فقط) له صلاحيات محددة: `usage` على `public`، `select/update` على `notification_outbox`، `select/delete` على `push_tokens`، `select` على `profiles` و`orders`، وتنفيذ `signup_rate_hit` (جدوله بمخطط `private`) و`revoke_user_sessions` ودوال T19 (`admin_rate_hit`، `record_pin_reset`، `finish_user_creation`؛ لا صلاحية مباشرة على `pin_resets`/`user_creations`). أي حاجة جديدة تُمنح بـ migration المهمة. `01_schema.sql` يفحص القائمة بالضبط (محلياً وبالسحابة).
10. الكتابة المباشرة على `products` و`addresses` بأعمدة محددة فقط (لا `in_stock` ولا `id` ولا `created_at`، ولا نقل عنوان لزبون آخر). لا صلاحيات على الـ sequences لـ `anon`/`authenticated`.
11. bucket الصور عام (العرض بالرابط العام)، لكن **قائمة الملفات** للأدمن فقط.

## 7) المصادقة (الهاتف + PIN، بدون رسائل)
> قرار المالك 2026-11-14: لا SMS ولا OTP (كلفة الرسائل بالعراق). التفاصيل والأسباب: [ADR 0001](ADR/0001-phone-pin-auth.md).
- Supabase Auth بمزوّد **Phone مع كلمة سر**: كلمة السر = رمز **PIN من 6 أرقام**. تأكيد الهاتف **معطّل**. **لا تُرسل أي رسالة أبداً** (لا SMS ولا بريد).
- **التسجيل عبر الخادم فقط (قرار المالك 2026-11-15):** التسجيل العام بـ GoTrue **مطفأ** (Allow new users to sign up: OFF)، فلا `signUp` ولا `signInWithOtp` ينشئ حساباً. الحساب الجديد من Edge Function `signup` (§8): تفحص الرقم والـ PIN بالخادم بنفس قواعد `packages/shared`، وتنشئه بـ `auth.admin.createUser` (هاتف مؤكد)، بحدود معدل خاصة (20/ساعة لكل IP، 5/ساعة لكل رقم؛ `private.signup_rate_limits`، migration `20261117000001`). ثم يدخل التطبيق بـ `signInWithPassword`.
- **Send SMS Hook** (`private.hook_send_sms_reject`، migration `20261116000001`) يرفض كل إرسال: `signInWithOtp` وإعادة الإرسال وتغيير الرقم و`reauthenticate` تفشل. الكلفة صفر حتى لو ضُبط مزوّد SMS بالخطأ. (`signInWithOtp` لرقم جديد كان يُنشئ الحساب قبل رفض الإرسال؛ أُغلق بإطفاء التسجيل العام، افتراض 53.)
- صيغة الرقم E.164: `+9647XXXXXXXXX`. التطبيقات تقبل `07XXXXXXXXX` (وأرقاماً عربية) وتحوّله (`phonePinCredentials` بـ `packages/shared`). Supabase يخزنه `9647XXXXXXXXX`.
- **كل حساب برقم صالح:** trigger على `auth.users` (`before insert`، و`before update of phone` عند تغيّر الرقم) يرفض حساباً بلا هاتف أو برقم ليس `9647XXXXXXXXX` (`PHONE_INVALID`). لا حسابات بالبريد. لذلك `profiles.phone` موجود دائماً و`PHONE_REQUIRED` لا يمنع زبوناً حقيقياً.
- **رقم واحد = حساب واحد:** `auth.users.phone` فريد (GoTrue)، وفهرس فريد `profiles_phone_key` وقيد صيغة `profiles_phone_format`.
- **الـ PIN:** 6 أرقام بالضبط، يُرفض السهل (تكرار، تسلسل، أنماط شائعة، أرقام من الهاتف): `validatePin` بـ `packages/shared` عند التسجيل (بالتطبيق **وبالخادم** في دالة `signup`) وتغيير الرمز وإعادة ضبطه. GoTrue لا يرى الرمز (bcrypt)؛ حده الأدنى `minimum_password_length = 6` (يكفي لتغيير الرمز بـ `updateUser`). Leaked password protection **معطّل** (يرفض كل الرموز تقريباً).
- عند التسجيل ينشئ trigger صفاً في `profiles` بدور `customer`. السائقون والموظفون يسجلون بنفس الدالة `signup` (تطبيق السائق، أو تطبيق الزبون للموظف)، ثم الأدمن يغيّر دورهم من اللوحة (`set_user_role`).
- أول أدمن: يُعيَّن يدوياً بـ SQL من لوحة Supabase (RUNBOOK §7).
- **نسيان الـ PIN:** الزبون يراسل المتجر على واتساب من نفس الرقم؛ الأدمن يعيد الضبط عبر Edge Function `admin-reset-pin` (§8، تُبنى بـ T19).
- **التخمين:** حدود Supabase لكل IP (تسجيل/دخول: 30 كل 5 دقائق افتراضياً). لا قفل لكل حساب على خطتنا (Password Verification Hook لـ Teams/Enterprise فقط). الخطر وخطة التخفيف بـ ADR 0001 (CAPTCHA بـ T23، الترقية لاحقاً).
- إعدادات اللوحة المطلوبة لكل مشروع: RUNBOOK §6.

## 8) Edge Functions
| الدالة | المُشغِّل | العمل |
|---|---|---|
| `push-dispatch` | trigger (`after insert for each statement`) على `notification_outbox` يطلب الدالة بـ `pg_net`، + `pg_cron` كل دقيقة إن بقي شيء غير مرسل. المصادقة بترويسة `x-dispatch-secret` (سر بـ Vault، `verify_jwt = false`) | تحجز حتى 200 صف، تجمع الرموز حسب الجمهور (`user` / كل السائقين النشطين / الأدمن والموظفون النشطون)، ترسل كل رمز عبر مزوّده: Expo Push API بدفعات ≤100 (`channelId: orders`، أولوية عالية)؛ `fcm` يُتخطى بملاحظة بـ `last_error`. تحدّث `sent_at` أو `attempts` و`last_error` (حد أقصى 5 محاولات)، وتحذف الرموز التي يرجع لها `DeviceNotRegistered` |
| `delete-account` | يستدعيها التطبيق بـ JWT المستخدم (`POST`، مطلوب من Apple وGoogle؛ `verify_jwt = true` + `auth.getUser`) | `begin_account_deletion` (يرفض `ADMIN_ACCOUNT` ← 403، `ACTIVE_ORDER` ← 409 لطلب غير منتهٍ كزبون أو كسائق معيَّن؛ ويعطّل الحساب)، ثم `auth.admin.deleteUser`؛ إن فشل: `abort_account_deletion` و500. الحذف يمتد: `profiles` ← العناوين والرموز تُحذف، والطلبات والتقييمات والسجل تبقى بنسخها مع `customer_id`/`driver_id` = null |
| `signup` (ADR 0001، تحديث 2026-11-15) | التطبيقات قبل الدخول (`POST {phone, pin}`، `verify_jwt = false`؛ المفتاح المنشور ليس JWT) | `signup_rate_hit(ip, phone)` أولاً (كل محاولة تُحسب؛ 20/ساعة لكل IP من `cf-connecting-ip`، 5/ساعة لكل رقم)، ثم `normalizeIraqiPhone` و`validatePin` من `packages/shared` (عبر `import_map`)، ثم `auth.admin.createUser({phone, password, phone_confirm: true})` ← `201 {created: true}`، والتطبيق يدخل بـ `signInWithPassword`. الأخطاء (`{"error": CODE}`): `PHONE_INVALID` ← 400، `PIN_INVALID` ← 400، `PHONE_TAKEN` ← 409، `RATE_LIMITED` ← 429، `SIGNUP_FAILED` ← 400/405/500 (جسم خاطئ، أو فشل الحد أو Auth: يغلق ولا يمرر). لا يُسجَّل الـ PIN ولا جسم الطلب |
| `admin-create-user` (T19) | لوحة الأدمن بـ JWT الأدمن (`POST {phone, full_name, role, pin}`، `verify_jwt = true` + `auth.getUser` + أدمن نشط) | `normalizeIraqiPhone` و`validatePin` من `packages/shared`، حد 20 محاولة/ساعة لكل أدمن (`admin_rate_hit`: تشمل الفاشلة مثل `PHONE_TAKEN`)، `auth.admin.createUser` (هاتف مؤكد) ثم `finish_user_creation`؛ فشلها ← حذف الحساب. ← `201 {user_id}`. الأخطاء: `NOT_AUTHENTICATED` ← 401، `NOT_ALLOWED` ← 403، `PIN_CHANGE_REQUIRED` ← 403 (المستدعي أدمن برمز مؤقت)، `INVALID_REQUEST` ← 400/405 (جسم أو اسم 1..80 خاطئ)، `PHONE_INVALID` ← 400، `INVALID_ROLE` ← 400 (غير `staff`/`driver`)، `PIN_INVALID` ← 400 (`detail`)، `RATE_LIMITED` ← 429، `PHONE_TAKEN` ← 409، `INTERNAL` ← 500. الرمز لا يرجع ولا يُسجَّل. التفاصيل: SPEC-admin §2.6 |
| `admin-reset-pin` (T19) | لوحة الأدمن بـ JWT الأدمن (`POST {user_id, new_pin}`، `verify_jwt = true` + `auth.getUser` + `profiles.role = 'admin'` ونشط) | إعادة ضبط PIN مستخدم نسيه (بعد رسالة واتساب من نفس الرقم): `validatePin` برقم الهدف، حد 20 محاولة/ساعة لكل أدمن (`admin_rate_hit`)، `updateUserById` ثم `record_pin_reset` (التدقيق + `must_change_pin` + حذف رموز الإشعارات) ثم `revoke_user_sessions`، وكل من الأخيرتين بمحاولتين إضافيتين عند الفشل (جلسة C M2). فشل التدقيق نهائياً ← الرمز المكتوب يُستبدل برمز عشوائي لا يعرفه أحد (لا رمز حي معروف بلا علامة) و`RESET_INCOMPLETE`؛ فشل إبطال الجلسات نهائياً ← `RESET_INCOMPLETE` (العلامة والتدقيق ثابتان). ← `200 {ok: true}`. الأخطاء: `NOT_AUTHENTICATED` ← 401، `NOT_ALLOWED` ← 403، `PIN_CHANGE_REQUIRED` ← 403 (المستدعي أدمن برمز مؤقت)، `INVALID_REQUEST` ← 400/405، `USER_NOT_FOUND` ← 404، `ADMIN_ACCOUNT` ← 403 (هدف أدمن أو المستدعي نفسه)، `PIN_INVALID` ← 400 (`detail` = سبب الرفض من `validatePin`: الطول، رمز سهل، أو من رقم الهدف)، `TOO_MANY_RESETS` ← 429، `RESET_INCOMPLETE` ← 500 (الرمز تغيّر لكن التدقيق أو إبطال الجلسات لم يكتمل: **لا يُرسل الرمز**، أعد الضبط)، `INTERNAL` ← 500. التفاصيل: SPEC-admin §2.6 |

## 9) كيف نضمن الأداء
| الإجراء | التفصيل |
|---|---|
| منطق الطلب بقاعدة البيانات | رحلة شبكة واحدة لكل طلب، وقفل صفوف المخزون فقط (لا قفل للجدول كاملاً) |
| ترتيب الأقفال | `order by product_id` في `place_order` والإلغاء، لمنع الـ deadlock |
| لا صف ساخن بمسار الطلب | `daily_stats` تتحدث عند التسليم/الإلغاء فقط، لا عند كل طلب. عدد الطلبات اليومي يُحسب من فهرس `orders(created_at)` |
| الفهارس | `orders(customer_id, created_at desc)`، `orders(status, created_at)`، `orders(driver_id, status)`، فهرس جزئي للطلبات غير المعيَّنة، `products(category_id, is_active, sort_order)`، `order_items(order_id)`، `inventory_movements(product_id, created_at desc)`، فهرس جزئي للإشعارات غير المرسلة. التقارير (T20): `orders(delivered_at) where status = 'delivered'` و`inventory_movements(created_at) where qty < 0 and type in ('waste','adjust')`؛ السرعة تُفحص بـ `pnpm db:report-perf` (200 ألف طلب على سنة داخل معاملة تُلغى، CI). تُراجع بـ `EXPLAIN ANALYZE` على بيانات تجريبية كبيرة قبل الإطلاق |
| Pagination | كل القوائم keyset (`created_at`، `id`) أو `range()` بحجم 20 إلى 50. لا استعلام بلا `limit` |
| Realtime محدود | الزبون يشترك بـ `orders` بفلتر `id=eq.<order_id>` لطلبه الحالي فقط، ويلغي الاشتراك عند الوصول لحالة نهائية. السائق يشترك بطلباته المعيَّنة. الأدمن يشترك بالطلبات الجديدة فقط |
| تخزين مؤقت | الكتالوج يُخزن بالتطبيق (`staleTime` 5 دقائق) |
| الصور | bucket `product-images` بحد 512KB، والتطبيق يصغّر لعرض 800px قبل الرفع |
| Connection pooling | Edge Functions ولوحة الأدمن (server-side) تستخدم رابط Supavisor |
| اختبار حمل k6 | انظر أدناه |

### اختبار الحمل (k6)
- **السيناريو 1، ذروة الطلبات:** 300 مستخدم افتراضي، كل واحد يسجّل الدخول بحساب تجريبي ويستدعي `place_order` بسلة عشوائية من 1 إلى 8 بنود، لمدة 5 دقائق.
- **السيناريو 2، التصفح:** 500 مستخدم افتراضي يقرأون الأقسام والمنتجات بصفحات.
- **السيناريو 3، التنافس:** 200 طلب متزامن على منتج رصيده 50. **المطلوب:** 50 طلباً ناجحاً بالضبط، والرصيد 0، والباقي `INSUFFICIENT_STOCK`، وصفر deadlocks.
- **العتبات:** p95 لـ `place_order` < 500ms، p95 لقراءة الكتالوج < 300ms، نسبة الأخطاء غير المتوقعة < 0.5%.
- يُشغَّل على مشروع staging بنفس حجم Compute الإنتاجي، **لا على الإنتاج**.
- ملاحظة تاريخية (مرحلة المسودة، Postgres 16 محلي، قبل Supabase): 40 طلباً متزامناً على رصيد 10 أعطت 10 طلبات ناجحة بالضبط بلا deadlocks. التحقق الحالي المستمر بـ CI عبر سكربت التزامن (انظر RUNBOOK §8)، والقياس الفعلي بـ T22.

## 10) الاختبارات (pgTAP)
لكل دالة ولكل سياسة RLS ملف اختبار في `supabase/tests/`. الحد الأدنى:
- الأسعار من الجدول، التقريب، الأجرة، الحد الأدنى، المتجر المغلق.
- منع التكرار (نفس المفتاح يرجع نفس الطلب).
- كل خلية بجدول الصلاحيات في §5 (مسموح وممنوع).
- الإلغاء يرجع المخزون، والتسليم يحدّث `daily_stats` بالأرقام الصحيحة.
- الزبون لا يرى `product_costs`/`stock`/طلبات غيره؛ السائق لا يرى هاتف زبون طلب غير معيَّن له؛ `anon` يقرأ الكتالوج فقط.
- الزبون لا يقدر يغيّر `role` أو يُدخل طلباً مباشرة.
- `push-dispatch` (`11_push_dispatch.sql`): المزوّد لكل رمز، الحجز والإنهاء، السر المشترك، trigger مرة لكل معاملة لا يُفشل المعاملة، التنظيف اليومي؛ ومنطق الإرسال بـ Deno (`push_dispatch_test.ts`، ومنه تقسيم مشاريع Expo).
- حذف الحساب (`12_delete_account.sql`، `delete_account_test.ts`، وتكامل `pnpm it:delete-account` على dev).
- نص العنوان بالإشعارات ("وحدة A1 - عمارة 12") بـ `03_place_order.sql` و`05_driver.sql`، ووحدات البيع الثابتة بـ `02_rls_catalog.sql`.
- الدخول بالهاتف + PIN (`13_phone_pin_auth.sql`): الـ hook يرفض كل SMS وصلاحياته، رفض حساب بلا رقم أو برقم غير صالح، رقم واحد = حساب واحد، وصيغة `profiles.phone`.
- التسجيل عبر الخادم: حدود المعدل وصلاحياتها والتجزئة والنافذة (`14_signup_rate_limit.sql`)، منطق الدالة (`signup_test.ts`)، وتكامل `pnpm it:signup` على dev (و`-- --signup-disabled` بعد إطفاء التسجيل العام).
- مراجعة T16-T19 جلسة A (`20_account_lifecycle.sql`): الرمز المؤقت (الضبط، الرفض، المسح بتغيير كلمة السر)، المعطّل/المخفَّض بلا وصول، الجلسات تُبطل، التدقيق، آخر أدمن، سائق بطلبات، نقل طلب بالطريق، الإلغاء بلا إرجاع (هدر بكلفة الطلب)، إشعار `ready` مرة واحدة. `21_staff_money.sql`: كل عمود مبالغ مصنَّف، وما يراه الموظف منها بالضبط.
- مراجعة T16-T19 جلسة B (`22_review_session_b.sql`): `record_pin_reset(kind)` وسطر `break_glass`، `admin_rate_hit` (العدّ، الأنواع، نافذة الساعة، service_role فقط)، الإشعارات (عالق ≠ فاشل نهائياً ≠ مصروف، التدقيق، الموظف مرفوض)، قيد صيغة العمارة 1..100 (قاعدة البيانات و`add_buildings`)، صلاحيات جداول العناوين (لا نقل ولا حذف)، `address_usage`. Edge Functions: رفض الأدمن برمز مؤقت، وعدّ المحاولات الفاشلة، وسجل بلا الرمز (`deno test`)؛ وسكربت الطوارئ (`pnpm it:break-glass` على dev، و`breakGlass.test.mjs` للمساعدات). `01_schema.sql` يثبّت من جديد قائمة دوال service_role وحدها (بلا دوال الـ trigger).
- T19 (`19_admin_settings_staff.sql`): `update_app_settings` (أدمن فقط، قيد 250، لا update مباشر)، مؤشر الإشعارات العالقة، RLS `pin_resets`/`user_creations` ودوال service_role، و`add_buildings`؛ منطق الدالتين (`admin_reset_pin_test.ts`، `admin_create_user_test.ts`)، وتكامل `pnpm it:admin-users` على dev.

## 11) النسخ الاحتياطي والمراقبة
- Supabase Pro: نسخ يومي. تجربة استعادة واحدة على مشروع staging قبل الإطلاق.
- تنبيه عند تجاوز 80% من مساحة قاعدة البيانات أو الاتصالات.
- مراقبة `notification_outbox` (عدد غير المرسل أقدم من 5 دقائق) بلوحة الأدمن.

## 12) تغييرات مخططة للوحة الأدمن (قرارات 2026-11-15)
> **بُني بـ T18 (migration `20261121000001`):** §12.1 كاملاً، و§12.2 للمنتجات، و§12.5. **بـ T19 (migration `20261122000001`):** `update_app_settings` وسحب الـ update المباشر (قيد الحد الأدنى كان موجوداً). التفاصيل النهائية بـ §5.
> مواصفة للمهام T18، T19، T20، T25، T26. كل بند = migration جديدة واختبارات pgTAP. الرموز الجديدة تُنقل إلى §5 (وerrors.ts) مع البناء فقط، لأن اختبار Jest يطابق §5 مع ما يرفعه SQL فعلاً.

### 12.1 المخزون والكلفة (T18)
- `inventory_movements.unit_cost_iqd bigint` (≥ 0، مضاعفات 250 للمشتريات). يُملأ لكل حركة: `purchase` من السعر المُدخل؛ `waste` و`adjust` و`sale` و`cancel_return` من `product_costs` لحظة الحركة (0 إن لم يوجد سعر شراء، مع بقاء تنبيه "منتج بلا سعر شراء"). **Backfill على dev:** الحركات القديمة من سعر الشراء الحالي.
- `adjust_stock(p_product_id, p_qty, p_type, p_note?, p_unit_cost_iqd?)`: `purchase` يتطلب `p_unit_cost_iqd` (مضاعف 250) ويحدّث `product_costs` لآخر سعر؛ `adjust` يتطلب ملاحظة؛ `waste` و`adjust` السالبة تزيد `daily_stats` بـ `qty × unit_cost` (اليوم بتوقيت بغداد). الأخطاء الحالية (`INVALID_MOVEMENT` لسعر ناقص أو ملاحظة ناقصة).
- `adjust_stock_bulk(p_items jsonb, p_type, p_note?)` (أدمن): `[{product_id, qty, unit_cost_iqd?}]` بمعاملة واحدة، بأقفال `stock` بترتيب `product_id`؛ أي بند خاطئ يُفشل الكل (`detail` = المنتج). لهدر اليوم (ويقبل المشتريات بالجملة).
- `daily_stats`: أعمدة `waste_cost_iqd` و`adjust_loss_iqd` (≥ 0)، و`net_profit_iqd` = `gross_profit_iqd - waste_cost_iqd - adjust_loss_iqd` (عمود محسوب). `_bump_daily_stats` يقبلها.
- `recompute_daily_stats(p_from date, p_to date)` (أدمن/service_role): يعيد بناء الأيام من `orders` و`order_item_costs` و`inventory_movements` (للتصحيح وللـ backfill)؛ اختبار pgTAP يقارن التحديث التراكمي بإعادة البناء.
- **حد النقص:** `stock.low_stock_threshold int not null default 5` (0..10000). عند أي تغيير رصيد (البيع بـ `place_order`، الإلغاء، `adjust_stock*`) ينزل فيه الرصيد من ≥ الحد إلى < الحد ← `_notify('admins_only', …)` مرة واحدة (`type: low_stock`، `product_id`، النص: الاسم والرصيد بالكيلو لنص الكيلو أو بالوحدة). العودة فوق الحد ثم النزول = إشعار جديد. لا إشعار للموظفين: **حُسم بالبناء** بجمهور جديد `admins_only` (الأدمن وحده) بقيد `notification_outbox` و`claim_push_notifications`؛ trigger على `stock` (لمنتج نشط فقط).
- اختبار ثابت (invariant): لكل منتج `stock.qty = Σ inventory_movements.qty` (الـ seed يُنشئ حركة رصيد افتتاحي بدل كتابة `stock` مباشرة).

### 12.2 المنتجات والإعدادات عبر دوال (T18، T19)
- `admin_save_product(p jsonb) → uuid` (أدمن): إنشاء أو تعديل (الاسم، الوصف، القسم، الوحدة من `SALE_UNITS`، سعر البيع، الصورة، النشاط، الترتيب، سعر الشراء، حد النقص) بمعاملة واحدة. سعر الشراء هنا للتصحيح اليدوي فقط (الطبيعي من المشتريات).
- `set_product_price(p_product_id, p_price_iqd)` (أدمن) للتعديل السريع. `reorder_products(p_ids uuid[])` (أدمن).
- `update_app_settings(p jsonb)` (أدمن): الأجرة، الحد الأدنى، `max_active_orders`، فتح/غلق المتجر ورسالته. قيد جديد: `min_order_iqd % 250 = 0`.
- بعدها تُسحب صلاحيات الكتابة المباشرة (`insert`/`update`) على `products` و`product_costs` و`app_settings` من `authenticated` (الأقسام تبقى بـ RLS)، وتُحدَّث اختبارات `01_schema.sql` و`02_rls_catalog.sql`.

### 12.3 التقارير والرئيسية والتقييمات (T20، T25، T26)
> **بُني بـ T20 (migration `20261126000001`):** دوال التقارير (التفاصيل النهائية بـ §5) + `report_summary` و`report_daily` (المجاميع بقاعدة البيانات لا بالمتصفح) + الفهرس الجزئي `orders(delivered_at) where status = 'delivered'` + فهرس جزئي للهدر والتسويات السالبة `inventory_movements(created_at)`. الباقي: `dashboard_today` وفهرس `cancelled_at` بُنيا بـ T25 (migration `20261127000001`، أدناه)، و`ratings_summary` لـ T26.
- `report_top_products(p_from, p_to, p_limit = 20)`، `report_drivers(p_from, p_to)`، `report_waste(p_from, p_to)` (الكمية والكلفة لكل منتج، الهدر والتسويات السالبة)، `report_orders_placed(p_from, p_to)` (عدد الطلبات الواردة لكل يوم من `orders(created_at)`): أدمن فقط، بتوقيت بغداد، مدى أقصى 366 يوماً.
- `dashboard_today() → jsonb` (موظف وأدمن): اليوم حتى الآن وأمس حتى نفس الدقيقة (بغداد): المسلّمة (`delivered_at`)، الملغاة (`cancelled_at`)، الواردة (`created_at`)، المفتوحة الآن بكل حالة، عدد المنتجات تحت حد النقص؛ وللأدمن فقط: المبيعات، متوسط الطلب، كلفة هدر اليوم، صافي ربح اليوم وأمس كاملاً (`daily_stats`). للموظف حقول المال `null`. فهارس جزئية: `orders(delivered_at) where status = 'delivered'` (T20) و`orders(cancelled_at) where status = 'cancelled'` (T25).
  - **مبني (T25):** `public.dashboard_today()` تتحقق من `private.is_staff_or_admin()` (يستبعد الزبون والسائق والمعطّل ومن عليه `must_change_pin`، `NOT_ALLOWED`) وتستدعي `private.dashboard_at(now(), is_admin)` (لا يصل إليها `authenticated`؛ تقبل لحظة صريحة لاختبار pgTAP بوقت ثابت). الشكل ثابت بالمفاتيح للدورين: `day`، `as_of`، `delivered_count`/`cancelled_count`/`placed_count` وكل منها `_prev`، `open` {pending, preparing, ready, out_for_delivery}، `low_stock_count`، `low_stock_items` (حتى 8: `product_id`، `name`، `unit`، `qty`، `threshold` بوحدات البيع، بلا مبالغ)، والمال (`sales_iqd`، `sales_prev_iqd`، `avg_order_iqd`، `avg_order_prev_iqd`، `waste_cost_iqd`، `net_profit_iqd`، `net_profit_prev_iqd`) للأدمن وإلا `null`.
- `ratings_summary(p_from?, p_to?) → jsonb` (موظف وأدمن): المتوسط، العدد، التوزيع 1..5 (تجميعات PostgREST مطفأة، فالحساب بدالة). القائمة نفسها قراءة مباشرة لـ `ratings` بـ RLS الحالية.
- لا يُكتب `daily_stats` عند كل طلب (§9 "لا صف ساخن"): الطلبات الواردة تُحسب من الفهرس.

### 12.4 لاحقاً (غير مخطط)
- جدول مصاريف تشغيل (إيجار، رواتب…) يُطرح من صافي الربح.
- صورة القسم على شرائح الأقسام برئيسية تطبيق الزبون (`categories.image_path` متاح للقراءة العامة الآن؛ خيار، لا تغيير).

### 12.5 الكيلو بلوحة الأدمن، وصور الأقسام (قرارات 2026-11-15؛ T18)
- **لا تغيير بقاعدة البيانات للكيلو:** `stock.qty` و`inventory_movements.qty` و`low_stock_threshold` و`order_items.qty` تبقى بوحدات البيع (أنصاف الكيلو)، و`price_iqd` و`unit_cost_iqd` و`product_costs` لكل وحدة بيع بمضاعفات 250. الدوال (`adjust_stock*`، `admin_save_product`، `set_product_price`، التقارير) تستقبل وترجع وحدات البيع.
- اللوحة تحوّل بالمساعد المشترك `packages/shared/src/adminUnits.ts` (SPEC-admin §2.9): كيلو × 2 = وحدات، سعر الكيلو ÷ 2 = سعر الوحدة، وسعر الكيلو مضاعف 500. قيد مضاعفات 250 بقاعدة البيانات هو خط الدفاع الأخير؛ لا رمز خطأ جديد (قيد CHECK `price_iqd % 250 = 0` الحالي يكفي).
- **صور الأقسام:** bucket `product-images` الحالي (migration `20261110000002`: قراءة عامة، كتابة/حذف للأدمن فقط) بالمسار `categories/<category_id>/<timestamp>.webp`، والمسار يُحفظ بـ `categories.image_path` (العمود موجود). إنشاء/تعديل/ترتيب/إخفاء الأقسام كتابة مباشرة للأدمن بـ RLS الحالية. **لا migration.** اختبار pgTAP لـ Storage: غير الأدمن لا يرفع تحت `categories/`.

## افتراضات
1. أسعار المنتجات وأجرة التوصيل **مضاعفات 250** (قيد بقاعدة البيانات). لذلك التقريب عملياً لا يغيّر المجموع، ويبقى كحماية.
2. التقريب "لأقرب 250" يعني النصف للأعلى (125 ← 250).
3. الحد الأدنى للطلب افتراضياً 0، ويُعدّل من الإعدادات. يُقارن بالمجموع قبل الأجرة.
4. كمية البند 1..99، وحد أقصى 50 بنداً مختلفاً بالطلب.
5. نقص المخزون يحدث **عند إنشاء الطلب** (لا عند التحضير)، ويُرجَع عند الإلغاء. التالف بعد التحضير يُسجل يدوياً `waste`.
6. منتج بلا رصيد يظهر للزبون "غير متوفر" (`in_stock = false`) ولا يُخفى.
7. السائق يقبل الطلب وهو `ready` فقط (قرار المالك 2026-11-15)؛ لا حد لعدد الطلبات النشطة للسائق بالمرحلة الأولى.
8. الإلغاء بعد خروج الطلب للتوصيل: أدمن فقط. الموظف يلغي من `pending`/`preparing`/`ready`، والزبون من `pending` فقط.
9. دور `staff` = موظف تحضير: يرى الطلبات والمخزون، يحضّر ويلغي، يعيّن سائقاً. لا يرى التكاليف والأرباح ولا يدير المنتجات.
10. التقارير اليومية بتوقيت `Asia/Baghdad`، ويُحسب اليوم بوقت التسليم/الإلغاء.
11. الربح الإجمالي = مجموع البنود − تكلفتها لحظة الطلب. أجرة التوصيل تُعرض منفصلة ولا تدخل بالربح (لأن غالباً تذهب للسائق؛ يُراجع مع صاحب المشروع).
12. منتج بلا سعر شراء مسجل تُحسب تكلفته 0 (تنبيه بلوحة الأدمن لهذه المنتجات).
13. التصفح بدون تسجيل دخول مسموح؛ الدخول مطلوب عند الطلب.
14. لا كوبونات ولا خصومات ولا جدولة توصيل بالمرحلة الأولى.
15. عند حذف حساب الزبون تبقى طلباته (للمحاسبة) مع نسخة الاسم والهاتف. **يُراجع قانونياً** ضمن سياسة الخصوصية؛ البديل مسح `customer_name`/`customer_phone` بعد التسليم بفترة.
16. أدوات التطوير (T01): Node 24 LTS (`.nvmrc`)، pnpm 12 (`packageManager`)، TypeScript مثبّت على 6.0 لأن typescript-eslint وts-jest لا يدعمان TypeScript 7 بعد. `pnpm lint` يشمل ESLint وفحص Prettier. سكربت البناء مسموح لحزمة `supabase` فقط (`allowBuilds` بـ `pnpm-workspace.yaml`).
17. المناطق (T02): مشروع التطوير `mukhdar-dev` بسنغافورة (`ap-southeast-1`) لأنه أُنشئ مسبقاً. مشروع الإنتاج **يُنشأ بفرانكفورت (`eu-central-1`)** لزمن استجابة أقل من العراق. التطوير بلا Docker، على المشروع السحابي مباشرة (`--remote`). التفاصيل بـ `docs/RUNBOOK.md`.
18. اختبارات pgTAP (T03) تعمل عبر `scripts/db-test.mjs` لا `supabase test db` (يحتاج Docker محلياً). كل ملف داخل `BEGIN ... ROLLBACK` مع إنشاء pgtap والدوال المساعدة داخل المعاملة. CI يشغلها على `supabase start` محلي على runner GitHub، لا على السحابة.
19. البيانات التجريبية (T05): سكربتات `seed:demo`/`seed:reset` تتصل بقاعدة التطوير مباشرة (كلمة سر القاعدة) بدل `service_role`، لأن الطلبات يجب أن تمر بـ `place_order`/`set_order_status` بهوية كل مستخدم (`auth.uid()`)، وهذا غير ممكن بمفتاح `service_role` عبر الـ API. مستخدمو العرض يُنشأون بـ `auth.users` + `auth.identities` (هاتف مؤكد) ويدخلون بالهاتف + `DEMO_PIN` (`scripts/lib/demo.mjs`، تطوير فقط، ADR 0001). الطلبات تُنشأ "الآن" ثم تُرجَع طوابعها الزمنية ليومها، وتُنقل مساهمتها بـ `daily_stats` لنفس اليوم. `service_role` يُستخدم فقط لرفع صور المنتجات (اختياري، من `.env.local`). الحماية: قائمة مشاريع تطوير مسموحة + `MUKHDAR_ENV` + `DB_URL` محلي فقط.
20. هيكل عناوين بسماية (قرار المالك 2026-11-14): قطاعان `قطاع A` و`قطاع B`؛ الوحدات (`subsections`) بأسماء `A1..A9` و`B1..B8`؛ العمارات (`buildings.number`) `1..100` داخل كل وحدة. بالواجهة والإشعارات: subsection = "وحدة"، building = "عمارة". لأن رقم العمارة يتكرر بين الوحدات، نصوص الإشعارات تذكر الوحدة مع العمارة ("وحدة A3 - عمارة 12"، migration `20261114000001`).
21. حد الطلبات المفتوحة للزبون **3** افتراضياً (`app_settings.max_active_orders`، 1..1000، يعدّله الأدمن). يحمي المخزون (يُحجز عند الطلب) ويمنع إغراق السائقين بالإشعارات. `replay` بنفس المفتاح يعمل حتى لو وصل الحد.
22. الطلب يتطلب رقم هاتف بالملف الشخصي (`PHONE_REQUIRED`)، لأن السائق يتصل بالزبون. `profiles.phone` يتبع `auth.users.phone` عند الإنشاء والتغيير، ومنذ ADR 0001 كل حساب له رقم صالح إلزامياً (`PHONE_INVALID`)، فالرمز يبقى حماية فقط.
23. عنوان افتراضي واحد لكل زبون (فهرس فريد جزئي). لتغييره: إلغاء القديم ثم تعيين الجديد (أو بعكس الترتيب بتعديلين متتاليين).
24. سبب الإلغاء وملاحظة السجل يُقصّان لـ 300 حرف (بدون خطأ).
25. الحد الأدنى للطلب من مضاعفات 250 (مثل الأجرة).
26. **push-dispatch (T07):** مزوّد لكل رمز (`expo` مُنفَّذ، `fcm` محجوز: يُقبل ويُخزن لكن يُتخطى بـ `last_error = "fcm: N token(s) skipped (provider not implemented)"`). APNs المباشر غير مخطط (iOS عبر Expo).
27. نتيجة الصف: وصل لرمز واحد على الأقل ← مرسل (لا إعادة كي لا يتكرر الإشعار، والفشل الجزئي يُكتب ملاحظة)؛ بلا مستلمين ← مرسل مع `no recipients`؛ أخطاء مؤقتة فقط ← إعادة بعد 5 دقائق (الحجز يبقى كمهلة)، حتى 5 محاولات؛ رموز ميتة/متخطاة فقط ← فشل نهائي.
28. **الإيصالات (receipts) مؤجلة:** نعتمد على تذكرة الإرسال (ticket) فقط؛ `DeviceNotRegistered` المتأخر يظهر بالإرسال التالي لنفس الرمز. تُضاف إن ظهرت حاجة.
29. السر المشترك بين القاعدة والدالة (`push_dispatch_secret`) يولّده الـ migration داخل Vault لكل بيئة، فلا يمر بأحد ولا بالـ git. رابط الدالة (`push_dispatch_url`) يُضبط بـ Vault لكل بيئة يدوياً (RUNBOOK)؛ بدونه (محلياً/CI) لا طلبات HTTP. `EXPO_ACCESS_TOKEN` اختياري (يُستخدم إن ضُبط، مطلوب فقط إن فُعّل "Enhanced push security" بحساب Expo).
30. اختبار "إشعار على جهاز حقيقي خلال 10 ثوانٍ" مؤجل لـ T14 (لا تطبيق بعد). التحقق الحالي على `mukhdar-dev`: من الإدخال للمعالجة عبر Expo الحقيقي ≈ 4 ثوانٍ.
31. **حذف الحساب (T08):** حساب `admin` لا يُحذف من التطبيق (يدوياً فقط). الموظف يحذف حسابه مثل غيره. السائق المعيَّن لطلب غير منتهٍ يُرفض (`ACTIVE_ORDER`) مثل الزبون صاحب طلب غير منتهٍ. حساب معطّل من الأدمن يستطيع حذف نفسه.
32. الحذف فوري ونهائي (لا فترة سماح ولا حذف ناعم). رمز الوصول القديم يبقى صالح التوقيع حتى انتهائه (≈ ساعة) لكنه لا يصل لشيء (لا ملف شخصي؛ `auth.getUser` يرفضه؛ رمز التحديث مُلغى)، والتطبيق يسجّل الخروج محلياً بعد النجاح. نفس الرقم يستطيع التسجيل لاحقاً كحساب جديد.
33. صفحة الويب العامة "طلب حذف الحساب" (Google Play) مؤجلة لـ T16 (تحتاج تطبيق الأدمن).
34. **وحدة البيع (قرار المالك 2026-11-14):** الخضار والفواكه (ومنها التمور والمكسرات المباعة بالوزن سابقاً) بوحدة `نص كيلو`، والأعشاب `باقة`، والباقي بالقطعة. السعر لكل وحدة ومن مضاعفات 250 كما هو. بالـ seed: سعر النص كيلو = نصف سعر الكيلو السابق مقرّباً لأقرب 250 (حد أدنى 250)، وسعر الشراء النصف، والرصيد الابتدائي الضعف. أسعار مؤقتة يعدّلها المالك.
35. **حالة `ready` (قرار المالك 2026-11-15):** بين `preparing` و`out_for_delivery`، يضعها الموظف/الأدمن عند انتهاء التجهيز. migrations: `20261115000001_order_status_ready.sql` (قيمة الـ enum وعمود `ready_at`، بملف مستقل لأن Postgres لا يستخدم قيمة enum جديدة بنفس المعاملة) و`20261115000002_ready_flow.sql` (الدوال والفهرس الجزئي `orders_unassigned_idx` صار على `status = 'ready'`).
36. الطلب الجديد يُبلَّغ للأدمن والموظفين فقط؛ السائقون يُبلَّغون عند `ready`. **افتراض:** طلب عُيِّن له سائق أثناء التحضير لا يُذاع لكل السائقين عند `ready`، بل يُبلَّغ سائقه فقط (`type: ready`، "الطلب #N جاهز للاستلام").
37. ~~إعادة التعيين غير ممكنة بعد خروج الطلب~~ ← **2026-11-16 (قرار المالك):** `assign_driver` ينقل طلباً `out_for_delivery` لسائق نشط آخر (§5)، والأدمن يقدر يلغيه بلا إرجاع للمخزون (هدر).
38. **مشاريع Expo المختلطة (مراجعة 2026-11-14، C1):** تطبيق الزبون وتطبيق السائق الخارجي غالباً مشروعا Expo مختلفان، و Expo يرفض الطلب كاملاً إن خلطهما (`PUSH_TOO_MANY_EXPERIENCE_IDS`، والحقل `details` يربط اسم المشروع برموزه). `push-dispatch` يقسم الدفعة حسب المشروع من `details` ويعيد إرسال كل جزء، ويحفظ الربط طوال الاستدعاء. **افتراض:** قيم `details` مصفوفات رموز (توثيق Expo لا يعرض الشكل)؛ إن لم تُفهم، تُرسل الرسائل غير المربوطة واحدة واحدة. جزء يُرفض مجدداً يُعامل كخطأ مؤقت (إعادة لاحقة).
39. فشل تشغيل الإرسال (Vault أو `pg_net`) لا يُفشل المعاملة التي كتبت الإشعار (مثل `place_order`): يتحول إلى `warning` و`pg_cron` يلتقط الصف خلال دقيقة (S1).
40. طلب HTTP واحد على الأكثر من الـ trigger لكل معاملة (علامة محلية `mukhdar.push_kicked`)، لا لكل جملة insert (S2). **افتراض:** لا نافذة زمنية بين المعاملات (كانت مقترحة: ثانيتان)، لأن صف معاملة متأخرة قد ينتظر دورة الـ cron (حتى دقيقة) إن حجزت الدالة قبل الـ commit.
41. تنظيف يومي (`push-history-purge`، 00:30 UTC): سجل `cron.job_run_details` أقدم من 7 أيام، وإشعارات منتهية (مرسلة، أو فاشلة نهائياً بـ 5 محاولات) أقدم من 30 يوماً (N3).
42. **الكتابة على `push_tokens` (مراجعة 2026-11-14، S3):** عبر `register_push_token` فقط (يتحقق من صيغة Expo والمزوّد)؛ التطبيق يقرأ ويحذف رموزه (تسجيل الخروج) فقط. migration `20261115000004_hardening.sql`.
43. **وحدات البيع قائمة ثابتة (S7):** `نص كيلو`، `باقة`، `حبة`، `علبة`، `قنينة`، `سلة` (وحدات `seed.sql`)، بقيد `products_unit_allowed` و`SALE_UNITS` بـ `packages/shared` (اختبار يتأكد من تطابقهما). إضافة وحدة = migration جديد + تحديث `SALE_UNITS`. `order_items.unit_snapshot` بلا قيد (نسخة تاريخية).
44. **اعتماديات Edge Functions مثبّتة (S4):** `npm:@supabase/supabase-js@2.119.0` (نفس نسخة `packages/shared`) و`supabase/functions/deno.lock` (`frozen`؛ تغيير الاعتماديات = تحديث الملف عمداً). النسخ المنشورة على `mukhdar-dev` تُحدَّث بالنشر القادم (لم يُعَد النشر بهذا التغيير).
45. **أخطاء Edge Functions بالتطبيقات (S6):** `parseFunctionError(error)` (غير متزامن) بـ `packages/shared` يقرأ `{"error": CODE}` من رد `functions.invoke`؛ يُستخدم بدل `parseBackendError` لنتائج الدوال (مثل `delete-account`).
46. **حذف الحساب والقبول (N1):** `accept_order` يقفل ملف السائق (`for share`) فيتسلسل مع `begin_account_deletion`: إن بدأ الحذف أولاً يُرفض القبول (`NOT_ALLOWED`)، وإن سبق القبول يُرفض الحذف (`ACTIVE_ORDER`). migration `20261115000005_deletion_safety.sql`.
47. **انقطاع أثناء الحذف (N2):** `is_active` الأصلي يُحفظ بـ `private.account_deletions` عند أول محاولة؛ إعادة المحاولة ترجعه والإلغاء يستعيده ثم يحذف السجل، والحذف الناجح يحذفه مع الملف. **افتراض:** إن عطّل الأدمن الحساب بين انقطاع وإعادة محاولة فاشلة، يُستعاد الحساب نشطاً (نادر جداً؛ يُعطَّل يدوياً من جديد).
48. **عرض العنوان (N6):** `formatAddress` ("قطاع A · وحدة A3 · عمارة 12 · شقة 5") و`formatAddressShort` ("وحدة A3 - عمارة 12"، نفس نص الإشعارات) بـ `packages/shared` لكل التطبيقات.
49. **الدخول بالهاتف + PIN (قرار المالك 2026-11-14، ADR 0001):** Phone provider بكلمة سر، تأكيد الهاتف معطّل، Send SMS Hook يرفض كل إرسال، لا Test OTPs. migration `20261116000001_phone_pin_auth.sql`. اختبار `13_phone_pin_auth.sql`.
50. **ملكية الرقم غير مُتحقق منها** (بلا رسائل): أي شخص يستطيع تسجيل رقم غير مسجل بعد. التخفيف: صاحب الرقم يراسل المتجر على واتساب من رقمه ← الأدمن يعيد ضبط الـ PIN أو يعطّل الحساب. التحقق عبر واتساب لاحقاً واختياري (T04).
51. **لا قفل لكل حساب بعد محاولات فاشلة** (غير ممكن بأمان على Free/Pro). الحماية الحالية: حد Supabase لكل IP + رفض الرموز السهلة. لا نخفّض حد الـ IP كثيراً بسبب CGNAT بشبكات العراق. الخطة: CAPTCHA (T23)، أو Password Verification Hook بخطة Teams، أو دخول عبر Edge Function (ADR 0001 خيار ج).
52. تغيير رقم الهاتف من التطبيق غير ممكن (OTP التغيير مرفوض)؛ الحساب الجديد برقم جديد، أو تغيير بالأدمن إن احتجنا لاحقاً.
53. **OTP لرقم جديد يحجز الرقم (تصحيح 2026-11-15):** GoTrue ينشئ الحساب عبر `Signup` بكلمة سر عشوائية ثم يرفض الـ hook الإرسال؛ الحساب يبقى. لا يمكن رفضه بـ trigger على `auth.users` ولا بـ before-user-created hook (الصف والحمولة مطابقان لتسجيل هاتف + PIN). خطر مساوٍ لافتراض 50 وتخفيفه نفسه (الأدمن يعيد ضبط الـ PIN). **حُل 2026-11-15 (قرار المالك):** التسجيل العام OFF + Edge Function `signup` (§7، §8؛ افتراض 54). ADR 0001 "العواقب" 2.
54. **حدود التسجيل (2026-11-15):** 20 محاولة/ساعة لكل IP و5/ساعة لكل رقم، نافذة ثابتة، ثابتة بدالة `signup_rate_hit` (تغييرها = migration). حد الـ IP مرتفع بسبب CGNAT؛ يُراجع بـ T22/T23. الدالة لا ترجع جلسة (الدخول من جهاز الزبون يُبقي حد GoTrue لكل IP على IP الزبون). تجزئة sha256 بلا ملح: تقلل ظهور الـ IP والرقم بالنص، ولا تمنع عكسها بالتجربة (مقبول: الجدول لـ postgres فقط ويُنظف بعد يوم).
55. **مخاطر منخفضة معروفة (مراجعة 2026-11-15، بلا تغيير كود):**
    - **NH7، حجم جسم `signup`:** `readBody` (`supabase/functions/signup/handler.ts`) يقرأ الجسم كاملاً (`req.text()`) ثم يفحص `MAX_BODY_BYTES`، فجسم ضخم يُقرأ للذاكرة قبل رفضه. الخطر منخفض: منصة Edge Functions تحد حجم الطلب والذاكرة ووقت التنفيذ، وحدود المعدل (افتراض 54) تقيّد التكرار. التحسين إن لزم: رفض `Content-Length` الكبير أولاً أو قراءة متدفقة بحد.
    - **NH8، إعادة ربط رمز إشعارات معروف:** `register_push_token` (`20261112000003_push_dispatch.sql`) يعمل upsert بالـ `token`، فمستخدم مسجّل يعرف رمز Expo لجهاز آخر يستطيع نقله لحسابه فتتوقف إشعارات صاحبه وتصله هو. الخطر منخفض: الرمز لا يُعرض لأي مستخدم آخر (RLS `push_tokens_own`)، ومعرفته تتطلب الوصول للجهاز نفسه، ومحتوى الإشعار حالة طلب بلا بيانات حساسة. هذا السلوك نفسه مقصود لنقل الجهاز بين حسابات (خروج ثم دخول بحساب آخر). التحسين إن لزم: لا يُنقل رمز إلا إن كان `last_seen_at` قديماً أو بإثبات من الجهاز.
56. **لوحة الأدمن (قرارات المالك 2026-11-15):** تعريف المبيعات وصافي الربح، كلفة الوحدة على كل حركة، آخر سعر مشتريات = سعر الشراء، حد نقص لكل منتج مع إشعار عند النزول، كتابة المنتجات والأسعار والإعدادات بدوال، و`admin-create-user`. التفاصيل §12 وSPEC-admin افتراض 8. **افتراض:** الحركات القديمة على dev تُقيَّم بسعر الشراء الحالي (لا تاريخ أسعار قبلها)، وتُعاد `daily_stats` بـ `recompute_daily_stats`.
57. **الكيلو باللوحة وصور الأقسام (قرارات المالك 2026-11-15):** §12.5. قاعدة البيانات تبقى بأنصاف الكيلو والسعر لكل وحدة بيع؛ التحويل باللوحة فقط عبر مساعد مشترك. صور الأقسام بالـ bucket الحالي بلا migration. **افتراض:** لا يُضاف رمز خطأ لسعر كيلو غير مضاعف 500 (يُرفض بالنموذج قبل الإرسال، وأي سعر وحدة غير مضاعف 250 يرفضه القيد).
58. **جلسة C لمراجعة الإصلاحات (2026-11-16، migration `20261125000001`، `docs/reviews/review-fixes-AB.md`):** H1 الإشعارات لا تصل لحساب `must_change_pin` وتُحذف الرموز بإعادة الضبط والتعطيل والتخفيض؛ M1 قفل `accept_order`/`assign_driver` بالدور والعلامة؛ L3 نفس السائق = لا شيء؛ L5 ربط `kind` بـ `reset_by`؛ L8(ب) تدقيق العناوين (`20261125000002`). **L4، افتراضان معلنان للإلغاء بلا إرجاع:** (ب) بند بلا سجل `order_item_costs` يُقيَّم بصفر (لا بكلفة اليوم)؛ (أ) ~~بند حُذف منتجه لا يدخل الهدر~~ ← **T20:** المنتج ذو التاريخ لا يُحذف أصلاً (`on delete restrict`، §5)؛ النص التالي تاريخي: بند حُذف منتجه (`product_id` null) لا يدخل الهدر ولا حركات المخزون (المنتج ذاته غير موجود)، مقبول لأن حذف منتج عليه طلب بالطريق نادر. L1 (جلسة JWT ≤ ساعة على صفوف المستخدم نفسه) **مخاطرة مقبولة** كما بـ RUNBOOK.
59. **التقارير (T20، 2026-11-16):** (1) أكثر المنتجات مبيعاً مرتّب **بالمبيعات** (بالدينار) لأن الكميات بوحدات مختلفة (كيلو، باقة، حبة) لا تُقارن؛ الكمية تُعرض بالكيلو أو بالوحدة. (2) الصف لكل منتج ووحدة البند وقت الطلب (تغيير وحدة منتج لاحقاً لا يخلط الوحدات)، أما تقرير الهدر فبوحدة المنتج الحالية (تغيير الوحدة بعد هدر مسجّل نادر؛ يُراجع إن حدث). (3) متوسط الطلب يُقرّب لأقرب دينار (ليس 250: رقم إحصائي لا سعر). (4) التقييم بيوم التقييم (`ratings.created_at`)، لا بيوم الطلب. (5) التسويات الموجبة لا تُطرح ولا تُضاف للربح (ربح الجرد غير محسوب، كما بـ §2).
60. **الرئيسية (T25، 2026-11-16):** (1) "حتى نفس الدقيقة": اليوم من 00:00 بغداد حتى نهاية الدقيقة الحالية، وأمس من 00:00 حتى نفس البعد (اليوم 24 ساعة دائماً، بلا توقيت صيفي). (2) المبيعات والمسلّمة والملغاة والواردة واليوم وأمس-حتى-الآن من `orders` مباشرة (فهارس جزئية)، وصافي الربح وكلفة الهدر من `daily_stats` (اليوم، وأمس كاملاً). (3) `net_profit_prev_iqd = null` إن لم يوجد صف لأمس (يُعرض "—" لا صفراً)؛ ومتوسط الطلب `null` بلا مسلّمة. (4) "كلفة هدر اليوم" = الهدر فقط (`waste_cost_iqd`)، ونقص الجرد يدخل صافي الربح لا هذه البطاقة. (5) تحت حد النقص = منتج **نشط** رصيده < حده (نفس شرط إشعار النقص وفلتر المخزون)؛ القائمة مرتبة بالرصيد ثم الاسم ومحدودة بـ 8. (6) المفتوحة الآن بحالتها الحالية بصرف النظر عن يوم الإنشاء.
