# 35: مرسِل Web Push في `push-dispatch` (W2) ⬜

**الهدف:** SPEC-webpush §5.4. مرسِل `webpush` (تشفير `aes128gcm` RFC 8291 + VAPID RFC 8292) داخل `push-dispatch`، بلا لمس مسار Expo.
**يعتمد على:** - (مستقلة عن W1؛ تسبق W3 لتحديد شكل المستلم).
**النموذج المقترح:** **Opus** (تشفير وحماية SSRF).
**على dev:** **لا** نشر ولا أسرار بهذه المهمة (كود واختبارات محلية فقط). النشر والأسرار بمهمة 38 (W5) بموافقتك.
**الحجم:** M.

## الخطوات
1. **استكشاف قصير (لا يتجاوز نصف الجلسة):** هل تعمل `npm:web-push` أو `jsr:@negrel/webpush` على Supabase Edge Runtime (Deno)؟ يُجرَّب محلياً بـ `deno test`؛ القرار مكتوب بـ SPEC-webpush §5.4. فشل ← تنفيذ WebCrypto داخلي (ECDH P-256، HKDF، AES-128-GCM، JWT ES256).
2. `supabase/functions/push-dispatch/webpush.ts`: `createWebPushSender({publicKey, privateKey, subject})` بواجهة `Sender` الحالية. الحمولة JSON `{title, body, data}` < 1KB فقط. ترويسات: `TTL` 3600، `Urgency` (`high` لـ "جاهز" وللسائق، وإلا `normal`)، `Topic` = `order-<id>`.
3. تصنيف النتائج: `201` وصل؛ `404/410` ← رمز ميت (يُحذف)؛ `429/5xx/شبكة/مهلة 8 ثوانٍ` ← مؤقت (احترام `Retry-After`)؛ `400/401/403` ← فشل دائم بسبب إعداد (لا يُحذف الرمز، يظهر بـ `last_error` والمؤشر الحالي)؛ تزامن 10.
4. **حماية SSRF بالمرسِل:** `https` فقط، بلا منفذ، المضيف من القائمة البيضاء (`fcm.googleapis.com`، `updates.push.services.mozilla.com`، `*.push.apple.com`، `*.notify.windows.com`) وإلا فشل دائم بلا اتصال.
5. **لا تسجيل للـ endpoint بالسجلات** (المضيف + مقطع هاش فقط). `dispatch.ts`: مزوّد `webpush` يمر بنفس منطق النتائج؛ غياب المرسِل (لم تُضبط الأسرار) ← يُتخطى بملاحظة واضحة كما يُتخطى `fcm` اليوم (لا يكسر Expo).
6. `index.ts`: يقرأ `VAPID_PUBLIC_KEY` و`VAPID_PRIVATE_KEY` و`VAPID_SUBJECT` من البيئة؛ غائبة ← لا مرسِل `webpush` (لا استثناء).

## القبول
- متجهات RFC 8291 الرسمية تعطي نفس الحمولة المشفَّرة (أو فك صحيح بمفتاح المستلم).
- endpoint خارج القائمة البيضاء لا يُطلب أبداً.
- كل تصنيف نتيجة مغطى، والرمز لا يُحذف عند `400/401/403`.
- مسار Expo واختبارات T07 كما هي (لا تغيير بالنتائج).
- لا endpoint ولا مفتاح خاص بأي سجل.

## الاختبارات
- Deno (`push_dispatch_test.ts` + ملف جديد): متجهات RFC، التصنيف، SSRF، المهلة، `Retry-After`، عدم تسجيل الـ endpoint، غياب الأسرار، تزامن الدفعات.
- `deno lint` و`deno check` كما بـ CI. اختبارات T07 الحالية تمر بلا تعديل.
