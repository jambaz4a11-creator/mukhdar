# Review of T23 fix sessions E1 and E2

- **Date:** 2026-11-17. **Scope:** the E1/E2 commits only (`dc0f126`, `54bfd5c`, `faeefb6`, `6add82f`, `aa07ca6`):
  migrations `20261130000001_security_t23.sql` and `20261201000001_security_t23_e2.sql`, the redeployed
  `admin-reset-pin` / `admin-create-user` (+ `_shared/admin.ts`, `cors.ts`, `supabase.ts`), panel `/mfa`, `IdleGuard`,
  `proxy.ts`, `security.ts`, `next.config.ts`, `safeNext`, lockdown dialog, account anonymization, staff 7-day window,
  new-account limit, push-token cap, `seed:*` / `sb` / `load` / break-glass guards, RUNBOOK §17, DRIVER-API.
- **Method (read-only):** code read by hand; mukhdar-dev queried only inside `begin transaction read only`
  (`pg_get_functiondef` of every `public`/`private` function, `pg_policies`, FKs, triggers, factor/label/session
  counts, a daily-stats recomputation); `get_advisors` (security); Edge Function list (versions, `verify_jwt`);
  Supabase docs (API keys / Edge Functions); local `pnpm build` of the panel to see which routes are static.
- **Nothing changed in code, migrations, Edge Functions or the cloud.** This file is the only change.

## Summary

E1/E2 mostly hold. The aal2 gate sits in `private.current_user_role()`, and every role helper, RLS policy, storage
policy, report, dashboard and Realtime check goes through it (checked function by function on dev: every
`authenticated`-executable definer function either uses the helpers or is customer/driver-only by design). The
idle check is enforced on the server, fails closed and never revives a session. It cannot lock out the only admin for
good: a new sign-in creates a new session. Polling and Realtime do not count as activity. CORS, `safeNext`, the
headers, the prod script guards and the break-glass MFA reset are sound. Report totals match a full recomputation.

Two things still need fixing before launch:

1. **A PIN-only (aal1) staff/admin session can still subscribe to the staff push feed** (High, H1 below). This is
   the one path around C1.
2. **The prod checklist will break the Edge Functions.** RUNBOOK §17.5 says to turn off the legacy keys and switch to
   asymmetric JWT signing keys. The functions (and the new idle check) still read the legacy keys and use
   `verify_jwt = true` (High, H2).

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 8 |

## Checked and OK (evidence)

| Area | Result |
|---|---|
| aal2 everywhere | `private.is_admin` / `is_staff_or_admin` → `current_user_role()` (aal2 + idle check). Definer RPCs executable by `authenticated` without a helper: `place_order`, `rate_order`, `register_push_token`, `touch_panel_session` (customer/self only, see H1), `ratings_*`/`report_*` (via `ratings_guard` / `report_guard`, which use the helpers). Storage `product-images` write/list policies: `private.is_admin()`. Realtime: only `orders`, filtered by `orders_read`. Panel: no route handlers; the only server action is `signOut`; server components query with the user JWT (RLS). Edge Functions: `requireAdmin` = `getUser` (Auth verifies the token and session) + `aal` from the same token + `touch_panel_session` (fails closed: 500 / 401 `SESSION_EXPIRED`). |
| Downgrade / bypass | Refresh keeps the same `session_id` and aal; an idle session cannot be revived (`touch` deletes `auth.sessions`; `current_user_role()` is null before that). The `.invalid` label is unconfirmed (0 confirmed on dev, 0 `email` identities); any sign-in through it would be aal1 anyway. No SMS/email recovery path exists. Unenrolling a verified factor needs aal2 (GoTrue). Change-PIN signs in again (aal1) and needs the TOTP step before `updateUser`. |
| Break-glass MFA | `break_glass_reset_mfa`: `service_role` only (not `authenticated`), admin targets only, row-locked, audited (`mfa_reset`, `via = break_glass`), sessions revoked. Script: TTY only, refuses `CI`, typed ref for non-dev. `admin_reset_mfa` refuses admin targets and self. |
| Idle | `panel_sessions` row per panel session (56 on dev, 0 stale), FK cascade to `auth.sessions`. Polling/Realtime never call `touch`; only proxy navigation (throttled 120 s) and `pointerdown`/`keydown`/`visibilitychange`. |
| Staff window | `orders_read` staff clause = open, or `created_at ≥ start of Baghdad day −6`. `order_items` / `order_status_history` inherit via `exists`. `/print` and order details read through RLS. `dashboard_today` returns counts only. Realtime follows the policy. **Exception: ratings (M1).** |
| Anonymization | `BEFORE DELETE` trigger on `profiles`; FKs: `push_tokens`, `addresses`, own `notification_outbox` rows → cascade; `orders.customer_id`, `ratings.customer_id` → set null. `orders` has no triggers, so the anonymizing UPDATE cannot touch `daily_stats`. Recomputation on dev (29 days): delivered count, revenue, delivery fees, cost, cancelled count and `net = gross − waste − adjust_loss` all match `daily_stats` (0 mismatches; revenue 13,423,250 = 13,423,250). Backfill left 0 orders with PII and no customer. `auth.audit_log_entries` is empty on dev. **Leftovers: L5.** |
| New-account limit | Checked under the per-customer advisory lock that `admin_cancel_customer_orders` and `begin_account_deletion` also take; the profile is re-read after the lock. Idempotent replay is answered before the check (correct). |
| Lockdown | Admin only; deactivates first (sessions + push tokens gone, `user_role` audit), then cancels through `set_order_status` (stock returned, history, daily stats, driver notified), then `customer_lockdown` audit. Concurrent `place_order` waits for the lock and then sees the account inactive. |
| CSP / headers | Production: `script-src 'self' 'nonce-…' 'strict-dynamic'` (no `unsafe-eval`; dev only), `style-src 'unsafe-inline'` (Next/Tailwind style attributes; acceptable), `connect-src` = self + Supabase https/wss, `img-src` self/blob/data/Supabase (Storage, upload preview), `font-src 'self'` (`next/font` self-hosts), `frame-ancestors 'none'`, `form-action 'self'`. CSV export (Blob download) and `wa.me`/`tel:` links are navigations and are not affected. `Referrer-Policy: same-origin` (keeps sign-out working). **Static pages: L2.** |
| Scripts | `projects.mjs` disjoint lists (throws on overlap); `assertSafeTarget` refuses a prod ref in the linked ref **or** the pooler URL, refuses a pooler URL for another project, `MUKHDAR_ENV=production`, and non-local `DB_URL`; `sb` checks `--db-url` against the classified project and accepts `--dry-run` only for `db push` / `migration`; load test on prod needs `--target=prod` + TTY + typed ref; seed/reset run as child processes against a faked prod link in `seed-guard.test.mjs`. The dev TOTP secret is used only by `seed:demo` (refuses non-dev) and the e2e helpers (demo accounts that do not exist on prod). **Allow-list edit before the prod ref exists: L3.** |
| RUNBOOK §17 | 31 migrations listed, in file order, #30/#31 with their prerequisites; `ALLOWED_ORIGINS` before the admin functions, with a curl check; TOTP; panel (Vercel) and customer app rebuild notes; §17.5 dashboard list. **Order of steps 2/3: L1. Keys/JWT: H2.** |
| Advisors (dev, now) | **34 WARN, 0 ERROR** = 33 × `authenticated_security_definer_function_executable` (exactly the list in RUNBOOK §5) + `auth_leaked_password_protection`. Matches the expected count. Plus 4 INFO `rls_enabled_no_policy` (`private.panel_sessions`, `private.signup_rate_limits`, `public.admin_function_hits`, `public.notification_outbox`): intended (no client access); RUNBOOK §5 does not mention INFO lints (see L1). |
| Deployed functions (dev) | `admin-reset-pin` v6, `admin-create-user` v5, both `verify_jwt = true`, updated with E2. |
| Tests (this review, local) | `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm test`: shared 237, admin 291, customer 217, scripts 54 (all pass), `pnpm test:functions` (Deno) 76 pass. pgTAP and Playwright run in CI on a local stack (not run against dev: they write). |

---

## High

### H1. PIN-only (aal1) or idle staff/admin sessions can receive the staff push feed
- **Where:** `public.register_push_token` (E2 version: checks only `auth.uid()` and `must_change_pin`) and
  `public.claim_push_notifications` (recipients chosen by `profiles.role in ('admin','staff')`, not by
  `current_user_role()`).
- **Problem:** with only a staff or admin PIN (no TOTP), someone signs in (aal1) and calls
  `rpc/register_push_token` with their own Expo token. From then on every `admins` notification goes to their device
  (`طلب جديد #N`, `وحدة A3 - عمارة 12 · المجموع …` for every new order), and for an admin also every `admins_only`
  notification. The token stays registered after the session ends. A stolen refresh token from an idle session can do the
  same: `current_user_role()` is null but the RPC does not check it. Today there are 0 staff/admin tokens on dev, because
  the panel never registers any, so every such token would come from someone working around the panel.
- **Impact:** a live feed of order volume, unit, building and totals without the second factor. This is the one
  remaining way around C1 (no names or phones in push bodies).
- **Fix:** new migration: (1) in `register_push_token`, if the caller's profile role is `admin`/`staff`, require
  `private.current_user_role() is not null` (aal2, not idle), else `MFA_REQUIRED` 42501. Simpler alternative, since
  the panel has no push: refuse every `admin`/`staff` caller with `NOT_ALLOWED`. (2) `delete from push_tokens` for
  current admin/staff users. (3) `admin_reset_mfa` / `break_glass_reset_mfa` also delete the target's tokens
  (`set_user_role` already does on demotion). pgTAP: aal1 staff → refused; aal2 staff → per the chosen rule.
- **Needs:** migration only. No redeploy, no rebuild. DRIVER-API unaffected (drivers keep aal1).

### H2. Prod checklist (legacy keys off, asymmetric JWT keys on) will break the Edge Functions, including the new idle check
- **Where:** RUNBOOK §17.5 "API keys" ("disable the legacy `anon`/`service_role` keys … enable asymmetric JWT signing
  keys") and "Edge Functions: `verify_jwt` = true for the other three"; `_shared/supabase.ts` reads
  `SUPABASE_SERVICE_ROLE_KEY`, and since E2 also **`SUPABASE_ANON_KEY`** (`touchSession`); `delete-account`,
  `signup`, `push-dispatch` read `SUPABASE_SERVICE_ROLE_KEY`.
- **Problem:** Supabase's current docs ("Migrating to publishable and secret API keys", "Understanding API keys") say
  the legacy keys keep working **until the end of 2026**. The new keys arrive as `SUPABASE_SECRET_KEYS` /
  `SUPABASE_PUBLISHABLE_KEYS` (JSON by name). The built-in `verify_jwt` check understands only the legacy JWT-based
  keys, so the docs advise `verify_jwt = false` with authorization in code. If the owner follows §17.5 as written, or
  simply launches after 2026-12-31, `touchSession` and `serviceClient()` fail. `requireAdmin` then answers
  `500 INTERNAL` (fails closed): no PIN resets and no staff/driver creation. `signup`, `delete-account` and
  `push-dispatch` also fail.
- **Impact:** a launch blocker of the same kind as T23 H1: no data exposure, but the admin flows stop working and the only
  way left is manual SQL.
- **Fix:** (1) one `_shared/keys.ts`: read `SUPABASE_SECRET_KEYS['<name>']` / `SUPABASE_PUBLISHABLE_KEYS['default']`,
  falling back to the legacy variables, and fail loudly if neither is set. (2) `verify_jwt = false` for
  `admin-reset-pin`, `admin-create-user`, `delete-account` (all three already verify the user with `auth.getUser`
  in code; keep a Deno test that a missing or invalid bearer gives 401). (3) RUNBOOK §17.5: turn off legacy keys only
  after the functions are redeployed and checked on dev with the legacy keys **off**; check the actual cut-off date
  shown in the dashboard. (4) The Vault `push_dispatch_url` / `pg_net` call: check which key it sends (the new keys
  are rejected in `Authorization: Bearer`; they go in `apikey`).
- **Needs:** Edge Function change + redeploy (all five) + `config.toml` + RUNBOOK. Test on dev with a disposable
  secret key first (cloud change: owner approval).

---

## Medium

### M1. Staff 7-day rule bypassed through ratings
- **Where:** `public.ratings_list` / `ratings_summary` (SECURITY DEFINER, `ratings_guard` = staff or admin, no date
  floor for staff); policy `ratings_read` (`… or private.is_staff_or_admin()`).
- **Problem:** staff can page through **every** rating ever made with `order_number` and `customer_name`
  (`ratings_list` joins `orders` as definer, so the `orders_read` window does not apply), and read
  `ratings` directly (comment, `customer_id`, `order_id`, all time).
- **Impact:** the M6 goal ("the customer base doesn't leave with an employee") is partly undone: names of everyone
  who ever rated, plus links of customer ids to orders. No phones or addresses.
- **Fix:** migration: for staff (`not private.is_admin()`), `ratings_list` / `ratings_summary` clamp `p_from` to
  `baghdad_today() - 6` (or filter `o.created_at` with the same predicate as `orders_read`). `ratings_read`:
  staff clause gets `created_at >= …same floor…`. Panel ratings screen: show the 7-day note to staff (as on orders).
  pgTAP boundary tests next to `30_security_e2.sql`.
- **Needs:** migration + small panel text change.

### M2. "First enrolment wins" for staff/admin accounts without a verified TOTP factor
- **Where:** `/mfa` (enrol at aal1 when no verified factor), `set_user_role` (promotion keeps the PIN and any existing
  factor), `admin_reset_mfa`, break-glass `--mfa-only`, new staff from `admin-create-user`.
- **Problem:** while a staff/admin account has no verified factor, anyone who knows its PIN can enrol **their own**
  authenticator and get aal2. Windows: (a) **promotion of an existing customer**: the PIN was chosen by the customer
  and is the guessable kind (T23 M1), and a factor that an attacker pre-enrolled while holding the customer account
  (any user can call `mfa.enroll`) survives the promotion; (b) a new staff account between the WhatsApp temp PIN and
  the first sign-in; (c) after `admin_reset_mfa` or `break-glass --mfa-only` (the PIN is unchanged).
- **Impact:** C1 is only as strong as the onboarding channel. For (a) it can be no stronger than a customer PIN.
- **Fix:** migration: on promotion to `staff`/`admin` in `set_user_role`, run `private.reset_mfa_factors` (drops any
  pre-existing factor) and revoke sessions. Process (RUNBOOK §7/§16 + panel hint): promote only after an admin PIN
  reset (temp PIN + `must_change_pin`), and do the first sign-in with `/mfa` enrolment **in person** on the shop PC;
  make `--with-mfa` the recommended break-glass mode; after `admin_reset_mfa` also reset the PIN. Optional: an
  "awaiting 2FA enrolment" badge on `/staff` (count of staff/admin without a verified factor).
- **Needs:** migration + RUNBOOK + optional panel badge.

### M3. H2 residual: one new account can still reserve 600 units
- **Where:** `place_order` limits after E2: 1 open order (new account) × `max_order_lines` 30 × `max_line_qty` 20.
- **Problem:** the original H2 fix list also asked for a per-order cap on total units or subtotal (`max_order_iqd`);
  it was not done. Dev stock: 60 products, median 100 units. Five fresh accounts (`signup` allows 20/h per IP)
  empty a product completely, and about 15 accounts take most of 30 products, all within an hour from one IP. Getting
  one cheap delivered order (`min_order_iqd` = 0) also lifts an account to `max_active_orders`.
- **Impact:** reduced but still practical stock DoS. Staff now have the lockdown button, but the cleanup is per account.
- **Fix (owner decision on numbers):** `app_settings.new_account_max_line_qty` (e.g. 6) and/or `max_order_iqd` /
  `new_account_max_order_iqd` checked after pricing in `place_order`; optionally a minimum delivered subtotal before
  the new-account limit lifts. Customer app error texts.
- **Needs:** migration + customer app text (rebuild) + settings form field.

### M4. After 12 h idle, the panel goes silently empty instead of signing out
- **Where:** `IdleGuard` (signs out only on user input), `PanelProviders` Realtime, polling (`refetchInterval` on
  dashboard/ratings/settings), orders list via RLS.
- **Problem:** once `last_seen` is more than 12 h old, `current_user_role()` is null. Realtime stops delivering, the
  orders query returns `[]` (RLS, no error), and the dashboard poll fails with `NOT_ALLOWED`. The sign-out happens only on the next
  click, key press or tab focus. A shop screen left open overnight shows **"no orders"** in the morning while new orders arrive
  (no sound either). The current design is right that polling must not extend the session.
- **Impact:** missed orders (operations), not a security hole.
- **Fix:** add `public.panel_session_alive()` (read-only: same predicate as `current_user_role()`, never updates
  `last_seen`) and call it from the existing poll or on any `42501` from a panel query. On `false` →
  `signOut({scope:'local'})` + `/login?reason=idle`. Or a client timer at 12 h since the last `touch`, as a second line
  (the server stays authoritative).
- **Needs:** small migration + panel.

### M5. DRIVER-API: anonymized orders are driver-visible and the "Changes" section is not updated
- **Where:** DRIVER-API §2 (E2 note: "drivers only ever see those for orders they hold, which are never final"), §4
  (`address_snapshot` shape, delivered history query), "Changes for the driver app (2026-11-16)".
- **Problem:** `orders_read` gives a driver **all** orders with `driver_id = uid`, including `delivered` ones (§4's own
  "history: delivered by me" query). After a customer deletes their account, those rows have `customer_name` /
  `customer_phone` / `note` null and an `address_snapshot` with **only** `sector` and `subsection` (`building`,
  `apartment`, `note`, `address_id` keys are gone). A driver app that reads `address_snapshot.building` without
  checking for null can crash on the history screen. The E1/E2 driver-visible items are also not in the "Changes"
  section the developer is told to read: the separate driver demo PIN (L6), the 5-token push cap per account (an older
  device stops getting pushes), lockdown cancelling an `out_for_delivery` order (push `تم إلغاء الطلب #N` with reason
  `إلغاء من الأدمن: حساب موقوف`), and name text cleaning.
- **Impact:** possible crash or blank fields in the third-party app; the contract and the code disagree.
- **Fix:** docs: new dated block "Changes for the driver app (2026-11-17, T23)" listing the four items above; correct
  the §2 sentence; add to §4 an anonymized `address_snapshot` example (`{ "sector": …, "subsection": … }`) and "every
  other key may be missing".
- **Needs:** docs only (send to the driver developer).

---

## Low

### L1. RUNBOOK §17: step order contradicts mandatory rule 3; INFO lints not listed
- **Where:** §17.1 rule 3 ("enable TOTP **before** `20261130000001`") vs §17.2 (step 2 `db push`, step 3 Auth
  settings incl. TOTP, "before is better"); §5 lists only the 34 WARN.
- **Fix:** move "§6 step 8 TOTP: Enabled" into §17.2 before step 2 (on a fresh project no one can be locked out, but
  the doc should not contradict itself). §5: add the 4 expected INFO `rls_enabled_no_policy` tables.
- **Needs:** docs.

### L2. Statically prerendered pages run with every script blocked by the CSP
- **Where:** `pnpm build`: `/privacy`, `/terms`, `/delete-account`, `/not-authorized`, `/_not-found` are `○` (static).
  Their HTML has 11 `<script>` tags and 0 `nonce=`; with `'strict-dynamic'` the browser ignores `'self'`, so all are
  blocked.
- **Problem / impact:** today the pages are pure server HTML (the `/not-authorized` sign-out is a native form post), so
  they work, but they log CSP violations and never hydrate. A client component added to them later would silently fail.
- **Fix:** make them dynamic (`export const dynamic = 'force-dynamic'` in `(public)/layout.tsx` and `not-authorized`,
  or `await connection()`), or add a code comment plus a Playwright check that no CSP violation is logged on `/privacy`.
- **Needs:** panel rebuild.

### L3. The allow-list guard is only as strong as `PROD_PROJECT_REFS` being filled in
- **Where:** `scripts/lib/projects.mjs` (`PROD_PROJECT_REFS = ['REPLACE_WITH_MUKHDAR_PROD_REF']`).
- **Problem:** until the real ref is written there, adding the prod ref to `DEV_PROJECT_REFS` makes it "dev" for
  `seed:demo` (the demo admin with the public `DEMO_PIN` + the published dev TOTP secret), `seed:reset`, `it:*` and `sb`.
  RUNBOOK §17.2 step 1 fills the ref in the same commit that creates the project, so this is a process risk only. Running
  `npx supabase …` directly (outside `pnpm sb`) has no guard at all.
- **Fix:** second, independent check inside the database: `seed:*`/`it:*` require
  `current_setting('app.mukhdar_env', true) = 'dev'` (set once on dev with `alter database postgres set
  app.mukhdar_env = 'dev'`, never on prod). RUNBOOK: "never call `supabase` directly; use `pnpm sb`".
- **Needs:** script change + one dev database setting (owner approval).

### L4. Lockdown books `out_for_delivery` goods as waste with no undo
- **Where:** `admin_cancel_customer_orders` → `set_order_status(…, p_return_stock => false)` for `out_for_delivery`.
- **Problem:** for a fake customer, the driver normally brings the bag back. The waste cost is already in net profit;
  a later positive stock adjustment restores the quantity but not the profit, so the books show a loss that did not happen.
  This follows the owner's ADR 0003 decision.
- **Fix (owner choice):** lockdown skips `out_for_delivery` orders and lists them in the result and the dialog ("on the
  way: decide when the driver is back"), or a "goods returned" action that reverses the waste movement.
- **Needs:** migration + panel dialog text, only if the owner changes the decision.

### L5. Anonymization leftovers
- **Where:** `orders.cancel_reason` and `order_status_history.note` (a customer can pass free text as `p_reason`
  through the API when cancelling a pending order; it is not cleaned (L3) or anonymized); `notification_outbox` rows for the
  `admins`/driver audiences keep `وحدة … - عمارة N` with the order id for up to 30 days; Edge Function logs (plan
  retention); `auth.audit_log_entries` (empty on dev, prod setting not checked).
- **Fix:** migration: `anonymize_customer_orders` also nulls `cancel_reason` and the history `note` of rows the customer
  wrote (`changed_by = customer`), and deletes unsent/sent outbox rows whose `data->>'order_id'` is one of the customer's
  orders; `set_order_status` cleans `p_reason` with `private.clean_user_text`. RUNBOOK §17.5: check that the Auth
  audit log is not stored in the database (or add it to the 7-day/30-day retention text on `/privacy`).
- **Needs:** migration + RUNBOOK.

### L6. Idle panel sessions are never purged
- **Where:** `private.panel_sessions` / `auth.sessions`: an idle session is deleted only when it calls `touch`.
- **Problem:** the refresh token of an abandoned session stays valid forever for own-row access (own profile/addresses,
  `register_push_token`, see H1).
- **Fix:** add to the daily `purge_push_history` cron (or a new job):
  `delete from auth.sessions s using private.panel_sessions p where p.session_id = s.id and p.last_seen < now() - interval '12 hours'`.
- **Needs:** migration.

### L7. A staff member's PIN alone can delete the staff account
- **Where:** `delete-account` → `begin_account_deletion` (refuses only `admin`).
- **Problem:** at aal1, with only a staff PIN, someone can delete that staff account. This is sabotage only, with no data
  access, and it loses the audit link (`actor` set null).
- **Fix:** `begin_account_deletion` refuses `staff` too (staff leave via admin deactivation, like admins), or requires
  `private.current_user_role() = 'staff'` (aal2).
- **Needs:** migration (+ panel text if staff ever see a delete button).

### L8. Lockdown and `set_user_role` on the same target can deadlock
- **Where:** `admin_cancel_customer_orders` locks the target profile, then (inside `set_user_role`) all admin rows;
  `set_user_role` locks admin rows, then the target.
- **Impact:** two admins acting on the same customer at the same instant → Postgres aborts one with `40P01`; the panel
  shows a generic error. No data damage.
- **Fix:** in `admin_cancel_customer_orders`, take the admin-row lock (`perform … where role = 'admin' and is_active
  order by id for update`) before the target lock, or ignore it.
- **Needs:** migration (optional).

---

## Ordered fix list

| # | Item | Severity | Needs |
|---|---|---|---|
| 1 | **H1** `register_push_token` refuses aal1/idle admin/staff; purge their tokens; MFA reset deletes tokens | High | Migration |
| 2 | **H2** Edge Functions read the new keys (fallback to legacy), `verify_jwt = false` for the 3 user-JWT functions, RUNBOOK §17.5 key/JWT order, test on dev with legacy off | High | Function change + redeploy (5), `config.toml`, RUNBOOK; dev test needs owner approval |
| 3 | **M1** ratings follow the staff 7-day window (`ratings_list`/`summary`, `ratings_read`) | Medium | Migration + panel text |
| 4 | **M2** promotion to staff/admin resets factors; in-person enrolment; break-glass `--with-mfa` recommended | Medium | Migration + RUNBOOK (+ optional panel badge) |
| 5 | **M4** read-only `panel_session_alive()` checked by the poll → sign out instead of an empty screen | Medium | Migration + panel |
| 6 | **M5** DRIVER-API "Changes (2026-11-17)" block, §2 correction, anonymized `address_snapshot` example | Medium | Docs (send to driver developer) |
| 7 | **M3** per-order unit/subtotal cap for new accounts (owner numbers) | Medium | Migration + customer app text (rebuild) + settings field |
| 8 | **L5 + L6 + L7** anonymize `cancel_reason`/history note/outbox, clean `p_reason`, purge idle sessions, staff self-deletion | Low | One migration + RUNBOOK |
| 9 | **L1** RUNBOOK §17.2 TOTP before `db push`; §5 INFO lints | Low | Docs |
| 10 | **L2** dynamic public pages (or documented + Playwright CSP check) | Low | Panel rebuild |
| 11 | **L3** DB-side `app.mukhdar_env = 'dev'` marker for data scripts | Low | Scripts + one dev setting (approval) |
| 12 | **L4, L8** lockdown on the way / lock order | Low | Owner decision; optional migration |

Items 1–2 should be done before T24 / go-live. Items 1, 3, 4, 5 and 8 fit in one new migration (plus the panel bits).
Item 2 does not touch the database.
