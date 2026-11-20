# Review R1: driver registration and `apps/driver` auth (T27–T30)

- **Date:** 2026-11-20. **Scope:** the R1 row of `docs/tasks/00-README.md`, i.e. T27–T30 as merged on `main` at
  `570b1bb`:
  - migration `20261208000001_driver_requests.sql` (D1–D13)
  - Edge Functions `driver-register` and `driver-complete-registration`, plus `_shared/driver.ts`
  - the panel page `/driver-requests` (`apps/admin/src/features/driverRequests/*`, `access.ts`, Sidebar badge)
  - `apps/driver`: session store, guard, login, register, pending, set PIN, forced PIN change, not-driver,
    SecureStore and device secret
  - tests `supabase/tests/36_driver_requests.sql` and the driver block of `32_real_role_writes.sql`, the Deno tests,
    the Jest tests, and `.github/workflows/ci.yml`
- **Method (read-only):** I read the code by hand against SPEC-driver §2–§4, DRIVER-API, SPEC-backend §5/§8,
  RUNBOOK §16b–16d and the earlier `set_user_role` / `admin-reset-pin` code. On mukhdar-dev I ran read-only catalog
  queries only (RLS flags, policies, table grants, function `EXECUTE` privileges per role, row counts, the latest
  migration version) and `get_advisors` (security).
- **Nothing changed in code, migrations, Edge Functions or the cloud.** This file and the R1 status line are the only
  changes.

## Summary

The registration design holds. A request never creates an Auth user. Only the holder of the 256-bit device secret
can turn an approved, unexpired request into an account. The server stores only SHA-256 of the secret. The secret
travels only in POST bodies (never in a URL) and is never logged. Every new table has RLS with no policies and no
grants. Every new function has exactly the grants the SPEC calls for, and dev matches the repo. Tests switch to the
real role for each call.

I found no Critical issues. These need fixing before T31:

1. **High H1. An admin can promote a customer account to `driver` without resetting its PIN.** Customer sign-up has
   no phone verification, so the PIN holder may not own the number. `set_user_role` already blocks this for
   staff/admin (`PIN_RESET_REQUIRED`) but not for driver, and the RUNBOOK path depends on the admin remembering.
2. **Medium M1. An approved request cannot be revoked** for its 7 days. The RUNBOOK tells the admin to "reject" or
   "delete" it, but no function can do that.
3. **Medium M2. The driver app signs the driver out if the app starts offline** with an expired access token. Any
   `getSession()` error, network failures included, wipes the stored refresh token.
4. **Medium M3. The 3-per-day phone limit is counted before the body is validated.** Anyone can lock a specific
   number out of registering for 24 hours with three junk requests.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 8 |

## Where we are

- T01–T20, T22, T23, T25–T30 are ✅. T21 was cancelled (replaced by T27–T33). T04 is optional. T24 (release) is ⬜.
- Driver track: T27 (DB, migration `20261208000001` on dev), T28 (both functions deployed to dev, `it:driver-register`
  green), T29 (panel page, deployed to the Cloudflare preview) and T30 (`apps/driver` auth, PR #17) are done.
- **R1 (this review) is the gate before T31.** Next: the fix list below (one migration, one function redeploy, app
  code), then T31.
- On dev: last migration = `20261208000001`, the same as the repo. `driver_requests` and
  `private.driver_request_rate_limits` are empty (the IT script cleaned up).

## Checked and OK (evidence)

| Area | Result |
|---|---|
| RLS on new tables | dev: `public.driver_requests` and `private.driver_request_rate_limits` have `relrowsecurity = true`, 0 policies, and no table grants to `anon`/`authenticated`/`service_role` (only `postgres`). Advisor INFO `rls_enabled_no_policy` is expected. |
| Function grants (dev) | `driver_request_status`: anon ✓, authenticated ✓, service_role ✗. `driver_request_rate_hit`, `submit_driver_request`, `begin_driver_completion`, `finish_driver_registration`: service_role only. `list_driver_requests`, `decide_driver_request`, `available_orders`: authenticated only (and the function checks the role). Matches D11 and `01_schema.sql`. |
| What anon can call | Exactly one definer function, `driver_request_status` (Advisor WARN `0028` is the documented, intended one). It returns only a status word, and `not_found` for every mismatch (unknown id, wrong secret, wrong length), so it can't tell "no such id" from "wrong secret". A 2^256 secret can't be guessed, so no rate limit is needed. |
| Device secret, app side | `expo-crypto.getRandomBytesAsync(32)` → base64url (43 chars), saved to SecureStore **before** the POST, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `allowBackup: false`. Sent only to `driver-register`, `driver-complete-registration` and the `driver_request_status` RPC (supabase-js POSTs the RPC body, so the secret is not in a URL or gateway log). Cleared on new request, cancel, `not_found`, `completed` and after account creation. No `console.*` anywhere in `apps/driver/src`. |
| Device secret, server side | Functions accept only the exact 32-byte form (`isDeviceSecret`, including the last-char padding-bit check). They hash it with WebCrypto, and the DB compares hashes only (comparing hashes leaks no timing that matters). `scrub()` removes the secret, hash, PIN, phone and name from every logged error, plus any 64-hex string and any run of 9+ digits. Logged phones are masked (`9647******67`). |
| Pending / rejected / expired never get an account | `begin_driver_completion` locks the row and requires a matching hash, `status = 'approved'` and `approved_until > now()`. `finish_driver_registration` requires `approved` again and that the new user's phone equals the request phone. Pending and rejected requests have no Auth user, so sign-in fails. `completed` → `REQUEST_NOT_APPROVED`. An expired approval is replaced (deleted) when the same number registers again, so it can never be completed. |
| Double-tap / concurrent completion | GoTrue's unique phone plus `profiles_phone_key`. The loser gets `phone_exists` or a "Database error", which is checked against `profiles` → 409. It does not delete the winner's account. `it:driver-register` proves this on dev (201 + 409, one account). |
| Decide races | `decide_driver_request` does `FOR UPDATE` and runs only from `pending`. Two admins → `REQUEST_ALREADY_DECIDED`. Approve re-checks `PHONE_TAKEN`. `submit_driver_request` uses a per-phone advisory lock plus the partial unique index (one open request per phone). |
| Push to a device with no account | `claim_push_notifications` gives the request token only while it is `approved` and unexpired. Reject and complete null the token. Outbox rows cascade when the request is deleted. |
| Admin page | `/driver-requests` is `['admin']` in `access.ts`. The DB functions require `private.is_admin()` (aal2), and pgTAP refuses aal1 admin, staff, driver, customer and anon. Approval needs the "I called and confirmed" checkbox. Every decision is written to `admin_audit`. |
| Forced PIN change | The guard sends `must_change_pin` → `auth/change-pin` with no skip. The DB enforces it too: `current_user_role()` returns null while `must_change_pin`, so driver RPCs refuse. The guard is only for routing. |
| Tests use the real role | `36_driver_requests.sql` (97 assertions) and the T32 block switch with `tests.as_anon()`, `as_user` (aal2), `as_user_aal1` and `as_service()`, and use `postgres` only for setup. `auth.users` inserts stand in for GoTrue (as in `32`). The real GoTrue path is covered by `it:driver-register` on dev. A new driver (aal1) then calls `available_orders` and `register_push_token` as itself. |
| CI | `pnpm lint`, `pnpm typecheck`, `pnpm test` include `apps/driver`, with an explicit step asserting `@mukhdar/driver` is in the recursive run. `test:functions` runs `deno check` and the tests for both new functions. The Playwright job covers `/driver-requests`. |
| Retention | Daily purge deletes rejected, completed and expired requests after 30 days, and rate-limit rows after 1 day. |
| `cf-connecting-ip` | A sound choice. Cloudflare sets it and refuses client-supplied copies (Error 1000, shown on dev by the IT script). `x-forwarded-for` / `x-real-ip` are never read. With no header the key is the shared `unknown` (fails closed). See L2 for the operational downside. |

## Findings

### Critical

None.

### High

#### H1. Customer → driver promotion needs no PIN reset (unverified phone owner becomes a driver)

- **Where:** `public.set_user_role` (last defined in `20261202000001_security_f.sql`):
  `v_promote := v_old.role in ('customer','driver') and p_role in ('staff','admin')`. RUNBOOK §16c "رقم مسجّل كزبون",
  SPEC-driver owner decision 2.
- **Problem:** Customer sign-up (`signup`) is phone + PIN with **no SMS/OTP**, so anyone can create a customer account
  on any number. When the real driver registers, they get `PHONE_TAKEN`. The RUNBOOK says to reset the PIN first,
  then `set_user_role(..., 'driver')`. The DB enforces "reset first" for staff/admin (`PIN_RESET_REQUIRED`) but not
  for driver. An admin who skips the reset gives a driver account to whoever squatted the number. Promotion also
  doesn't revoke that account's existing sessions (it's a move up in rank).
- **Impact:** A stranger becomes an active driver. After `accept_order` they see the customer name, phone and full
  address, and get "new order" pushes. The phone call protects the request flow, but not this side path.
- **Fix:** New migration. Redefine `set_user_role` so that `v_old.role = 'customer' and p_role = 'driver'` also
  requires `v_old.must_change_pin` (raise `PIN_RESET_REQUIRED`). The admin then hands the temporary PIN to the person
  on the phone call, and the driver app forces a PIN change. `admin-reset-pin` already revokes sessions. Add pgTAP for
  customer→driver with and without a prior reset, and panel copy for `PIN_RESET_REQUIRED` on the driver choice. This
  hardens owner decision 2 (it was "RUNBOOK only, no DB rule"), so **record it in SPEC-driver/SPEC-backend**. If the
  owner prefers to keep it procedural, say so explicitly as an accepted risk.
- **Needs:** migration (`pnpm sb db push` on dev), panel deploy (Cloudflare via merge). No function redeploy, no app
  rebuild.

### Medium

#### M1. An approved request can't be revoked; RUNBOOK tells the admin to do the impossible

- **Where:** `decide_driver_request` runs only from `pending` (else `REQUEST_ALREADY_DECIDED`). RUNBOOK §16b says
  "الأدمن يقرر: يحذف الطلب" and §16c says "...وارفض الطلب". No function deletes or rejects an approved request, and
  the panel has no button for it.
- **Problem:** Say that after approval the admin learns the caller lied, the real owner calls to object, or the number
  turns out to belong to a customer (`PHONE_TAKEN` at completion). The approval then stays live for up to 7 days. If
  the blocking customer account is later deleted, the device can still complete.
- **Impact:** A mistaken approval can't be undone except through SQL by the owner (and `execute_sql` is barred by
  CLAUDE.md). The RUNBOOK steps fail.
- **Fix:** New migration. Let `decide_driver_request(p_id, false, note)` also act on `approved` (expired or not, but
  not `completed`) → `rejected`, null `push_token`, write to audit (`before.status = 'approved'`). Add a "سحب
  الموافقة" action in "آخر القرارات" for approved/expired rows. Fix the RUNBOOK §16b/§16c wording. pgTAP: revoke →
  `begin_driver_completion` = `REQUEST_NOT_APPROVED`, status `rejected`.
- **Needs:** migration, panel deploy.

#### M2. Driver app wipes the session on any `getSession()` error, including offline start

- **Where:** `apps/driver/src/features/auth/store.ts` `initAuth`: `if (error) await localSignOut(client)`.
- **Problem:** supabase-js `getSession()` refreshes an expired access token. On a network failure
  (`AuthRetryableFetchError`) it returns `{session: null, error}` but **keeps** the stored session. The driver app then
  calls `signOut({scope:'local'})`, which deletes the refresh token. The customer app does not do this: it ignores the
  error and keeps the session.
- **Impact:** A driver who opens the app with no signal after an hour or more (lifts, basements, between buildings) is
  signed out and must type the PIN again. A forgotten PIN means a call to the shop. Not a security hole, but it hurts
  daily use and T31 will lean on this store.
- **Fix:** Sign out only for a definite rejection: `AuthApiError` with status 400/401 or codes `refresh_token_not_found`
  / `refresh_token_already_used` / `session_not_found`. For retryable or network errors, keep the session, set
  `profileError`-style state and retry on the next foreground. Add a Jest case for `AuthRetryableFetchError` → no
  `signOut`.
- **Needs:** app code only (no build exists yet).

#### M3. Per-phone limit is spent before validation → targeted 24 h registration lockout

- **Where:** `driver-register/handler.ts` step 1 calls `rateHit(ip, phone)` before the name/secret checks.
  `driver_request_rate_hit` counts the phone bucket (3/24 h) on every hit.
- **Problem:** Three requests with the victim's number and an invalid name (or no secret) use up that number's daily
  allowance, from three different IPs if needed. Same-device retries (the app reuses the secret on purpose) also count.
  A driver on a bad connection who taps "send" three times is locked out for a day.
- **Impact:** Anyone who knows a driver's number can stop them registering, renewable daily. Low cost, and SPEC §3
  didn't intend this side effect.
- **Fix:** In the handler, hit the **IP bucket first** (`rateHit(ip, null)`) before any work. Hit the **phone bucket
  only after** the body, name and secret are valid, and only when the request would create a new row. Simplest: let
  `submit_driver_request` skip the phone count when it returns an existing id (same hash), via a new
  `p_count_phone`-style split or a dedicated `driver_request_phone_hit` (service_role). Update the Deno order tests
  ("limit before any work" still holds for the IP).
- **Needs:** function redeploy (`driver-register`). A migration only if you choose the DB-side split.

#### M4. Admin "new driver request" push carries attacker-chosen text to admin phones

- **Where:** `submit_driver_request` → `_notify('admins_only', ..., 'طلب سائق جديد: ' || v_name)`.
- **Problem:** The name is anonymous input (cleaned, 2–80 chars). Anyone can make every admin phone show
  "طلب سائق جديد: <any text>", up to 10/h per IP and 50 pending in total. That is a cheap phishing or annoyance
  channel ("call 07… now"), and the admin has to read these.
- **Impact:** Social engineering aimed at the person who approves drivers. Low volume, but it goes straight to the
  most privileged users.
- **Fix:** New migration. Make the push body generic ("طلب سائق جديد، افتح طلبات السواق") and keep the name only in the
  panel. Optionally reject names containing digits or URLs (`NAME_INVALID`), which also slows phone-number spam in
  the list.
- **Needs:** migration (can share H1/M1's).

### Low

#### L1. `finish_driver_registration` doesn't re-check `approved_until`

- **Where:** D7. **Problem:** Expiry is checked in `begin` only. A completion that starts a second before expiry
  finishes after it. **Impact:** Negligible (a window of seconds, same device, same approval). **Fix:** Add
  `approved_until > now()` (else `REQUEST_EXPIRED`) in the M1 migration, so the SPEC's "conditional transition" is
  literally true. **Needs:** migration.

#### L2. `cf-connecting-ip` limit vs carrier NAT, and the shared `unknown` key

- **Where:** `_shared/driver.ts`, `driver_request_rate_hit` (10/h per IP, shared by both functions).
  **Problem:** Iraqi mobile carriers use CGNAT heavily, so many phones share one public IP. If Supabase ever stops
  sending `cf-connecting-ip`, every caller shares `unknown`, which means 10 registrations/hour for the whole shop.
  **Impact:** Rare legitimate 429s. Registrations are few, so acceptable. **Fix:** No code change now. Add a RUNBOOK
  monitoring line ("many `rate limited` with few `done` = CGNAT or missing header; check that the `ip` bucket key
  count isn't 1"), and re-verify the header on the production project before launch (RUNBOOK §17.4). **Needs:** docs.

#### L3. Phone enumeration via `PHONE_TAKEN` / `REQUEST_EXISTS`

- **Where:** `driver-register`. **Problem:** Anon learns whether a number has an account (same as `signup`, accepted
  in SPEC §3) and whether it has an open driver request (new). **Impact:** Limited by 10/h per IP and 3/day per phone.
  **Fix:** Accept and document `REQUEST_EXISTS` next to `PHONE_TAKEN` in SPEC-driver §3. No code. **Needs:** docs.

#### L4. Orphan-account recovery requires manual Auth deletion

- **Where:** `driver-complete ORPHAN account` log path. **Problem:** If `finish` fails and `deleteUser` fails, a
  customer account remains with the driver's chosen PIN. The request stays approved, and retries get `PHONE_TAKEN`.
  The owner of that account is the legitimate device holder, so this is not a security issue. **Fix:** After H1 the
  RUNBOOK could say "or reset PIN + promote" instead of only "delete by hand". **Needs:** docs.

#### L5. Expired approvals are hard-deleted on re-registration, losing history

- **Where:** `submit_driver_request` (`delete ... where id = v_open.id`). **Problem:** The "آخر القرارات" tab loses the
  old approval (who approved it and when). `admin_audit` still has the decision. **Fix:** Optional: mark it
  `rejected` with note "انتهت" instead of deleting (the unique index is only over pending/approved). **Needs:**
  migration (optional).

#### L6. Guard sends a session with an unreadable profile to the tabs

- **Where:** `guard.ts` (`if (!p) return ... ROUTES.home`). **Problem:** If the profile read fails at startup, the
  user lands on the tabs. The DB refuses non-drivers and `must_change_pin`, so there is no access, but T31 screens
  must handle `NOT_ALLOWED` by calling `refreshProfile` (SPEC §2.6 already says so). **Fix:** Carry this into the T31
  checklist and add a test that `NOT_ALLOWED` on `available_orders` re-runs the guard. **Needs:** none now.

#### L7. CI doesn't bundle the driver app

- **Where:** `ci.yml`. The customer app gets `expo export -p web`, the driver app only lint/typecheck/jest.
  **Problem:** A Metro bundling or `app.config.ts` failure would first show up at the EAS build (T32/T33).
  **Fix:** Add `pnpm --filter @mukhdar/driver exec expo config --type public` and
  `expo export -p android --output-dir /tmp/driver-bundle` (no EAS, no network keys) to the build job. **Needs:** CI
  only.

#### L8. Panel badge fetches the whole pending list

- **Where:** `fetchPendingDriverRequestCount` calls `list_driver_requests('pending', 200)` and takes `.length`.
  **Problem:** It pulls names and phones on every sidebar poll just to count them. Bounded at 50 rows by
  `TOO_MANY_PENDING`, so this is minor. **Fix:** A `pending_driver_requests_count()` (admin aal2) in the next
  migration, or leave it. **Needs:** optional migration + panel deploy.

## Ordered fix list (before T31)

| # | Item | Change | Deploy |
|---|---|---|---|
| 1 | H1 customer→driver needs `must_change_pin` | migration `set_user_role` + pgTAP (`36`, `32`) + panel message + SPEC-driver decision 2 / SPEC-backend note (owner confirms) | `pnpm sb db push` (dev), panel via merge |
| 2 | M1 revoke an approved request (+ L1 expiry in `finish`) | same migration: `decide_driver_request` from `approved`; `finish` checks `approved_until`; panel "سحب الموافقة"; RUNBOOK §16b/§16c wording; pgTAP + Playwright | same |
| 3 | M4 generic admin push text (+ optional name rule) | same migration: `submit_driver_request` | same |
| 4 | M3 phone bucket after validation, not on same-hash resubmit | `driver-register` handler (+ DB split if chosen) + Deno tests | redeploy `driver-register` on dev (owner approval) |
| 5 | M2 keep the session on retryable `getSession` errors | `apps/driver/src/features/auth/store.ts` + Jest | none (no build yet) |
| 6 | L7 driver bundle in CI | `ci.yml` | none |
| 7 | L2, L3, L4 docs | RUNBOOK §16b, SPEC-driver §3 | none |
| 8 | L5, L8 (optional) | fold into the migration if convenient | — |

Items 1–3 fit into **one** new migration. Run `pnpm it:driver-register` again after items 1–4, and
`pnpm sb migration list --remote` must show no difference.
