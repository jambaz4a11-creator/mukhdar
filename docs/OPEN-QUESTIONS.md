# Open questions for the owner

Decisions that were not mine to make during the 2026-11-18 session. All were answered by the owner on
2026-11-18 and are applied; nothing is open except the billing step in item 3.

## 1. Address wording everywhere — ✅ resolved (2026-11-18)
**Decision:** use "بلوك / بناية / الطابق / شقة" everywhere (order screens, admin, receipts, driver data and
notifications, reports, CSV). Example: `بلوك A3 · بناية 12 · الطابق 3 · شقة 10`. The word "قطاع" is no longer
printed (the sector is part of the block name `A3`).
**Done:** one function (`formatAddress` / `formatAddressShort` in `packages/shared`) drives every screen;
admin address-management labels, public privacy/delete pages and the account-deletion text use the new
words; migration `20261205000001_address_wording_block.sql` (dev only, RUNBOOK §17 item 35) changes the push
text to `بلوك A3 - بناية 12`. Stored values are unchanged. The driver developer must be told: see
"Changes for the driver app (address wording)" in `docs/DRIVER-API.md`.

## 2. Floor range — ✅ resolved (2026-11-18)
**Decision:** 0..20, with 0 = "الطابق الأرضي" (approved as assumed). Floors display as "الطابق 3".
**Superseded 2026-11-19 (owner, exact Bismayah data):** floors are **G (stored 0) and 1..9**, apartments **1..12**, and the ground floor is displayed **"الطابق G"** everywhere (never "الأرضي"). See SPEC-backend §12.10.

## 3. Admin panel hosting: Cloudflare Workers plan — ✅ code follow-up done; billing is the owner's
The deployed admin panel (`mukhdar-admin.jambaz4a11.workers.dev`) intermittently answered
**`503 error code: 1102` "Worker exceeded resource limits"** on the Workers Free plan
(`docs/reviews/preview-check.md`).
- **Owner:** will upgrade to Workers Paid (a billing change on their Cloudflare account, not done by me).
- **Done (code):** a failed session check caused by a server/network error (Supabase 5xx, unparseable reply
  such as Cloudflare 1102, network failure) no longer sends staff to the login page. The proxy and the
  layouts now show "صار خلل، حاول مرة ثانية" with a retry button (HTTP 503, `/unavailable`). Access stays
  denied. A real missing/invalid/expired/idle session (4xx, no session) still goes to the login page.
  Tests: `apps/admin/src/lib/panelUser.test.ts`, `access.test.ts`.
