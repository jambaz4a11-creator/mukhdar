# Preview full check (2026-11-18, Part 4)

Full order cycle on the **deployed preview**, against mukhdar-dev, in WebKit (iPhone 13 profile = Safari)
and Chromium (Pixel 7 profile). Main at `ec3021b` (PRs #2, #3, #4 merged; Cloudflare Pages and the admin
Worker both reported a successful build for that commit).

- Customer PWA: https://mukhdar-app.pages.dev
- Admin panel: https://mukhdar-admin.jambaz4a11.workers.dev
- Spec: `apps/customer/e2e/full-cycle.spec.ts` (opt-in `E2E_FULL_CYCLE=1`, see RUNBOOK §13)

## What the run does
| # | Step | Who / how | Checked |
|---|---|---|---|
| 1 | Sign up (phone + PIN) → name | customer, PWA | lands on the address form |
| 2 | Address: البلوك A1 → البناية 1 → الطابق 3 → شقة 12 | customer, PWA | saved; "delivery to" on home |
| 3 | Browse → add first product → cart → checkout | customer, PWA | order screen shows "… طابق 3 · شقة 12"; `address_snapshot.floor = 3` |
| 4 | Admin sees the new order | admin, deployed panel (PIN + TOTP) | "today's orders" card +1 live; order details show the name and "طابق 3" |
| 5 | Preparing → ready | staff, deployed panel (PIN + TOTP) | status badges; customer screen shows "جاهز" live |
| 6 | Accept → out for delivery → delivered | driver `07000000012`, the DRIVER-API calls (`available_orders`, `accept_order`, `set_order_status`) with the driver's own session | order listed before accepting **without** the floor; floor visible after accepting |
| 7 | Rate 5 stars + comment | customer, PWA | "rated" shown on the order |
| 8 | Numbers | admin home and /reports (today) | delivered +1, sales + order subtotal (no delivery fee), report "today" = home |
| 9 | Delete account | customer, PWA | account gone; order stays `delivered`, name/phone null, snapshot = sector + unit only |

## Results
| Browser | Result | Time |
|---|---|---|
| Chromium (Android) | ✅ passed (twice) | 55 s – 1.3 min |
| WebKit (iPhone / Safari) | ✅ passed (twice); 2 other runs failed on the admin panel (below) | ~4.3 min |

Also on the deployed preview, both browsers: `customer-flow.spec.ts` ✅ (sign up → name → address with
floor → order → cancel → delete) and `catalog-cards.spec.ts` ✅ (new product card at 360px on home,
category and search).

## Findings
1. **Admin Worker hits Cloudflare's resource limit (Error 1102). Needs an owner decision
   (`docs/OPEN-QUESTIONS.md` §3).** About 13 of 30 plain `/login` requests returned
   `503 error code: 1102`, and `/orders` did too during the run (Ray `a5c7d76828613dbb`, 14:59:52 UTC).
   At the same times Supabase auth logs show `GET /user … context canceled` from Cloudflare addresses.
   The Worker is cut off mid-request, `getPanelUser` sees an error, and the panel sends the user to
   `/login`. That caused both failed WebKit runs (an error page, then a bounce to the login page while on
   `/orders`). The customer PWA is static on Pages and was never affected. No code fix in this session:
   the real fix is the hosting plan. A follow-up to show "try again" instead of the login page is
   proposed there.
2. **Test harness only:** with Playwright's WebKit build on Windows, a panel page in a background window
   loads very slowly while the customer page has focus. The spec brings each page to the front before using
   it. Chromium is not affected, and this has nothing to do with real Safari. Playwright's WebKit build here
   also has no `AudioContext`, so the new-order sound cannot be checked in it.
3. No functional bug found in the customer app, the order flow, the staff/admin actions, the driver
   contract, rating, the numbers or account deletion.

## Test data left on mukhdar-dev
- **Accounts:** none. Every run deletes its account in the app; `global-teardown` found no leftovers
  (`9647008…` = 0 users, 0 profiles).
- **Orders:** the runs leave anonymized orders, as account deletion is designed to do (they are kept for
  accounting). Full cycle: **#730431** and **#730432**, `delivered`, no name, phone or address beyond
  "قطاع A / A1". Earlier runs: one delivered order from the first failed WebKit run, and cancelled ones
  from `customer-flow` (stock returned). Two runs that stopped at the panel left **#730429** and
  **#730430** `pending`; they were cancelled by the demo staff account through `set_order_status`
  (reason "تنظيف: طلب اختبار e2e", stock returned) so they don't show as new orders. Each delivered order took 1 sale unit of one product from dev stock,
  and its sales count in today's dev report. Deleting orders was outside the approved scope (accounts
  only), so they stay.
- No products, categories, sectors/units/buildings or settings were changed.
