# Review R4: driver cash handover (T40–T42)

- **Date:** 2026-11-22. **Scope:** the R4 row of `docs/tasks/00-README.md` (`docs/tasks/R4-cash-review.md`): what
  T40–T42 merged on `main` up to `d424977` (PRs #37–#39):
  - T40 `supabase/migrations/20261212000001_cash_handover.sql`, `supabase/tests/39_cash_handover.sql` and the guards
    (`01`, `12`, `21`, `27`, `28`, `32`), `scripts/db-concurrency.mjs` section 5
  - T41 `apps/admin/src/features/cash/*`, `apps/admin/src/app/(panel)/cash/page.tsx`, `apps/admin/e2e/cash.spec.ts`
  - T42 `apps/driver/src/features/cash/cash.ts`, `apps/driver/src/app/(tabs)/today.tsx`, `apps/driver/src/app/cash/history.tsx`
- **Method (read-only):** I read the migration against SPEC-cash §2–§5, §9 and §12, and checked the helpers it
  relies on at their latest definitions: `private.current_user_role` (`20261201000001`, aal2 + 12 h idle + active +
  no temporary PIN), `private.is_admin`/`is_staff_or_admin` (`20261111000001`), `private.staff_window_start`
  (`20261202000001`, Baghdad today − 6), `private.report_guard` (`20261126000001`), `private.clean_user_text`
  (returns null for blank text), `set_order_status` (`20261202000001`: `delivered` is final, `out_for_delivery` needs a
  driver), `assign_driver` (`20261125000001`: active orders only) and `set_user_role` (`20261209000001`:
  `DRIVER_HAS_ORDERS`). I also checked the `orders` grants (select only, no column update). I did not run anything on
  mukhdar-dev.
- **Nothing changed in code, migrations, Edge Functions or the cloud.** This file and the R4 status lines are the
  only changes.
- **Report path:** the task file says `docs/reviews/review-R4-cash.md`; the owner asked for
  `docs/reviews/R4-cash-review.md` in this session, so the report is here.
- **Not done in this session:** the manual check on dev (SPEC-cash §14 items 3 and 4). It needs the owner's approval
  and a driver device. R4 stays ⬜ until that check is done and the fixes below are scheduled.

## Test results

| Suite | Result |
|---|---|
| `@mukhdar/admin` Vitest, `src/features/cash` | 51 / 51 (8 files) |
| `@mukhdar/driver` Jest, cash / notification / delete suites (`--maxWorkers=2`) | 47 / 47 (3 suites) |
| pgTAP (`39_cash_handover.sql`, 130 assertions, and the guards) and `db-concurrency.mjs` | CI on this PR (see the PR checks) |

## Summary

**No Critical or High findings.** The core is sound:

- **Locking:** the advisory lock per driver, then `FOR UPDATE` on that driver's delivered, unlinked orders in `id`
  order, in a single statement whose result is exactly what gets linked. This is correct under `READ COMMITTED`. A
  delivery that commits after the step-5 statement starts doesn't match its snapshot, so it stays in the balance. No
  order can be linked twice (one `cash_handover_id` column, rows locked), and none is missed (`delivered` is final,
  and `cash_handover_id` can only be set by the definer function).
- **Concurrent calls:** the optimistic `(expected, count)` comparison turns every concurrent change (a delivery, a
  fee-setting flip, a second recorder) into `CASH_BALANCE_CHANGED` or `NO_CASH_OUTSTANDING`, never a phantom shortage.
- **Idempotency:** the key is checked again after the lock, so two parallel clicks give one row (concurrency 5c).
- **Server-side enforcement:** the shortage/overage note is enforced in the function (`NOTE_REQUIRED`) and again by
  `cash_handovers_note_required`. `clean_user_text` turns a blank note into null, so `'   '` is refused (test line 119).
- **Roles:** they all go through `current_user_role()`, so aal2, a temporary PIN and a disabled account are handled in
  one place. There is no direct read of `cash_handovers` for any role. Staff get 7 days of history and no
  reports or corrections. Driver functions return the caller's own rows only, with the recorder's first name only.
- **Audit:** every record and correction writes `admin_audit` from inside the function, and fee-setting changes are
  audited through `update_app_settings`.
- **Sales and net profit:** they are untouched (nothing in the reports reads `cash_handovers`).
- **Rounding:** prices and the delivery fee are DB-constrained to multiples of 250, so `expected` is always a
  multiple of 250 and an exact match is always possible.

The findings below are edge cases, defence in depth and test gaps.

## Medium

### M1. A fee-setting flip silently writes off delivery fees already held, and nothing shows it

- **Where:** `20261212000001_cash_handover.sql:152–160`, `:286–291`, `:504–510` (balance and expected use the
  *current* `cash_handover_includes_delivery_fee`). `report_cash` `:511–519` has no fee figure.
- **Scenario:** with the setting `true`, driver D delivers 10 orders and holds 10 × (goods + 1,000) in cash. The admin
  sets it to `false` to try it out, and the staff record D's handover during that window. `expected = goods` only, so
  the handover is "matched" with difference 0. The 10,000 IQD of fees that the policy at delivery time said belonged
  to the shop are closed for good. No shortage is recorded, and `report_cash` has no column that shows it. The only
  traces are `fees_iqd` / `includes_delivery_fee` on the row and the `settings` audit line.
- **Status:** the SPEC (§2, Q1) approves "computed with the current setting", so this is not a defect in the code.
  But the result is invisible in every screen the owner reads.
- **Fix (pick one, owner decision):**
  - (a) Add `fees_kept_iqd` (Σ `fees_iqd` where `not includes_delivery_fee`) to `report_cash` totals and per
    driver, and show it in the "الكاش والسواق" section.
  - (b) Show the confirmation "N drivers hold X IQD of fees that will no longer be collected" in `/settings` before
    saving `false`.
  - (c) Snapshot the setting per order at delivery time. This changes `set_order_status`, so it is out of scope
    without the owner's approval.

  (a) is cheap and keeps the approved rule.

### M2. After a lost response, changing the amount leads to "recorded a while ago" with the first amount stored

- **Where:** `apps/admin/src/features/cash/HandoverDialog.tsx:95` (`keyFor` rotates the key when the amount changes),
  `errors.ts` (`case null`: the result is unknown, keep the key) and `case 'NO_CASH_OUTSTANDING'` (close).
- **Scenario:**
  1. Staff types 40,000 and confirms. The request commits, but the response is lost (Wi-Fi drop), so they see "صار
     خلل، حاول مرة ثانية".
  2. They recount, change the amount to 39,750 and write a note. The new amount means a new key, and the server
     returns `NO_CASH_OUTSTANDING`.
  3. The dialog closes with "انسجل الاستلام قبل شوية".

  The staff member believes 39,750 was recorded. The row says 40,000 with difference 0. The driver's notification
  says 40,000. Nobody is told that the stored amount differs from the last one typed.
- **Fix:** after an unknown-outcome error (`code === null`), keep the amount field read-only and offer only "retry"
  (same key). Or, on `NO_CASH_OUTSTANDING` after an unknown outcome, load the driver's latest handover
  (`cash_handover_history(p_driver_id, …, p_limit 1)`) and show "the recorded amount is X". If X differs from the
  amount on screen, point the staff to the admin correction. Add a unit test for this sequence.

## Low

### L1. Deadlock between `begin_account_deletion` and `record_cash_handover` (the documented lock order is wrong)

- **Where:** `20261212000001_cash_handover.sql:570–588` (deletion takes the `place_order` lock, then
  `profiles … FOR UPDATE`, then the `cash_handover:` advisory lock) and `:266`, `:303`, `:312`, `:319` (recording
  takes the advisory lock, then the `INSERT`s whose foreign keys on `driver_id` / `recorded_by` / `actor` / `user_id`
  take `FOR KEY SHARE` on the same `profiles` row).
- **Scenario:** a driver presses "delete my account" while a staff member is recording their handover. T1 (record)
  holds the advisory lock and waits for `KEY SHARE` on the profile. T2 (deletion) holds `FOR UPDATE` on the profile
  and waits for the advisory lock. Postgres detects the deadlock after about 1 s and aborts one of them. No money is
  lost either way: an aborted record is retried with the same key, and an aborted deletion is retried. But
  SPEC-cash §3.3 says the deletion check uses "the same lock" and is safe, and `db-concurrency.mjs` doesn't cover
  this pair.
- **Fix:** in `begin_account_deletion`, take `pg_advisory_xact_lock(hashtextextended('cash_handover:' || p_user_id, 0))`
  before `select … for update` on `profiles` (new migration). Add a concurrency scenario: deletion and recording in
  parallel, 10 rounds, no `40P01`.

### L2. A replayed key ignores the amount, note and expected values

- **Where:** `20261212000001_cash_handover.sql:257–263`, `:267–273`.
- **Scenario:** a client bug, or a future client, reuses a key with a different `p_received_iqd` or note. The server
  returns the old row with `replayed: true` and no error. The current dialog rotates the key when the amount changes,
  so it is safe today, but the note isn't part of that rule: retry with the same amount and an edited note, and the
  first note is kept without any warning.
- **Fix:** on replay, compare `p_received_iqd` (and `p_expected_iqd` / `p_order_count`) with the stored row. On a
  mismatch, raise `INVALID_REQUEST` with `detail = 'idempotency_key'`. Add pgTAP for the case.

### L3. Same key for two different drivers at the same instant gives a raw unique-violation error

- **Where:** `20261212000001_cash_handover.sql:266–273` (the lock is per driver, so two calls for different drivers
  don't serialize) and `:303` (`idempotency_key unique`).
- **Scenario:** possible only with a client bug. The second insert fails with `23505`, and the panel shows the
  generic error instead of `INVALID_REQUEST idempotency_key`.
- **Fix:** catch `unique_violation` around the insert and re-raise `INVALID_REQUEST` (`detail = 'idempotency_key'`).

### L4. `p_expected_iqd + 10000000` can overflow

- **Where:** `20261212000001_cash_handover.sql:248`.
- **Scenario:** `p_expected_iqd` near the `bigint` maximum raises `22003 bigint out of range`, not
  `CASH_AMOUNT_INVALID`. This is harmless (it's refused anyway) but leaks an internal error code.
- **Fix:** add `p_expected_iqd > 1e12` (or any sane cap) to the `INVALID_REQUEST p_expected_iqd` check.

### L5. Staff can see data older than 7 days through K4 and K5

- **Where:** `20261212000001_cash_handover.sql:166–171` (`cash_outstanding` returns the last handover's time,
  amount and difference however old it is) and `:197–204` (`cash_outstanding_orders` returns order number, amounts,
  block and building of unlinked orders however old they are).
- **Scenario:** a driver last handed over 30 days ago. Staff see that handover's amount and shortage in the
  balances tab, even though `cash_handover_history` hides it. The K5 exposure is approved in SPEC-cash K5. The K4
  "last handover" exposure isn't mentioned anywhere.
- **Fix:** in `cash_outstanding`, null out `last_received_iqd` / `last_difference_iqd` when the caller is staff and
  `h.recorded_at < private.staff_window_start()`, or record it as an approved assumption in SPEC-cash §12.

### L6. Correction: lost update between two admins, and a note can't be corrected alone

- **Where:** `20261212000001_cash_handover.sql:452` (row lock, but no "expected current value"), `:467–469` (same
  amount returns `changed: false` without saving the note).
- **Scenario:** admins A and B both open "تصحيح" on the same row showing 40,000. A saves 39,500, then B saves
  39,750. B's value wins without B ever seeing A's change (both are audited). Separately, an admin who only wants to
  fix a wrong note can't.
- **Fix:** add `p_expected_received bigint` and raise `HANDOVER_CHANGED` if it differs from `v_old.received_iqd`.
  Decide whether a note-only correction is allowed (SPEC says amount and note; the code allows the amount only).

### L7. A poll during the in-flight submit closes the dialog with "recorded a while ago" for the user's own handover

- **Where:** `apps/admin/src/features/cash/HandoverDialog.tsx:62–68` (`doneRef` is set only in `onSuccess`),
  `CashScreen.tsx:47–48` (`liveRow` filters `outstanding_iqd > 0`).
- **Scenario:** the 30 s poll, or a focus refetch, lands after the RPC has committed but before its response
  arrives. `liveRow` is undefined, so the dialog shows "انسجل الاستلام قبل شوية" and closes. Then `onSuccess` shows
  "تم: استلمت …". The user sees two contradictory notices. No data is wrong.
- **Fix:** skip the `live` effect while `submit.isPending`, or set a `submittingRef` before `mutate`.

### L8. The `CASH_BALANCE_CHANGED` text always blames a new delivery

- **Where:** `apps/admin/src/features/cash/errors.ts` (message) and `HandoverDialog.tsx:77–79`.
- **Scenario:** the admin flips the fee setting while a dialog is open. The dialog says "وصل توصيل جديد", but the
  count is unchanged and only the basis changed.
- **Fix:** if `order_count` is unchanged, say "تغيّر إعداد أجرة التوصيل. المطلوب الآن X".

### L9. A cash notification can reach an account that isn't a driver any more

- **Where:** `20261212000001_cash_handover.sql:319–321`, `:483–487`.
- **Scenario:** a driver is demoted to customer while holding cash (allowed by Q5), then staff record the handover.
  The `user` notification goes to their customer-app devices with `data.type = 'cash_handover'`, which the customer
  app doesn't route. The tap opens the default screen, and the text talks about handing over cash.
- **Fix:** either skip `_notify` when the profile's role isn't `driver`, or add `cash_handover` to the customer
  app's routing as a no-op. The first is simpler.

### L10. `update_app_settings` keeps `search_path = public, pg_temp` (pre-existing)

- **Where:** `20261212000001_cash_handover.sql:621` (a copy of the older function body).
- **Scenario:** not exploitable today (`pg_temp` is last, and `public` is owner-controlled), but SPEC-cash K16 and the
  definer guard expect `search_path = ''` for SECURITY DEFINER functions. `set_order_status` and `assign_driver` have
  the same pre-existing pattern.
- **Fix:** next time any of these functions is replaced, pin `search_path = ''` and schema-qualify the body.

## Test gaps

| # | Missing | Why it matters | Where to add |
|---|---|---|---|
| T1 | Concurrency: `begin_account_deletion` ∥ `record_cash_handover` | Would have caught L1 | `scripts/db-concurrency.mjs` §5e |
| T2 | Replay with the same key but a different amount or note | Pins the L2 behaviour (whatever is decided) | `39_cash_handover.sql` |
| T3 | `record_cash_handover` as an admin/staff with a **temporary PIN** (aal2 session) | SPEC §9.1 lists it; only the driver temp-PIN case is in 39 (aal1 is covered in 28) | `39_cash_handover.sql` roles block |
| T4 | Customer calling `record_cash_handover`, `correct_cash_handover`, `report_cash`, `cash_handover_history` | Role matrix completeness; `27_access_matrix.sql` lists only 3 of the 8 cash RPCs | `27_access_matrix.sql` |
| T5 | Staff 7-day boundary: a handover at Baghdad today − 6 at 00:05 (visible) and today − 7 at 23:55 (hidden) | Only "10 days ago" is tested; an off-by-one in `staff_window_start` would pass | `39_cash_handover.sql` history block |
| T6 | `report_cash` / `cash_handover_history` after the driver is deleted (`driver_id` null row, `full_name` null) | The report groups the null driver; the UI shows "سائق محذوف". Neither side is asserted | `39_cash_handover.sql` (after the K9 block) + `report.test.ts` |
| T7 | Correction with the same amount: `changed: false`, no audit, no notification | Guards against double notifications from a double-click on "تصحيح" | `39_cash_handover.sql` correction block |
| T8 | Dialog: unknown error, then the amount is changed, then `NO_CASH_OUTSTANDING` | M2 | `apps/admin/src/features/cash/*.test.ts` / `cash.spec.ts` |

The rest of SPEC-cash §9.1 is covered with the real role (`tests.as_user` / `tests.as_user_aal1`): the 130
assertions in `39_cash_handover.sql`, the guard lists in `01`/`21`/`28`/`32`, and `12_delete_account.sql` for
`CASH_OUTSTANDING`. Concurrency 5a–5d cover two recorders, deliveries racing handovers, a doubled key and a
fee-setting flip.

## Checks that passed (no finding)

- `orders` has select-only grants. `cash_handover_id` can't be written by any role, and the `delivered` check holds
  even for postgres (test lines 77, 259–263).
- `cash_handovers`: RLS on, every privilege revoked from `anon`/`authenticated`/`service_role`, and the 8 RPCs are
  SECURITY DEFINER with `search_path=""`, `authenticated` only (test line 63).
- Accounting invariant per handover (count, goods, fees match the linked orders) and per driver (test lines 241–255,
  concurrency 5b).
- The `expected = goods + fees?` CHECK, plus the stored `includes_delivery_fee`: old handovers aren't recalculated
  after a setting change (test lines 226–235).
- The opening balance (K8) links every pre-migration delivered order with a driver. Delivered orders always have a
  driver (`NO_DRIVER_ASSIGNED` at `out_for_delivery`, `assign_driver` refuses null and non-active statuses,
  `set_user_role` refuses with `DRIVER_HAS_ORDERS`), so nothing is left unattributed.
- The notification text (`استلمنا منك 1,750 د.ع · نقص 250 د.ع`) contains no staff phone. `my_cash_handovers` gives the
  first name only. K5 returns block and building only (test line 102).
- Admin UI: amounts come from `cash_outstanding`, and the header total is a display sum of the K4 rows. The key is
  generated when the dialog opens, reused only for the same amount, and rotated after `CASH_BALANCE_CHANGED`.
  The amount is cleared on a balance change. A double-click reuses one key. The correct action and the reports are
  hidden for staff, and the database enforces both anyway. The CSV export goes through the shared `toCsv`, which
  neutralises formula injection.
- Driver app: the balance comes from `driver_cash_summary()`, and the list is display only. History is paged through
  `my_cash_handovers`.
- `set_order_status`, `accept_order`, `assign_driver`, `available_orders` and `push-dispatch` are unchanged by
  `20261212000001`.

## Ordered fix list (separate session)

1. **M2**: dialog behaviour after an unknown outcome, plus test T8.
2. **M1**: owner decision. Then (a) add `fees_kept_iqd` to `report_cash` and the reports section.
3. **L1 + T1**: lock order in `begin_account_deletion` (new migration), plus the concurrency scenario.
4. **L2 + L3 + L4 + T2**: harden `record_cash_handover` replay and input (same migration as 3).
5. **L6 + T7**: optimistic check for corrections (same migration), and the note-only decision in SPEC-cash.
6. **L5, L9**: small migration changes, or record them as SPEC assumptions.
7. **L7, L8**: dialog polish.
8. **T3–T6**: test additions.
9. **L10**: when those functions are next replaced.
10. Then the manual dev check (SPEC-cash §14 items 3–4), with the owner's approval.
