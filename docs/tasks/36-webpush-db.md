# 36: قاعدة البيانات لـ Web Push (W3) ⬜

**الهدف:** SPEC-webpush §5.3. إضافة مزوّد `webpush` لـ `push_tokens` مع دالة تسجيل وقيود، بلا كسر `register_push_token` (الـ APK يعتمد عليه).
**يعتمد على:** 35 (شكل المستلم بالمرسِل).
**النموذج المقترح:** **Opus** (RLS وSSRF والـ migrations).
**على dev:** **migrations (اثنتان)** بـ `pnpm sb db push` بعد `--dry-run` (لا MCP، CLAUDE.md) **بموافقتك**. لا Edge Function ولا أسرار ولا Cloudflare.
**الحجم:** M.

## الخطوات
1. **migration A** (ملف مستقل: قيد PostgreSQL على `ALTER TYPE … ADD VALUE` داخل معاملة): `push_provider += 'webpush'`، `push_platform += 'web'`.
2. **migration B**: `push_tokens.keys jsonb` (`{p256dh, auth}` base64url)؛ CHECK: إلزامي لـ `webpush` ومحظور لغيره؛ CHECK للـ endpoint: `https`، بلا منفذ، المضيف من القائمة البيضاء (نفس قائمة T35)، طول ≤ 1024؛ `register_web_push(p_endpoint, p_p256dh, p_auth)` (`authenticated`، `security definer`، `set search_path`): نفس قواعد `register_push_token` (`must_change_pin` ← `PIN_CHANGE_REQUIRED`، أدمن/موظف يتطلب دوراً فعّالاً aal2، نقل الرمز للحساب الحالي، سقف 5 رموز، `INVALID_TOKEN`)؛ `grant` للدور الصحيح و`revoke` من `public, anon`.
3. تحديث `claim_push_notifications` (`create or replace`، **نوع المخرجات نفسه**): `recipients jsonb` يضيف `keys` لمستلمي `webpush`؛ يبقى استثناء `must_change_pin` وكل ما فيه.
4. `packages/shared/src/database.types.ts` (إعادة توليد) وSPEC-backend (الدالة، المزوّد، قيود الـ endpoint) وDRIVER-API §6 وRUNBOOK §17 (ترتيب الـ migrations، 39 ← 41).
5. التحقق: `pnpm sb migration list --remote` محلي = بعيد.

## القبول
- `register_web_push` يعمل لزبون وسائق بدورهم الحقيقي، ويرفض: حساب `must_change_pin`، `anon`، endpoint خارج القائمة أو `http` أو بمنفذ أو > 1024، مفاتيح ناقصة، السادس بعد 5.
- نقل الرمز بين حسابين (جهاز مشترك) يعمل.
- `claim_push_notifications` يرجع المفاتيح لـ `webpush` ويستثني `must_change_pin` كما كان؛ مستلمو Expo بلا تغيير.
- `register_push_token` يرفض endpoint ويقبل Expo كما كان.
- `push_tokens` RLS: المالك يقرأ ويحذف صفه فقط.

## الاختبارات
- pgTAP **بالدور الحقيقي** (`tests.as_user`، CLAUDE.md): ملف جديد لـ `register_web_push` + توسيع `32_real_role_writes.sql` و`11_push_dispatch.sql`؛ حدود السقف، القيود، النقل، `claim`.
- CI: db-tests أخضر، `db:concurrency` بلا تغيير، `typecheck` للحزم بعد توليد الأنواع.
