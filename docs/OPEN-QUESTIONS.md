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
