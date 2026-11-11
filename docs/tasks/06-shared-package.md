# 06: الحزمة المشتركة `packages/shared` ✅

**الهدف:** قواعد مكتوبة مرة واحدة وتُستخدم بالتطبيقات الثلاثة.

## المحتوى
- `database.types.ts` (مولّد) وأنواع مختصرة: `Product`، `Order`، `OrderStatus`...
- `money.ts`: `formatIQD(n)` ← `"12,500 د.ع"`، `roundIQD(n)` (مطابق لـ `round_iqd` بقاعدة البيانات)، `isValidPrice(n)` (موجب ومضاعف 250).
- `phone.ts`: `normalizeIraqiPhone("07701234567") → "+9647701234567"`، يرفض غير الصالح.
- `status.ts`: ترتيب الحالات، أسماؤها العربية، ألوانها، `canCustomerCancel(status)`.
- `errors.ts`: خريطة رموز الخلفية (`INSUFFICIENT_STOCK`...) إلى رسائل عربية، مع رسالة افتراضية.
- `supabase.ts`: إنشاء client (يستقبل التخزين كمعامل: AsyncStorage للموبايل، cookies للويب).

## القبول
- لا اعتماد على React Native أو Next داخل الحزمة.

## الاختبارات (Jest)
- `roundIQD`: 0، 124، 125، 249، 250، 1125، أعداد كبيرة.
- `normalizeIraqiPhone`: صيغ صحيحة (07، 7، +964، 00964، مسافات) وخاطئة (أقصر، أطول، ليس 7).
- `formatIQD`: الفواصل والعملة.
- كل رمز خطأ بـ SPEC-backend له رسالة بـ `errors.ts` (اختبار يقرأ القائمة).

## ما نُفّذ (2026-11-12)
- `packages/shared/src/`: `types.ts` (أنواع مختصرة فوق `database.types.ts`: `Product`، `Order`، `OrderStatus`، `AddressSnapshot`، `CartLine`، `PlaceOrderResult`...)، `money.ts` (`formatIQD`، `roundIQD`، `isValidPrice`)، `phone.ts` (`normalizeIraqiPhone` يقبل الأرقام العربية أيضاً، `toStoredPhone`)، `status.ts` (الترتيب، الأسماء، الألوان، `STATUS_TRANSITIONS`، `canCustomerCancel`، `isFinalStatus`، `statusStep`)، `errors.ts` (29 رمزاً + رسالة افتراضية ورسالة انقطاع الشبكة، `parseBackendError` يرجع الرمز والرسالة و`detail`)، `supabase.ts` (`createSupabaseClient` يستقبل التخزين، ويرفض مفتاح `service_role`/`sb_secret_`).
- الاعتماد الوحيد: `@supabase/supabase-js`. لا React Native ولا Next (اختبار `purity.test.ts`).
- الاختبارات (Jest، 112): الحالات المطلوبة للتقريب والهاتف والتنسيق، ومقارنة `roundIQD` بصيغة SQL لـ 0..5000. `errors.test.ts` يقرأ رموز SPEC-backend §5 ورموز `raise exception` بالـ migrations: يفشل إن اختلفا، أو نقص رمز من `errors.ts`، أو زاد رمز غير موثق (جُرّب بحذف `ADDRESS_INACTIVE`: فشل اختباران).
- SPEC-backend §5: أُضيفت أربعة رموز كانت ترفعها قاعدة البيانات بدون توثيق: `DRIVER_NOT_FOUND`، `INVALID_MOVEMENT`، `PRODUCT_NOT_FOUND`، `USER_NOT_FOUND`.
