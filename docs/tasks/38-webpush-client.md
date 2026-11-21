# 38: Web Push بالعميل: السائق والزبون (W5) ⬜

**الهدف:** SPEC-webpush §5.2 و§5.5–§5.7. اشتراك Web Push وتسجيله والخروج منه وعرضه وفتحه عند النقر، لـ PWA السائق ثم الزبون، بنفس قواعد الخصوصية.
**يعتمد على:** 35، 36، 37.
**النموذج المقترح:** Sonnet.
**على dev (كلها بموافقتك):**
- **أسرار Edge** `VAPID_PRIVATE_KEY` و`VAPID_PUBLIC_KEY` و`VAPID_SUBJECT` (توليد زوج dev خارج الـ repo؛ `VAPID_SUBJECT = mailto:` لبريد المالك كسر فقط، **لا يُكتب بأي ملف أو وثيقة**) عبر `pnpm sb secrets set`.
- **نشر `push-dispatch`** (المرسِل من T35).
- **Cloudflare:** `EXPO_PUBLIC_VAPID_PUBLIC_KEY` بمشروع `mukhdar-driver` وبمشروع الزبون `mukhdar-app` + إعادة بناء.
- **`ALLOWED_ORIGINS`** يضم أصل الزبون أيضاً إن لم يكن (يُراجَع).
- لا migration (من T36).
**الحجم:** L.

## الخطوات
1. `public/sw.js` للتطبيقين (أصلان مستقلان): `push` يعرض **دائماً** `showNotification` (`lang: ar`، `dir: rtl`، `tag = type:order_id`)؛ `notificationclick` يتحقق (UUID + type معروف) ثم يركّز نافذة ويرسل `postMessage` أو `openWindow('/order/<id>')`؛ `pushsubscriptionchange` بلا RPC (إعادة التسجيل عند التشغيل). بلا `fetch` handler وبلا كاش (A2). نسخة منطق التحقق تُختبر ضد `routeForNotification`.
2. `lib/push.web.ts` (السائق) و`push.web.ts` (الزبون) بنفس الواجهة: `subscribe({userVisibleOnly: true, applicationServerKey})` **من لمسة مستخدم فقط**، `register_web_push`، قراءة الـ endpoint من `pushManager.getSubscription()`، تسجيل صامت عند كل تشغيل/رجوع (`visibilitychange`).
3. آلة الحالات `webPushState` (`unsupported | needs-install | default | denied | granted-unregistered | registered`) وبطاقات التمهيد بالعربي: **السائق** بعد أول دخول ناجح؛ **الزبون** بعد نجاح أول طلب؛ iOS خارج الـ PWA ← دليل التثبيت؛ `denied` ← شريط "الإشعارات مطفية" مع طريقة التفعيل؛ «مو هسه» تخفي 7 أيام.
4. **الخروج** عبر `signOut` الموحَّدة بالسائق (R2 M2): حذف صف الاشتراك ثم `unsubscribe()` ثم القنوات ثم خروج `local`؛ بلا شبكة: `unsubscribe()` محلياً + حذف مؤجَّل يُعاد بأول جلسة (مخزَّن مشفَّراً بوحدة T34). نفس السلوك لخروج الزبون.
5. جسر النقر بالسائق (`NotificationsBridge` للويب) يمرر `postMessage` لـ `routeForNotification`؛ الزبون يفتح مسار تتبع الطلب الحالي.
6. اختبار خصوصية: حمولة الصندوق لا تحوي نمط هاتف ولا طابق/شقة (يُضاف لاختبار الصندوق الحالي).
7. RUNBOOK (توليد VAPID، الأسرار، ما لا يُغيَّر)، SPEC-driver وSPEC-customer وDRIVER-API §6.
8. فحص دخاني بعد النشر على dev: طلب ← "جاهز" من اللوحة ← إشعار على متصفح سطح مكتب/Android Chrome (iOS بـ T39).

## القبول
- إشعار "جاهز" يصل لسائق PWA (Android Chrome، ثم iOS بـ T39) والتطبيق مغلق، والنقر يفتح الطلب (بلا جلسة ← الدخول).
- إشعار حالة الطلب يصل لزبون PWA بعد المنح بعد أول طلب.
- لا طلب إذن عند التحميل ولا عند الدخول؛ iOS خارج التثبيت لا يعرض زر الإذن بل الدليل.
- الخروج بأي مسار (حسابي، ماكو اتصال، غير سائق، الرمز الإجباري) يحذف الاشتراك أو يبطله ويؤجل حذفه؛ جهاز خرج منه لا يستقبل شيئاً.
- مفتاح VAPID الخاص غير موجود بأي bundle أو سجل؛ الـ endpoint لا يُسجَّل.
- مسار Expo/APK لم يتأثر.

## الاختبارات
- Jest: آلة الحالات لكل مدخل، ترتيب الخروج (بشبكة/بلا شبكة)، الحذف المؤجَّل، تطابق منطق الـ SW مع `routeForNotification`، تعدد الحسابات.
- Deno/pgTAP لا تتغير (من 35/36)؛ اختبار خصوصية الحمولة.
- Playwright (Chromium) بمحاكاة `Notification` و`PushManager` للبطاقات وإخفاء 7 أيام؛ الإشعار الحقيقي يدوي.
