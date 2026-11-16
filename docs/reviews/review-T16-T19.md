# Review: T16–T19 (admin shell, orders, products/stock/waste, settings/staff/addresses)

- **Date:** 2026-11-16. **Scope:** commits up to `ff07e7e`.
- **Method:** read-only. I compared the live definitions on mukhdar-dev (`pg_proc`, `pg_policies`, grants, read in a read-only transaction) against the migrations, read the Edge Function handlers, the admin feature code, the tests, `SPEC-admin`, `SPEC-backend`, `DRIVER-API.md`, ADR 0001 and the RUNBOOK. I also took screenshots of `/settings`, `/staff` and `/addresses` against dev.
- **This review changed no application code, migration, Edge Function or cloud setting.**

## Summary

No **Critical** findings. The database is the real gate everywhere I looked:

- Every `SECURITY DEFINER` RPC checks the caller's role.
- The role helpers (`private.current_user_role`) only return a role when `is_active` is true. So a deactivated or demoted user loses staff/admin/driver access to RPCs and RLS on their very next request, even while their JWT is still valid.
- `anon` can execute no definer function.
- `authenticated` cannot `CREATE` in `public`.
- Cost, profit, waste and stock-ledger data are admin-only.

The main gaps are in the **account lifecycle**:

- temporary PINs are never forced to change, and the panel has no change-PIN screen at all;
- deactivating a driver who holds an order leaves that order stranded;
- refresh tokens survive deactivation;
- the admin break-glass procedure leaks the PIN into SQL history.

There are also several **doc/spec mismatches**, most importantly whether staff may see sale amounts.

Verified facts this review relies on:

| Check | Result |
|---|---|
| Definer functions executable by `anon` | none |
| Definer functions with no role check, executable by `authenticated` | none (all call `is_admin` / `is_staff_or_admin` / `current_user_role`) |
| `search_path` set on every definer function | yes. T16–T19 era functions: `public, pg_temp`; T19 service-role helpers: `''` |
| `authenticated` CREATE on schema `public` | false (so `public, pg_temp` cannot be hijacked) |
| Direct writes where an RPC exists | `products`, `stock`, `product_costs`, `inventory_movements`, `app_settings`, `orders`, `profiles.role/is_active`: SELECT only for `authenticated` |
| Staff read on `product_costs`, `order_item_costs`, `inventory_movements`, `daily_stats`, `pin_resets`, `user_creations` | blocked by admin-only RLS |
| Push to a deactivated user/driver | none: `claim_push_notifications` filters on `p.is_active` |

---

## Critical

None.

## High

### H1. Temporary PINs are never forced to change, and the panel has no "change PIN" at all
- **Where:** `admin-create-user`, `admin-reset-pin`, `apps/admin` (no `updateUser` anywhere), `SPEC-admin.md` §2.6 line "الموظف يغيّر رمزه بعد أول دخول (تطبيق أو لوحة…)".
- **What:** A PIN chosen by the admin is sent over WhatsApp. It stays valid indefinitely, and nothing records that it is temporary.
  - Staff and admins cannot change their PIN from the panel, although the SPEC says they can.
  - The customer app has `account/pin.tsx`. Staff could use it only by signing in to the customer app.
  - Drivers depend on the external app.
- **Why it matters:**
  - The PIN sits in the admin's WhatsApp chat history, on the admin's phone and on any linked WhatsApp Web session.
  - Anyone who sees that chat can sign in as that staff member. Staff accounts can read customer phones and addresses (ADR 0001, consequence 2).
  - The SPEC promises a feature that does not exist.
- **Fix:**
  1. Migration: add `profiles.must_change_pin boolean not null default false`.
     - Set it to true inside `finish_user_creation` and inside `record_pin_reset`, or in a new helper, so both functions set it atomically with the audit row.
     - Add a `public.pin_changed()` RPC: authenticated, sets the flag back to false for `auth.uid()`. The apps call it after `auth.updateUser({ password })` succeeds.
  2. Admin panel: add an `/account/pin` page using the same flow as the customer app: re-sign-in with the current PIN, `validatePin`, `updateUser`, then revoke the other sessions as ADR 0001 requires.
     - `proxy.ts` sends any user with `must_change_pin = true` to that page before any other page.
  3. Customer app: show the same gate after sign-in.
  4. `DRIVER-API.md`: document the flag and the expected screen, by agreement with the driver-app developer.
  5. Optional hardening, as a later decision: make admin/staff RPCs refuse while `must_change_pin` is true. Without that, the flag is UI-only. That is acceptable as a first step, because a PIN thief can also clear it.
- **Needs:** migration + redeploy of both Edge Functions (only if the flag is set from the function rather than inside `finish_user_creation`/`record_pin_reset`; setting it inside those SQL helpers needs no redeploy).

### H2. Deactivating or demoting a driver who holds an order strands it
- **Where:** `public.set_user_role`, `public.assign_driver`, `public.set_order_status`.
- **What:** `set_user_role` does not look at the driver's orders. Once a driver is inactive (or no longer `driver`):
  - Their `set_order_status` fails with `NOT_AUTHENTICATED`, because `current_user_role()` returns null. They also cannot read the order (`05_driver.sql` confirms).
  - A `ready` order already assigned to them stays assigned. It is no longer in `available_orders`, because `driver_id` is not null. Staff can re-assign it, but nothing tells them to.
  - For an `out_for_delivery` order, `assign_driver` refuses re-assignment (only `preparing`/`ready`). The only exits are:
    - staff/admin "تم التوصيل (بدل السائق)", which books revenue even though nobody confirmed the cash;
    - admin cancel, which **returns the stock to inventory** although the goods left with the driver.
- **Why it matters:** Goods and cash can be with a person who has just been removed, and the books (`daily_stats`, `stock`) become wrong silently. `delete-account` already refuses this case with `ACTIVE_ORDER`; `set_user_role` does not.
- **Fix (migration):**
  - In `set_user_role`: when the target is currently a driver and the call either deactivates them or changes their role, refuse with a new code `DRIVER_HAS_ORDERS` (detail = the order count) if any order has `driver_id = p_user_id` and status in (`ready`, `out_for_delivery`). Lock those rows `for share`, like `accept_order` does with deletion.
  - Panel: show "عنده N طلب بالطريق/جاهز: انقلها أو أكملها أولاً" with a link to the filtered orders list.
  - Optionally let admins `assign_driver` from `out_for_delivery` (hand-over to another driver), with a history note.
  - Also add an admin-only "cancel without stock return" option, or a note on the cancel dialog, for goods that are physically gone. This is an owner decision; record it as an assumption.
  - Add pgTAP tests for both refusals and for the hand-over.
- **Needs:** migration (+ panel change, + SPEC-admin §2.1/§2.6 and DRIVER-API §7 update).

## Medium

### M1. Deactivation does not revoke sessions (refresh tokens keep working)
- **Where:** `public.set_user_role`.
- **What:** Database access is cut immediately, because every RLS policy and RPC goes through `is_active`. But `auth.sessions`/`auth.refresh_tokens` survive, so the user keeps refreshing JWTs forever.
  - A deactivated **customer** can still read their own orders and addresses and edit their own name (own-row policies do not check `is_active`).
  - If the account is ever re-activated, every old device is signed in again without a PIN.
- **Why it matters:** ADR 0001 lists "deactivate immediately" as the containment for a stolen staff PIN. Re-activation after a theft would silently restore the thief's session.
- **Fix (migration):** in `set_user_role`, call `public.revoke_user_sessions(p_user_id)` when `p_is_active = false`, or when the role is lowered (admin → anything, staff → driver/customer, driver → customer).
  - `revoke_user_sessions` is service-role-only for API callers, but `set_user_role` is a definer function owned by `postgres` and can call it internally.
  - Add a pgTAP check that the session rows are gone.
  - The panel `proxy.ts` already rejects inactive accounts, so no panel change is needed.
- **Needs:** migration.

### M2. Staff can see sale amounts; the SPEC says amounts are "not returned to staff at all"
- **Where:**
  - `SPEC-admin.md` §1, which says "الحماية الحقيقية في RLS والدوال (المبالغ لا تُرجَع للموظف أصلاً)";
  - RLS `orders_read`, `order_items_read`, `products_read`, `settings_read`;
  - `OrdersTable.tsx`, `OrderDetailPanel.tsx`, `print/orders/[id]`.
- **What, verified at the DB level:**
  - **Hidden from staff:** cost (`product_costs`, `order_item_costs`), profit (`daily_stats`), waste value and purchase cost (`inventory_movements`), and the stuck count.
  - **Visible to staff by RLS:** `orders.subtotal_iqd/delivery_fee_iqd/total_iqd`, item prices and line totals, `products.price_iqd` (public anyway), and `app_settings` including the delivery fee and minimum order (readable even by `anon`, by design for customers).
  - The orders screen and the 80 mm receipt **show these amounts to staff**.
  - Staff cannot open `/settings` (the proxy blocks it), cannot call `update_app_settings` (direct update is revoked; `19_admin_settings_staff.sql` covers this), and cannot call `stuck_notifications_count`.
  - `dashboard_today()` (T25) is not built yet, so "home without amounts" is not testable yet.
- **Why it matters:** Either the SPEC is wrong or the RLS is. Hiding sale amounts from staff would break the receipt that staff print.
- **Fix:** an owner decision is needed.
  - **Recommended:** amend SPEC-admin §1/§2.0 to say "staff never receive cost, profit, waste value or purchase prices; sale prices, order totals and the delivery fee are visible (receipts, customer calls)". Add a pgTAP "staff money matrix" (T8 below). Docs only.
  - **Alternative:** if totals must be hidden, add a staff view of `orders` without money columns, revoke column privileges, and drop totals from the staff receipt. This is a large migration plus UI work.

### M3. Any admin can demote or deactivate any other admin; role and settings changes leave no audit trail
- **Where:** `public.set_user_role`, `public.update_app_settings`.
- **What:** Admins cannot demote themselves, but they can demote or deactivate every other admin, including the owner. They can also promote any phone to `admin`. Nothing records who changed a role, a price setting or the store state. (`pin_resets`/`user_creations` exist only for the two Edge Functions.)
- **Why it matters:** One compromised admin PIN can lock the owner out of the panel. Recovery then needs SQL (see M4). Disputes over who closed the store or changed the fee cannot be answered.
- **Fix (migration):**
  - Add `public.admin_audit(id, actor, action, target, before jsonb, after jsonb, created_at)`, readable by admins only, and write to it from `set_user_role` and `update_app_settings`.
  - Optionally add an `is_owner` flag (or keep the owner's id in `app_settings`). `set_user_role` then refuses changes to the owner by anyone but the owner, and refuses demoting the **last** active admin.
  - Add pgTAP tests.
- **Needs:** migration.

### M4. Admin forgot PIN: the break-glass procedure leaks the PIN and leaves no audit
- **Where:** `RUNBOOK.md` §7.3; `admin-reset-pin` refuses admin targets (`ADMIN_ACCOUNT`).
- **What:** The documented path is SQL in the dashboard: `update auth.users set encrypted_password = crypt('<PIN>', …)`. It works, and deleting `auth.sessions` cascades to `refresh_tokens` (verified FK). But:
  - the new PIN is typed in plain text into the SQL Editor, which keeps query history and may log it;
  - it writes no `pin_resets` row;
  - it does not set `must_change_pin` (H1).
- **Proposed procedure (to document; do not implement in this session):**
  1. **Another active admin exists:** they deactivate nothing. The locked-out admin asks the owner. Do **not** allow admin-to-admin resets through `admin-reset-pin`, because that would let one stolen admin PIN take over every admin account.
  2. **Owner-run script** `scripts/admin-break-glass.mjs`. It runs on the owner's machine with `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`, which is never committed and never in the browser. It:
     - takes the phone as an argument and reads the PIN from a hidden stdin prompt, or generates one with `generatePin` and prints it once;
     - refuses non-admin targets and refuses any project ref that is not on an allow-list;
     - calls `auth.admin.updateUserById`, then `rpc('revoke_user_sessions')`, then inserts a `pin_resets` row with `reset_by = null` and a note `'break-glass'` (this needs a nullable column or a `kind` column);
     - sets `must_change_pin`.
  3. **No machine with the key available:** keep the RUNBOOK SQL as a last resort, but change it to generate the hash outside the editor, or to clear the editor history afterwards, and to insert the audit row.
  4. The owner tells the admin the PIN by phone call, not WhatsApp. The admin changes it at first sign-in (H1).
- **Needs:** a docs change now. The script and a nullable `reset_by` (or new `kind` column) need a small migration later.

### M5. The "stuck notifications" indicator never clears after one dead notification
- **Where:** `public.stuck_notifications_count()`, `finish_push_notifications`.
- **What:** The count is `sent_at is null and created_at < now() - 5 min`. A notification that fails for good gets `attempts = 5` and keeps `sent_at = null` forever, so the indicator stays red permanently and stops meaning "the dispatcher is down". A single invalid push token is enough. Today there are 0 such rows on dev.
- **Why it matters:** The indicator exists to show whether push delivery is working. A permanent red state hides a real outage.
- **Fix (migration):**
  - Count only `attempts < 5` as **stuck**, the same predicate the claim uses. Return dead rows as a separate number (`{stuck, failed_24h}`).
  - Or let the admin dismiss them: mark dead rows with a `dead_at` and count only the last 24 h.
  - Update the indicator text accordingly.
- **Needs:** migration (+ small UI change).

### M6. DRIVER-API.md is behind T19
- **Where:** `docs/DRIVER-API.md` §2, §3.3, §8.
- **What:**
  - (a) §2 says driver accounts are created only through `signup`. T19 adds `admin-create-user`, which creates the account directly as `driver` with a temporary PIN the admin sends by WhatsApp.
  - (b) There is no note on what a driver app sees when the driver is **deactivated**. `set_order_status` raises `NOT_AUTHENTICATED` (28000, not `NOT_ALLOWED`); `available_orders`/`accept_order` raise `NOT_ALLOWED`; the orders read returns empty.
  - (c) After an admin PIN reset, refresh fails; the app should sign out and show the PIN screen.
  - (d) H1's change-PIN expectation.
- **Fix:** docs only. Agree the change with the driver-app developer, per CLAUDE.md.

### M7. Renaming a unit or building silently rewrites existing customers' addresses; building numbers have no DB format check
- **Where:** `AddressesScreen.tsx` (direct `update` on `sectors`/`subsections`/`buildings`), table `buildings`.
- **What:**
  - Saved customer addresses point at `building_id`. Renaming building "12" to "21", or unit "A1" to "A10", changes the address of every customer who saved it. Their next order goes to the new label. Old orders keep their snapshot.
  - `add_buildings` validates `^[1-9][0-9]{0,3}$`, but a direct insert or rename by an admin can store any text, because `buildings.number` has no `CHECK`.
  - `authenticated` also holds `UPDATE` on the `id` and `subsection_id` columns and `DELETE` on these tables. The admin UI never uses them; the FK from `addresses` blocks deleting a building in use.
- **Why it matters:** A typo fix can send deliveries to the wrong building with no warning.
- **Fix:**
  - Migration: add `check (number ~ '^[1-9][0-9]{0,3}$')` on `buildings` (`not valid` first, then validate after checking dev/prod data).
  - Revoke `update (id, subsection_id)` and `update (id, sector_id)` on the address tables, plus `delete` on them (hide instead).
  - UI: when renaming a building or unit, show "عدد العناوين المحفوظة عليها: N، الاسم الجديد يظهر لهم" using a count RPC, or block renaming in-use rows and suggest hide + add instead.
- **Needs:** migration.

## Low

### L1. `update_app_settings` returns a raw error for `1000.0`
The numeric check accepts `1000.0` (it equals its `trunc`), but the final `(p ->> key)::bigint` cast raises `22P02 invalid input syntax`, not `INVALID_SETTINGS`. The panel always sends integers, so only direct API callers hit this. **Fix:** cast through `v_num::bigint`. Migration.

### L2. `search_path = public, pg_temp` versus `''`
The T01–T19 era definer functions use `public, pg_temp`. This is safe today, because `authenticated` cannot create objects in `public` and `pg_temp` is last. The T19 service-role helpers use `''`. **Fix:** when those functions are next touched, move them to `''` with fully qualified names (the Supabase linter's preference). No standalone migration is needed.

### L3. Edge Function rate limits count only successes
`admin-create-user` and `admin-reset-pin` count rows in `user_creations`/`pin_resets`. So:
- failed attempts are unlimited: for example, repeated `409 PHONE_TAKEN` lets an admin probe which phones are registered;
- concurrent requests can exceed 20 slightly (this is documented).

Both functions are admin-only, so the risk is low. **Fix**, only if wanted: count attempts in a small `admin_function_hits` table, as `signup_rate_hit` does. Migration + redeploy.

### L4. Edge Function error handling
- Errors return generic `INTERNAL` with no internals; good.
- `PIN_INVALID` carries the rule (`PIN_TRIVIAL`, …). That is intended and harmless.
- `errText(e)` from Supabase Auth or PostgREST is logged. It does not contain the password today, but the log line is not filtered. **Fix:** remove anything matching the PIN from the log string before writing it. Redeploy.

### L5. Arabic labels are inconsistent: "السواق" versus "السائقون"
In the screenshots, `/staff` and the settings card say "الموظفون والسواق"; SPEC-admin and the design say "الموظفون والسائقون". Everything else checked renders correctly RTL in all three screens:
- no reversed strings;
- numbers and phone numbers read left-to-right inside RTL lines;
- "قطاع A ← وحدة A1" and mixed Arabic/Latin unit names display in the right order.

**Fix:** use the SPEC wording (UI string change only).

### L6. `01_schema.sql` no longer pins the list of service-role-only definer functions
This was removed in `ff07e7e`, because the local stack grants `service_role` execute on internal functions by default and the cloud does not. A future function wrongly granted to `service_role` would now go unnoticed. (`19_admin_settings_staff.sql` still pins the three T19 helpers.) **Fix:** restore the check, filtered to non-internal names (exclude `tg_%`, `\_%`), or compare only under `--remote`.

### L7. The hidden-address wording on `/addresses` is incomplete
The page says "المخفي ما يظهر للزبون، والعناوين القديمة تبقى". That is true, but `place_order` **refuses** orders to an address under a hidden sector, unit or building. **Fix:** "…والعناوين المحفوظة عليها ما تقدر تطلب لحد ما ترجّعها". UI string only.

### L8. Status flow: confirmed correct (two small notes)
Verified in `set_order_status`:
- only the forward transitions plus cancel are allowed (`INVALID_TRANSITION` otherwise);
- staff fallback is limited to `out_for_delivery`/`delivered` and cancel up to `ready`;
- `out_for_delivery` requires a driver;
- drivers act only on their own order;
- customers cancel only `pending`;
- the `ready` notification fires once, because `ready` is reachable only from `preparing`, and goes to all active drivers if unassigned, or only the assigned driver if assigned.

Notes:
- (a) The staff fallback "بالطريق" is allowed even when the assigned driver is **inactive** (it checks only `driver_id is not null`). Fold this into H2.
- (b) The units math is consistent: `adminUnits` is the only place that converts; there is no `* 2`/`/ 2` in pages; per-kilo prices are a multiple of 500 ⇔ the stored half-kilo price is a multiple of 250, which the DB enforces; order lines keep `formatQuantity` as SPEC-admin §2.9 says. No float issues: `kgToUnits` requires `Number.isSafeInteger(kg*2)`, and every amount is a `bigint`/integer.

---

## Test gaps

| # | Gap | Could a broken feature still pass? |
|---|---|---|
| T1 | `04_status_transitions.sql` checks the `ready` outbox row with `row_eq`, which compares a single row. Nothing asserts there is **exactly one** `new_order` row, or none after `assign_driver`/`accept_order`. | Yes: a duplicate notification would pass. Add `is(count(*), 1)`. |
| T2 | No test that a **deactivated admin or staff** loses `set_user_role`, `update_app_settings`, `adjust_stock`, `assign_driver` (only drivers and customers are covered). | Yes, if `is_admin()` ever stopped checking `is_active`. |
| T3 | No test for `set_user_role` on a driver with `ready`/`out_for_delivery` orders (H2). | Behaviour is undefined today. |
| T4 | No test that `set_user_role(…, false)` removes sessions (M1). | Feature missing. |
| T5 | Staff reads of `order_item_costs` and `daily_stats` are not asserted (only `product_costs` and `inventory_movements` are). | Yes, if a policy were widened. |
| T6 | Edge Functions: "PIN never logged" is asserted only against fake deps; the live test checks the response body, not the function logs. | Partly. Acceptable; add a log check to `pnpm it:admin-users` via the Management API logs only if cheap. |
| T7 | e2e write tests (settings, staff, addresses, catalog, orders) run **only in CI** (`E2E_ALLOW_WRITES=1`). Local runs against dev are read-only. | No: CI runs them (45/45 in run 43782660276). Documented. |
| T8 | No "staff money matrix" pgTAP. As staff, select every money-bearing column/RPC and assert exactly what is visible (M2). | Yes: a future grant could leak cost data unnoticed. |
| T9 | `stuck_notifications_count` is not tested with a dead (`attempts = 5`) row (M5). | It passes today and the behaviour is wrong. |

## Docs mismatches

- SPEC-admin §1: "amounts not returned to staff" contradicts the RLS and the receipt (M2).
- SPEC-admin §2.6: the panel's "change PIN" does not exist (H1).
- DRIVER-API §2/§3.3/§8: account creation by admin, deactivated-driver errors, and refresh after reset are not described (M6).
- RUNBOOK §7.3: the break-glass procedure needs the hardening in M4.
- The rest of the SPEC-admin assumptions 16–19 match what was built. Checked: T17 fallback buttons, T18 kilo units and waste "today", and T19 routes, the existing min-order check, the 20/hour limit and building ordering.

---

## Ordered fix list (for a separate fix session)

| # | Fix | Migration | Edge Function redeploy | Notes |
|---|---|:-:|:-:|---|
| 1 | **H2:** `set_user_role` refuses deactivating/demoting a driver with `ready`/`out_for_delivery` orders (`DRIVER_HAS_ORDERS`); optional admin hand-over from `out_for_delivery`; panel message; pgTAP (T3) | ✅ | — | Owner decision on "cancel without stock return" |
| 2 | **M1:** `set_user_role` revokes sessions on deactivate or role downgrade; pgTAP (T4) | ✅ | — | Same migration as 1 |
| 3 | **H1:** `profiles.must_change_pin`, set by `finish_user_creation`/`record_pin_reset`, `pin_changed()` RPC; panel `/account/pin` + proxy gate; customer-app gate; DRIVER-API note | ✅ | — (if set inside the SQL helpers) | Driver part needs the external developer's agreement |
| 4 | **M3:** `admin_audit` table written by `set_user_role` and `update_app_settings`; protect the owner / last active admin | ✅ | — | |
| 5 | **M4:** RUNBOOK break-glass rewrite now; later `scripts/admin-break-glass.mjs` + nullable `pin_resets.reset_by` / `kind` | ✅ (later) | — | Docs first |
| 6 | **M2:** owner decides; recommended: amend SPEC-admin §1/§2.0 wording + staff money matrix pgTAP (T8, T5) | — | — | Docs + tests only, if recommended option chosen |
| 7 | **M5:** stuck count = `attempts < 5`; separate dead count; UI text; pgTAP (T9) | ✅ | — | |
| 8 | **M7:** `buildings.number` CHECK; revoke `update(id, parent)` and `delete` on address tables; rename warning with count | ✅ | — | |
| 9 | **M6:** DRIVER-API §2/§3.3/§8 updates | — | — | By agreement |
| 10 | Tests T1, T2 | — | — | pgTAP only |
| 11 | **L1** cast fix (fold into the next migration), **L6** restore filtered schema check, **L5/L7** UI strings | ✅ (L1) | — | |
| 12 | **L3/L4** attempt-based rate limit and log scrubbing (optional) | ✅ (L3) | ✅ | Only if wanted |
