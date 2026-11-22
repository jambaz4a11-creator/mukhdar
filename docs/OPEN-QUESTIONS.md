# Open questions for the owner

Decisions that were not mine to make. Items 1–4 were answered by the owner and are applied; open: the billing step
in item 3, and item 5 (not blocking).

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

## 4. Web Push sender: in-house WebCrypto instead of `npm:web-push` (T35, 2026-11-21) — ✅ decided (2026-11-21)
**Decision (owner, 2026-11-21):** keep the in-house RFC 8291 implementation; do **not** switch to `npm:web-push`.
SPEC-webpush §5.4 records it.
**What I found:** `npm:web-push@3.6.7` **does run on local Deno 2.9.6**. The Supabase Edge Runtime itself could not be
tried (no Docker on this machine, and no deploys in T35), and the library depends on Deno's Node compatibility
layer (`crypto.createECDH`, `https`, proxy agents), which is exactly where the Edge Runtime can differ.
**What I did (reversible):** wrote the sender on WebCrypto only (`push-dispatch/webpush_crypto.ts`, ~200 lines). It
reproduces the official RFC 8291 test vector **byte for byte**, adds no dependency to the frozen `deno.lock`, and
keeps full control of the request (8 s timeout, no redirects, no URL in error messages). SPEC-webpush §5.4.
**Your call:** keep it (my recommendation), or switch to the library. Either way, the first deploy (T38) sends a test
notification to a desktop browser before any phone is involved.

## 5. Will the customer web app (PWA) go to production? (R3 L8, 2026-11-22) — open, not blocking
**Why it matters:** the customer PWA calls two browser-facing Edge Functions (`signup`, `delete-account`). In
production they only answer origins listed in `ALLOWED_ORIGINS`. The RUNBOOK used to say "admin only" (§17) and
"admin + driver PWA" (§16f), which disagree, and neither includes the customer web origin.
**What I did:** one rule in RUNBOOK §16f, which §17 now follows: production = admin + driver PWA, **+ the customer PWA
origin if the customer web app is launched in production**. No cloud change (production doesn't exist yet). Dev is
unchanged (5 origins).
**Your call (before T24):** launch the customer PWA in production (add its origin and a production Pages project), or
keep the customer on the native apps only (leave it out).
