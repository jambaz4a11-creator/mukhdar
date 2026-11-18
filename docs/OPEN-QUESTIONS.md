# Open questions for the owner

Decisions that were not mine to make during the 2026-11-18 session. Each item says what was done in the
meantime, so nothing is blocked. Answer in one line and it will be applied.

## 1. Address wording everywhere: "بلوك/بناية" or "وحدة/عمارة"? (Part 2, 2026-11-18)
The customer form now uses the words you asked for: **البلوك ← البناية ← الطابق ← رقم الشقة**.
Everywhere else the address is still written with the old words: the customer's order screen, the form's
preview line, the admin order details and receipt, and the push text to drivers
("قطاع A · وحدة A3 · عمارة 12 · طابق 3 · شقة 5", push "وحدة A3 - عمارة 12").
- **Option A (kept for now):** leave the display as is. No change for the admin, staff or the driver app.
- **Option B:** show "بلوك A3 · بناية 12 · طابق 3 · شقة 5" everywhere (one shared function, the admin
  address pages and a migration for the push text; the driver developer must be told).
Which one?

## 2. Floor range (Part 2, 2026-11-18)
Assumed **0..20**, with 0 = ground floor ("الطابق الأرضي"). Bismayah buildings have 10 floors; 20 leaves a
margin. If you want a different maximum, or the ground floor written differently (e.g. "أرضي"), say so.

## 3. Admin panel hosting: Cloudflare Workers plan (Part 4, 2026-11-18) — **needs a decision**
The deployed admin panel (`mukhdar-admin.jambaz4a11.workers.dev`) intermittently answers
**`503 error code: 1102` "Worker exceeded resource limits"**: about 13 of 30 plain `/login` requests in one
sample, and also `/orders`. Rendering Next.js pages on the Worker needs more CPU per request than the
Workers Free plan allows. Supabase auth logs show `GET /user … context canceled` from Cloudflare at the
same times. The panel then treats the failed session check as "signed out" and sends the user to the
login page. The customer PWA (Cloudflare Pages, static) is not affected.
- **Option A (recommended):** Workers Paid plan (about 5 USD/month; CPU per request far above the
  free limit). No code change. This is a billing change on your Cloudflare account, so it was not done.
- **Option B:** keep Free and reduce server work per page (cache, fewer server-rendered pages). Needs a
  measurement first; it may not get under the free limit.
- **Follow-up either way (proposed, not done):** when the session check fails because Supabase or the
  network is unreachable, show "تعذّر التحقق، أعد المحاولة" instead of the login page. Access stays
  denied either way. It touches the proxy and four layouts, so I left it for a reviewed PR.
Details: `docs/reviews/preview-check.md`.
