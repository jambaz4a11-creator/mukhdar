# Review: fix sessions A and B (after review T16–T19)

- **Date:** 2026-11-16. **Scope:** commits `c3e71ab` (session A), `86f958f` (session B), `4c1258b`, `a2aecfe`:
  migrations `20261123000001_account_lifecycle.sql` and `20261124000001_review_session_b.sql`, the
  `admin-create-user` / `admin-reset-pin` changes (`_shared/admin.ts`, `_shared/supabase.ts`, both handlers),
  admin `/change-pin` + proxy/layout gating, the customer app forced PIN change, order reassignment,
  cancel without stock return, `admin_audit`, `pin_resets` / `admin_function_hits`, the break-glass script,
  notification counts, address/building changes, and `DRIVER-API.md` "Changes for the driver app".
- **Method:** read-only. Live definitions on mukhdar-dev (`pg_proc`, `pg_policies`, `pg_trigger`, grants,
  `pg_publication_tables`, `realtime` policies, building data) read inside a `begin read only` transaction,
  compared with the migrations; read the Edge Function handlers, the admin and customer code, the scripts,
  SPEC-admin, SPEC-backend, DRIVER-API, RUNBOOK and the T16–T19 review.
- **This review changed no application code, migration, Edge Function or cloud setting.** The only other
  file change is the new RUNBOOK §17 (production launch order), as requested.

## Summary

The core of both sessions holds up. `must_change_pin` is enforced in one place (`private.current_user_role()`
returns null), so every role helper, every RLS policy that names a role, the driver functions, Realtime
(`orders` is the only published table and its policy goes through `current_user_role()`), storage writes
(`is_admin()`) and the two admin Edge Functions (`requireAdmin`) refuse a flagged user. The flag is only
cleared by the `auth.users.encrypted_password` trigger; nothing else writes `false`. `LAST_ADMIN`,
self-demotion, reassignment vs. "delivered", two staff acting at once, and cancel-without-return are
correctly serialized on row locks. Waste is valued at order-time cost and net profit still matches the
formula (SPEC-admin "التقارير" and SPEC-backend §2: gross profit − waste cost − negative adjustments; CLAUDE.md does
not state the formula itself). No PIN is stored anywhere in the database or logs. The building check
covers every write path.

The one real gap is **push notifications**: they ignore `must_change_pin` and survive a PIN reset, so the
"lost phone → admin resets PIN" case still delivers order pushes to the lost phone (H1). Four Medium items:
a race in `accept_order`/`assign_driver`, a partial-failure path in `admin-reset-pin`, an escapable forced
screen in the customer app, and the break-glass PIN reaching captured stdout.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 8 |

---

## High

### H1. Push notifications bypass `must_change_pin` and survive a PIN reset
- **Where:** `public.claim_push_notifications` (recipient join), `public.register_push_token`,
  `public.record_pin_reset`, `public.set_user_role` (revocation branch), `public.revoke_user_sessions`.
- **Problem:** the recipient join filters `p.is_active` and the role only:
  `when 'drivers' then p.role = 'driver'`, `when 'admins' then p.role in ('admin','staff')`,
  `when 'admins_only' then p.role = 'admin'`, `when 'user' then t.user_id = c.user_id`. There is no
  `not p.must_change_pin`. `register_push_token` only checks `auth.uid()`, so a flagged user can also
  register a new token. And neither a PIN reset nor a session revocation deletes `push_tokens`, so the
  token of the old device stays registered.
  Also `assign_driver` accepts a flagged driver (see M1), which sends that driver a `user` push.
- **Impact:** the main reason the admin resets a PIN is a lost/stolen or shared phone. After the reset
  (sessions revoked, flag set) that phone **keeps receiving** pushes: for staff/admin every new order
  (`طلب جديد #N`, unit, building, **total**), low-stock alerts with quantities (admin); for a driver every
  `ready` order (unit, building) and assignments. The same applies to whoever holds the temporary PIN but
  has not changed it. The database itself shows nothing to these users; the push channel does.
  Deactivation and demotion are already safe (`is_active` / role filters).
- **Fix (one new migration, no Edge Function redeploy: `push-dispatch` calls the RPC):**
  1. `claim_push_notifications`: add `and not p.must_change_pin` to the recipient `where` for every
     audience except `user` to a customer (or simply for all audiences; a customer with a reset PIN is
     signed out anyway).
  2. `record_pin_reset`: `delete from public.push_tokens where user_id = p_user_id;` (the reset exists to
     cut off old devices; the new device registers again after the PIN change).
  3. `set_user_role`: the same delete inside the existing revoke branch (deactivation/downgrade).
  4. `register_push_token`: refuse (`PIN_CHANGE_REQUIRED`) when the caller's profile has the flag and the
     role is not `customer`, or just rely on (1).
  5. pgTAP: flagged staff/driver with a token gets no recipient row; reset deletes tokens.
- **Needs:** migration. No redeploy.

---

## Medium

### M1. `accept_order` and `assign_driver` lock predicates miss the role / flag
- **Where:** `public.accept_order` (unchanged in A/B but relied on by A), `public.assign_driver`
  (`20261123000001` §4).
- **Problem:** the comment in `assign_driver` says both functions serialize with `set_user_role` through
  the driver's profile row. They do lock it, but the re-check under the lock is incomplete:
  - `accept_order`: `perform 1 from profiles where id = v_uid and is_active for share`. The role check
    (`current_user_role() <> 'driver'`) runs **before** the lock. If an admin demotes the driver
    (driver → customer/staff, still active) while `accept_order` waits on the lock, the lock re-check
    passes (`is_active` is still true) and the order is accepted by a non-driver. `set_user_role`'s
    `DRIVER_HAS_ORDERS` check already ran, so the new state is a `ready` order held by an account that can
    no longer see or deliver it.
  - `assign_driver`: `where id = p_driver_id and role = 'driver' and is_active for share`: no
    `not must_change_pin`. Staff can assign (or reassign an `out_for_delivery` order) to a driver with a
    temporary PIN, who cannot read it (RLS) or mark it delivered until they change the PIN, but does get
    the push (H1). `list_drivers` does not return the flag, so the panel cannot warn.
- **Impact:** rare (needs a demotion within milliseconds of an accept), but it breaks the
  "no driver is demoted while holding orders" invariant that H2 of the previous review established.
  The flagged-driver assignment is more likely (a new driver created today is flagged until first sign-in)
  and silently strands the order until the driver changes the PIN.
- **Fix (same new migration):** `accept_order`: lock with
  `where id = v_uid and role = 'driver' and is_active and not must_change_pin for share`.
  `assign_driver`: add `and not must_change_pin` (error `DRIVER_NOT_FOUND` or a new `DRIVER_PIN_PENDING`).
  `list_drivers`: return `must_change_pin` so the assign dialog shows "لم يغيّر رمزه بعد" and disables the
  row. pgTAP for both (the concurrency script `db:concurrency` can cover the demotion race).
- **Needs:** migration; small admin UI change (no redeploy).

### M2. `admin-reset-pin` partial failure leaves a known PIN without `must_change_pin`
- **Where:** `supabase/functions/admin-reset-pin/handler.ts` (order: `updatePassword` → `revokeSessions`
  → `recordReset`); `apps/admin/src/features/admin/PinDialogs.tsx` (`ResetPinDialog`).
- **Problem:** `updatePassword` fires the trigger, which **clears** any flag. The flag is set again only by
  `recordReset`. If `recordReset` fails (network blip to PostgREST, statement timeout) the handler returns
  500, but the password is already the new PIN, the flag is `false`, and no `pin_resets` row exists. The
  PIN the admin typed is still in the dialog's input (it is only cleared on success).
- **Impact:** if the admin sends that PIN anyway (it "looks" set; the user can sign in with it), the
  temporary PIN becomes permanent and is known to the admin and to the WhatsApp thread, and the reset is
  missing from the audit table. The break-glass script does not have this problem (it never shows the PIN
  unless all three steps succeeded).
- **Fix (redeploy + admin UI):** in the handler, retry `recordReset` (and `revokeSessions`) up to 2 more
  times; if it still fails return a distinct `500 RESET_INCOMPLETE`. In `ResetPinDialog`, on any error
  clear the PIN input and show "لم تكتمل إعادة الضبط: أعد المحاولة ولا ترسل الرمز". Optional DB hardening:
  a `begin_pin_reset(user)` RPC that writes the audit row first and a `pin_reset_pending` marker the
  trigger consumes instead of clearing the flag; only worth it if retries prove insufficient.
- **Needs:** redeploy of `admin-reset-pin`; admin UI change. No migration (unless the optional variant).

### M3. Customer app: the forced PIN screen can be left
- **Where:** `apps/customer/src/features/auth/api.ts` (`goAfterAuth`), `apps/customer/src/app/account/pin.tsx`,
  `apps/customer/src/features/auth/store.ts`.
- **Problem:** the flag is checked only in `goAfterAuth`, right after sign-in. Not checked on: app restart
  with the persisted session, app resume, or deep links (`/(tabs)`, `/order/[id]`, `/checkout`). On the
  forced screen there is no `usePreventRemove` / `gestureEnabled: false`, and `router.replace` only
  replaces the sign-in screen, so Android hardware back or iOS swipe returns to whatever was under sign-in
  (e.g. the cart).
- **Impact:** not a security bypass: the database still refuses `place_order` (`PIN_CHANGE_REQUIRED`), and
  everything else the flagged customer can reach is their own rows. But the user is not forced, and only
  learns it at checkout after building a cart (message: "غيّره أولاً من تغيير الرمز").
- **Fix (app release):** read `must_change_pin` in the auth store when the session is restored and on
  resume; a root-layout guard redirects to `/account/pin?forced=1` while it is true; block back on the
  forced screen (`usePreventRemove`, `gestureEnabled: false`) leaving only "تغيير" and "تسجيل الخروج";
  on `PIN_CHANGE_REQUIRED` at checkout navigate there instead of only showing the message. Jest tests for
  restore + deep link.
- **Needs:** customer app change only.

### M4. Break-glass: PIN reaches captured stdout; confirmation can be piped
- **Where:** `scripts/admin-break-glass.mjs`.
- **Problem:** the prompts read from `readline` on whatever stdin is, so `echo y | pnpm admin:break-glass-reset 07…`
  works on dev, and `printf '<ref>\ny\n' | …` works on any other project: the "type the ref" guard is a
  typing guard, not an interactive one. The PIN is printed with `console.log`; the "clear from screen"
  escape is sent only when `stdout.isTTY`. Run under CI, `tee`, `> file`, `script`, or a terminal
  recorder, the PIN line is kept in that log. `it:break-glass` itself runs the script with piped stdin and
  captures stdout (that is on dev with a throwaway admin, so acceptable there).
- **Impact:** the RUNBOOK says "never written anywhere"; the script does not enforce it. A future
  automation or a careless `| tee log.txt` writes the production admin PIN to disk or a CI log.
- **Fix (script only):** refuse to run unless `process.stdin.isTTY && process.stdout.isTTY`, with a
  test-only escape (`MUKHDAR_BREAK_GLASS_TEST=1` **and** ref = dev ref) used by `it:break-glass`; refuse
  when `CI` is set. Optionally write the PIN line to the controlling terminal only. Also catch exceptions
  from `fetch` (L8).
- **Needs:** local script change only.

---

## Low

### L1. Residual access with a revoked session (≤ 1 hour)
- **Where:** all own-row policies (`addresses`, `orders` as customer, `profiles`, `push_tokens`, `ratings`),
  `rate_order`, `set_default_address`.
- **Problem / impact:** PostgREST validates the JWT, not the session. After a reset/deactivation the old
  access token still reads and writes the user's **own** rows until it expires (role-gated data is already
  cut off by `current_user_role()`). For a customer whose phone was lost: addresses and order history
  readable, addresses editable, for up to an hour. Documented as accepted in SPEC/RUNBOOK.
- **Fix (optional, migration):** a `private.session_alive()` that checks `auth.jwt() ->> 'session_id'`
  exists in `auth.sessions`, used in `current_user_role()` and the own-row policies; or shorten the JWT
  expiry. Otherwise keep as accepted risk.

### L2. Rate limit counts attempts only after validation
- **Where:** both handlers call `rateHit` after the body/PIN/target checks; RUNBOOK §16 "الفاشلة تُحسب أيضاً".
- **Problem / impact:** `INVALID_REQUEST`, `USER_NOT_FOUND`, `ADMIN_ACCOUNT`, `PIN_INVALID` are not counted.
  Harmless (they change nothing and reveal nothing new), but the doc overstates it. Also the old
  `admin_actions_last_hour` function is now unused.
- **Fix:** reword the RUNBOOK line ("every attempt that reaches the change, including `PHONE_TAKEN`");
  drop `admin_actions_last_hour` in the next migration.

### L3. Re-assigning to the same driver sends a misleading push
- **Where:** `assign_driver`.
- **Problem / impact:** `p_driver_id = v_prev_driver` is not short-circuited: on an `out_for_delivery` order
  the same driver gets "نُقل لك طلب بالطريق", and a `driver_reassigned` history row is written (no audit
  row, correctly).
- **Fix (migration):** `if v_prev_driver = p_driver_id then return v_order; end if;` after the lock.

### L4. Cancel-without-return: two valuation edge cases
- **Where:** `set_order_status` (no-return branch).
- **Problem / impact:** (a) items whose `product_id` became null (product deleted) are skipped, so their
  cost never enters waste; (b) if an item had no `order_item_costs` row, `unit_cost_iqd` is null and the
  `tg_movement_unit_cost` trigger fills the **current** cost, not order-time cost. (b) cannot happen for
  orders made by `place_order` (it always writes a cost row, `coalesce(..., 0)`), so it is theoretical;
  (a) needs a product deleted while its order is on the way.
- **Fix (migration, when next touched):** `coalesce(<expr>, 0)` for the unit cost; for (a) either block
  product deletion while referenced by an open order or accept and document.

### L5. `record_pin_reset` does not tie `kind` to `reset_by`
- **Where:** `record_pin_reset(p_user_id, p_reset_by, p_kind)`.
- **Problem / impact:** `kind = 'admin'` with `reset_by = null`, or `break_glass` with an admin id, is
  accepted. Only `service_role` can call it, so it is a data-quality issue.
- **Fix (migration):** `check ((kind = 'admin') = (reset_by is not null))` on `pin_resets`, or the same test
  in the function.

### L6. Flag clearing depends on GoTrue never rewriting the hash on sign-in
- **Where:** trigger `on_auth_user_password_changed`.
- **Problem / impact:** the trigger treats any `encrypted_password` change as "the user chose a new PIN".
  Today GoTrue does not rehash bcrypt on sign-in (confirmed live by `it:admin-users`: signing in with the
  temporary PIN keeps the flag). A future GoTrue that upgrades hash cost on sign-in would silently clear
  the flag at first sign-in.
- **Fix:** keep that live check in `it:admin-users` and run it after every Supabase Auth upgrade (add a line
  to the RUNBOOK upgrade notes). No code change now.

### L7. DRIVER-API "Changes for the driver app" is slightly inaccurate / incomplete
- **Where:** `docs/DRIVER-API.md` top section and §2 point 4.
- **Problem:**
  - "deactivation or a role change also revokes every session": only deactivation and a **downgrade**
    revoke (driver → customer). A promotion (driver → staff/admin) does not.
  - Not mentioned: `order_status_history` now gets rows with `from_status = to_status` and notes
    `driver_assigned` / `driver_reassigned` / `driver_accepted`; a history timeline must not render them as
    status changes.
  - Not mentioned: delete the device's row in `push_tokens` **before** `signOut()` (after a revoked
    session the app can no longer delete it), and that until H1 is fixed a flagged driver still gets pushes.
  - Not said explicitly that `20261124000001` has no driver-facing change.
- **Fix:** doc update with the H1/M1 migration (the API changes for M1 belong in the same section).

### L8. Smaller items
- **Break-glass network error:** a `fetch` exception after step 1 is an unhandled rejection with no
  "re-run" hint (no PIN in the output; safe). Wrap `call()` and print the same message as a failed step.
- **Audit coverage:** renaming/hiding a sector/unit/building changes every saved customer address but is
  not in `admin_audit`. Not required by CLAUDE.md; worth adding as `action = 'address'` when next touched.

---

## Checked and OK (no finding)

1. **`must_change_pin` enforcement:** every policy in `public`/`storage` either uses own-row predicates
   or `private.is_admin()` / `is_staff_or_admin()` / `current_user_role()`; the driver order policy is
   `driver_id = uid AND current_user_role() = 'driver'`. Every `authenticated`-executable function is either
   role-gated through these helpers or own-row only (`rate_order`, `set_default_address`,
   `register_push_token`, see H1). `admin_audit`, `pin_resets`, `user_creations` admin-only;
   `admin_function_hits` no grants. `realtime` schema: no policies (private channels closed); the only
   published table is `orders`. Edge Functions: `requireAdmin` refuses the flag; `delete-account` allowed by
   design. The flag is written `true` only by `finish_user_creation` / `record_pin_reset` and `false` only by
   the trigger; the user cannot update it (column grant is `full_name` only). The admin `/change-pin` page
   and proxy/layout redirect are correct (proxy redirects every non-public path; layout double-checks).
2. **Session revocation:** `set_user_role` is the only role/active write path reachable by the app
   (column grants; `finish_user_creation` is for brand-new users; `begin_account_deletion` ends in deleting
   the auth user). Revocation runs in the same transaction as the change. Manual SQL in RUNBOOK §7 is a
   promotion. `auth.getUser` in the Edge Functions rejects revoked sessions.
3. **Reassignment / cancel races:** `assign_driver` and `set_order_status` both take `for update` on the
   order row; under READ COMMITTED the waiting call re-reads the row (status filter re-evaluated, new
   `driver_id` seen), so: delivered-then-reassign → `ORDER_NOT_AVAILABLE`; reassign-then-delivered by the
   old driver → `NOT_ALLOWED`; two staff → serialized, audit `before` is the real previous driver; two
   cancels → `INVALID_TRANSITION`. No lock-order cycle with `set_user_role` (admins → target) or
   `accept_order`. Stock: no-return branch leaves `stock` untouched and writes `cancel_return +N` and
   `waste −N`, so the ledger still sums to the balance; waste valued at
   `order_item_costs.cost_snapshot_iqd`, enters `daily_stats.waste_cost_iqd` through the existing trigger,
   and `rebuild_daily_stats` computes the same; revenue/cost never counted because the order was not
   delivered; `cancelled_count` +1. Net profit = gross − waste − negative adjustments holds.
4. **LAST_ADMIN / self-demotion:** `CANNOT_DEMOTE_SELF` before any lock; then all active admin rows are
   locked in id order and the caller is re-checked under the lock (`not must_change_pin` included). Two
   admins demoting each other: the second waits, then fails `NOT_ALLOWED`. Since an admin can never demote
   themselves, the caller always remains, so `LAST_ADMIN` is defence in depth.
5. **Audit / secrets:** `admin_audit` (roles, settings with changed fields only, order driver, dismissed
   notifications) is admin-read-only, written only by `security definer` functions. `pin_resets`,
   `user_creations`, `admin_function_hits` contain no PIN. Edge Function logs scrub raw and normalized PIN;
   bodies are never logged. Rate-limit counting is per admin with an advisory lock (no over-count race).
6. **Break-glass guards:** refuses without `SUPABASE_URL` or the service key; prints ref + URL; non-dev ref
   needs the ref typed; admin accounts only; PIN generated in-process (never on the command line, so not in
   shell history); shown only after all three steps succeed, so any half-way failure leaves an unknown PIN
   (safe; re-run). Mismatched URL/key fails at the first call with nothing changed.
7. **Buildings 1–100:** check constraint validated on dev (1700 rows, 0 violations). Every write path
   (direct insert/update under admin RLS, `add_buildings`, `seed.sql`, `db-concurrency` uses `'1'`) passes
   through it; the form uses the same regex; `update` on buildings is limited to `number, sort_order,
   is_active`; delete revoked. Rename confirmation uses `address_usage` (admin-only).
8. **DRIVER-API:** function names, error codes, push titles and `data` types match the live definitions
   (apart from L7).

---

## Production rollout

RUNBOOK §17 (new) lists every migration in order, the Edge Function order, the rule
"apply `20261124000001` before deploying `admin-create-user` and `admin-reset-pin`", the
`SUPABASE_URL=https://<prod-ref>.supabase.co` line for the root `.env.local`, and the buildings pre-check.
The production project does not exist yet (RUNBOOK §1), so "since the last production-ready state" means
all 23 migrations.

## Ordered fix list

1. **One new migration** (`H1`, `M1`, plus `L3`, `L4(b)`, `L5`, drop `admin_actions_last_hour` from `L2`):
   push recipients exclude flagged users; reset/deactivation/downgrade delete push tokens;
   `accept_order` / `assign_driver` lock predicates include role and `not must_change_pin`; `list_drivers`
   returns the flag; same-driver assign is a no-op. pgTAP for each; `db:concurrency` case for the demotion
   race. Apply to mukhdar-dev with approval. No Edge Function redeploy.
2. **`admin-reset-pin` redeploy + `ResetPinDialog`** (`M2`): retry, `RESET_INCOMPLETE`, clear the PIN on error.
3. **Break-glass script** (`M4`, `L8`): TTY-only, CI refusal, test escape, caught network errors.
4. **Customer app** (`M3`): flag check on restore/resume, root guard, no back on the forced screen,
   checkout redirect.
5. **Admin assign dialog** (`M1` UI): show/disable drivers with a pending PIN change.
6. **Docs** (`L2`, `L6`, `L7`): RUNBOOK rate-limit wording and Auth-upgrade check; DRIVER-API corrections.
7. **Decide** `L1` (accept the ≤ 1 h window or add the session check).
