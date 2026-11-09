# 06: الحزمة المشتركة `packages/shared`

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
